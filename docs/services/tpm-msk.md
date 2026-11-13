# tpm-msk

## Tujuan

CLI Go yang menyimpan Master Secret Key (MSK) di TPM 2.0, membungkus dan membuka KEK, serta menjalankan layanan delivery KEK. MSK tidak pernah keluar dari TPM dalam bentuk jelas. Pada laptop, `tpm-msk` berjalan native di Windows; pada VPS, ia berjalan sebagai container di samping `swtpm`. Native path tidak terdaftar sebagai service Compose.

## Image, binary, dan port

- Native: binary `cryptography-service/tpm-services/bin/tpm-msk.exe`, dibangun dari `./cmd/tpm-msk`.
- Container VPS: build dari `cryptography-service/tpm-services/Dockerfile`, command `serve`.
- `serve` listen `127.0.0.1:2798` dengan mTLS. Pada VPS, listen `0.0.0.0:2798` di jaringan `crypto-tpm-net`.
- Tidak punya port host pada native path; keyd menjangkau `host.docker.internal:2798`.

## Konfigurasi

Native: PIN diminta interaktif; path default `%APPDATA%\tpm-msk\msk.key` dan dapat diubah dengan `--key`.

Container VPS (hanya mode vTPM):

| Variabel | Kegunaan |
| --- | --- |
| `TPM_MSK_TCP` | Dial TPM lewat TCP, misalnya `swtpm:2321`, bukan transport platform |
| `TPM_MSK_PIN_FILE` | Baca PIN dari file ini; minimal 6 byte |
| `TPM_MSK_APPROVE_FP` | Setujui delivery key otomatis hanya bila fingerprint sama dengan nilai `sha256:<64 hex>` |

Bila variabel ini kosong, perilaku native Windows/TBS tidak berubah.

## Perintah

- `tpm-msk kek create --id <id> [--file <path>] [--key <path>]`: membuat KEK memakai MSK yang terikat TPM; meminta PIN. `--id` wajib.
- `tpm-msk kek list [--file <path>]`: daftar ID KEK, versi, dan waktu pembuatan tanpa memakai TPM.
- `tpm-msk pki --out <dir> [--force]`: membuat PKI development. `--out` wajib.
- `tpm-msk audit verify <file>`: memeriksa hash chain audit tanpa memakai TPM. Satu file posisional, tanpa flag.
- `tpm-msk init [--key <path>] [--force] [--import]`: membuat atau mengimpor MSK; meminta PIN.
- `tpm-msk serve --pki-dir <dir> [--pubkey-file <path>] [--listen <addr>] [--allow-kek <id>] [--audit-file <path>] [--rate <n>] [--demo-ceremony <bool>] [--key <path>]`: layanan delivery. `--pki-dir` wajib; `--listen` default `127.0.0.1:2798`.
- `tpm-msk selftest`: memeriksa kapabilitas TPM. Tanpa flag.
- `tpm-msk info [--key <path>]`: melaporkan properti TPM dan key file.

Build native:

```powershell
cd "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
go build -o bin\tpm-msk.exe ./cmd/tpm-msk
```

Urutan start native ada di [tutorial operator](../operasi/tutorial-operator.md) dan [run PowerShell](../operasi/run-powershell.md).

## Urutan start

Dijalankan dari `cryptography-service`:

1. `tpm-msk pki --out run\pki` membuat `run\pki\keyzone` dan `run\pki\api`.
2. `tpm-msk init`, lalu `tpm-msk kek create --id kek-01`.
3. `New-Item -ItemType Directory -Force run\audit\keyd, run\audit\crypto-api`.
4. `tpm-msk serve --pki-dir run\pki --pubkey-file run\keyd-pub\delivery.pub.pem`, lalu masukkan PIN.
5. `docker compose -f compose.yaml up -d --build`.
6. Setujui fingerprint yang tampil di konsol `serve`; log keyd: `docker compose -f compose.yaml logs keyd`.
7. Uji enkripsi:

```bash
curl --cert run/pki/api/app-cert.pem --key run/pki/api/app-cert-key.pem --cacert run/pki/api/ca.pem -H "Content-Type: application/json" -d "{\"Plaintext\":[{\"Text\":\"hello\"}]}" https://127.0.0.1:2896/encrypt
```

8. Verifikasi audit: `tpm-msk audit verify run\audit\keyd\audit.jsonl`, `tpm-msk audit verify run\audit\crypto-api\audit.jsonl`, `tpm-msk audit verify $env:APPDATA\tpm-msk\audit.jsonl`.

`.\hw-acceptance.ps1` menjalankan langkah-langkah ini beserta pemeriksaan hardware.

## Pengujian end-to-end

`bash e2e.sh` dari `cryptography-service` menguji mTLS, round trip kripto, penanganan KEK terbungkus, expiry/outage DEK, hash chain audit, kebersihan log, throughput, dan hardening container keyd. Harness memakai TPM software, bukan hardware TPM. Suspend didekati dengan `docker pause` melewati TTL ditambah jitter; siklus sleep nyata dan pengujian TPM hardware tetap manual. `cargo test` memindai memori proses keyd setelah zeroize; forensik memori fisik belum diuji.

Prasyarat: Git Bash dengan `cygpath`, curl, openssl, jq, Go 1.26.8, Docker Desktop. Port 2798 (TPM harness) dan 2897 (crypto-api) harus bebas. `run-e2e/` dihapus setiap run; volume project `crypto-tpm-e2e` dihapus sebelum dan sesudah run.

## Hardening laptop

Dijalankan manual; tooling tidak menjalankannya.

```powershell
manage-bde -status          # BitLocker harus On untuk system drive
powercfg /h off             # nonaktifkan hibernasi, shell admin
```

`.wslconfig` di `%UserProfile%`:

```ini
[wsl2]
swap=0
```

Hentikan keyd sebelum sleep: `docker compose -f compose.yaml stop keyd`. Untuk aturan firewall inbound 2798, uji dulu bahwa keyd masih bisa mencapai `tpm-msk serve`; bila traffic terblokir, batasi aturan ke adapter virtual Docker/Hyper-V atau andalkan binding loopback.

## Desain

- MSK adalah objek keyedHash HMAC-SHA256 di bawah SRK persisten `0x81000001`, atau SRK ECC P-256 transient bila handle itu tidak ada.
- Key file adalah JSON berversi berisi `TPM2B_PUBLIC` dan `TPM2B_PRIVATE`; blob privat dienkripsi oleh parent TPM, sehingga hanya bisa dimuat di TPM itu. Kehilangan TPM berarti kehilangan MSK.
- ACL Windows membatasi key file ke user saat ini. File yang sudah ada tidak ditimpa tanpa `--force`; penulisan atomik.
- PIN minimal 6 karakter dan dimasukkan dua kali saat `init`, termasuk `--import`. authValue TPM adalah SHA-256(PIN). Tidak ada atribut `noDA`: PIN salah menaikkan lockout counter TPM. Contoh mesin pengembangan mengizinkan 32 kegagalan; setiap kegagalan meluruh setelah 7200 detik. Pesan error: `wrong PIN; failures count toward lockout: X of Y`.
- KEK adalah `TPM2_HMAC(MSK, "tpm-msk/kek/v1" 0x00 label 0x00 nonce)` dengan nonce acak 32 byte. AES-256-GCM mengenkripsi DEK dengan IV 12 byte dan AAD `"tpm-msk/v1"||label`. Envelope JSON v1: `{"v":1,"alg":"HMAC-SHA256+AES-256-GCM","label","nonce","iv","ct"}`; field byte di-base64. DEK 1-1024 byte. Kegagalan parse, validasi, atau dekripsi hanya melaporkan `unwrap failed`.
- Batas: tanpa PCR binding, tanpa rotasi kunci, tanpa export/backup MSK hasil generate. HMAC memakai salted session dengan salt SRK dan enkripsi parameter AES-128-CFB, jadi digest PIN dan KEK tidak terkirim jelas di bus TBS lokal. Key file dari implementasi `tpm-msk` lain tidak kompatibel.

## Layanan delivery

`serve` menulis public key delivery RSA-3072 ke `--pubkey-file` (default `run/keyd-pub/delivery.pub.pem`). keyd membaca file itu setiap 2 detik dan hanya menerima RSA-3072. Saat fingerprint cocok, approval dilakukan manual di konsol (`[y/N]`) atau otomatis bila cocok dengan `TPM_MSK_APPROVE_FP`.

## Perilaku gagal

- PIN salah menaikkan lockout counter TPM. Jalankan `init` dan `serve` hanya dengan PIN benar.
- `serve` berhenti: keyd tidak bisa mengambil KEK baru. DEK yang masih di cache dipakai sampai TTL habis, lalu operasi kripto gagal dan tidak ada fallback plaintext.
- TPM hilang atau key file hilang: semua yang dibungkus dengan MSK tidak bisa dibuka.

## Catatan operasional

Demo jalur native laptop: lihat [tpm-native-demo](../operasi/tpm-native-demo.md).

- `selftest` mencetak `PASS`, `FAIL`, `SKIP`, dan `INFO`. Windows TBS non-admin memblokir `TPM2_SelfTest` dan `TPM2_GetTestResult`, sehingga pemeriksaan itu `SKIP`; jalankan PowerShell elevated untuk menyertakannya. `FAIL` berarti berhenti.
- Audit `tpm-msk`, keyd, dan crypto-api adalah log JSONL terpisah dengan hash chain SHA-256, bukan tabel `audit_events`. Verifikasi: `tpm-msk audit verify` untuk tiap file.
- Pemeriksaan TPM bawaan Windows: `tpmtool getdeviceinformation` dan `Get-Tpm`.
- Firewall opsional memblokir inbound TCP 2798: `New-NetFirewallRule -DisplayName tpm-msk-block-2798 -Direction Inbound -LocalPort 2798 -Protocol TCP -Action Block`. Hapus dengan `Remove-NetFirewallRule -DisplayName tpm-msk-block-2798`.

## Kode

`cryptography-service/tpm-services/` (`cmd/tpm-msk/`, `internal/`).
