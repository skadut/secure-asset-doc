# crypt-module

Tiruan endpoint layanan kriptografi Sandidata v2.3 untuk sesi studi kasus SIMPELDATIN. Bentuk request/response mengikuti spesifikasi Sandidata v2.3 (file spesifikasi tidak ada di repo ini). Hanya untuk demo: HTTP biasa, kunci lokal, bukan dari KMS BSSN.

## Jalankan

MSK disimpan di `.env` (gitignored, dibuat oleh `setup.sh`). Aplikasi membaca `.env` dari direktori kerja saat start.

```bash
./setup.sh                       # generate key -> .env -> build -> compose up -> functional test (opsional)
docker compose up -d --build     # Docker standalone, .env dipasang lewat env_file
```

Default `CRYPTO_MODE` adalah `safe`, yang butuh Vault (`VAULT_ADDRS`, `VAULT_CA_FILE`, `VAULT_CLIENT_CERT`, `VAULT_CLIENT_KEY`). Untuk standalone tanpa Vault, set `CRYPTO_MODE=unsafe` di `.env` sebelum `docker compose up` atau `docker run`, lalu jalankan lokal dengan:

```bash
go run .                         # lokal, baca .env
```

Tanpa compose:

```powershell
docker build -t crypt-module .
docker run -d -p 2796:2796 --env-file .env crypt-module
```

## Mode (`CRYPTO_MODE`)

- `CRYPTO_MODE` di-*pin* ke `safe` di `compose.yaml` root repo (service `crypto-service`), bukan di compose standalone.
- Alasan: kedua mode Key Zone (`KEYZONE_MODE` `safe` atau `unsafe`) sama-sama memakai DEK/KEK Vault transit. `KEYZONE_MODE` hanya mengatur unseal Shamir di key zone, jadi crypto-service tidak perlu berganti mode.
- Akibatnya mode `unsafe` (MSK dari `CRYPT_KEY`) tidak bisa dijangkau lewat compose. Jalur kodenya tetap ada.

| Mode | Kunci | Format cipher | Syarat |
|---|---|---|---|
| `safe` (default) | DEK per-sesi, di-unwrap Vault transit `crypto-module-kek` | `k1:` | Vault cluster unsealed, cert auth `crypto-module` |
| `unsafe` | MSK `CRYPT_KEY` dari `.env` | `s0` | `CRYPT_KEY` 64 hex |

- `safe`: `CRYPT_KEY` diabaikan (log `safe mode: CRYPT_KEY ignored`). Login cert ke Vault, token policy `crypto-module` saja, 1 jam.
- Vault tidak bisa dihubungi/unseal: `503` `{"fault":{"code":503,"message":"key zone unavailable"}}`. Tidak ada fallback ke kunci lokal.
- `unsafe`: `s0` saja. Cipher `k1:` ditolak, dan sebaliknya.
- `CRYPTO_KEY_TTL`: umur DEK di memori (default `5m`, maks `5m`). Lewat TTL, DEK di-zeroize lalu di-unwrap ulang.
- Zeroize: TTL, error Vault (`reason=vault-error`), dan shutdown. Log: `zeroize reason=ttl count=N`.
- Env wajib (safe): `VAULT_ADDRS` (https, dipisah koma, contoh `https://vault-1:8200,https://vault-2:8200,https://vault-3:8200`), `VAULT_CA_FILE`, `VAULT_CLIENT_CERT`, `VAULT_CLIENT_KEY`.
- `VAULT_ADDRS` dicoba berurutan (failover). Pindah ke alamat berikutnya bila error transport atau status non-2xx selain 400. Login cert dilakukan per alamat. Status 400 langsung dikembalikan sebagai error ciphertext, tanpa pindah alamat.
- Kontainer: `read_only`, `cap_drop ALL`, `cap_add IPC_LOCK`, `ulimits core 0`, network `key-zone-service` (172.30.20.0/24) dan `default`. Distroless, tanpa shell/healthcheck.
- Cek cert auth dari service-zone (authoritative): `docker compose exec vault-bootstrap-dash sh /scripts/enable-cert-auth.sh check` dari root repo. Script sumber: `cryptography-service/key-zone/vault-bootstrap-dash/scripts/enable-cert-auth.sh`.

## Master key (MSK, mode unsafe)

- Sumber: `CRYPT_KEY` di `.env`, 64 hex = 32 byte. Wajib ada di mode `unsafe`; diabaikan di `safe`.
- Env yang sudah diset di shell/container menang atas isi `.env`.
- Dari MSK diturunkan dua kunci (HMAC-SHA256 label `enc` dan `mac`): AES-256-GCM dan HMAC.
- Mengganti MSK = semua ciphertext lama tidak bisa didekripsi. Backup `.env`.
- `.env` tidak ikut masuk image (`.dockerignore`), hanya dipasang saat `run`.
- Bangkitkan MSK baru: `openssl rand -hex 32`.
- Produksi (Sandidata asli): kunci dari KMS BSSN/HSM, bukan file.

## Endpoint

| Endpoint | Body |
|---|---|
| `POST /genrand` | `{"CountByte":8}` |
| `POST /encrypt` | `{"Plaintext":[{"Text":"data 1"}]}` |
| `POST /decrypt` | `{"Ciphertext":[{"versionkey":"s0","text":"...","mac":"...","iv":"..."}]}` |
| `POST /seal` | `{"Plaintext":[{"Text":"data 1"}]}` |
| `POST /unseal` | `{"Ciphertext":[{"text":"s0:..."}]}` |
| `POST /hmac` | `{"Message":"password"}` |
| `POST /verifyhmac` | `{"Message":"password","HMACstring":"s0:..."}` |
| `POST /tokenize` | `{"Masking":[{"Format":"LEFT","Length":3,"Text":"..."}]}` |
| `POST /detokenize` | `{"Masking":[{"text":"***...:s0:..."}]}` |
| `POST /sealfile` | `{"Data":"<base64 file>"}` |
| `POST /unsealfile` | `{"Ciphertext":"s0:..."}` |

`/sealfile` dan `/unsealfile`: isi file dikirim sebagai base64 standar. `Data` yang sudah di-decode maks 10 MiB. Data kosong, base64 tidak valid, atau melebihi batas: `400`. Error lain sama dengan `/unseal`.

Format `tokenize`: `LEFT`/`RIGHT` + `Length`, `MID` + `Position` `"awal:akhir"`, atau pola per karakter (`$` disamarkan, `%` tampil, panjang sama dengan teks).

Contoh masking NIK:

```bash
curl -X POST localhost:2796/tokenize -d '{"Masking":[{"Format":"%$%%%%%%%%%$%%%$","Text":"3302271000000001"}]}'
# {"Ciphertext":[{"text":"3*022710000*000*:s0:..."}]}
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
  `[{"source":"client","target":"crypto-service","rps":12.4,"errorRate":0,"avgMs":3.1}, {"source":"crypto-service","target":"vault-1",...}]`
- Edge: `client -> crypto-service` (inbound, gagal = status >=500, `/internal/traffic` tidak dihitung), `crypto-service -> vault-1` (outbound, gagal = error transport atau status >=500; 400/403 tidak gagal), `crypto-service -> vault-2` (outbound, gagal = error transport atau status >=500; 400/403 tidak gagal), `crypto-service -> vault-3` (outbound, gagal = error transport atau status >=500; 400/403 tidak gagal).
- Window 10 detik, in-memory, reset saat restart. Metadata saja: service ID, jumlah, durasi, status.
- Panic di handler: semua DEK di cache di-zeroize (`zeroize reason=panic count=N`), lalu 500.

Tidak diimplementasikan: `GET /`, `GET /transaksi`, `/totpgenerate`, `/totpvalidate`, mTLS, rotasi kunci otomatis (mode `unsafe`: `s0` saja; mode `safe`: `k1:` dengan DEK per-sesi).

## Mode tpm

Mode ini tidak memegang materi kunci. Semua kunci ada di key container (keyd) dan diakses lewat Unix socket. Rancangan: [tpm-development-crypto-service.md](../../tpm-development-crypto-service.md).

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
- Mode `safe` dan `unsafe` tidak berubah. Keduanya tetap HTTP biasa.

Format cipher, prefix versi `t1`:

- Encrypt: `Versionkey` berisi `t1:<dek_id>`, dengan field `Text`, `Mac`, `IV`.
- Seal: `t1:<dek_id>:<base64(iv||ct||tag)>`
- HMAC: `t1:<dek_id>:<base64(mac)>`

Audit: satu baris JSON per request. Jika gagal ditulis, server mengembalikan `503` `audit unavailable`; respons operasi ditahan sampai record tertulis (fail-closed).‌

- Field: `time`, `request_id`, `service`, `identity`, `key_id`, `key_version`, `action`, `result`, `prev_hash`, `hash`.
- `hash` = SHA-256 hex dari `prev_hash|time|request_id|service|identity|key_id|key_version|action|result`. Karakter `|` dan newline di nilai diganti `_`.
- `prev_hash` pertama berisi 64 nol.
- Tidak pernah mencatat plaintext, ciphertext, atau kunci.
