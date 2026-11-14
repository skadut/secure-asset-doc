# Panduan menjalankan

Langkah operasional stack: penyiapan, start dan stop, seeding, operasi TPM, pengembangan, tes, deployment, dan pemeliharaan. Ringkasan ada di [README](../../README.md); desain teknis ada di [desain keamanan](../keamanan/desain-keamanan.md). Tutorial operator berbahasa Indonesia ada di [tutorial-operator.md](tutorial-operator.md), dan versi copy-paste PowerShell ada di [run-powershell.md](run-powershell.md).

Jangan pernah menempel nilai `.env`, PIN asli, atau password ke dokumen, perintah, atau riwayat shell.

## Isi

- [Penyiapan pertama kali (sekali)](#penyiapan-pertama-kali-sekali)
- [Setiap kali start](#setiap-kali-start)
- [Mulai dari awal](#mulai-dari-awal)
- [Berhenti](#berhenti)
- [Seeding](#seeding)
- [Akun demo](#akun-demo)
- [Operasi TPM](#operasi-tpm)
  - [Demo TPM native di laptop](#demo-tpm-native-di-laptop)
  - [Lingkungan `tpm-msk` mode container](#lingkungan-tpm-msk-mode-container)
- [Development](#development)
- [Tes](#tes)
- [Deployment (CI/CD)](#deployment-cicd)
- [Retensi log audit](#retensi-log-audit)
- [Tata letak repositori](#tata-letak-repositori)
- [Perangkat keras yang dipakai](#perangkat-keras-yang-dipakai)

## Penyiapan pertama kali (sekali)

Butuh Docker Desktop (Compose v2) dan layanan TPM di host Windows. Dari root repo, salin `.env.example` menjadi `.env`, lalu ganti nilai contoh dengan secret untuk `POSTGRES_PASSWORD` dan `APP_DB_PASSWORD` (16+ karakter). `APP_DB_PASSWORD` tidak boleh kosong; lihat `db/init/005_app_role.sh`. Jangan pernah menaruh nilai `.env` di dokumen atau riwayat shell.

```powershell
Copy-Item .env.example .env
```

Dari `cryptography-service\tpm-services\` (setelah membangun `bin\tpm-msk.exe` seperti dijelaskan di [setup layanan TPM](../services/tpm-msk.md#perintah)):

```powershell
& .\bin\tpm-msk.exe pki --out ..\run\pki
& .\bin\tpm-msk.exe init
& .\bin\tpm-msk.exe kek create --id kek-01
New-Item -ItemType Directory -Force ..\run\audit\keyd, ..\run\audit\crypto-api | Out-Null
```

## Setiap kali start

1. Di host, dari `cryptography-service\tpm-services\`, jalankan `& .\bin\tpm-msk.exe serve --pki-dir ..\run\pki --pubkey-file ..\run\keyd-pub\delivery.pub.pem`; masukkan PIN minimal 6 karakter.
2. Dari root repo, jalankan `docker compose up -d --build`.
3. Jalankan `docker compose logs keyd` dan baca baris `delivery key fingerprint: sha256:...`.
4. Bandingkan fingerprint, lalu ketik `y` di konsol `tpm-msk serve`.
5. Buka http://127.0.0.1:8088. Persetujuan ulang diperlukan setelah setiap restart keyd.

Pada instalasi baru, ikuti [Mulai dari awal](#mulai-dari-awal).

## Mulai dari awal

Semua data mulai dari nol. Stack hanya TPM; tidak ada rekey dan tidak ada migrasi dari Vault. Langkah operator (backup opsional, `docker compose down -v`, seeding, pemeriksaan SQL) ada di [Tutorial operator langkah 5, Reset data dari nol](tutorial-operator.md#5-reset-data-dari-nol).

> **Peringatan:** `docker compose down -v` menghapus semua data DB dan named volume. Pakai hanya untuk reset lokal yang disengaja. Jangan pernah menjalankannya di VPS; lihat [Deployment (CI/CD)](deployment.md). Untuk stop normal, pakai `docker compose down` (data tetap).

## Berhenti

`docker compose down` (data tetap). Sebelum tidur: `docker compose -f cryptography-service/compose.yaml stop keyd`.

## Seeding

Volume baru hanya berisi skema (`db/init`, 0 baris). Urutan seed setelah mulai dari awal: `db/seed/*.sql`, lalu `seed-users`, lalu `seed-totp`, lalu `protect-documents`, lalu `tokenize-titles`. Perintah lengkap, panduan dry-run, dan pemeriksaan ada di [seeding.md](seeding.md).

## Akun demo

Setiap akun demo memakai password di `DEMO_USER_PASSWORD` dari `.env`. Username adalah nama depan dan belakang orang, misalnya `hendra.wiratama`; semua akun fiktif. Skrip menyemai 80 akun di 22 pangkat dan mengatur `access_level` per pangkat. Daftar lengkap akun, pemetaan username lama ke baru, dan flag peran ada di [akun-demo.md](../demo/akun-demo.md). Untuk menyemai akun, ikuti [seeding.md](seeding.md); `DEMO_USER_PASSWORD` minimal 16 karakter. Login di http://127.0.0.1:8088.

Level akses terpisah dari pangkat. Contoh, `sersan-mayor` adalah Bintara tetapi level 2.

Pilihan cepat untuk pengujian: `hendra.wiratama` (PATI), `rizky.firmansyah` (PAMEN), `wahyu.hidayat` (PAMA), `surya.pratama` (Bintara Tinggi), `kusnadi.hartono` (Bintara), `agus.rusdiana` (Tamtama Kepala), `samsul.bahri` (Tamtama). Detail hak per pangkat dan matriks izin ada di [akun-demo.md](../demo/akun-demo.md) dan [model akses](../keamanan/model-akses.md). Pangkat adalah data demo fiktif.

## Operasi TPM

Desainnya ada di [blueprint TPM](../referensi/tpm-blueprint.md). Langkah perintah ada di [Penyiapan pertama kali](#penyiapan-pertama-kali-sekali) dan [tutorial operator](tutorial-operator.md).

### Demo TPM native di laptop

Jalur native memakai TPM 2.0 perangkat keras lewat TBS Windows: `tpm-msk serve` di host, aplikasi di Docker, tanpa emulator. Screenshot start, fingerprint, dan verifikasi audit ada di [tpm-native-demo.md](tpm-native-demo.md). VPS memakai vTPM lewat overlay `cryptography-service/compose.vps.yaml`, bukan jalur ini.

Jika layanan TPM berhenti, operasi crypto fail closed setelah DEK yang termuat kedaluwarsa, dalam 5 menit.

Setiap layanan menulis log audit JSONL berantai hash (rantai SHA-256). Dari `cryptography-service\tpm-services`, jalankan `& .\bin\tpm-msk.exe audit verify ..\run\audit\keyd\audit.jsonl`, `& .\bin\tpm-msk.exe audit verify ..\run\audit\crypto-api\audit.jsonl`, dan `& .\bin\tpm-msk.exe audit verify "$env:APPDATA\tpm-msk\audit.jsonl"`. Log ini terpisah dari tabel database `audit_events`.

`[DEMO]` Shamir share: `tpm-msk serve` mencetaknya secara default (`--demo-ceremony`, default true). Share dipecah dari secret acak sekali pakai, bukan MSK, dan tidak dapat memulihkan MSK. `init` tidak mencetaknya.

Pengerasan laptop manual, tidak dilakukan tooling: BitLocker pada drive sistem (`manage-bde -status`), `powercfg /h off`, `swap=0` di bawah `[wsl2]` pada `%UserProfile%\.wslconfig`, dan stop keyd sebelum tidur dengan `docker compose -f compose.yaml stop keyd`. Lihat [laptop hardening](../services/tpm-msk.md#hardening-laptop).

Setup satu laptop ini untuk pengembangan dan demonstrasi, tanpa pemisahan zona. Malware dengan hak administrator Windows, penyerang yang mengendalikan container keyd yang berjalan, dan aplikasi yang dikompromikan memakai sertifikat validnya sendiri tidak terlindungi. Lihat blueprint bagian 12, Batas keamanan.

Backend memanggil crypto-api dalam mode TPM lewat compose root. `cryptography-service/e2e.sh` menguji jalur itu dengan harness software TPM. Run TPM nyata lewat `cryptography-service/hw-acceptance.ps1` belum dilakukan.

Jangan pernah menempel PIN asli atau secret ke dokumen, perintah, atau riwayat shell.

### Lingkungan `tpm-msk` mode container

Ketiga variabel ini hanya untuk mode vTPM/container (`cryptography-service/compose.vps.yaml`). Jika tidak di-set, perilaku native Windows/TBS tidak berubah.

- `TPM_MSK_TCP`: dial TPM TCP (misalnya `swtpm:2321`) alih-alih transport TPM platform (`internal/tpm/tpm.go`).
- `TPM_MSK_PIN_FILE`: baca PIN dari file ini alih-alih meminta input. File harus berisi minimal 6 byte (`cmd/tpm-msk/main.go`).
- `TPM_MSK_APPROVE_FP`: auto-approve kunci delivery hanya jika fingerprint-nya sama dengan nilai `sha256:<64 hex>` ini; jika tidak, persetujuan manual tetap diperlukan (`cmd/tpm-msk/serve.go`).

## Development

Frontend:

```powershell
cd frontend
npm ci
npm run dev
npm run lint
npm run build
```

Vite dev server mem-proxy `/api` ke `http://localhost:3000`. Compose tidak mempublikasikan port backend, jadi jalankan backend secara lokal juga:

```powershell
cd backend
npm ci
$env:PGHOST = '127.0.0.1'; $env:PGPORT = '5432'; $env:PGDATABASE = 'secure_asset_doc'; $env:PGUSER = 'sad_app'
$env:PGPASSWORD = '<APP_DB_PASSWORD from .env>'
node server.mjs
```

Regenerasi seed dari `frontend/src/test-utils/grc-fixture.ts` dan file contoh di `db/seed-files/`:

```powershell
node --experimental-strip-types db/scripts/seed-db.mjs
Get-ChildItem db\seed\*.sql | Sort-Object Name | ForEach-Object { Get-Content -Raw $_.FullName } | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

psql sebagai `sad` di atas adalah akses admin untuk pemeliharaan. Itu bukan runtime backend, yang terhubung sebagai `sad_app`.

Seed memakai `ON CONFLICT DO NOTHING`. Menerapkannya ulang menambah baris yang hilang tetapi tidak memperbarui baris yang ada. Jangan pakai `docker compose down -v`; perintah itu menghapus named volume.

## Tes

| Area | Perintah | Hasil terakhir |
| --- | --- | --- |
| Self-check frontend | `node --experimental-strip-types src/lib/grc.check.ts` (sama untuk `src/lib/xlsx.check.ts`, `src/features/dashboard/stats.check.ts`, `src/features/traffic/graph.check.ts`, `src/features/documents/version-history.check.ts`, dijalankan dari `frontend/`) | 5 dari 5 PASS (2026-10-27) |
| Self-check backend | `node backend/<name>.check.mjs` untuk `audit-purge`, `auth`, `csf-order`, `protection`, `session`, `traffic`, `uploads` | `csf-order` dan `traffic` PASS (2026-10-27). Mendahului RBAC, belum dijalankan ulang. Tidak ada hasil tercatat untuk lima lainnya |
| Lint dan build frontend | `npm run lint`, `npm run build` (di `frontend/`) | Build PASS. Lint 0 error, 2 warning `react-refresh` (2026-10-26) |
| Tes browser frontend | `npm test` (di `frontend/`, Vitest dengan Chromium headless) | 107 dari 109 PASS. 2 kegagalan di `src/context/search-provider.test.tsx`: mengharapkan opsi pencarian "Tasks" (tidak ada item itu di data sidebar) dan "Settings Account" (label dibangun dari parent dan sub-item sidebar di `command-menu.tsx`; penyebab kegagalan belum diverifikasi ulang) (2026-10-26) |
| Unit test Go crypto | `docker run --rm -v "${PWD}\cryptography-service\encryption-services:/src" -w /src golang:1.21-alpine sh -c "go vet ./... && go test -count=1 -v ./..."` | `go vet` PASS. Tujuh tes `main_test.go` PASS (2026-10-26). Catatan 2026-10-26 tidak mencantumkan hasil untuk delapan tes `traffic_test.go` |
| Unit test Go crypto | `go test ./...` dari `cryptography-service/encryption-services/` | Tes mode TPM dicatat terpisah; lihat [crypto-api](../services/crypto-api.md) dan [keyd](../services/keyd.md) |
| Integrasi | Stack sehat, `127.0.0.1:8088` 200, `/api/health` 200, `/api/grc` 200, unduh file 200 | PASS (2026-10-26). Mendahului sesi/RBAC, belum dijalankan ulang. `/api/grc` dan unduh file sekarang mengembalikan 401 tanpa sesi |
| e2e berakar TPM (harness software TPM) | `bash e2e.sh` (dijalankan dari `cryptography-service/`) | 22/22 PASS pada run terakhir |
| Unit test keyd, termasuk `acceptance_memory_dump_kek_dek_absent_after_zeroize` (`key-container/src/memdump_test.rs`, hanya Linux) | `cargo test` (di `cryptography-service/key-container/`) | 17/17 PASS pada run terakhir (container `rust:1.85-bookworm`) |
| Penerimaan perangkat keras (operator, TPM nyata dengan PIN) | `.\hw-acceptance.ps1` (dijalankan dari `cryptography-service/`) | Belum dijalankan |

configure.sh hanya mencetak baris PASS dan FAIL. Ia tidak pernah mencetak share, root token, kunci privat, role ID, atau DEK plaintext.

## Deployment (CI/CD)

Alur deploy, workflow, pengecualian rsync, overlay vTPM VPS, dan langkah pasca-deploy ada di [deployment.md](deployment.md).

## Retensi log audit

Aturan purge, batas, dan penerapannya ada di [retensi-audit.md](retensi-audit.md).

## Tata letak repositori

| Path | Isi |
| --- | --- |
| `frontend/` | Vite, React 19, TanStack Router dan Table, Tailwind CSS 4, shadcn/ui di Radix, Recharts. `nginx.conf` mem-proxy `/api/` ke `backend:3000`. Dockerfile membangun ke nginx-unprivileged. Tidak membawa data contoh; menghidrasi dari `/api/grc`. Juga `public/`, `scripts/` (`make-sample-xlsx.py`), `demo/` |
| `backend/` | API Node 24 `node:http` (`server.mjs`), client `pg`, perekam lalu lintas (`traffic.mjs`), perlindungan file (`protection.mjs`), upload (`uploads.mjs`), self-check |
| `db/` | `init/001_schema.sql` sampai `init/018_audit_actions.sql`. `compose.yaml` me-mount `init/` ke `/docker-entrypoint-initdb.d`; image postgres hanya menjalankan skrip ini pada init pertama volume `pgdata` kosong. File yang header-nya menyebut "Manual apply" juga harus diterapkan ke volume yang sudah ada sebagai admin. `scripts/seed-db.mjs` (regenerasi seed), `scripts/protect-documents.mjs` (perlindungan dokumen), `scripts/protect-fields.mjs` (perlindungan field), `scripts/seed-users.mjs` (akun demo), `scripts/tokenize-titles.mjs` (tokenisasi judul dan nama file) |
| `db/seed-files/` | File contoh yang dipakai seed (`db/scripts/seed-db.mjs`). Tidak disajikan aplikasi |
| `cryptography-service/encryption-services/` | Crypto API Go hanya TPM, tes, `Dockerfile`, `README.md` |
| `docs/versi-lama/crypt-module-vault/` | Modul crypto Vault lama, `docker-compose.yml`, `functional.ps1`, `setup.sh`, dan README |
| `cryptography-service/tpm-services/` | Modul Go `tpm-msk` (CLI dan layanan delivery TPM 2.0): `cmd/`, `internal/`, `README.md` sendiri |
| `cryptography-service/key-container/` | keyd Rust, key container untuk mode berakar TPM. Jalankan `cargo test` |
| `cryptography-service/compose.yaml` | Topologi berakar TPM, proyek `crypto-tpm`, disertakan oleh `compose.yaml` root |
| `cryptography-service/e2e.sh` | Tes end-to-end dengan harness software TPM |
| `cryptography-service/hw-acceptance.ps1` | Walkthrough penerimaan perangkat keras dengan TPM dan PIN nyata |
| `docs/versi-lama/key-zone/` | Konfigurasi Vault lama, hanya arsip |
| `docs/` | Dokumentasi: `keamanan/`, `operasi/`, `referensi/`, `arsitektur/`, `services/`, `demo/`, `screenshots/`, `versi-lama/` (dokumen Vault pra-blueprint). Mulai dari [index dokumentasi](../README.md) |
| `ref/` | Gambar referensi (`details style.jpg`) |
| `.verification/` | Screenshot review dan skrip pengambilannya (`access-capture.mjs`, `contrast-probe.mjs`) |
| `.github/` | Workflow CI, deploy, dan stale, template issue dan PR, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` |
| `compose.yaml` | Compose root menyertakan `cryptography-service/compose.yaml`; stack hanya TPM, tanpa service Vault |
| `docs/demo/` | Skenario demo keamanan dan katalog akun |
| `.env.example` | Template `.env` root, disalin pada penyiapan pertama kali |
| `CHANGELOG.md`, `cz.yaml` | Changelog dan konfigurasi Commitizen |
| `LICENSE`, `docs/referensi/third-party-notices.md` | Lisensi MIT dan pemberitahuan pihak ketiga |

Tiga bagian di bawah `cryptography-service/` (`encryption-services/`, `tpm-services/`, `key-container/`) dijelaskan di [index dokumentasi](../README.md).

## Perangkat keras yang dipakai

| Item | Detail |
| --- | --- |
| Laptop | Lenovo ThinkPad X1 Carbon, Intel Core Ultra 7 265U |
| TPM | Discrete TPM 2.0 (dTPM), terpasang dari pabrik |
| OS | Windows 11 |
| RAM | 64 GB |
| Storage | SSD 1 TB |
