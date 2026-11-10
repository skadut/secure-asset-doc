use crate::crypto::{unb64, unwrap_kek};
use aws_lc_rs::rsa::{OaepPrivateDecryptingKey, PrivateDecryptingKey};

const VECTOR: &str = include_str!("../testdata/delivery_vector.json");

struct Vector {
    rsa: OaepPrivateDecryptingKey,
    kek_id: String,
    version: u32,
    nonce: Vec<u8>,
    wrapped: Vec<u8>,
    kek: Vec<u8>,
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn load() -> Vector {
    let v: serde_json::Value = serde_json::from_str(VECTOR).unwrap();
    let s = |k: &str| v[k].as_str().unwrap();
    let der = unb64(s("rsa_private_pkcs8_der_b64")).unwrap();
    let sk = PrivateDecryptingKey::from_pkcs8(&der).unwrap();
    Vector {
        rsa: OaepPrivateDecryptingKey::new(sk).unwrap(),
        kek_id: s("kek_id").to_string(),
        version: v["version"].as_u64().unwrap() as u32,
        nonce: unb64(s("nonce_b64")).unwrap(),
        wrapped: unb64(s("wrapped_kek")).unwrap(),
        kek: unhex(s("kek_hex")),
    }
}

#[test]
fn go_delivery_vector_unwraps_to_kek_hex() {
    let t = load();
    let got = unwrap_kek(&t.rsa, &t.wrapped, &t.nonce, &t.kek_id, t.version).unwrap();
    assert_eq!(got.bytes(), t.kek.as_slice());
}

#[test]
fn go_delivery_vector_rejects_tampered_input() {
    let t = load();
    let mut bad_nonce = t.nonce.clone();
    bad_nonce[0] ^= 1;
    assert!(unwrap_kek(&t.rsa, &t.wrapped, &bad_nonce, &t.kek_id, t.version).is_err());

    let mut bad_rsa = t.wrapped.clone();
    bad_rsa[0] ^= 1;
    assert!(unwrap_kek(&t.rsa, &bad_rsa, &t.nonce, &t.kek_id, t.version).is_err());

    let mut bad_kwp = t.wrapped.clone();
    let last = bad_kwp.len() - 1;
    bad_kwp[last] ^= 1;
    assert!(unwrap_kek(&t.rsa, &bad_kwp, &t.nonce, &t.kek_id, t.version).is_err());
}
