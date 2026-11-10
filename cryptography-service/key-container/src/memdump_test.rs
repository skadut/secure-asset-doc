//! Acceptance test "memory dump" (blueprint section 15): a known test KEK and DEK are
//! absent from process memory after zeroization. Linux only: scans /proc/self/maps + /proc/self/mem.
//!
//! The plain patterns never exist as constants: each is stored XOR-masked and rebuilt at runtime
//! straight into a `Secret`, and the scanner compares through the mask. Otherwise .rodata, .text
//! immediates or the scan buffer would hold the pattern and the negative check could never pass.
use crate::{crypto::{self, Secret}, store::{self, Cache, Store}, time};
use std::{fs, hint::black_box, os::unix::fs::FileExt, sync::{atomic::{AtomicU64, Ordering}, Arc}, time::Duration};
use zeroize::Zeroizing;

const MASK: [u8; 32] = [0x5c, 0xa3, 0x17, 0xe8, 0x9b, 0x42, 0xd6, 0x0f, 0x71, 0xbe, 0x2a, 0xc5, 0x88, 0x34, 0xf9, 0x6d, 0x13, 0xea, 0x57, 0x9c, 0x26, 0xb1, 0x7f, 0x48, 0xd3, 0x05, 0xac, 0x61, 0xfe, 0x3b, 0x92, 0xc7];
// Test KEK = KEK_X ^ MASK, test DEK = DEK_X ^ MASK. Random-looking, no repeats.
const KEK_X: [u8; 32] = [0xe1, 0x0c, 0x7a, 0x33, 0xd4, 0x96, 0x2b, 0xf8, 0x45, 0x6e, 0x91, 0x1a, 0xcf, 0x08, 0x5d, 0xb2, 0x7e, 0x23, 0xa9, 0x64, 0x0b, 0xdc, 0x38, 0x87, 0xf0, 0x59, 0x1d, 0xc6, 0x4a, 0x2f, 0xe3, 0x75];
const DEK_X: [u8; 32] = [0x3f, 0xd8, 0x84, 0x51, 0x0e, 0xbb, 0x67, 0xc2, 0x99, 0x24, 0xf5, 0x7c, 0x13, 0xa0, 0x4e, 0xe9, 0xb6, 0x5a, 0x02, 0xcd, 0x71, 0x98, 0xe4, 0x2d, 0x86, 0x3c, 0xf1, 0x0a, 0x6b, 0xd7, 0x45, 0x90];

fn unmask(x: &[u8; 32]) -> Secret {
    let (x, m) = (black_box(x), black_box(&MASK));
    let mut s = Secret::zeroed(32);
    for (i, b) in s.bytes_mut().iter_mut().enumerate() { *b = x[i] ^ m[i]; }
    s
}

/// Pattern = x[from..32] ^ MASK[from..32]. from=16 is the tail: free() can clobber the first 16 bytes (tcache next/key).
fn matches(w: &[u8], x: &[u8; 32], from: usize) -> bool { w.iter().zip(&x[from..]).zip(&MASK[from..]).all(|((b, x), m)| b ^ m == *x) }

/// Counts occurrences of each masked (pattern, offset) across all readable mappings. Returns (hits, bytes scanned).
fn scan(pats: &[(&[u8; 32], usize)]) -> (Vec<usize>, u64) {
    let maps = fs::read_to_string("/proc/self/maps").expect("/proc/self/maps");
    let mem = fs::File::open("/proc/self/mem").expect("/proc/self/mem");
    let mut hits = vec![0; pats.len()];
    let mut scanned = 0u64;
    const CHUNK: usize = 1 << 20;
    let mut buf = Zeroizing::new(vec![0u8; CHUNK + 31]);
    for line in maps.lines() {
        let mut f = line.split_whitespace();
        let (Some(range), Some(perms)) = (f.next(), f.next()) else { continue };
        if !perms.starts_with('r') || line.ends_with("[vvar]") || line.ends_with("[vsyscall]") { continue; }
        let Some((a, b)) = range.split_once('-') else { continue };
        let (Ok(start), Ok(end)) = (u64::from_str_radix(a, 16), u64::from_str_radix(b, 16)) else { continue };
        let mut off = start;
        while off < end {
            let len = ((end - off) as usize).min(CHUNK + 31);
            let Ok(n) = mem.read_at(&mut buf[..len], off) else { break };
            if n < 32 { break; }
            scanned += n.min(CHUNK) as u64;
            // Starts < CHUNK only: the 31-byte overlap is rescanned by the next chunk.
            for i in 0..n.min(CHUNK) {
                for (h, &(p, from)) in hits.iter_mut().zip(pats) {
                    let Some(w) = buf[..n].get(i..i + 32 - from) else { continue };
                    if w[0] ^ MASK[from] == p[from] && matches(w, p, from) { *h += 1; }
                }
            }
            off += CHUNK as u64;
        }
    }
    (hits, scanned)
}

struct Fake(AtomicU64);
impl time::Clock for Fake {
    fn now(&self) -> Duration { Duration::from_secs(self.0.load(Ordering::SeqCst)) }
    fn realtime(&self) -> Duration { Duration::from_secs(self.0.load(Ordering::SeqCst)) }
}
struct NoJitter;
impl time::Jitter for NoJitter { fn offset(&self) -> Duration { Duration::ZERO } }

#[test]
fn acceptance_memory_dump_kek_dek_absent_after_zeroize() {
    let path = std::env::temp_dir().join(format!("keyd-memdump-{}.json", crypto::hex(&crypto::random::<8>().unwrap())));
    let store = Store::open(path.to_string_lossy().into_owned()).unwrap();
    let clock = Arc::new(Fake(AtomicU64::new(1)));
    let cache = Cache::new(clock.clone(), Arc::new(NoJitter), Duration::from_secs(60));
    let kek = unmask(&KEK_X);

    // Wrap the test DEK exactly as Store::add does, then load it through the real unwrap + cache path.
    let iv = [0x6au8; 12];
    let d = { let dek = unmask(&DEK_X); let (id, p, k) = ("d0f1e2d3c4b5a6978", "data", "kek-memdump");
        store::Dek { dek_id: id.into(), purpose: p.into(), kek_id: k.into(), kek_version: 1, created: time::now_rfc3339(), iv: crypto::b64(&iv), ct: crypto::b64(&crypto::gcm_seal(kek.bytes(), &iv, &crypto::dek_aad(id, p, k, 1), dek.bytes()).unwrap()) } };
    let key = cache.get_or_load(&d.dek_id, || store.unwrap(&d, kek.bytes())).unwrap();
    let ct = crypto::gcm_seal(key.secret.bytes(), &[0x2bu8; 12], d.dek_id.as_bytes(), b"memdump-op").unwrap();
    assert_eq!(crypto::gcm_open(key.secret.bytes(), &[0x2bu8; 12], d.dek_id.as_bytes(), &ct).unwrap().as_slice(), b"memdump-op");

    let pats = [(&KEK_X, 0), (&DEK_X, 0), (&KEK_X, 16), (&DEK_X, 16)];
    let (before, before_bytes) = scan(&pats);
    println!("memory dump: before zeroize KEK hits={} DEK hits={} KEK tail hits={} DEK tail hits={} bytes={}", before[0], before[1], before[2], before[3], before_bytes);
    assert!(before.iter().all(|&h| h >= 1), "positive control: scanner must find live KEK and DEK (full and tail)");

    drop(kek);
    drop(key);
    clock.0.store(61, Ordering::SeqCst);
    assert_eq!(cache.sweep(), vec![d.dek_id.clone()], "DEK must expire and be evicted");

    let (after, after_bytes) = scan(&pats);
    println!("memory dump: after zeroize KEK hits={} DEK hits={} KEK tail hits={} DEK tail hits={} bytes={}", after[0], after[1], after[2], after[3], after_bytes);
    assert!(after_bytes * 2 >= before_bytes, "after-scan covered {after_bytes} bytes, under 50% of before-scan {before_bytes}");
    assert_eq!(after, vec![0, 0, 0, 0], "KEK/DEK pattern (full or 16-byte tail) still in process memory after zeroize");
}
