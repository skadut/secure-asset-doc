# database

## Tujuan

PostgreSQL menyimpan seluruh data aplikasi: aset, dokumen dan versi, tautan bukti, grant, session, audit, dan preferensi. Stack ini TPM-only; Vault sudah pensiun, data dimulai dari nol, dan tidak ada rekey.

## Image dan port

- Image `postgres:17-alpine`.
- Port `127.0.0.1:5432` (loopback saja, untuk klien DB lokal).
- Volume `pgdata` untuk data; `./db/init` di-mount read-only ke `/docker-entrypoint-initdb.d`.
- Healthcheck `pg_isready`; `restart: unless-stopped`.

## Konfigurasi

| Variabel | Kegunaan |
| --- | --- |
| `POSTGRES_USER` | User superuser database, default `sad` |
| `POSTGRES_DB` | Nama database, default `secure_asset_doc` |
| `POSTGRES_PASSWORD` | Password superuser; wajib diisi di `.env` |
| `APP_DB_PASSWORD` | Password role aplikasi `sad_app`; wajib, minimal 16 karakter |

`APP_DB_PASSWORD` dipakai `005_app_role.sh` saat init volume kosong. Backend terhubung sebagai `sad_app`, bukan superuser.

## Script init

Script berjalan alfabetis berdasarkan nama file, `001` sampai `015`, dan hanya pada volume kosong. Skema saja: volume baru berisi 0 baris di setiap tabel. Data berasal dari seed.

- `001`: skema.
- `003`: tabel uploads dan grant.
- `004`: kolom proteksi dokumen dan CHECK bentuk (`db/init/004_document_protection.sql`).
- `005`: role aplikasi `sad_app` (memakai `APP_DB_PASSWORD`, dibuat oleh `005_app_role.sh`).
- `006`: tabel RBAC, grant, dan fungsi audit (`006_rbac.sql`).
- `007`: fungsi purge audit `purge_audit_events` (`007_audit_purge.sql`).
- `008`: level akses dan grant dokumen (`008_access_levels.sql`).
- `009`: fungsi turunan `derive_document` dan kolom `derived_from` (`009_derive.sql`).
- `010`: RED+STRICT dan otorisasi ganda (`010_red_strict_dual_auth.sql`).
- `011`: perubahan level, raise oleh officer dengan persetujuan commander, lower langsung (`011_level_change.sql`).
- `012`: flag unit head dan maksimum satu head per unit (`012_unit_head.sql`).
- `013`: lockout login, last sign-in, pelacakan idle session, kosakata audit login/logout (`013_login_lockout.sql`).
- `014`: flag `users.super_admin`; super admin mengisi salah satu slot persetujuan, tidak pernah keduanya (`014_super_admin.sql`). `014` harus diterapkan sebelum backend yang membaca `users.super_admin` di-deploy.
- `015`: proteksi field (`015_field_protection.sql`): `assets.ip_address` dari inet ke text (token), batas CHECK diperlebar ke 4096 untuk alasan/nama berukuran ciphertext, `document_versions.sha256` dihapus, fungsi request/level/Derive ditulis ulang untuk menyimpan teks tersegel. Terapkan sebelum backend yang menyegel field tersebut di-deploy.

`001` sampai `015` berjalan otomatis pada volume `pgdata` baru. Pada volume lama, terapkan `010`, lalu `011`, lalu `012`, lalu `013`, `014`, dan `015` secara manual. Urutan fresh start ada di [docs/operasi/](../operasi/).

## Seed data

`seed/*.sql` diterapkan berurutan sebagai DB owner, sebelum `seed-users.mjs`. Idempoten (`ON CONFLICT DO NOTHING`).

- `seed/001_reference.sql`: subkategori NIST CSF dan rank.
- `seed/002_seed.sql`: aset, dokumen, versi, tautan, audit awal (plaintext, `protection='none'`; dihasilkan `scripts/seed-db.mjs`, jangan diedit manual). Jalankan script proteksi setelahnya.

```powershell
Get-ChildItem db\seed\*.sql | Sort-Object Name | ForEach-Object { Get-Content -Raw $_.FullName } | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## Script

- `scripts/seed-users.mjs`: 80 akun demo pada 22 rank, `access_level` per rank, grant DOC-0017, dan derived demo child. Jalankan pertama setelah fresh start. Butuh `DEMO_USER_PASSWORD` minimal 16 karakter. Tidak ada `--dry-run`. Aman dijalankan ulang. Daftar akun: [docs/demo/akun-demo.md](../demo/akun-demo.md).
- `scripts/tokenize-titles.mjs`: menokenkan judul dan nama file plaintext untuk dokumen non-CLEAR. Mendukung `--dry-run`. crypto-api TPM harus tersedia. Dry-run dan run nyata keluar dengan kode 1 bila ada baris gagal.
- `scripts/protect-documents.mjs`: migrasi proteksi; menyegel semua TLP termasuk CLEAR dan meningkatkan baris `integrity` lama. Mendukung `--dry-run`.
- `scripts/protect-fields.mjs`: menokenkan `assets.ip_address` dan `uploaded_files.name`; menyegel `assets.model`/`firmware`, `document_versions.summary` non-CLEAR, alasan request/approval, dan teks bebas perubahan level. Mendukung `--dry-run`. Jalankan sebagai DB owner, bukan `sad_app`. Idempoten: nilai yang sudah terlindungi dilewati. Butuh `015` sudah diterapkan.
- `scripts/seed-db.mjs`: meregenerasi `seed/002_seed.sql` dari `frontend/src/test-utils/grc-fixture.ts` dan file di `seed-files/`.
- `seed-files/`: file contoh yang dibaca `seed-db.mjs`; tidak disajikan aplikasi.

## Melindungi dokumen

File hasil seed atau unggahan baru masih plaintext sampai dilindungi. Setelah fresh start, jalankan dry-run lebih dulu:

```
docker compose run --rm --no-deps -v "./db/scripts/protect-documents.mjs:/app/protect-documents.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> backend node /app/protect-documents.mjs --dry-run
```

Run nyata memakai perintah yang sama tanpa `--dry-run`.

- Semua TLP, termasuk CLEAR, disegel lewat `/sealfile`. Baris CLEAR lama dengan `protection='integrity'` dinaikkan menjadi `encrypted` (tag HMAC lama dipakai ulang bila valid, bila tidak dihitung ulang).
- Menjalankan ulang aman. Hanya baris `protection='none'` dan `protection='integrity'` yang punya file yang disentuh; versi tanpa file dihitung `no file` dan dilewati.
- Exit code 1 bila ada baris gagal.
- Nilai `<...>` berasal dari `.env` root. Jangan menempel nilai asli ke dokumen atau shell history.
- Batas: `/sealfile` menerima maksimum 10 MiB setelah decode per file. File lebih besar tetap `none` dan dilaporkan gagal.
- Catatan: bila TLP dokumen diubah kemudian, menjalankan ulang tidak memproteksi ulang atau membuka proteksi versi lama. Tangani manual.

## Backup sebelum migrasi

Sebelum migrasi proteksi apa pun, backup `document_versions` dan `documents` dengan `pg_dump` (`-t document_versions -t documents`).

- File backup berisi plaintext.
- Simpan di luar repositori, misalnya `%USERPROFILE%\secure-asset-doc-backups\`.
- Jangan pernah commit.

## Urutan fresh start

Gunakan run guide di [docs/operasi/](../operasi/) dan tutorial TPM di [docs/operasi/tutorial-operator.md](../operasi/tutorial-operator.md). Init volume baru menerapkan `001`-`015` otomatis. Urutannya: seed, lalu protect documents, lalu tokenize titles. Jalankan tokenization lagi setelah membuat dokumen turunan non-CLEAR.

## Kode

`db/`, terutama `db/init/`, `db/seed/`, dan `db/scripts/`. Katalog akun demo ada di [docs/demo/akun-demo.md](../demo/akun-demo.md).
