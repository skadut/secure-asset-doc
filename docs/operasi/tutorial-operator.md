# Tutorial Operator TPM (Windows)

Panduan ini untuk operator yang menjalankan perintah sendiri di PowerShell. Gunakan hanya data demo. Jangan masukkan data pribadi, operasional, atau rahasia nyata.

Screenshot jalur TPM native (start, fingerprint, verifikasi audit) ada di [tpm-native-demo.md](tpm-native-demo.md). Versi copy-paste semua skenario PowerShell ada di [run-powershell.md](run-powershell.md).

## 0. Prasyarat

- Windows dengan TPM 2.0. Buka PowerShell sebagai Administrator, jalankan:

  ```powershell
  Get-Tpm
  ```

  Hasil yang diharapkan: `TPM Present: True`, `TPM Version: 2.0`, `Ready For Storage: True`, dan `Is Locked Out: False`. Catat juga `Lockout Counter` dan `Max Auth Fail`; setiap PIN salah akan menaikkan counter. Perintah pendamping: `tpmtool getdeviceinformation`. Jika TPM tidak ada, belum siap, atau terkunci, berhenti dan selesaikan konfigurasi TPM/firmware Windows lebih dahulu.
- Go sesuai `go.mod`: Go 1.22.0 atau lebih baru; modul meminta toolchain Go 1.26.8. Periksa `go version`. Go dapat mengunduh toolchain yang diminta secara otomatis. Jika build gagal, pasang Go/toolchain tersebut, lalu coba lagi.
- Docker Desktop berjalan dengan Docker Compose v2. Periksa `docker compose version`. Jika perintah gagal, jalankan Docker Desktop dan pastikan Compose v2 tersedia.
- Berkas `.env` sudah ada di root repo. Jika belum, salin `.env.example` menjadi `.env` sesuai Quick start di README root, lalu isi nilainya sendiri. Jangan buka, salin, atau tempel isi `.env` ke chat, tiket, dokumen, atau terminal bersama. Perintah di tutorial hanya memakai placeholder seperti `<POSTGRES_USER>`.

## 1. Build `tpm-msk.exe`

Jalankan di PowerShell dari root repo:

```powershell
cd "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
go build -o bin\tpm-msk.exe ./cmd/tpm-msk
$exe = "$PWD\bin\tpm-msk.exe"
```

Hasil yang diharapkan: build selesai tanpa pesan error, dan `$exe` menunjuk ke `bin\tpm-msk.exe`. Jika gagal, periksa `go version`, koneksi saat toolchain/module diunduh, dan jalankan ulang dari direktori `tpm-services`.

## 2. Penyiapan satu kali

Tetap dari `cryptography-service\tpm-services\`:

1. Buat sertifikat dan kunci pengembangan:

   ```powershell
   & $exe pki --out ..\run\pki
   ```

   Hasil yang diharapkan: mencetak `..\run\pki`; berkas PKI tersedia di `..\run\pki\keyzone` dan `..\run\pki\api`. Jika gagal, pastikan direktori induk dapat ditulis dan tujuan belum berisi berkas yang tidak boleh ditimpa. Jangan tambahkan `--force` kecuali memang berniat mengganti berkas.

2. Buat MSK yang terikat pada TPM:

   ```powershell
   & $exe init
   ```

   Masukkan PIN minimal 6 karakter saat diminta, lalu konfirmasikan. Hasil yang diharapkan: lokasi berkas key dicetak, biasanya `%APPDATA%\tpm-msk\msk.key`. MSK yang dibuat di TPM tidak dapat diekspor. Berkasnya terikat pada TPM ini. Setiap PIN salah menaikkan hitungan lockout TPM; jangan menebak PIN. Jika gagal, berhenti dan baca pesan error sebelum mencoba lagi.

3. Buat KEK:

   ```powershell
   & $exe kek create --id kek-01
   ```

   Masukkan PIN yang sama saat diminta. Hasil yang diharapkan: `created kek-01 version 1`. Jika gagal, periksa PIN, status TPM, dan apakah KEK sudah ada. Jangan mencoba PIN berulang kali.

4. Siapkan direktori audit:

   ```powershell
   New-Item -ItemType Directory -Force ..\run\audit\keyd, ..\run\audit\crypto-api | Out-Null
   ```

   Hasil yang diharapkan: perintah selesai tanpa error dan kedua direktori tersedia.

5. Cadangkan material key di lokasi aman **di luar repo** dan batasi aksesnya. Berkas MSK default ada di `$env:APPDATA\tpm-msk\msk.key`; salinan berkas ini hanya berguna pada TPM yang sama, dan MSK hasil generate tidak dapat diekspor. Berkas KEK default ada di `$env:APPDATA\tpm-msk\keks.json`. Salin berkas yang diperlukan ke media/lokasi terenkripsi yang aksesnya dibatasi. Jangan taruh cadangan di repo, jangan commit, dan jangan bagikan. Jika TPM atau berkas MSK hilang, KEK yang dibungkus tidak dapat dipulihkan. Jika pencadangan aman belum siap, berhenti sebelum mengandalkan layanan ini.

## 3. Opsional: hardware acceptance

Skrip ini menjalankan acceptance walk-through untuk topology TPM mandiri dari `cryptography-service\compose.yaml`, bukan pengganti startup root compose. Dari root repo:

```powershell
.\cryptography-service\hw-acceptance.ps1
```

Hasil yang diharapkan: laporan langkah `PASS`, `WARN`, `SKIP`, atau `FAIL` dan log status di `cryptography-service\run\hw-acceptance-<waktu>.log`. Skrip meminta PIN secara interaktif; jangan aktifkan transcript PowerShell. Ia juga mencakup uji tidur laptop minimal 6 menit. Jika gagal, gunakan catatan skrip untuk langkah yang gagal dan jangan anggap uji perangkat keras lulus. Perintah ini tidak diperlukan untuk menjalankan startup root.

## 4. Setiap kali menjalankan aplikasi

1. Buka jendela PowerShell terpisah. Jalankan layanan TPM dari root repo:

   ```powershell
   cd "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
   & .\bin\tpm-msk.exe serve --pki-dir ..\run\pki --pubkey-file ..\run\keyd-pub\delivery.pub.pem
   ```

   Masukkan PIN saat diminta. Hasil yang diharapkan: layanan mencetak `Key ID:` lalu berjalan pada `127.0.0.1:2798`, menunggu fingerprint keyd untuk disetujui. Biarkan jendela tetap terbuka. Jika gagal, cek bahwa langkah penyiapan satu kali selesai dan gunakan PIN yang benar; PIN salah dihitung terhadap lockout TPM.

2. Di jendela PowerShell lain, dari root repo:

   ```powershell
   cd "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose up -d --build
   ```

   Hasil yang diharapkan: layanan Compose dibuat/dijalankan tanpa error. Jika gagal karena berkas host tidak ditemukan, periksa `run\pki` dan folder audit dari langkah 2; mount sertifikat Compose memakai `create_host_path: false` dan tidak membuat berkas yang hilang.

3. Baca fingerprint keyd:

   ```powershell
   docker compose logs keyd
   ```

   Cari baris `delivery key fingerprint: sha256:...`. Fingerprint itu harus sama persis dengan `Delivery key fingerprint: sha256:...` yang ditampilkan di jendela `serve`. Ketik `y` hanya jika cocok. Jika berbeda, jangan setujui; lihat Troubleshooting.

   Hasil yang diharapkan: `serve` mencatat persetujuan, biasanya `pubkey.approve`. Setelah itu aplikasi tersedia di http://127.0.0.1:8088. Persetujuan perlu diulang setelah keyd restart.

## 5. Reset data dari nol

**Peringatan: langkah ini tidak dapat dibatalkan. Akan menghapus seluruh data database dan volume Vault lama.** Ini operasi destruktif yang dijalankan operator secara manual. Data mulai dari nol: tidak ada rekey dan tidak ada migrasi dari Vault. Jangan jalankan bagian ini jika data lama masih dibutuhkan.

**(a) Backup opsional.** Lewati jika data lama memang tidak perlu disimpan. Dump berisi plaintext. Jalankan dari root repo:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\secure-asset-doc-backups" | Out-Null
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/sad-full-backup.sql'
docker compose cp db:/tmp/sad-full-backup.sql "$env:USERPROFILE\secure-asset-doc-backups\full-backup.sql"
docker compose exec db rm /tmp/sad-full-backup.sql
```

Simpan file dump di luar repo; jangan commit atau kirimkan.

**(b) Hapus container dan volume yang dideklarasikan.** Dari root repo:

```powershell
docker compose down -v --remove-orphans
```

Perintah ini menghapus data PostgreSQL dan `keyd-deks`. Jalankan hanya pada langkah reset ini.

**(c) Hapus volume lama yang tidak dideklarasikan** (jika masih ada). Daftar dulu:

```powershell
docker volume ls --filter name=secure-asset-doc
docker volume ls --filter name=keyzone
```

Periksa nama setiap volume dengan teliti, lalu hapus satu per satu secara manual:

```powershell
docker volume rm <nama-volume>
```

Jangan menulis skrip atau loop untuk penghapusan.

**(d) Jalankan layanan.** Dari `cryptography-service\tpm-services\`, jalankan `serve` dan masukkan PIN (minimal 6 karakter). Biarkan jendela ini terbuka:

```powershell
& .\bin\tpm-msk.exe serve --pki-dir ..\run\pki --pubkey-file ..\run\keyd-pub\delivery.pub.pem
```

Di jendela PowerShell lain, dari root repo:

```powershell
docker compose up -d --build
docker compose logs keyd
```

Bandingkan baris `delivery key fingerprint: sha256:...` dengan fingerprint di jendela `serve`. Ketik `y` hanya jika sama. crypto-api harus aktif sebelum langkah (e).

**(e) Seed data, urutan tetap:** data dasar `db/seed/*.sql`, lalu `seed-users`, lalu `protect-documents`, lalu `tokenize-titles`. Jalankan dari root repo. Ganti placeholder `<...>` dengan nilai dari `.env` secara lokal; jangan tempel nilainya ke dokumen atau riwayat shell.

Volume baru hanya berisi skema (0 baris di setiap tabel). Terapkan dulu data dasar (CSF, pangkat, aset, dokumen, versi, tautan, audit awal) sebagai pemilik DB:

```powershell
Get-ChildItem db\seed\*.sql | Sort-Object Name | ForEach-Object { Get-Content -Raw $_.FullName } | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

1. `seed-users.mjs` membuat akun demo, `access_level`, grant DOC-0017, dan dokumen turunan demo. Skrip ini tidak punya `--dry-run`. Membutuhkan crypto-api aktif dan fingerprint keyd sudah disetujui, karena hash password diberi pepper HMAC lewat `/hmac`. Jalankan sekali:

   ```powershell
   docker compose run --rm --no-deps -v "./db/scripts/seed-users.mjs:/app/seed-users.mjs:ro" -v "./db/scripts/demo-users.mjs:/app/demo-users.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> -e DEMO_USER_PASSWORD=<DEMO_USER_PASSWORD> backend node /app/seed-users.mjs
   ```

2. `protect-documents.mjs` mengenkripsi versi dokumen. Membutuhkan crypto-api aktif. Dry run dulu:

   ```powershell
   docker compose run --rm --no-deps -v "./db/scripts/protect-documents.mjs:/app/protect-documents.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> backend node /app/protect-documents.mjs --dry-run
   ```

   Real run: sama tanpa `--dry-run`.

3. `tokenize-titles.mjs` men-tokenisasi judul dan nama berkas untuk dokumen non-CLEAR. Membutuhkan crypto-api aktif. Dry run dulu:

   ```powershell
   docker compose run --rm --no-deps -v "./db/scripts/tokenize-titles.mjs:/app/tokenize-titles.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> backend node /app/tokenize-titles.mjs --dry-run
   ```

   Real run: sama tanpa `--dry-run`.

Exit code `0` berarti berhasil. Exit code `1` berarti ada baris gagal; perbaiki penyebabnya, lalu ulangi. Ketiga skrip aman dijalankan ulang.

**(f) Verifikasi SQL.** Buka psql:

```powershell
docker compose exec db psql -U <POSTGRES_USER> -d <POSTGRES_DB>
```

Jalankan query read-only berikut di prompt `psql`:

```sql
SELECT count(*) FILTER (WHERE tlp <> 'CLEAR' AND title NOT LIKE '%:t1:%') AS title_bad
FROM documents;
SELECT count(*) FILTER (WHERE d.tlp <> 'CLEAR' AND (v.file_name IS NULL OR v.file_name NOT LIKE '%:t1:%')) AS file_name_bad,
       count(*) FILTER (WHERE d.tlp <> 'CLEAR' AND (v.content_ciphertext IS NULL OR v.content_ciphertext NOT LIKE 'skadut-t1:%')) AS content_bad,
       count(*) FILTER (WHERE d.tlp <> 'CLEAR' AND v.protection <> 'encrypted') AS protection_bad
FROM document_versions v
JOIN documents d ON d.id = v.document_id
WHERE v.content_base64 IS NOT NULL OR v.content_ciphertext IS NOT NULL;
```

Hasil yang diharapkan: semua kolom bernilai `0`. Judul dan nama berkas token berbentuk `<masked>:t1:<sealed>`, jadi dicek dengan `%:t1:%`; ciphertext konten diawali `skadut-t1:`. Versi tanpa konten (derived briefing dari `derive_document`) sengaja dikecualikan karena tidak punya berkas maupun ciphertext, dan `protection` tetap `none`. Jika ada nilai bukan `0`, jangan lanjutkan; ulangi dry run lalu real run untuk skrip terkait.

## 6. Verifikasi audit

Dari `cryptography-service\tpm-services\`, jalankan:

```powershell
& .\bin\tpm-msk.exe audit verify ..\run\audit\keyd\audit.jsonl
& .\bin\tpm-msk.exe audit verify ..\run\audit\crypto-api\audit.jsonl
& .\bin\tpm-msk.exe audit verify "$env:APPDATA\tpm-msk\audit.jsonl"
```

Hasil yang diharapkan untuk tiap file yang ada: `OK (<jumlah> records)` dan exit code `0`. Jika file belum ada, layanan belum menghasilkan audit; ulangi setelah layanan mencatat aktivitas. Jika muncul `broken at line ...`, simpan informasi file/baris dan hentikan penggunaan log tersebut sampai penyebabnya diselidiki. `audit verify` memverifikasi rantai hash, bukan tanda tangan audit. Contoh hasil nyata ada di [tpm-native-demo.md](tpm-native-demo.md#verifikasi-audit).

## 7. Troubleshooting

| Gejala | Tindakan |
|---|---|
| Fingerprint `keyd` tidak sama dengan `serve` | Jangan ketik `y`. Pastikan membaca baris terbaru, keyd berjalan, dan `run\keyd-pub\delivery.pub.pem` milik startup keyd saat ini. Restart keyd dapat menghasilkan fingerprint baru; bandingkan ulang fingerprint baru sebelum menyetujui. |
| PIN ditolak atau TPM lockout | Berhenti mencoba PIN. Setiap PIN salah menaikkan counter lockout TPM. Catat pesan error, tunggu pemulihan TPM bila sedang terkunci, dan minta bantuan administrator/pemilik PIN. Jangan hapus atau inisialisasi ulang key. |
| `serve` tidak dapat dijangkau di `127.0.0.1:2798` | Pastikan jendela `serve` masih hidup, memakai `--pki-dir ..\run\pki`, dan tidak menampilkan error. Periksa port lokal 2798 serta firewall/VPN. Container mengakses host melalui `host.docker.internal:2798`; jangan mengubah firewall tanpa menguji akses container. |
| Compose gagal karena `run\pki`/sertifikat hilang | Mount sertifikat menetapkan `create_host_path: false`; Compose memang gagal jika file sumber tidak ada. Jalankan ulang `pki --out ..\run\pki`, buat folder audit pada langkah 2, lalu ulangi `docker compose up -d --build`. Jangan buat file sertifikat kosong. |
| `seed-users`, `protect-documents`, atau `tokenize-titles` gagal (exit code `1`) | Pastikan crypto-api aktif (`docker compose up -d --build` sudah berjalan dan `serve` masih terbuka), lalu jalankan dry run lagi sebelum real run. Ketiga skrip aman dijalankan ulang. |
