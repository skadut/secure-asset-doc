# Seeding

Volume baru dari `db/init` hanya berisi skema: tabel, fungsi, trigger, role, dan grant, tanpa baris data. Data masuk lewat seed. Urutan wajib setelah mulai dari awal:

1. `db/seed/*.sql`
2. `seed-users`
3. `seed-totp`
4. `protect-documents`
5. `tokenize-titles`

Perintah di bawah dijalankan dari root repo. Placeholder `<...>` diisi dari `.env` secara lokal; jangan menempel nilainya ke dokumen atau riwayat shell.

> **Peringatan:** `docker compose down -v` menghapus seluruh data database dan named volume, termasuk `keyd-deks`. Jangan menjalankannya tanpa konfirmasi eksplisit. Pada VPS, jangan pernah menjalankannya sama sekali; lihat [deployment.md](deployment.md).

## Backup sebelum migrasi

Cadangkan sebelum migrasi perlindungan apa pun. File backup berisi plaintext. Simpan di luar repo dan jangan commit.

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\secure-asset-doc-backups" | Out-Null
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t document_versions -t documents -f /tmp/sad-backup.sql'
docker compose cp db:/tmp/sad-backup.sql "$env:USERPROFILE\secure-asset-doc-backups\documents-backup.sql"
docker compose exec db rm /tmp/sad-backup.sql
```

## 1. Data dasar dari `db/seed`

Terapkan `db/seed/*.sql` sebagai pemilik DB, berurutan menurut nama file:

```powershell
Get-ChildItem db\seed\*.sql | Sort-Object Name | ForEach-Object { Get-Content -Raw $_.FullName } | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Data dasar mencakup CSF, pangkat, aset, dokumen, versi, tautan, dan audit awal. Seed memakai `ON CONFLICT DO NOTHING`; menerapkannya ulang menambah baris yang hilang tetapi tidak memperbarui baris yang ada.

## 2. Akun demo (`seed-users`)

`seed-users.mjs` membuat akun demo, `access_level`, grant DOC-0017, dan dokumen turunan demo. Skrip ini tidak punya `--dry-run`. Crypto-api harus aktif dan fingerprint keyd sudah disetujui, karena hash password diberi pepper HMAC lewat `/hmac`.

```powershell
docker compose run --rm --no-deps -v "./db/scripts/seed-users.mjs:/app/seed-users.mjs:ro" -v "./db/scripts/demo-users.mjs:/app/demo-users.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> -e DEMO_USER_PASSWORD=<DEMO_USER_PASSWORD> backend node /app/seed-users.mjs
```

Password akun demo adalah `DEMO_USER_PASSWORD`, minimal 16 karakter. Daftar akun ada di [akun-demo.md](../demo/akun-demo.md).

## 3. TOTP demo (`seed-totp`)

`seed-totp` menyimpan shared secret TOTP demo untuk OTP login. Set `DEMO_TOTP_SECRET` ke 20 karakter ASCII yang dapat dicetak:

```powershell
$env:DEMO_TOTP_SECRET = "<20-char-ascii>"
docker compose run --rm --no-deps -v "./db/scripts/seed-totp.mjs:/app/seed-totp.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> -e DEMO_TOTP_SECRET backend node /app/seed-totp.mjs
```

`--print-uri` mencetak URI `otpauth://` untuk aplikasi authenticator. Hanya operator, jangan di CI:

```powershell
docker compose run --rm --no-deps -v "./db/scripts/seed-totp.mjs:/app/seed-totp.mjs:ro" -e DEMO_TOTP_SECRET backend node /app/seed-totp.mjs --print-uri
```

## 4. Perlindungan dokumen (`protect-documents`)

`protect-documents.mjs` men-seal setiap versi file, termasuk dokumen CLEAR, lewat crypto-api `/sealfile` dan menyimpannya di `content_ciphertext`. Skrip ini juga memigrasikan baris lama dengan `protection='integrity'` menjadi `encrypted`. Crypto-api harus aktif.

Dry run dulu:

```powershell
docker compose run --rm --no-deps -v "./db/scripts/protect-documents.mjs:/app/protect-documents.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> backend node /app/protect-documents.mjs --dry-run
```

Run nyata adalah perintah yang sama tanpa `--dry-run`.

- Menjalankan ulang aman: hanya baris `protection='none'` dan baris `integrity` lama yang disentuh.
- Exit code 1 jika ada baris gagal.
- Batas: `/sealfile` menerima maksimal 10 MiB setelah decode per file. File yang lebih besar tetap `none` dan dilaporkan gagal.
- Jika TLP dokumen berubah kemudian, menjalankan ulang tidak memproteksi atau melepas proteksi versi yang sudah ada. Kasus ini di luar cakupan; tangani manual.

## 5. Tokenisasi judul (`tokenize-titles`)

`tokenize-titles.mjs` men-tokenisasi `documents.title` dan `document_versions.file_name` untuk dokumen non-CLEAR menjadi `<masked>:<t1:sealed>`. Crypto-api harus aktif. Dry run dulu:

```powershell
docker compose run --rm --no-deps -v "./db/scripts/tokenize-titles.mjs:/app/tokenize-titles.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> backend node /app/tokenize-titles.mjs --dry-run
```

Run nyata adalah perintah yang sama tanpa `--dry-run`. Baris yang sudah berupa token dilewati; baris baru perlu dijalankan ulang. Exit code 1 jika ada baris gagal.

## Pemeriksaan

Setelah kelima langkah, periksa hasilnya lewat psql read-only:

```powershell
docker compose exec db psql -U <POSTGRES_USER> -d <POSTGRES_DB>
```

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

Semua kolom harus bernilai `0`. Judul dan nama file token berbentuk `<masked>:t1:<sealed>`, jadi dicek dengan `%:t1:%`; ciphertext konten diawali `skadut-t1:`. Versi tanpa konten (briefing turunan dari `derive_document`) sengaja dikecualikan karena tidak punya file maupun ciphertext, dan `protection` tetap `none`. Jika ada nilai bukan `0`, jangan lanjutkan; ulangi dry run lalu run nyata untuk skrip terkait.

Alur reset lengkap, termasuk `down -v`, ada di [tutorial operator langkah 5](tutorial-operator.md#5-reset-data-dari-nol). Versi copy-paste PowerShell ada di [run-powershell.md](run-powershell.md).
