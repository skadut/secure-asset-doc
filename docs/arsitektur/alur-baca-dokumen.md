# Alur baca dokumen

Jalur ini menjelaskan apa yang terjadi saat pengguna membuka daftar dokumen, membuka viewer, dan meminta byte file. Semua langkah di bawah memakai session pengguna; tidak ada endpoint baca publik.

## 1. `GET /api/grc` dan penyaringan

Route `/api/grc` memanggil `grc()` untuk membangun payload: `documents`, `controls`, `assets`, `evidenceLinks`, `assetDocLinks`, dan `auditEvents`. Payload itu lalu diberikan ke `filterGrc` (`backend/grc-filter.mjs`) dengan `accessLevel`, `grantedIds`, `securityOfficer`, `granteesByDoc`, dan `superAdmin`.

- Dokumen terlihat bila `canReadLevel(accessLevel, tlp)` benar, atau bila ada grant aktif. Grant aktif berarti `revoked_at IS NULL` dan `expires_at` kosong atau di masa depan.
- Dokumen tak terlihat tidak masuk `documents`. `evidenceLinks` dan `assetDocLinks` yang menunjuk dokumen itu ikut dibuang.
- `auditEvents` untuk `objectType = document` dengan `objectId` yang tersembunyi dibuang. Event yang `summary` atau `changes`-nya memuat string ID tersembunyi juga dibuang, supaya ID tidak bocor lewat teks audit.
- Super admin tanpa grant mendapat stub `tokenOnly: true` untuk dokumen tersembunyi: `id`, `tlp`, `status`, `owner`, `approver`, `nextReview`, `versions: []`, dan `title` yang tetap berupa token atau hasil `localMask`. `revealTokens` tidak dipanggil untuk stub ini. Di UI, baris ini menampilkan judul tertutup dan tombol mata untuk menampilkan token.
- Security officer mendapat `restrictedDocuments` berisi `{id, tlp, createdAt, versionCount, grantees}`. `createdAt` adalah tanggal versi paling awal. Tidak ada judul, nama file, atau isi.
- Dokumen yang boleh dibaca didetokenkan judulnya. Bila panggilan kripto gagal, `revealTokens` memakai bagian masked, bukan token.
- Bila pengguna tidak punya izin baca aset, field `model`, `firmware`, dan `ipAddress` pada aset dikosongkan.
- Catatan field aset: `model` dan `firmware` disimpan SEALED saat at rest, `ip_address` disimpan TOKENIZED (`db/scripts/protect-fields.mjs:53-55`; penulisan lewat `backend/asset-manage.mjs:86-88`). Saat baca, `revealTokens` (`backend/server.mjs:338-349`) membuka ketiga field itu hanya bila gate `assetRead = can(...).asset.r` benar (`server.mjs:589`), yang diteruskan sebagai `assetRead ? out.assets : []` (`server.mjs:591`). Bila gate salah, `/api/grc` menyamarkan field (`server.mjs:590`): token menjadi `maskedPart`, teks sealed menjadi `***` (`backend/reveal.mjs:5`, `:22-27`). Saat ini semua tier memegang `asset.r` (`backend/auth.mjs:63-81`), sehingga cabang penyamaran hanya berlaku untuk rank yang tidak dikenal atau tidak valid.

## 2. Sesi viewer

Membuka dokumen memanggil `POST /api/documents/:id/viewer-session` (alias `/viewer-sessions`).

- ID harus berformat `DOC-\d{4}`.
- Kelayakan memakai plafon yang sama: `canReadLevel(accessLevel, tlp)` atau grant aktif. Dokumen tidak dikenal dan dokumen tak terbaca sama-sama menghasilkan 404.
- TTL ditentukan TLP: RED dan RED+STRICT 600 detik, AMBER dan AMBER+STRICT 900 detik, GREEN dan CLEAR 1800 detik. TLP tidak dikenal ditolak 403.
- Baris `viewer_sessions` menyimpan `user_id`, `document_id`, dan `expires_at`.
- `GET /api/viewer-sessions/:id` memvalidasi pemilik dan masa berlaku. Sesi kedaluwarsa menghasilkan 410; grant yang sudah tidak berlaku menghasilkan 403.
- `DELETE /api/viewer-sessions/:id` menghapus sesi milik pengguna.

## 3. `GET /api/files/:doc/:ver`

Route ini menerima parameter opsional `viewerSession`.

1. Bila `viewerSession` dikirim, backend memvalidasi bahwa sesi belum kedaluwarsa dan terikat ke `user_id` serta `document_id` yang sama. Gagal validasi menghasilkan 403.
2. Backend mengambil `file_name`, `mime_type`, `protection`, `content_base64`, `content_ciphertext`, `integrity_tag`, dan `tlp`.
3. Bila baris tidak ada, atau TLP di atas plafon dan tidak ada grant, responsnya 404. Bukan 403, supaya keberadaan dokumen tidak terbocor.
4. `fileBase64` (`backend/server.mjs`) menangani proteksi:
   - `none`: byte dikirim apa adanya.
   - `integrity`: HMAC diverifikasi lewat crypto-api `/verifyhmac` terhadap base64 tersimpan. Tag tidak cocok menghasilkan 500 `integrity check failed`.
   - `encrypted`: ciphertext dikirim ke `/unsealfile`, lalu hasil base64 diverifikasi lewat `/verifyhmac`. Tag tidak cocok menghasilkan 500 `integrity check failed`.
5. Kegagalan crypto-api dipetakan ke 503 `crypto unavailable` (zona kunci tidak tersedia) atau 502 `crypto failure` (kegagalan lain). Byte tidak pernah dikirim saat pemeriksaan gagal.
6. Nama file yang masih bertoken didetokenkan. Bila detokenisasi gagal, yang dipakai bagian masked.
7. Respons memakai `Content-Type` dari allowlist mime, `Content-Length`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, dan `Cache-Control: no-store`. Body dibuffer di memori (batas 25 MiB) dan di-zero-kan saat koneksi ditutup.

## 4. crypto-api

`/unsealfile` menerima ciphertext base64 dengan format seal `skadut-t1:<dek_id>:<base64(iv||ct||tag)>`.

- Ukuran setelah decode maksimum 10 MiB. Data kosong, base64 tidak valid, atau melebihi batas menghasilkan 400.
- crypto-api tidak memegang materi kunci. Untuk dekripsi, ia mengirim request NDJSON ke keyd lewat `KEYD_SOCKET`.
- Bila keyd atau TPM tidak bisa memberi kunci, responsnya 503 dengan pesan `KEY_UNAVAILABLE`.
- Setiap request menulis satu baris audit hash-chained. Bila audit gagal ditulis, request ditahan dan server mengembalikan 503 `audit unavailable` (fail-closed).
- `/sealfile` memakai batas dan format yang sama. Semua unggahan baru dan semua versi file dokumen melewati endpoint ini.

## 5. keyd

keyd menerima satu objek JSON per baris lewat Unix socket `keyd.sock`.

- `decrypt` membutuhkan `dek_id` yang menunjuk DEK berjenis data. DEK diambil dari cache, atau DEK yang tersimpan dibuka dengan KEK.
- Bila KEK belum ada, keyd mengambil KEK terbungkus dari `tpm-msk` lewat mTLS `host.docker.internal:2798` (atau `tpm-msk:2798` pada VPS).
- KEK dipakai untuk membuka DEK, lalu KEK di-zeroize. Dekripsi data memakai AES-256-GCM.
- Cache DEK berlaku 31 sampai 300 detik. `compose.yaml` menyetel `KEYD_DEK_TTL` ke 60 detik. Expiry memakai waktu boot dan waktu realtime yang lebih pendek, dikurangi jitter.
- Error `bad_cipher` untuk DEK tidak dikenal, purpose salah, atau GCM auth failure. `unavailable` untuk kegagalan fetch/delivery KEK atau cache. `internal` untuk kegagalan RNG, persist DEK, atau enkripsi.
- Setiap operasi sukses menulis satu record audit. Bila penulisan audit gagal, request mengembalikan `unavailable`.

## 6. tpm-msk

`tpm-msk serve` berjalan di `127.0.0.1:2798` dengan mTLS dan meminta PIN saat start.

- MSK adalah objek HMAC-SHA256 di dalam TPM dan tidak pernah keluar dalam bentuk jelas.
- KEK adalah `TPM2_HMAC(MSK, "tpm-msk/kek/v1" ...)`; KEK dibungkus dan disimpan sebagai file.
- `serve` menulis public key delivery RSA-3072; keyd membaca `delivery.pub.pem` setiap 2 detik.
- keyd hanya boleh memakai public key RSA-3072. Fingerprint harus disetujui manual di konsol, atau otomatis cocok dengan `TPM_MSK_APPROVE_FP`.
- Bila layanan TPM berhenti, DEK yang masih di cache keyd tetap dipakai sampai TTL habis. Setelah itu semua operasi kripto gagal dan tidak ada fallback ke plaintext.

## 7. Ringkasan fail-closed

| Kondisi | Hasil |
| --- | --- |
| TLP atau level tidak dikenal | `canReadLevel` false; akses ditolak |
| Dokumen di atas plafon tanpa grant | 404 pada route file |
| Sesi viewer tidak valid | 403 |
| Tag integrity tidak cocok | 500 `integrity check failed`, tanpa byte |
| crypto-api tidak tersedia | 503 `crypto unavailable`, tanpa byte |
| Keyd atau KEK gagal | 503 `KEY_UNAVAILABLE` dari crypto-api |
| Audit crypto-api gagal ditulis | 503 `audit unavailable` |
| `revealTokens` gagal | Bagian masked dipakai, token tidak ditampilkan |
