# backend

## Tujuan

API Node.js untuk autentikasi, data GRC, file dokumen, unggahan, grant, level, audit purge, traffic, dan tampilan database. Backend juga satu-satunya klien crypto-api dari sisi aplikasi.

## Image dan port

- Build dari `backend/Dockerfile`: `node:24-alpine`, `npm ci --omit=dev`, berjalan sebagai user `node`.
- Listen di `3000` (`PORT`, default 3000). Compose tidak memetakan port host; akses hanya lewat frontend.
- `init: true`, `restart: unless-stopped`.

## Konfigurasi

Nama environment variable; nilai ada di `.env` atau `compose.yaml`.

| Variabel | Kegunaan |
| --- | --- |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Koneksi PostgreSQL |
| `APP_ORIGINS` | Daftar origin yang diizinkan untuk request non-GET/HEAD |
| `CRYPTO_URL` | Base URL crypto-api, default `https://crypto-api:2796` |
| `CRYPTO_CERT`, `CRYPTO_KEY`, `CRYPTO_CA` | File mTLS client ke crypto-api |
| `PORT` | Port listen, default 3000 |

## Endpoint

### `GET /api/traffic`

Statistik edge untuk peta layanan.

```json
{ "ts": 1793030000, "edges": [{ "source": "frontend", "target": "backend", "rps": 12.4, "errorRate": 0, "avgMs": 35 }], "down": ["crypto-service"] }
```

- Edge `frontend>backend`, `backend>db`, `backend>crypto-service`, dan `client>crypto-service`. Edge milik backend selalu ada dengan nilai nol; edge crypto hanya muncul bila fetch `/internal/traffic` berhasil.
- `down` berisi `crypto-service` bila fetch gagal, dan `db` bila `SELECT 1` gagal.
- Window 10 detik, metadata saja: ID, jumlah, durasi, kelas status.
- Rate limit 5 req/s token bucket global; kelebihan menghasilkan `429 {"error":"rate_limited"}`. In-memory, reset saat restart. Butuh session cookie; tanpa session `401 {"error":"unauthenticated"}`.
- Hanya super admin. Self-check: `node backend/traffic.check.mjs`.

### Unggahan

File disegel crypto-api (`CRYPTO_URL`). Hanya ciphertext yang disimpan di `uploaded_files`.

`POST /api/uploads` (`Content-Type: application/json`)

Request: `{ "name": "a.pdf", "mime": "application/pdf", "data": "<std base64>" }`

Response `201`: `{ "id": "<uuid>", "name": "a.pdf", "mime": "application/pdf", "size": 1234, "uploadedAt": "2026-10-28T00:00:00Z", "uploadedBy": "<username>" }`

- Error: `400 {"error":"bad request"}`, `408 {"error":"timeout"}`, `413 {"error":"too large"}`, `415 {"error":"unsupported media type"}`, `429 {"error":"rate_limited"}`, `502 {"error":"crypto unavailable"}`, `503 {"error":"unavailable"}`.
- Batas: body 14 MiB, file 10 MiB, 2 req/s (burst 2). Allowlist mime: PDF, PNG, JPEG, plain text. Magic bytes diperiksa. Nama: basename, maksimum 200 karakter, tanpa control character.

`GET /api/uploads`: daftar terbaru, maksimum 50. Response `200` array `{id, name, mime, size, uploadedAt, uploadedBy}`. `uploadedBy` adalah username atau null.

- Error: `403 {"error":"forbidden"}` bila tier tidak punya `upload.r`.

`GET /api/uploads/:id/content`: byte file mentah. Header: `Content-Type` mime tersimpan, `Content-Length`, `Content-Disposition: inline; filename*=UTF-8''...`, `X-Content-Type-Options: nosniff`, CSP `sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`, `Cache-Control: no-store`.

- Error: `403` tanpa `upload.r`, `400` bila ID bukan UUID, `404`, `502`, `503`.
- Self-check: `node backend/uploads.check.mjs`.

### Tulis dokumen: `POST /api/documents`

File: `doc-upload.mjs` (handler), `doc-create.mjs` (validasi). Dipakai wizard `/documents/upload`.

Auth dan CSRF berlaku untuk semua route tulis di bagian ini: session cookie wajib (tanpa session `401 {"error":"unauthenticated"}`), dan `Origin` harus ada di `APP_ORIGINS` (selain itu `403 {"error":"forbidden"}`). Body dengan `Content-Type` selain JSON ditolak `415`.

Body JSON (`Content-Type: application/json`):

```json
{ "title": "...", "type": "Policy", "owner": "...", "approver": "...", "tlp": "AMBER", "status": "draft", "nextReview": "2027-01-31", "version": "1.0", "summary": "...", "file": { "name": "a.pdf", "mime": "application/pdf", "data": "<std base64>" } }
```

- Validasi: `title` 1-200; `type` salah satu nilai `documents.type`; `owner` dan `approver` 1-120; `tlp` salah satu dari enam TLP; `status` `draft` atau `in review`; `nextReview` `YYYY-MM-DD`; `version` `\d+.\d+`; `summary` 1-500.
- File: mime `application/pdf` atau XLSX. Magic bytes diperiksa; XLSX hanya memeriksa header ZIP. Nama lewat `sanitizeName`.
- Otorisasi: `authorize(rank, 'document.c')` dengan level dan TLP tujuan. TLP di atas plafon level ditolak.
- Proses: file disegel crypto-api (`/sealfile`) dan dihitung HMAC (`/hmac`). Untuk TLP selain CLEAR, judul dan nama file ditokenkan dan `summary` disegel. Insert dokumen dan versi dalam satu transaksi dengan `protection='encrypted'`, lalu audit `doc.upload`.

Response `201`: `{ id, title, type, tlp, status, version, nextReview, owner, approver, fileName, size, uploadedBy, at }`. `title` (sudah di-trim) dan `fileName` (sudah disanitasi) adalah nilai plaintext, bukan token.

Error:

- `400`: `{"error":"bad request"}` (JSON rusak, base64 tidak valid, atau file tidak bisa didekode), atau `{"error":"invalid <field>"}` (`title`, `type`, `owner`, `approver`, `tlp`, `status`, `nextReview`, `version`, `summary`, `file`, `mime`, `file name`, `file data`), atau `file content does not match mime`.
- `403`: `{"error":"forbidden"}`. Dicatat sebagai `access.denied`.
- `408`: `{"error":"timeout"}`, body tidak terbaca dalam 20 detik.
- `413`: `{"error":"too large"}`, body di atas 14 MiB atau file di atas 10 MiB.
- `415`: `{"error":"unsupported media type"}`.
- `429`: `{"error":"rate_limited"}`, 2 req/s (burst 2) atau 3 request in-flight.
- `502`: `{"error":"crypto failure"}`. `503`: `{"error":"unavailable"}` bila crypto-api tidak tersedia.
- Bentrok unik (`23505`) dicoba ulang sampai 3 percobaan total. Setelah itu error jatuh ke `500 {"error":"internal"}`; route ini tidak memetakan `23505` ke 409.

### Tulis aset: `POST /api/assets`, `PATCH /api/assets/:id`, `DELETE /api/assets/:id`

File: `asset-manage.mjs` (handler), `assets-write.mjs` (validasi). Dipakai `/assets/new` dan dialog edit/hapus di halaman aset.

Syarat: level minimal 4 dan `authorize()` mengizinkan `asset.c`, `asset.u`, atau `asset.d` sesuai route. Selain itu `403 {"error":"forbidden"}`, dicatat sebagai `access.denied`.

Body JSON wajib `Content-Type: application/json`. Body di atas 14 MiB ditolak `413`. Body yang bukan objek JSON ditolak `400 {"error":"bad request"}`.

`POST /api/assets` (201):

- Field: `name`, `type`, `site`, `sector`, `purdueLevel`, `vendor`, `model`, `firmware`, `ipAddress`, `criticality`, `status`, `owner`, `lastReviewed`. Semua wajib.
- Nilai: `type` (9 nilai), `sector` (`Energy`, `Water`, `Telecom`), `purdueLevel` (`L0`, `L1`, `L2`, `L3`, `L3.5`, `L4`), `criticality` (`high`, `medium`, `low`), `status` (`active`, `maintenance`, `retired`). `ipAddress` IPv4. `name`, `site`, `owner`, `vendor` 1-120; `model`, `firmware` 1-80; `lastReviewed` `YYYY-MM-DD`.
- `zone` dihitung dari `purdueLevel` dan `type`. `ipAddress` ditokenkan; `model` dan `firmware` disegel.
- Nama duplikat per `site` (tanpa membedakan huruf besar-kecil) ditolak `409 {"error":"conflict","field":"name"}`. Pengecekan awal dilakukan di luar transaksi.
- Response: `{ id, zone, at }`. Audit `asset.create`.

`PATCH /api/assets/:id` (200):

- Field yang boleh: `name`, `type`, `site`, `purdueLevel`, `criticality`, `status`, `lastReviewed`, `owner`, dan `reason` wajib (1-500). Field lain: `400 {"error":"unknown field <x>"}`.
- ID harus `AST-\d{4,}`, selain itu `400`. ID tidak ada: `404 {"error":"not found"}`.
- Tanpa perubahan nilai: `400 {"error":"no changes"}`. Nama duplikat: `409`.
- Perubahan `type` atau `purdueLevel` menghitung ulang `zone`.
- Response: `{ id, changed: [<field>...] }`. Audit `asset.update`. `reason` disimpan di audit dalam bentuk disegel.

`DELETE /api/assets/:id` (200):

- Body: `{ "reason": "...", "confirmId": "AST-0001" }`. `reason` 1-500 setelah trim. `confirmId` harus sama dengan ID di path. Selain itu `400`.
- Menghapus baris `evidence_links` dan `asset_document_links` milik aset, lalu aset itu sendiri, dalam satu transaksi.
- Response: `{ id, unlinkedEvidence, unlinkedDocuments }`. ID tidak ada: `404`. Audit `asset.delete`, dengan jumlah tautan yang dilepas dan `reason` disegel.

Error umum route aset: `401 {"error":"unauthenticated"}`, `403`, `408`, `413`, `415`, `502 {"error":"crypto failure"}` bila sealing atau tokenisasi gagal.

### Audit aksi baru

Migrasi `018_audit_actions.sql` menambah `doc.upload`, `asset.create`, `asset.update`, dan `asset.delete` ke `audit_events_action_check`. Penolakan akses tetap memakai `access.denied` (`log_access_denied`, `006_rbac.sql`).

### Proteksi dan `GET /api/files/:doc/:ver`

File: `protection.mjs` (`protectionFor` memetakan TLP, `INTEGRITY_ERROR`). Self-check: `node backend/protection.check.mjs`.

- `protectionFor(tlp)`: semua TLP (`CLEAR`, `GREEN`, `AMBER`, `AMBER+STRICT`, `RED`, `RED+STRICT`) menjadi `encrypted`. TLP tidak dikenal melempar `unknown tlp`. Nilai `integrity` hanya dipertahankan untuk baris CLEAR lama yang belum dimigrasi.
- `INTEGRITY_ERROR` = `integrity check failed`.

Read path:

- `none`: dikirim apa adanya.
- `integrity`: HMAC diverifikasi atas base64 tersimpan lewat `/verifyhmac`.
- `encrypted`: dibuka lewat `/unsealfile`, lalu tag diverifikasi atas base64 hasil.
- Tidak ada byte yang dikirim bila pemeriksaan gagal.

Error: `500 {"error":"integrity check failed"}` saat tag gagal; `503 {"error":"crypto unavailable"}`; `502 {"error":"crypto failure"}`.

Saat start, backend mencatat `WARN: <n> document versions not sealed; run db/scripts/protect-documents.mjs` bila ada versi berfile dengan `protection` bukan `encrypted`. Pemeriksaan hanya sekali saat start, bukan per request. Bila query gagal: `WARN: protection check skipped`. Perbaikan ada di [database](database.md).

### TLP dan plafon baca

- `TLP_ORDER` di `auth.mjs`: CLEAR, GREEN, AMBER, AMBER+STRICT, RED, RED+STRICT.
- `canReadLevel(level, tlp)` membaca indeks TLP `<= min(level, 4)`. RED+STRICT tidak pernah terbuka lewat level; hanya grant aktif (`hasGrant` di `server.mjs`, argumen `grantedIds` pada `filterGrc`).
- TLP tidak dikenal melempar di `tlpRank`. Level atau TLP tidak dikenal membuat `canReadLevel` false. `can()` false untuk semua permission rank tak dikenal; flag akses tetap diturunkan dari level dan flag officer.

### Level pengguna

`levels.mjs`:

- `validateRaise(input, currentLevel)`: pre-check murni yang mencerminkan `request_level_change`. Mengembalikan null, nama field yang gagal, `unchanged`, atau `not-raise`.
- `makeLevelRoutes(deps)`: factory yang mengembalikan `requestRaise`, `listRequests`, `decideRaise`, `lowerLevel` (dipasang di `server.mjs` sebagai `levelRoutes`).
- `requestRaise`: `POST /api/users/:username/level-requests`. Menaikkan level, atau mendelegasikan ke `lowerLevel` bila level lebih rendah.
- `listRequests`: `GET /api/level-requests`. `decideRaise`: `POST /api/level-requests/:id/decision`.
- `lowerLevel`: penurunan langsung lewat `lower_user_level`.

Aturan: raise request hanya oleh security officer (DB); approve hanya commander; deny oleh commander atau officer. Tidak boleh mengubah diri sendiri: requester, target, dan approver diperiksa. Penurunan berlaku langsung; session target dihapus saat apply dan saat lower.

Field wajib: `justification`, `screeningVerified` dan `screeningRef` (PS-3), `accessAgreementSigned` dan `accessAgreementDate` (PS-6), `reviewDue` dalam 12 bulan (AC-2), `fips199Basis` (AC-3(2)). Basis FIPS 199: level 1-2 LOW, 3 MODERATE, 4-5 HIGH. Baris audit membawa `changes.controls`: AC-2, AC-3(2), AC-5, AC-6, PS-3, PS-6, AU-2, AU-3. Ini pemetaan desain, bukan bukti kepatuhan.

### Permintaan akses

- Route: `GET /api/access-requests`, `POST /api/documents/:id/access-requests`, `POST /api/access-requests/:id/decision`.
- Commander (level 5) dan security officer harus sama-sama menyetujui, urutan bebas. Requester dan calon grantee tidak boleh menyetujui (403). Peran duplikat atau sudah terpakai menghasilkan 409.
- Deny menutup permintaan. Dua persetujuan menulis grant (`decide_access_request`, `010_red_strict_dual_auth.sql`).
- Pencabutan oleh salah satu peran (`revoke_document_access`) mengisi `revoked_at` dan berlaku pada request berikutnya. Session tidak dihapus.

### Grant

- `GET /api/documents/:id/grants` dan `DELETE /api/documents/:id/grants/:username` (204). Keduanya butuh `canManage`: level 5 atau `securityOfficer`. Selain itu 403.
- `POST /api/documents/:id/grants` dihapus; path sekarang 405.
- `010_red_strict_dual_auth.sql` mencabut EXECUTE `grant_document_access` dari `sad_app`. Grant baru hanya lewat permintaan akses.

### `/api/me` dan `/api/users`

- `/api/me` (`meJson` di `session.mjs`) mengembalikan `accessLevel`, `tlpMax`, `securityOfficer`, `unit`, `unitHead`, dan `can.access` = `{grant, request, approve, revoke}`. `grant` hanya level 5; sisanya level 5 atau officer.
- `permissions` di `/api/me` (`meJson` di `session.mjs`): `canCreateDocument` (boolean), `docCreateMaxTlp` (TLP tertinggi yang lolos `authorize('document.c')`, atau null bila tidak ada), dan `canWriteAssets` = `{c, u, d}`. Setiap flag `canWriteAssets` true hanya bila `authorize()` mengizinkan dan level minimal 4.
- `/api/users` mengembalikan `username`, `name` (string atau null), `rankName`, `golongan`, `accessLevel`, `unit`, `unitHead`, `securityOfficer`. Butuh `canManage`.
- `unit` dan `unitHead` hanya label; tidak ada jalur otorisasi yang memakainya. `unit_head` membatasi satu head per unit (`012_unit_head.sql`).

### Dokumen terbatas

- `GET /api/grc` memanggil `filterGrc`. Dokumen tak terbaca dibuang bersama tautan evidence, tautan aset, dan event audit yang merujuknya. Event yang teks `summary` atau `changes`-nya memuat ID tersembunyi juga dibuang.
- Hanya security officer: `restrictedDocuments` berisi `{id, tlp, createdAt, versionCount, grantees}`. `createdAt` adalah tanggal versi paling awal. Tanpa judul, nama file, atau isi.
- Level 5 tanpa flag officer tidak mendapat `restrictedDocuments`.

## Fail closed

- TLP tidak dikenal melempar (`tlpRank`, `protectionFor`); `canReadLevel` false untuk level atau TLP tak dikenal.
- `can()` false untuk semua permission rank tak dikenal. `authorize()` false untuk rank atau action tak dikenal.
- `verifyPassword` false pada error apa pun. `/api/files/:doc/:ver` mengembalikan 404 di atas plafon tanpa grant.
- `revealTokens` jatuh ke bagian masked saat kripto gagal, tidak pernah ke token.
- SQLSTATE 42501 menjadi 403 (diaudit) di route grant dan level. SQLSTATE tak dikenal di-rethrow. P0002 menjadi 404, 22023 menjadi 400, 23505 dan 55000 menjadi 409.

## Catatan operasional

- Healthcheck: `GET /api/health`, 503 bila database tidak naik.
- `POST /api/uploads` belum punya panggilan authorize eksplisit; semua tier saat ini memegang `upload.c`.
- `/api/grc` mengembalikan event audit ke setiap session, difilter oleh keterbacaan dokumen. Belum ada permission baca audit.
- Policy `authorize()` sisi tulis di `backend/auth.mjs` belum terhubung ke route dokumen.
- File dibuffer di memori, batas 25 MiB.

## Kode

`backend/`, terutama `server.mjs`, `auth.mjs`, `session.mjs`, `grc-filter.mjs`, `viewer.mjs`, `protection.mjs`, `crypto-client.mjs`, `uploads.mjs`, `traffic.mjs`, `levels.mjs`, `grants.mjs`, dan `audit-purge.mjs`.
