# Run di PowerShell (copy-paste)

Setiap blok bisa langsung di-paste ke **Windows PowerShell**. Setiap blok mulai dengan `Set-Location`, jadi aman di-paste di folder mana pun. Untuk perintah yang meminta PIN, pakai PowerShell, jangan Git Bash. Jangan menebak PIN, karena setiap PIN salah menaikkan lockout TPM. Penjelasan lengkap ada di [TUTORIAL.md](TUTORIAL.md).

Daftar isi:
- [Versi 1: Boot dari 0](#versi-1-boot-dari-0)
- [Versi 2: Pause lalu jalankan lagi (repeat)](#versi-2-pause-lalu-jalankan-lagi-repeat)
- [Versi 3: Lanjutkan lalu hapus semua atau hapus DB aplikasi saja](#versi-3-lanjutkan-lalu-hapus-semua-atau-hapus-db-aplikasi-saja)
- [Versi 4: Pulihkan ke TPM baru](#versi-4-pulihkan-ke-tpm-baru)

## Versi 1: Boot dari 0

### 0. Prasyarat

Build exe, siapkan PKI (jika belum ada), dan buat folder audit:

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
go build -o bin\tpm-msk.exe ./cmd/tpm-msk
if (-not (Test-Path ..\run\pki\keyzone\ca.pem)) { & .\bin\tpm-msk.exe pki --out ..\run\pki }
New-Item -ItemType Directory -Force ..\run\audit\keyd, ..\run\audit\crypto-api | Out-Null
```

Yang diharapkan: `ca.pem` ada dan kedua folder audit tersedia.

Pakai dua jendela:
- **Jendela A** untuk `tpm-msk` (init, kek, serve).
- **Jendela B** untuk Docker dan seed.

### 1. Reset Docker (TIDAK BISA DIBATALKAN)

**PERINGATAN: perintah ini menghapus volume Docker beserta datanya secara permanen.** Jalankan dari root repo.

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose down -v --remove-orphans
docker volume ls --filter name=secure-asset-doc
```

Yang diharapkan: daftar tidak berisi `secure-asset-doc_pgdata`, `secure-asset-doc_keyd-deks`, `secure-asset-doc_keyd-sock`; volume lama lain (mis. sisa Vault) boleh ada.

### 2. Arsipkan material TPM lama (bukan hapus)

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
$old = "$env:USERPROFILE\tpm-msk-old-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force $old | Out-Null
foreach ($f in 'msk.key','keks.json','audit.jsonl') { $p = "$env:APPDATA\tpm-msk\$f"; if (Test-Path $p) { Move-Item $p $old } }
$e = "$env:USERPROFILE\tpm-msk-escrow\msk.escrow"; if (Test-Path $e) { Move-Item $e $old }
Get-ChildItem $old | Select-Object Name, Length
Remove-Item -Recurse -Force ..\run\keyd-pub -ErrorAction SilentlyContinue
```

MSK lama tidak dapat diekspor dan database lama sudah dihapus, jadi tidak ada yang bisa dipulihkan. Arsipkan alih-alih menghapus agar tindakan ini bisa dibatalkan. `msk.escrow` ikut dipindahkan karena `init --escrow` menolak jika `msk.escrow` sudah ada. Folder `keyd-pub` dihapus agar fingerprint lama tidak terbaca.

### 3. Buat MSK dengan escrow (Jendela A, PIN baru)

Ketik PIN baru dua kali.

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
& .\bin\tpm-msk.exe init --escrow "$env:USERPROFILE\tpm-msk-escrow"
```

Yang diharapkan: path `msk.key`, `key_id: ...`, lima baris `share 1/5 <bundle_id>:<hex>` sampai `share 5/5 ...`, lalu peringatan custodian.

**Shares hanya ditampilkan SEKALI. Catat masing-masing pada custodian/media terpisah. Jangan tempel ke repo, chat, atau file di dalam repo. Tiga dari lima shares memulihkan semuanya. Setelah menyalin, gulir/bersihkan konsol dengan `Clear-Host`.** Catat nilai `key_id` (bukan rahasia) untuk pemeriksaan nanti. Folder `tpm-msk-escrow` menyimpan `msk.escrow` terenkripsi, tidak berguna tanpa 3 shares.

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
Clear-Host
```

### 4. Buat KEK

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
& .\bin\tpm-msk.exe kek create --id kek-01
```

Yang diharapkan: `created kek-01 version 1`.

### 5. Jalankan layanan TPM (Jendela A, biarkan terbuka)

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
& .\bin\tpm-msk.exe serve --pki-dir ..\run\pki --pubkey-file ..\run\keyd-pub\delivery.pub.pem
```

Masukkan `<PIN>`. Layanan jalan di `127.0.0.1:2798` dan menunggu fingerprint keyd. Jangan tutup jendela ini. Baris `[DEMO] Share …` dari `serve` adalah share contoh demo, bukan share escrow MSK; abaikan. Setiap permintaan KEK tampil sebagai baris `[audit] ...` di jendela ini; catatan lengkap tetap di `%APPDATA%\tpm-msk\audit.jsonl`. Matikan dengan `--audit-echo=false`.

### 6. Jalankan aplikasi dan setujui fingerprint (Jendela B)

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose up -d --build
docker compose logs keyd | Select-String "fingerprint" | Select-Object -Last 1
```

Bandingkan `delivery key fingerprint: sha256:...` di sini dengan `Delivery key fingerprint: sha256:...` di Jendela A. Jika sama persis, cukup tekan `y` atau `Y` satu kali tanpa Enter. Jika prompt tidak merespons, hentikan `serve` dengan Ctrl+C lalu jalankan ulang dengan `--approve-fingerprint sha256:<fingerprint>`, memakai fingerprint yang tercetak di log keyd (`docker compose logs keyd`); fingerprint yang tidak cocok kembali ke prompt manual.

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose ps
```

Yang diharapkan: semua service `running` atau `healthy`. Setelah ini, untuk rebuild crypto-api saja selalu pakai `docker compose up -d --build --no-deps crypto-api`; keyd tidak ikut restart dan tidak perlu approval ulang.

### 7. Muat kredensial dari `.env` ke sesi ini (tanpa menampilkannya)

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
foreach ($line in Get-Content .\.env) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"').Trim("'"), 'Process')
  }
}
$env:PGUSER = $env:POSTGRES_USER
$env:PGDATABASE = $env:POSTGRES_DB
$env:PGPASSWORD = $env:POSTGRES_PASSWORD
"PGUSER set: $([bool]$env:PGUSER) | PGPASSWORD set: $([bool]$env:PGPASSWORD) | DEMO_USER_PASSWORD set: $([bool]$env:DEMO_USER_PASSWORD)"
```

Yang diharapkan: ketiganya `True`. Kalau `DEMO_USER_PASSWORD` masih `False`, isi secara tersembunyi:

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
$s = Read-Host "DEMO_USER_PASSWORD (min 16 karakter)" -AsSecureString
$env:DEMO_USER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
```

Nilainya hanya ada di sesi jendela ini. `-e NAMA` tanpa `=nilai` meneruskan variabel dari sesi, jadi password tidak tercatat di riwayat perintah.

### 8. Uji POC layanan TPM (opsional, sebelum seed)

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
powershell -NoProfile -ExecutionPolicy Bypass -File .\cryptography-service\tpm-services\poc.ps1
"exit: $LASTEXITCODE"
```

Yang diharapkan: semua baris `PASS` (atau `SKIP` untuk audit yang belum ada) dan `exit: 0`. Jangan lanjut ke seed sebelum semua PASS.

### 9. Seed data (urutan tetap)

Jalankan di jendela yang sama dengan langkah pemuatan kredensial. Urutannya wajib: data dasar, seed akun, file versi, protect, tokenize. `9a` juga membuat `super.admin` (L5, semua menu); nama RED+STRICT ditampilkan sebagai token. Password akun demo adalah `<DEMO_USER_PASSWORD>`.

**9-0. Data dasar dari `db/seed`**

Volume baru hanya berisi skema (tabel, fungsi, trigger, role, grant), tanpa baris data. Langkah ini mengisi referensi CSF, pangkat, aset, dokumen, versi, tautan, dan audit awal dari `db/seed/*.sql` sesuai urutan nama file, sebagai pemilik DB lewat container `db`. Aman dijalankan ulang (`ON CONFLICT DO NOTHING`).

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
Get-ChildItem db\seed\*.sql | Sort-Object Name | ForEach-Object { Get-Content -Raw $_.FullName } | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
"exit: $LASTEXITCODE"
docker compose exec -T db sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (SELECT count(*) FROM documents), (SELECT count(*) FROM document_versions), (SELECT count(*) FROM assets)"'
```

Yang diharapkan: `exit: 0`, lalu `17|43|20`.

**9a. Akun demo**

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose run --rm --no-deps -v "./db/scripts/seed-users.mjs:/app/seed-users.mjs:ro" -v "./db/scripts/demo-users.mjs:/app/demo-users.mjs:ro" -e PGUSER -e PGDATABASE -e PGPASSWORD -e DEMO_USER_PASSWORD backend node /app/seed-users.mjs
"exit: $LASTEXITCODE"
```

**9b. File fiktif untuk setiap versi (jalankan SEBELUM protect). Dry run dulu:**

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose run --rm --no-deps -v "./db/scripts/seed-version-files.mjs:/app/seed-version-files.mjs:ro" -e PGUSER -e PGDATABASE -e PGPASSWORD backend node /app/seed-version-files.mjs --dry-run
"exit: $LASTEXITCODE"
```

Kalau hasilnya `exit: 0`, jalankan yang asli:

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose run --rm --no-deps -v "./db/scripts/seed-version-files.mjs:/app/seed-version-files.mjs:ro" -e PGUSER -e PGDATABASE -e PGPASSWORD backend node /app/seed-version-files.mjs
"exit: $LASTEXITCODE"
```

Yang diharapkan: baris `doc DOC-xxxx vN ... bytes` dan `updated N rows`.

**9c. Enkripsi dokumen. Dry run dulu:**

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose run --rm --no-deps -v "./db/scripts/protect-documents.mjs:/app/protect-documents.mjs:ro" -e PGUSER -e PGDATABASE -e PGPASSWORD backend node /app/protect-documents.mjs --dry-run
"exit: $LASTEXITCODE"
```

Kalau hasilnya `exit: 0`, jalankan yang asli:

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose run --rm --no-deps -v "./db/scripts/protect-documents.mjs:/app/protect-documents.mjs:ro" -e PGUSER -e PGDATABASE -e PGPASSWORD backend node /app/protect-documents.mjs
"exit: $LASTEXITCODE"
```

**9d. Tokenisasi judul. Dry run dulu:**

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose run --rm --no-deps -v "./db/scripts/tokenize-titles.mjs:/app/tokenize-titles.mjs:ro" -e PGUSER -e PGDATABASE -e PGPASSWORD backend node /app/tokenize-titles.mjs --dry-run
"exit: $LASTEXITCODE"
```

Kalau hasilnya `exit: 0`, jalankan yang asli:

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose run --rm --no-deps -v "./db/scripts/tokenize-titles.mjs:/app/tokenize-titles.mjs:ro" -e PGUSER -e PGDATABASE -e PGPASSWORD backend node /app/tokenize-titles.mjs
"exit: $LASTEXITCODE"
```

Yang diharapkan: exit `0` untuk setiap seed. Exit `1` berarti ada baris gagal; pastikan Jendela A masih hidup lalu ulangi. Skrip seed aman dijalankan ulang.

**9e. Proteksi field sensitif. Dry run dulu:**

```powershell
Set-Location "D:_Dev_hackatonsecure-asset-doc"
docker compose run --rm --no-deps -v "./db/scripts/protect-fields.mjs:/app/protect-fields.mjs:ro" -e PGUSER -e PGDATABASE -e PGPASSWORD backend node /app/protect-fields.mjs --dry-run
"exit: $LASTEXITCODE"
```

Kalau hasilnya `exit: 0`, jalankan yang asli:

```powershell
Set-Location "D:_Dev_hackatonsecure-asset-doc"
docker compose run --rm --no-deps -v "./db/scripts/protect-fields.mjs:/app/protect-fields.mjs:ro" -e PGUSER -e PGDATABASE -e PGPASSWORD backend node /app/protect-fields.mjs
"exit: $LASTEXITCODE"
```

Yang diharapkan: satu baris `summary <tabel>.<kolom> processed=N ok=N skipped=N failed=N` per kolom, lalu `dry-run: no writes` atau `writes committed`, dan `exit: 0`. `failed=0` wajib; exit `1` berarti ada baris gagal. Jalankan sebagai owner DB, bukan `sad_app`. Aman dijalankan ulang: nilai yang sudah terproteksi dilewati.

### 10. Verifikasi read-only

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
$sql = @'
SELECT count(*) FILTER (WHERE tlp <> 'CLEAR' AND title NOT LIKE '%:t1:%') AS title_bad FROM documents;
SELECT count(*) FILTER (WHERE d.tlp <> 'CLEAR' AND (v.file_name IS NULL OR v.file_name NOT LIKE '%:t1:%')) AS file_name_bad,
       count(*) FILTER (WHERE d.tlp <> 'CLEAR' AND (v.content_ciphertext IS NULL OR v.content_ciphertext NOT LIKE 'skadut-t1:%')) AS content_bad,
       count(*) FILTER (WHERE d.tlp <> 'CLEAR' AND v.protection <> 'encrypted') AS protection_bad
FROM document_versions v JOIN documents d ON d.id = v.document_id
WHERE v.content_base64 IS NOT NULL OR v.content_ciphertext IS NOT NULL;
SELECT count(*) AS versions_without_file FROM document_versions WHERE content_base64 IS NULL AND content_ciphertext IS NULL;
SELECT count(*) FILTER (WHERE ip_address !~ '^[^:]*:t1:') AS ip_bad,
       count(*) FILTER (WHERE model NOT LIKE 'skadut-t1:%' OR firmware NOT LIKE 'skadut-t1:%') AS model_firmware_bad FROM assets;
SELECT count(*) AS summary_bad FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.tlp <> 'CLEAR' AND v.summary NOT LIKE 'skadut-t1:%';
SELECT (SELECT count(*) FROM uploaded_files WHERE name !~ '^[^:]*:t1:')
     + (SELECT count(*) FROM access_requests WHERE reason NOT LIKE 'skadut-t1:%')
     + (SELECT count(*) FROM access_approvals WHERE reason NOT LIKE 'skadut-t1:%')
     + (SELECT count(*) FROM level_change_requests WHERE justification NOT LIKE 'skadut-t1:%' OR screening_ref NOT LIKE 'skadut-t1:%' OR decision_reason NOT LIKE 'skadut-t1:%') AS freetext_bad;
'@
$sql | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Yang diharapkan: semua kolom bernilai `0`.

### 11. Backup key-zone pertama (wajib, setelah seed)

Keyd baru membuat DEK saat seed memakai enkripsi. Pastikan Jendela A (`serve`) masih hidup.

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
$bundle = "$env:USERPROFILE\tpm-msk-bundle-$(Get-Date -Format yyyyMMdd-HHmmss)"
$tmp = "$env:TEMP\deks-export.json"
docker compose cp keyd:/var/lib/keyd/deks.json $tmp
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
& .\bin\tpm-msk.exe backup export --escrow "$env:USERPROFILE\tpm-msk-escrow" --deks $tmp --out $bundle
"exit: $LASTEXITCODE"
Remove-Item $tmp
Get-ChildItem $bundle | Select-Object Name, Length
```

Masukkan `<PIN>` saat diminta. Yang diharapkan: `wrote <bundle>` dan empat berkas `manifest.json`, `msk.escrow`, `keks.json`, `deks.json`. Bundle tidak berisi plaintext key dan tidak berguna tanpa 3 shares; tetap simpan di luar mesin pada media terenkripsi.

Ekspor ulang setiap ada DEK baru: keyd membuat DEK saat pertama kali dipakai pada tiap tahun UTC (berikutnya 1 Jan 2027) dan setelah rotasi. Periksa `run\audit\keyd\audit.jsonl` untuk `dek.create`. Bundle hanya berisi KEYS; DATA terenkripsi tersimpan di Postgres. Buat juga `pg_dump` dengan perintah Versi 3 langkah 2, simpan di `$env:USERPROFILE\secure-asset-doc-backups`.

Jika `backup export` tidak bisa membuka TPM saat `serve` berjalan, hentikan `serve` dengan Ctrl+C, ekspor, lalu mulai ulang `serve` (fingerprint sama; ketik `y` lagi).

### 12. Uji restore (fungsional, TPM yang sama; tidak menyentuh key aktif)

Gunakan nilai `$bundle` yang dibuat pada langkah 11. Siapkan folder uji dan jalankan import:

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
$t = "$env:TEMP\tpm-msk-restore-test"
New-Item -ItemType Directory -Force $t | Out-Null
& .\bin\tpm-msk.exe backup import --in $bundle --key "$t\msk.key" --file "$t\keks.json"
"exit: $LASTEXITCODE"
```

Pada prompt, tempel 3 dari 5 share (misalnya 1, 3, 5), satu per baris, Enter setelah masing-masing. Lalu masukkan PIN uji dua kali (PIN apa pun, minimal 6 karakter). Yang diharapkan: `restore deks.json into the keyd-deks docker volume (see docs)` dan `exit: 0`; ini membuktikan Key ID cocok dan setiap KEK dapat di-unwrap.

Buktikan kegagalan juga: ulangi dengan hanya 2 shares lalu Ctrl+Z/Enter, atau dengan share yang salah ketik. Yang diharapkan: error dan exit `1`.

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
Remove-Item -Recurse -Force $t
```

### 13. Buka aplikasi dan cek versi

Buka http://127.0.0.1:8088 lalu tekan Ctrl+F5. Login `super.admin` (OTP `123456`). Di `/viewer`, cek urutan kolom `No. dokumen | Nama dokumen | TLP`, buka dokumen, lalu klik versi lama (1.0/2.0); preview harus berganti.

### 14. Hapus kredensial dari sesi

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
Remove-Item env:PGPASSWORD, env:POSTGRES_PASSWORD, env:APP_DB_PASSWORD, env:DEMO_USER_PASSWORD -ErrorAction SilentlyContinue
```

Cara lain: tutup Jendela B.
Menutup Jendela B lebih bersih, karena semua variabel `.env` ikut hilang.

## Versi 2: Pause lalu jalankan lagi (repeat)

Asumsi: jendela A dan B sudah ditutup; buka PowerShell baru. Bagian Pause dijalankan dulu, saat jendela masih terbuka.

### Pause (jendela masih terbuka)

Di Jendela B, jalankan:

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
docker compose stop
```

Di Jendela A, tekan Ctrl+C pada proses `serve`. Tidak ada data yang hilang.

### Jalankan lagi (jendela baru)

Buka dua PowerShell baru, lalu ikuti langkah ini. Tidak ada variabel dari Versi 1 yang dipakai.

1. Jendela A (baru): mulai `serve`. Masukkan `<PIN>` saat diminta; gunakan PIN operator. Baris `[DEMO] Share …` dari `serve` adalah share contoh demo, bukan share escrow MSK; abaikan.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
   & .\bin\tpm-msk.exe serve --pki-dir ..\run\pki --pubkey-file ..\run\keyd-pub\delivery.pub.pem
   ```

2. Jendela B (baru): jalankan layanan tanpa membangun ulang. Untuk rebuild hanya crypto-api, gunakan `docker compose up -d --build --no-deps crypto-api` (keyd tidak restart, tanpa approval ulang).

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose up -d
   ```

3. Baca fingerprint keyd.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose logs keyd | Select-String "fingerprint" | Select-Object -Last 1
   ```

4. Tunggu prompt `[y/N]` muncul di Jendela A, lalu tekan `y` atau `Y` satu kali tanpa Enter. Jika prompt tidak merespons, pakai `--approve-fingerprint sha256:<fingerprint>` seperti di Versi 1 langkah 6. Jawaban yang diketik sebelum prompt muncul akan terbuang. Persetujuan diperlukan lagi setiap keyd restart. Jika muncul prompt untuk fingerprint lama, jawab `N` atau tunggu sampai prompt baru menggantikannya (log `pubkey.cancel`); setujui hanya yang sama dengan baris log terakhir.

### Uji POC (opsional)

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
powershell -NoProfile -ExecutionPolicy Bypass -File .\cryptography-service\tpm-services\poc.ps1
```

### Verifikasi audit (opsional)

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
& .\bin\tpm-msk.exe audit verify ..\run\audit\keyd\audit.jsonl
& .\bin\tpm-msk.exe audit verify ..\run\audit\crypto-api\audit.jsonl
& .\bin\tpm-msk.exe audit verify "$env:APPDATA\tpm-msk\audit.jsonl"
```

Yang diharapkan: `OK (<n> records)`. Tidak perlu init atau seed.

## Versi 3: Lanjutkan lalu hapus semua atau hapus DB aplikasi saja

Pilih satu: [3A](#3a-hapus-semua) menghapus semua data Docker, [3B](#3b-hapus-db-aplikasi-saja) hanya database aplikasi.

### 3A. Hapus semua

Asumsi: jendela A dan B sudah ditutup; buka PowerShell baru. Versi ini tidak memerlukan `serve` TPM. Hanya container `db` yang dinyalakan, untuk backup. Tidak ada variabel dari Versi 1 yang dipakai.

**PERINGATAN: Langkah ini menghapus semua data Docker, termasuk database, volume, serta state audit/keyd. Tindakan ini tidak dapat dibatalkan.**

1. Nyalakan database (hanya untuk backup). Lewati langkah ini jika backup tidak dibutuhkan.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose up -d db
   docker compose ps db
   ```

   Tunggu sampai status `running` (atau `healthy` jika ada healthcheck) sebelum lanjut.

2. Backup database opsional. Dump berisi plaintext. Jalankan dari root repo.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   New-Item -ItemType Directory -Force "$env:USERPROFILE\secure-asset-doc-backups" | Out-Null
   docker compose exec db sh -c 'pg_dump --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/sad-full-backup.sql'
   docker compose cp db:/tmp/sad-full-backup.sql "$env:USERPROFILE\secure-asset-doc-backups\full-backup.sql"
   docker compose exec db rm /tmp/sad-full-backup.sql
   ```

   Simpan file dump di luar repo; jangan commit atau kirimkan.

3. Hapus container dan volume.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose down -v --remove-orphans
   ```

4. Daftar volume terkait, lalu hapus setiap volume yang masih terdaftar secara manual.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker volume ls --filter name=secure-asset-doc
   docker volume rm <nama-volume-1>
   docker volume rm <nama-volume-2>
   ```

   Ganti setiap placeholder dengan nama volume yang terdaftar. **Menghapus volume `keyd-deks` memusnahkan DEK; pemulihan hanya mungkin dari bundle.**

5. Opsional: hapus state audit dan keyd lokal. Blok ini sudah `cd` ke folder tpm-services, jadi path relatif valid.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
   Remove-Item -Recurse ..\run\audit\*
   Remove-Item -Recurse ..\run\keyd-pub -ErrorAction SilentlyContinue
   New-Item -ItemType Directory -Force ..\run\audit\keyd, ..\run\audit\crypto-api | Out-Null
   ```

Material key TPM `%APPDATA%\tpm-msk\msk.key` dan `keks.json` tetap disimpan secara default. Jika operator menghapusnya, semua KEK yang dibungkus dan data terenkripsi menjadi tidak dapat dipulihkan. Penghapusan ini keputusan manual yang terpisah.

```powershell
Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
# Remove-Item "$env:APPDATA\tpm-msk\msk.key"
# Remove-Item "$env:APPDATA\tpm-msk\keks.json"
```

Untuk mulai dari awal, buka [Versi 1](#versi-1-boot-dari-0). Jika material TPM tetap disimpan, lewati `init` dan `kek create`, lalu mulai dari reset/serve.

### 3B. Hapus DB aplikasi saja

Asumsi: stack Docker sudah berjalan dan jendela A (`serve` TPM) tetap hidup. Menghapus hanya volume Postgres `secure-asset-doc_pgdata` (dokumen, versi, user, grant, audit aplikasi). Volume `keyd-deks`, material TPM, PKI, dan audit keyd/crypto-api tetap. keyd tidak di-restart, jadi tidak perlu approval fingerprint ulang. Jendela A (`serve`) harus tetap hidup untuk seed.

1. Backup opsional. Ikuti 3A langkah 2 (pg_dump). Pastikan `db` berjalan dulu (3A langkah 1). Lewati jika backup tidak dibutuhkan.

2. **PERINGATAN: menghapus seluruh isi database aplikasi secara permanen.**

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose rm -s -f frontend backend db
   docker volume rm secure-asset-doc_pgdata
   docker volume ls --filter name=secure-asset-doc
   ```

   Yang diharapkan: `secure-asset-doc_pgdata` tidak ada lagi; `keyd-deks` dan `keyd-sock` masih ada.

3. Nyalakan ulang database, lalu backend dan frontend. Volume baru menjalankan `db/init/*` yang hanya membuat skema.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose up -d --wait --no-deps db
   docker compose up -d --no-deps --build backend frontend
   docker compose ps
   ```

   Yang diharapkan: `db` dan `backend` `healthy`; `keyd` dan `crypto-api` uptime tidak berubah (tidak restart). Pada titik ini DB berisi tabel, fungsi, trigger, role, dan grant, tetapi **0 baris di setiap tabel**: belum ada dokumen, aset, user, atau audit. Semua data hanya masuk lewat seed di langkah 4.

4. Muat kredensial dan seed ulang. Jalankan di jendela yang sama dengan Versi 1 langkah 7 (muat kredensial), lalu ikuti Versi 1 langkah 9 dengan urutan wajib 9-0 (data dasar dari `db/seed`), 9a, 9b, 9c, 9d, 9e, kemudian langkah 10 (verifikasi). Jendela A (`serve`) harus tetap hidup.

   Password akun demo disimpan sebagai `hmac$<salt>$<tag>` lewat crypto-api `/hmac`; login memverifikasi lewat `/verifyhmac`. Password tetap `<DEMO_USER_PASSWORD>`.

5. Catatan DEK. DEK lama di `keyd-deks` tetap ada, tapi tidak dipakai data apa pun lagi; aman dibiarkan. Jika seed membuat `dek.create` baru (cek `run\audit\keyd\audit.jsonl`), ekspor ulang bundle key-zone (Versi 1 langkah 11) setelah seed.

6. Hapus kredensial dari sesi. Lihat Versi 1 langkah 14.

## Versi 4: Pulihkan ke TPM baru

Pulihkan ke mesin dan TPM baru menggunakan bundle key-zone serta dump database terbaru. Jangan jalankan perintah `DROP`; jika database konflik saat restore, berhenti dan minta bantuan.

1. Di mesin baru, clone repo, build exe, siapkan PKI, dan folder audit. Salin folder bundle dan `pg_dump` terbaru ke mesin ini.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
   go build -o bin\tpm-msk.exe ./cmd/tpm-msk
   & .\bin\tpm-msk.exe pki --out ..\run\pki
   New-Item -ItemType Directory -Force ..\run\audit\keyd, ..\run\audit\crypto-api | Out-Null
   ```

   Yang diharapkan: PKI dan folder audit siap. Pastikan `$bundle` menunjuk folder bundle yang disalin.

2. Impor MSK dan KEK pada TPM baru. Masukkan PIN baru saat diminta, lalu tempel 3 shares. Set `$bundle` (baris pertama blok) di setiap jendela PowerShell baru; nilainya hilang saat jendela ditutup.

   ```powershell
   $bundle = "<path-folder-bundle>"
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
   & .\bin\tpm-msk.exe backup import --in $bundle
   "exit: $LASTEXITCODE"
   ```

   Yang diharapkan: `exit: 0`. Tambahkan `--force` hanya jika `msk.key`/`keks.json` sudah ada di mesin ini dan memang harus diganti. **`--force` menimpa material key yang ada secara permanen.**

3. Pulihkan `deks.json` ke volume sebelum keyd mulai. Tetapkan `$bundle` ke path folder bundle. Cek nama volume dulu: `docker volume ls | Select-String keyd-deks`; ganti bila prefix berbeda.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose create keyd
   docker run --rm -v secure-asset-doc_keyd-deks:/v -v "${bundle}:/in:ro" alpine:3.20 sh -c 'cp /in/deks.json /v/deks.json && chown 65532:65532 /v/deks.json && chmod 600 /v/deks.json'
   ```

   Keyd berjalan sebagai UID `65532` dan membutuhkan berkas milik UID tersebut dengan mode `0600`.

4. Pulihkan database dari dump terbaru. Ganti `<dump>` dengan path file dump lokal. Database baru mungkin sudah menjalankan skrip init. Dump dibuat dengan `--clean --if-exists`, jadi tabel hasil init diganti isi dump. Dump lama tanpa opsi itu akan konflik; buat dump baru dulu. Jangan jalankan perintah `DROP`.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose up -d --wait db
   docker compose ps db
   docker compose cp <dump> db:/tmp/restore.sql
   docker compose exec db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/restore.sql'
   docker compose exec db rm /tmp/restore.sql
   ```

5. Jalankan TPM serve di Jendela A, lalu start aplikasi dan setujui fingerprint yang cocok.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
   & .\bin\tpm-msk.exe serve --pki-dir ..\run\pki --pubkey-file ..\run\keyd-pub\delivery.pub.pem
   ```

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   docker compose up -d --build
   docker compose logs keyd | Select-String "fingerprint" | Select-Object -Last 1
   ```

   Masukkan `<PIN>` saat diminta. Bandingkan fingerprint, lalu ketik `y` di Jendela A hanya jika sama persis. Baris `[DEMO] Share …` dari `serve` adalah share contoh demo, bukan share escrow MSK; abaikan. Jalankan POC seperti Versi 1 langkah 8, buka aplikasi, lalu buka dokumen terenkripsi untuk memastikan dekripsi berhasil.

6. Ekspor ulang bundle pada mesin baru. Salin `msk.escrow` dari bundle ke folder escrow di profil pengguna terlebih dahulu; berkas shares tetap milik custodian.

   ```powershell
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc"
   New-Item -ItemType Directory -Force "$env:USERPROFILE\tpm-msk-escrow" | Out-Null
   Copy-Item "$bundle\msk.escrow" "$env:USERPROFILE\tpm-msk-escrow\msk.escrow"
   $tmp = "$env:TEMP\deks-export.json"
   $newBundle = "$env:USERPROFILE\tpm-msk-bundle-$(Get-Date -Format yyyyMMdd-HHmmss)"
   docker compose cp keyd:/var/lib/keyd/deks.json $tmp
   Set-Location "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
   & .\bin\tpm-msk.exe backup export --escrow "$env:USERPROFILE\tpm-msk-escrow" --deks $tmp --out $newBundle
   "exit: $LASTEXITCODE"
   Remove-Item $tmp
   ```

   Masukkan `<PIN>`. Yang diharapkan: bundle baru tertulis; simpan di luar mesin pada media terenkripsi.
