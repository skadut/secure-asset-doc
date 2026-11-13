# crypto-api

## Tujuan

HTTP API Go untuk seal/unseal file, enkripsi/dekripsi, HMAC, tokenisasi, dan TOTP. crypto-api tidak memegang materi kunci; semua kunci ada di keyd dan diakses lewat Unix socket. Satu-satunya mode adalah `tpm`.

## Image dan port

- Build dari `cryptography-service/encryption-services/Dockerfile`; dijalankan sebagai service `crypto-api`.
- Listen `:2796` dengan mTLS dan TLS 1.3. Client certificate wajib; CN yang tidak ada di `APP_IDENTITIES` ditolak 403.
- Compose memetakan `127.0.0.1:2896` ke container `2796`.
- Listener internal terpisah di `CRYPTO_INTERNAL_ADDR` (default `:2797`), hanya untuk `/internal/traffic`, dan tidak dipublikasikan ke host.
- Container read-only, `cap_drop: ALL`, `no-new-privileges`.

## Konfigurasi

| Variabel | Default | Kegunaan |
| --- | --- | --- |
| `CRYPTO_MODE` | — | Isi `tpm` |
| `KEYD_SOCKET` | `/run/keyd/keyd.sock` | Unix socket ke keyd |
| `TLS_CERT_FILE` | `/pki/crypto-api.pem` | Sertifikat server |
| `TLS_KEY_FILE` | `/pki/crypto-api-key.pem` | Kunci privat server |
| `TLS_CLIENT_CA_FILE` | `/pki/ca.pem` | CA untuk verifikasi client cert |
| `APP_IDENTITIES` | `app` | Daftar CN client cert yang diizinkan, dipisah koma |
| `AUDIT_FILE` | kosong | Opsional; JSON lines di-append ke file ini. stdout selalu |
| `CRYPTO_INTERNAL_ADDR` | `:2797` | Listener `/internal/traffic` |

## Endpoint

| Endpoint | Body |
| --- | --- |
| `POST /genrand` | `{"CountByte":8}` |
| `POST /encrypt` | `{"Plaintext":[{"Text":"data 1"}]}` |
| `POST /decrypt` | `{"Ciphertext":[{"versionkey":"t1:<dek_id>","text":"...","mac":"...","iv":"..."}]}` |
| `POST /seal` | `{"Plaintext":[{"Text":"data 1"}]}` |
| `POST /unseal` | `{"Ciphertext":[{"text":"t1:<dek_id>:<base64>"}]}` |
| `POST /hmac` | `{"Message":"password"}` |
| `POST /verifyhmac` | `{"Message":"password","HMACstring":"t1:<dek_id>:..."}` |
| `POST /tokenize` | `{"Masking":[{"Format":"LEFT","Length":3,"Text":"..."}]}` |
| `POST /detokenize` | `{"Masking":[{"text":"<masked>:<sealed token>"}]}` |
| `POST /sealfile` | `{"Data":"<base64 file>"}` |
| `POST /unsealfile` | `{"Ciphertext":"t1:<dek_id>:..."}` |
| `POST /totpgenerate` | `{"AccountName":"alice@example.com"}` |
| `POST /totpvalidate` | `{"SecretEncrypted":"...","CodeOTP":"123456"}` |

`/totpgenerate` membuat secret TOTP 20 byte acak. Respons berisi `SecretEncrypted` dengan format seal dan field `TOTP Key` berisi URI TOTP. Secret terenkripsi bisa dibuka lewat `/unseal`; secret mentah tidak pernah dikembalikan selain di URI.

`/totpvalidate` mengembalikan `{"valid":true}` atau `{"valid":false}`. Kode harus 6 digit ASCII. Window ±1 step (30 detik). Kode yang sudah dipakai untuk step yang sama ditolak selama 90 detik; cache in-memory, hilang saat restart, dan tidak dibagi antar replika.

`/sealfile` dan `/unsealfile` menerima isi file sebagai base64 standar. Data setelah decode maksimum 10 MiB. Data kosong, base64 tidak valid, atau melebihi batas menghasilkan 400.

Format `tokenize`: `LEFT`/`RIGHT` + `Length`, `MID` + `Position` `"awal:akhir"`, atau pola per karakter (`$` disamarkan, `%` tampil, panjang sama dengan teks). Contoh masking NIK:

```bash
curl -X POST localhost:2796/tokenize -d '{"Masking":[{"Format":"%$%%%%%%%%%$%%%$","Text":"3302271000000001"}]}'
# {"Ciphertext":[{"text":"3*022710000*000*:<sealed token>"}]}
```

## Format cipher

Prefix versi `t1`.

- Encrypt: `Versionkey` berisi `skadut-t1:<dek_id>` dengan field `Text`, `Mac`, `IV`.
- Seal: `skadut-t1:<dek_id>:<base64(iv||ct||tag)>`.
- HMAC: `skadut-t1:<dek_id>:<base64(mac)>`.
- Label `skadut-` hanya kosmetik pada output `/encrypt`, `/seal`, `/sealfile`, `/hmac`; bukan bagian AAD. Input menerima dengan atau tanpa label.

## Log dan audit

Setiap request dicatat satu baris ke stdout (Gin, logger kustom):

    time=2026-10-20T03:15:42.123456Z ip=172.17.0.1 method=POST path="/encrypt" status=200 dur=1.2ms

- Waktu UTC; path tanpa query string.
- Body, query, dan header tidak dicatat. Plaintext, ciphertext, dan kunci tidak masuk log.
- Lihat log: `docker compose logs -f crypto-service` pada root compose.
- Di balik port mapping Docker, `ip` bisa berisi IP gateway bridge, bukan IP klien asli. `X-Forwarded-For` diabaikan.

Audit: satu baris JSON per request dengan field `time`, `request_id`, `service`, `identity`, `key_id`, `key_version`, `action`, `result`, `prev_hash`, `hash`. `hash` adalah SHA-256 hex dari `prev_hash|time|request_id|service|identity|key_id|key_version|action|result`; karakter `|` dan newline diganti `_`. `prev_hash` pertama berisi 64 nol. Tidak pernah mencatat plaintext, ciphertext, atau kunci. Bila audit gagal ditulis, server mengembalikan 503 `audit unavailable`; respons operasi ditahan sampai record tertulis.

## Traffic internal

`GET /internal/traffic` di listener `CRYPTO_INTERNAL_ADDR`.

- Tanpa auth. Akses dibatasi jaringan, bukan aplikasi.
- Respons array JSON, satu objek per edge: `[{"source":"client","target":"crypto-service","rps":12.4,"errorRate":0,"avgMs":3.1}]`.
- Edge `client -> crypto-service` (inbound; gagal = status >= 500; `/internal/traffic` tidak dihitung).
- Window 10 detik, in-memory, reset saat restart. Metadata saja.
- Panic di handler men-zeroize semua DEK di cache (`zeroize reason=panic count=N`), lalu 500.

Tidak diimplementasikan: `GET /`, `GET /transaksi`, rotasi kunci otomatis.

## Perilaku gagal

- Ciphertext rusak atau kunci berbeda: 501.
- Key zone tidak tersedia (DEK/KEK tidak bisa diambil dari keyd/TPM, atau keyd gagal): 503 dengan pesan `KEY_UNAVAILABLE`.
- Body JSON salah: 400.
- Audit gagal ditulis: 503 `audit unavailable`.
- Tidak ada fallback ke plaintext.

## Berkomunikasi dengan

- Backend memanggil lewat mTLS `https://crypto-api:2796`.
- crypto-api memanggil keyd lewat Unix socket `KEYD_SOCKET` dengan NDJSON.

## Kode

`cryptography-service/encryption-services/`.
