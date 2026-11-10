use aws_lc_rs::{
    aead::{self, Aad, LessSafeKey, UnboundKey},
    digest, hmac, rand,
    key_wrap::{AesKek, KeyWrapPadded, AES_256},
    rsa::{OaepPrivateDecryptingKey, OAEP_SHA256_MGF1SHA256},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Once;
use zeroize::{Zeroize, Zeroizing};

pub type Res<T> = Result<T, &'static str>;

pub const RSA_PART_LEN: usize = 384;
const MAC_DOMAIN: &[u8] = b"tpm-msk/delivery/v1";

static MLOCK_WARNED: Once = Once::new();
static MLOCK_FAILS: AtomicU64 = AtomicU64::new(0);

/// Raises the soft RLIMIT_MEMLOCK to the hard limit where allowed. Logs the resulting limit.
pub fn raise_memlock() {
    let mut r = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
    unsafe { libc::getrlimit(libc::RLIMIT_MEMLOCK, &mut r) };
    if r.rlim_cur != r.rlim_max { r.rlim_cur = r.rlim_max; unsafe { libc::setrlimit(libc::RLIMIT_MEMLOCK, &r) }; }
    unsafe { libc::getrlimit(libc::RLIMIT_MEMLOCK, &mut r) };
    eprintln!("memlock limit: soft={} hard={}", r.rlim_cur, r.rlim_max);
}

/// Locks one page, unlocks it. Prints the result line.
pub fn mlock_self_test() {
    let page = 4096usize;
    let buf = vec![0u8; page * 2];
    let aligned = unsafe { buf.as_ptr().add(buf.as_ptr().align_offset(page)) };
    if unsafe { libc::mlock(aligned.cast(), page) } == 0 {
        unsafe { libc::munlock(aligned.cast(), page) };
        println!("mlock: ok");
    } else {
        println!("mlock: unavailable ({})", std::io::Error::last_os_error().raw_os_error().unwrap_or(0));
    }
}

/// Key bytes in locked memory, wiped on drop.
// ponytail: per-allocation mlock, a locked page can be shared with unrelated heap data; add mlockall at startup when key memory exposure matters
pub struct Secret(Box<[u8]>);

impl Secret {
    pub fn zeroed(len: usize) -> Self {
        let b = vec![0u8; len].into_boxed_slice();
        if unsafe { libc::mlock(b.as_ptr().cast(), b.len()) } != 0 {
            MLOCK_FAILS.fetch_add(1, Ordering::Relaxed);
            MLOCK_WARNED.call_once(|| eprintln!("warning: mlock failed, key memory may be swapped"));
        }
        Self(b)
    }

    pub fn from_slice(s: &[u8]) -> Self {
        let mut x = Self::zeroed(s.len());
        x.0.copy_from_slice(s);
        x
    }

    pub fn bytes(&self) -> &[u8] {
        &self.0
    }

    pub fn bytes_mut(&mut self) -> &mut [u8] {
        &mut self.0
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
        // ponytail: ceiling munlock can unlock a page still holding another Secret or unrelated heap data, upgrade path mlockall at startup
        unsafe { libc::munlock(self.0.as_ptr().cast(), self.0.len()) };
    }
}

pub fn random<const N: usize>() -> Res<[u8; N]> {
    let mut b = [0u8; N];
    rand::fill(&mut b).map_err(|_| "internal")?;
    Ok(b)
}

pub fn hex(d: &[u8]) -> String {
    d.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn sha256_hex(d: &[u8]) -> String {
    hex(digest::digest(&digest::SHA256, d).as_ref())
}

pub fn b64(d: &[u8]) -> String {
    STANDARD.encode(d)
}

pub fn unb64(s: &str) -> Option<Vec<u8>> {
    STANDARD.decode(s).ok()
}

pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> Vec<u8> {
    hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, key), msg).as_ref().to_vec()
}

fn gcm_key(key: &[u8]) -> Res<LessSafeKey> {
    Ok(LessSafeKey::new(
        UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| "internal")?,
    ))
}

pub fn gcm_seal(key: &[u8], iv: &[u8; 12], aad: &[u8], pt: &[u8]) -> Res<Vec<u8>> {
    // Capacity covers the tag: seal_in_place_append_tag must not realloc and strand a plaintext copy.
    let mut buf = Vec::with_capacity(pt.len() + aead::AES_256_GCM.tag_len());
    buf.extend_from_slice(pt);
    gcm_key(key)?
        .seal_in_place_append_tag(aead::Nonce::assume_unique_for_key(*iv), Aad::from(aad), &mut buf)
        .map_err(|_| "internal")?;
    Ok(buf)
}

pub fn gcm_open(key: &[u8], iv: &[u8; 12], aad: &[u8], ct: &[u8]) -> Res<Zeroizing<Vec<u8>>> {
    let mut buf = Zeroizing::new(ct.to_vec());
    let n = gcm_key(key)?
        .open_in_place(aead::Nonce::assume_unique_for_key(*iv), Aad::from(aad), &mut buf)
        .map_err(|_| "bad_cipher")?
        .len();
    buf.truncate(n);
    Ok(buf)
}

/// dek_id || 0 || purpose || 0 || kek_id || 0 || u32be(kek_version)
pub fn dek_aad(dek_id: &str, purpose: &str, kek_id: &str, kek_version: u32) -> Vec<u8> {
    let mut a = Vec::new();
    for part in [dek_id, purpose, kek_id] {
        a.extend_from_slice(part.as_bytes());
        a.push(0);
    }
    a.extend_from_slice(&kek_version.to_be_bytes());
    a
}

/// MAC_DOMAIN || 0 || nonce || kek_id || 0 || u32be(version)
pub fn delivery_label(nonce: &[u8], kek_id: &str, version: u32) -> Vec<u8> {
    let mut l = MAC_DOMAIN.to_vec();
    l.push(0);
    l.extend_from_slice(nonce);
    l.extend_from_slice(kek_id.as_bytes());
    l.push(0);
    l.extend_from_slice(&version.to_be_bytes());
    l
}

/// wrapped = rsaPart(384) || kwpPart. Returns the 32-byte KEK.
pub fn unwrap_kek(
    rsa: &OaepPrivateDecryptingKey,
    wrapped: &[u8],
    nonce: &[u8],
    kek_id: &str,
    version: u32,
) -> Res<Secret> {
    if wrapped.len() <= RSA_PART_LEN {
        return Err("bad_delivery");
    }
    let (rsa_part, kwp_part) = wrapped.split_at(RSA_PART_LEN);
    let label = delivery_label(nonce, kek_id, version);

    let mut temp_out = Zeroizing::new(vec![0u8; RSA_PART_LEN]);
    let tlen = rsa
        .decrypt(&OAEP_SHA256_MGF1SHA256, rsa_part, &mut temp_out, Some(&label))
        .map_err(|_| "bad_delivery")?
        .len();
    if tlen != 32 {
        return Err("bad_delivery");
    }
    let temp_key = Secret::from_slice(&temp_out[..tlen]);

    let mut kek_out = Secret::zeroed(kwp_part.len());
    let klen = AesKek::new(&AES_256, temp_key.bytes())
        .map_err(|_| "bad_delivery")?
        .unwrap_with_padding(kwp_part, kek_out.bytes_mut())
        .map_err(|_| "bad_delivery")?
        .len();
    if klen != 32 {
        return Err("bad_delivery");
    }
    Ok(Secret::from_slice(&kek_out.bytes()[..klen]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_lc_rs::rsa::{KeySize, OaepPublicEncryptingKey, PrivateDecryptingKey};

    fn keys() -> (OaepPrivateDecryptingKey, OaepPublicEncryptingKey) {
        let sk = PrivateDecryptingKey::generate(KeySize::Rsa3072).unwrap();
        let pk = OaepPublicEncryptingKey::new(sk.public_key()).unwrap();
        (OaepPrivateDecryptingKey::new(sk).unwrap(), pk)
    }

    fn build_delivery(
        pk: &OaepPublicEncryptingKey,
        nonce: &[u8],
        kek_id: &str,
        version: u32,
        kek: &[u8],
    ) -> Vec<u8> {
        let temp = [7u8; 32];
        let label = delivery_label(nonce, kek_id, version);
        let mut out = vec![0u8; RSA_PART_LEN];
        pk.encrypt(&OAEP_SHA256_MGF1SHA256, &temp, &mut out, Some(&label))
            .unwrap();
        let mut kwp = vec![0u8; kek.len() + 15];
        let w = AesKek::new(&AES_256, &temp)
            .unwrap()
            .wrap_with_padding(kek, &mut kwp)
            .unwrap()
            .to_vec();
        out.extend_from_slice(&w);
        out
    }

    #[test]
    fn delivery_round_trip_and_replay_rejected() {
        let (rsa, pk) = keys();
        let nonce = [3u8; 32];
        let kek = [9u8; 32];
        let w = build_delivery(&pk, &nonce, "kek-01", 3, &kek);
        assert_eq!(unwrap_kek(&rsa, &w, &nonce, "kek-01", 3).unwrap().bytes(), &kek);
        assert!(unwrap_kek(&rsa, &w, &[4u8; 32], "kek-01", 3).is_err());
        assert!(unwrap_kek(&rsa, &w, &nonce, "kek-01", 4).is_err());
    }

    #[test]
    fn dek_aad_swap_fails() {
        let kek = [1u8; 32];
        let iv = [2u8; 12];
        let aad = dek_aad("d0123456789abcdef", "data", "kek-01", 1);
        let ct = gcm_seal(&kek, &iv, &aad, b"dek-bytes").unwrap();
        assert_eq!(gcm_open(&kek, &iv, &aad, &ct).unwrap().as_slice(), b"dek-bytes");
        let swapped = dek_aad("d0123456789abcdef", "mac", "kek-01", 1);
        assert_eq!(gcm_open(&kek, &iv, &swapped, &ct).unwrap_err(), "bad_cipher");
    }

    #[test]
    fn kwp_round_trip() {
        let kek = AesKek::new(&AES_256, &[5u8; 32]).unwrap();
        let mut out = vec![0u8; 32 + 15];
        let w = kek.wrap_with_padding(&[8u8; 32], &mut out).unwrap().to_vec();
        assert_eq!(w.len(), 40);
        let kek = AesKek::new(&AES_256, &[5u8; 32]).unwrap();
        let mut back = vec![0u8; 40];
        assert_eq!(kek.unwrap_with_padding(&w, &mut back).unwrap(), &[8u8; 32]);
    }
}
