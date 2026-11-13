# keyd

## Tujuan

Key container Rust yang memegang DEK di memori, meminta KEK terbungkus dari `tpm-msk`, membuka DEK, dan melakukan AES-256-GCM serta HMAC. keyd tidak punya port host; satu-satunya jalur masuk adalah Unix socket dari crypto-api.

## Image dan port

- Build dari `cryptography-service/key-container/Dockerfile`; image `crypto-tpm-keyd`, service `keyd`.
- Tanpa port host. Socket `/run/keyd/keyd.sock` dibagi lewat volume `keyd-sock`.
- Read-only root filesystem, `cap_drop: ALL`, `cap_add: IPC_LOCK`, `--ulimit core=0`, tanpa PID sharing, `security_opt: no-new-privileges`.
- `mem_limit` dan `memswap_limit` 256 MB.
- Volume writable: `keyd-sock:/run/keyd`, `keyd-deks:/var/lib/keyd`, dan bind `run/audit/keyd` ke `/var/log/keyd`, `run/keyd-pub` ke `/run/keyd-pub`.

## Konfigurasi

| Variabel | Default | Kegunaan |
| --- | --- | --- |
| `KEYD_PUBKEY_FILE` | `/run/keyd-pub/delivery.pub.pem` | Public key delivery dari `tpm-msk` |
| `KEYD_AUDIT_FILE` | `/var/log/keyd/audit.jsonl` | Audit hash-chained |
| `KEYD_SOCKET` | `/run/keyd/keyd.sock` | Unix socket |
| `KEYD_DEK_STORE` | `/var/lib/keyd/deks.json` | Penyimpanan DEK terbungkus |
| `KEYD_ALLOWED_UID` | `65532` | UID yang boleh memakai socket |
| `TPM_SERVICE_ADDR` | `host.docker.internal:2798` | Alamat `tpm-msk serve` |
| `TPM_CA_FILE` | `/pki/ca.pem` | CA untuk mTLS ke TPM service |
| `TPM_CLIENT_CERT` | `/pki/crypto-service.pem` | Client cert ke TPM service |
| `TPM_CLIENT_KEY` | `/pki/crypto-service-key.pem` | Kunci client |
| `KEK_ID` | `kek-01` | ID KEK |
| `KEK_VERSION` | `1` | Versi KEK |
| `KEYD_DEK_TTL` | `300` | TTL cache DEK, detik |

`KEK_ID` dan `KEK_VERSION` di-hard-code di `compose.yaml`. Mengubahnya berarti recreate keyd dan butuh fingerprint approval; rotasi KEK adalah ceremony sengaja.

## Protokol

Satu objek JSON per baris, request dan response. Field response yang kosong dihilangkan.

Field request: `id` (8-64 karakter, ASCII alfanumerik atau `-`, wajib), `op`, `plaintext` (base64), `dek_id` (`d` + 16 hex lowercase), `iv` (base64, 12 byte), `ct` (base64), `message` (base64).

| op | Request | Response |
| --- | --- | --- |
| `encrypt` | `{"id","op":"encrypt","plaintext"}` | `ok`, `dek_id`, `iv`, `ct` |
| `decrypt` | `{"id","op":"decrypt","dek_id","iv","ct"}` | `ok`, `plaintext` |
| `hmac` | `{"id","op":"hmac","message"}`, `dek_id` opsional | `ok`, `dek_id`, `mac` |

- `encrypt` memakai DEK data aktif untuk tahun berjalan; dibuat bila belum ada.
- `decrypt` mensyaratkan `dek_id` merujuk DEK ber-purpose data.
- `hmac` memakai `dek_id` untuk memilih DEK mac tertentu. `mac` adalah HMAC-SHA256 base64.

## TTL dan zeroization

- `KEYD_DEK_TTL` detik; default `300`. Rentang valid `31..=300`; nilai lain gagal saat start.
- Expiry cache memakai waktu boot dan waktu realtime yang lebih pendek; umur efektif dikurangi jitter 5-30 detik.
- Compose menyetel `KEYD_DEK_TTL` ke `60`.
- Compose menyetel ulimit `memlock` untuk `mlock` per secret.

## Error

| Kode | Penyebab |
| --- | --- |
| `bad_request` | JSON rusak, `id`/`dek_id` tidak valid, base64 salah, panjang `iv` salah, `op` tak dikenal, baris lebih dari 14 MiB |
| `bad_cipher` | `dek_id` tak dikenal atau purpose salah, GCM auth failure, DEK unwrap failure |
| `unavailable` | Fetch/delivery KEK lewat tautan TPM gagal, cache load gagal, key aktif tidak tersedia |
| `internal` | RNG gagal, persist DEK gagal, enkripsi gagal |

Penulisan audit yang gagal membuat request mengembalikan `unavailable`.

## Mode file

- `deks.json` dan `audit.jsonl` dibuat dengan mode `0600`.
- Socket diset `0600`.
- File yang sudah ada mempertahankan mode lamanya.

## Berkomunikasi dengan

- crypto-api lewat Unix socket NDJSON.
- `tpm-msk` lewat mTLS `POST /v1/kek/wrapped` ke `TPM_SERVICE_ADDR`.
- Host lewat `run/keyd-pub/delivery.pub.pem` dan bind audit.

## Perilaku gagal

- KEK tidak bisa diambil: request `unavailable`, crypto-api meneruskan sebagai 503.
- Setelah `tpm-msk` berhenti, DEK yang masih di cache tetap dipakai sampai TTL habis; setelah itu semua operasi gagal.
- keyd berhenti: crypto-api kehilangan socket dan operasi kripto gagal; tidak ada fallback plaintext.

## Kode

`cryptography-service/key-container/`.
