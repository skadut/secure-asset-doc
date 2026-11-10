# crypto-api

`encryption-services/` is the TPM-only crypto API. It runs with `CRYPTO_MODE=tpm`; legacy `safe` and `unsafe` modes, Vault compose files, and setup scripts are archived in [`docs/versi-lama/crypt-module-vault/`](../../docs/versi-lama/crypt-module-vault/). See the [TPM services README](../README.md#tpm-services) for startup and the [TPM tutorial](../tpm-services/TUTORIAL.md) for the rekey procedure.

## Endpoint

| Endpoint | Body |
|---|---|
| `POST /genrand` | `{"CountByte":8}` |
| `POST /encrypt` | `{"Plaintext":[{"Text":"data 1"}]}` |
| `POST /decrypt` | `{"Ciphertext":[{"versionkey":"t1:<dek_id>","text":"...","mac":"...","iv":"..."}]}` |
| `POST /seal` | `{"Plaintext":[{"Text":"data 1"}]}` |
| `POST /unseal` | `{"Ciphertext":[{"text":"t1:<dek_id>:<base64>"}]}` |
| `POST /hmac` | `{"Message":"password"}` |
| `POST /verifyhmac` | `{"Message":"password","HMACstring":"t1:<dek_id>:..."}` |
| `POST /tokenize` | `{"Masking":[{"Format":"LEFT","Length":3,"Text":"..."}]}` |
| `POST /detokenize` | `{"Masking":[{"text":"***...:t1:<dek_id>:..."}]}` |
| `POST /sealfile` | `{"Data":"<base64 file>"}` |
| `POST /unsealfile` | `{"Ciphertext":"t1:<dek_id>:..."}` |
| `POST /totpgenerate` | `{"AccountName":"alice@example.com"}` |
| `POST /totpvalidate` | `{"SecretEncrypted":"skadut-t1:FAKE-DEK-ID:FAKEBASE64==","CodeOTP":"123456"}` |

`/totpgenerate`: membuat secret TOTP 20 byte acak. Respons `{"SecretEncrypted":"skadut-t1:<dek_id>:<base64>","TOTP Key":"otpauth://totp/Skadut:alice@example.com?algorithm=SHA1&digits=6&issuer=Skadut&period=30&secret=EXAMPLEBASE32SECRET"}`. Secret terenkripsi memakai format seal, jadi bisa di-`/unseal`. Secret mentah tidak pernah dikembalikan selain dalam URI.

`/totpvalidate`: `{"valid":true}` atau `{"valid":false}`. Kode harus 6 digit ASCII. Window ±1 step (30 detik). Kode yang sudah dipakai untuk step yang sama ditolak selama 90 detik (cache in-memory, hilang saat restart, tidak dibagi antar replika). Ciphertext rusak: `501`. Key zone tidak tersedia (DEK/KEK tidak bisa diambil dari keyd/TPM, atau keyd gagal): `503` dengan message `KEY_UNAVAILABLE: kunci enkripsi tidak dapat digunakan (DEK/KEK tidak tersedia dari key zone). Operasi enkripsi/dekripsi gagal. Cek koneksi ke keyd dan layanan TPM di DMZ.`.

`/sealfile` dan `/unsealfile`: isi file dikirim sebagai base64 standar. `Data` yang sudah di-decode maks 10 MiB. Data kosong, base64 tidak valid, atau melebihi batas: `400`. Error lain sama dengan `/unseal`.

Format `tokenize`: `LEFT`/`RIGHT` + `Length`, `MID` + `Position` `"awal:akhir"`, atau pola per karakter (`$` disamarkan, `%` tampil, panjang sama dengan teks).

Contoh masking NIK:

```bash
curl -X POST localhost:2796/tokenize -d '{"Masking":[{"Format":"%$%%%%%%%%%$%%%$","Text":"3302271000000001"}]}'
# {"Ciphertext":[{"text":"3*022710000*000*:t1:..."}]}
```

## Log

Setiap request dicatat satu baris ke stdout (Gin, logger kustom):

    time=2026-10-20T03:15:42.123456Z ip=172.17.0.1 method=POST path="/encrypt" status=200 dur=1.2ms

- Waktu dalam UTC. Path tanpa query string.
- Body, query, dan header tidak dicatat, jadi plaintext, ciphertext, dan kunci tidak masuk log.
- Lihat log: `docker compose logs -f crypt-module` (standalone compose) atau `docker compose logs -f crypto-service` (root compose).
- Di balik port mapping Docker, `ip` bisa berisi IP gateway bridge, bukan IP klien asli. `X-Forwarded-For` diabaikan. Bila nanti ada reverse proxy tepercaya, isi CIDR-nya di `SetTrustedProxies`.

Error: `400` body JSON salah, `501` gagal kriptografi (ciphertext rusak/kunci beda).

## Traffic internal

- `GET /internal/traffic` di listener terpisah `CRYPTO_INTERNAL_ADDR` (default `:2797`). Hanya route ini. Jangan dipublikasikan ke host (tanpa `-p`).
- Tanpa auth. Akses dibatasi jaringan (network policy), bukan aplikasi.
- Respons: array JSON, satu objek per edge (edge tetap selalu ada, nol bila idle):
  `[{"source":"client","target":"crypto-service","rps":12.4,"errorRate":0,"avgMs":3.1}]`
- Edge: `client -> crypto-service` (inbound, gagal = status >=500, `/internal/traffic` tidak dihitung).
- Window 10 detik, in-memory, reset saat restart. Metadata saja: service ID, jumlah, durasi, status.
- Panic di handler: semua DEK di cache di-zeroize (`zeroize reason=panic count=N`), lalu 500.

Tidak diimplementasikan: `GET /`, `GET /transaksi`, rotasi kunci otomatis.

## Mode tpm

Mode ini (satu-satunya mode) tidak memegang materi kunci. Semua kunci ada di key container (keyd) dan diakses lewat Unix socket. Rancangan: [tpm-development-crypto-service.md](../../docs/tpm-development-crypto-service.md).

| Env | Default | Keterangan |
|---|---|---|
| `CRYPTO_MODE` | - | Isi `tpm` |
| `KEYD_SOCKET` | `/run/keyd/keyd.sock` | Unix socket ke keyd |
| `TLS_CERT_FILE` | `/pki/crypto-api.pem` | Sertifikat server |
| `TLS_KEY_FILE` | `/pki/crypto-api-key.pem` | Kunci privat server |
| `TLS_CLIENT_CA_FILE` | `/pki/ca.pem` | CA untuk verifikasi client cert |
| `APP_IDENTITIES` | `app` | Daftar CN client cert yang diizinkan, dipisah koma |
| `AUDIT_FILE` | kosong | Opsional. JSON lines di-append ke file ini. stdout selalu |

- Listen di `:2796` dengan mTLS, TLS 1.3, client cert wajib.
- CN yang tidak ada di `APP_IDENTITIES`: `403`.

Format cipher, prefix versi `t1`:

- Encrypt: `Versionkey` berisi `skadut-t1:<dek_id>`, dengan field `Text`, `Mac`, `IV`.
- Seal: `skadut-t1:<dek_id>:<base64(iv||ct||tag)>`
- HMAC: `skadut-t1:<dek_id>:<base64(mac)>`
- Label `skadut-` hanya kosmetik di output `/encrypt`, `/seal`, `/sealfile`, `/hmac`; bukan bagian AAD. Input menerima dengan atau tanpa label.

Audit: satu baris JSON per request. Jika gagal ditulis, server mengembalikan `503` `audit unavailable`; respons operasi ditahan sampai record tertulis (fail-closed).‌

- Field: `time`, `request_id`, `service`, `identity`, `key_id`, `key_version`, `action`, `result`, `prev_hash`, `hash`.
- `hash` = SHA-256 hex dari `prev_hash|time|request_id|service|identity|key_id|key_version|action|result`. Karakter `|` dan newline di nilai diganti `_`.
- `prev_hash` pertama berisi 64 nol.
- Tidak pernah mencatat plaintext, ciphertext, atau kunci.
