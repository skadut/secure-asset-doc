# Model akses, TLP, dan briefing turunan

## Ringkasan

- Setiap user punya `users.access_level` 1 sampai 5, diatur per pangkat.
- Level menentukan TLP yang bisa dibaca user secara default (dihitung kode).
- Grant per dokumen di `document_access_grants` menambah hak baca satu dokumen, tanpa memandang level. Grant dibuat lewat persetujuan ganda.
- Level dinaikkan lewat persetujuan ganda. Level diturunkan oleh satu orang dan langsung berlaku.
- Kata sandi tidak disimpan di dokumentasi ini.

Sumber kebenaran: `backend/auth.mjs` (`canReadLevel`, `approverRole`, `TLP_ORDER`), `backend/grants.mjs`, `backend/levels.mjs`, `backend/grc-filter.mjs`, dan `db/init/010_red_strict_dual_auth.sql`, `db/init/011_level_change.sql`.

`ranks.tlp_max` (006) adalah LEGACY dan tidak ditegakkan.

## Status implementasi

- Kode backend sudah ada untuk seluruh route di bagian [Route](#route).
- Migrasi `010`, `011`, dan `012` belum diterapkan ke volume DB yang sudah ada. Sampai diterapkan, fungsi DB yang dipanggil route tidak tersedia dan route terkait tidak berfungsi.
- Cara menerapkan: lihat [Menerapkan migrasi 010 dan 011 secara manual](#menerapkan-migrasi-010-dan-011-secara-manual) dan [Kepala Unit](#kepala-unit) untuk `012`.
- Urutan deploy: terapkan 010, 011, dan 012 sebelum restart backend. `/api/me` dan daftar user memilih `security_officer`, `unit`, dan `unit_head`; restart lebih dulu menghasilkan error.

## Tingkat TLP (6 level)

| Indeks | TLP | Bisa dibaca level |
|---|---|---|
| 0 | CLEAR | 1-5 |
| 1 | GREEN | 1-5 |
| 2 | AMBER | 2-5 |
| 3 | AMBER+STRICT | 3-5 |
| 4 | RED | 4-5 |
| 5 | RED+STRICT | tidak ada (hanya grant) |

Level 4 dan 5 sama-sama membaca sampai RED menurut level. Level 5 tidak menambah TLP dari level; ia menambah hak administratif.

RED+STRICT tidak pernah terbaca lewat level, termasuk level 5. Hanya penerima yang namanya tercantum dengan grant aktif yang belum kedaluwarsa.

Aturan kode: level L membaca TLP indeks `<= min(L, 4)` (`canReadLevel`).

## Level akses 1 sampai 5

| Level | Pangkat (dipetakan oleh 008) | Contoh akun demo | TLP yang bisa dibaca (dari `canReadLevel`) |
|---|---|---|---|
| 5 | Jenderal TNI, Letnan Jenderal TNI | hendra.wiratama | CLEAR, GREEN, AMBER, AMBER+STRICT, RED |
| 4 | Mayor Jenderal TNI, Brigadir Jenderal TNI | teguh.prasetya | CLEAR, GREEN, AMBER, AMBER+STRICT, RED |
| 3 | Kolonel, Letnan Kolonel, Mayor | rizky.firmansyah | CLEAR, GREEN, AMBER, AMBER+STRICT |
| 2 | Kapten, Letnan Satu, Letnan Dua, Sersan Mayor | wahyu.hidayat, kusnadi.hartono | CLEAR, GREEN, AMBER |
| 1 | Semua pangkat lain | surya.pratama, komang.adnyana, bagus.hartanto | CLEAR, GREEN |

Pangkat yang tidak terdaftar default ke level 1.

## Makna TLP

- CLEAR: pengungkapan tidak dibatasi.
- GREEN: boleh dibagikan dalam komunitas, tidak untuk publik umum.
- AMBER: terbatas pada organisasi penerima dan klien yang perlu tahu.
- AMBER+STRICT: terbatas pada organisasi penerima saja.
- RED: hanya penerima yang disebutkan namanya; tidak boleh dibagikan lebih lanjut.
- RED+STRICT: hanya penerima bernama dengan grant aktif; tidak terbaca lewat level.

## Alur grant akses (dual authorization)

1. Request dibuat oleh level 5 atau security officer untuk penerima bernama. Request tidak bisa untuk diri sendiri.
2. Persetujuan harus dari satu komandan (level 5) DAN satu security officer, dua orang berbeda.
3. Requester dan penerima grant tidak boleh menyetujui.
4. Penolakan oleh salah satu pihak menutup request (status `denied`).
5. Grant baru dibuat setelah kedua pihak menyetujui (`decide_access_request`).
6. User selain level 5 dan security officer tidak bisa membuat request, sehingga dokumen tersembunyi tidak bocor keberadaannya.
7. Pencabutan grant (`revoke_document_access`) dilakukan satu orang (level 5 atau security officer) dan langsung berlaku. Baris grant tidak dihapus, hanya diisi `revoked_at`.
8. Setiap langkah dicatat di audit: `access.request`, `access.approve`, `access.deny`, `grant`, `revoke`, dan denial (`access.denied`).

Migrasi: `010_red_strict_dual_auth.sql`. Status: belum diterapkan ke volume.

## Alur perubahan level

Naik level (raise):

1. Diajukan oleh security officer (bukan level 5). Level 5 yang mencoba raise ditolak 403.
2. Disetujui oleh satu komandan (level 5) yang berbeda dari pengaju dan target. Penolakan bisa oleh komandan atau security officer (selain pengaju dan target).
3. Tidak ada yang mengajukan atau menyetujui perubahan levelnya sendiri.
4. Akun security officer tidak pernah menjadi level 5 (CHECK di database, dan dicek ulang saat request dan apply).
5. Basis FIPS 199 harus sesuai level: level 1-2 LOW, level 3 MODERATE, level 4-5 HIGH.
6. Wajib: referensi screening (PS-3) dan tanggal perjanjian akses yang ditandatangani (PS-6).
7. `review_due` maksimal 12 bulan dari sekarang (AC-2). Jika sudah lewat saat apply, apply ditolak.
8. Saat apply: `access_level` target diubah, dan semua sesi target dihapus. Target harus login ulang.

Turun level (lower):

1. Satu orang (security officer atau komandan). Tidak ada persetujuan kedua dan tidak ada baris request.
2. Tidak boleh untuk diri sendiri. Level baru harus lebih rendah dari level sekarang.
3. Langsung berlaku. Sesi target dihapus.
4. Dicatat di audit `level.lowered`.

Audit: `level.request`, `level.approve`, `level.deny`, `level.apply`, `level.lowered`. Setiap entri memuat daftar ID kontrol.

Migrasi: `011_level_change.sql`. Status: belum diterapkan ke volume.

## Route

| Metode | Path | Siapa | Sukses |
|---|---|---|---|
| GET | `/api/access-requests` | level 5 atau security officer | 200 daftar request |
| POST | `/api/documents/:id/access-requests` | level 5 atau security officer | 201 request dibuat (pending) |
| POST | `/api/access-requests/:id/decision` | level 5 atau security officer; dua approval diperlukan | 200 |
| GET | `/api/documents/:id/grants` | level 5 atau security officer | 200 daftar grant |
| DELETE | `/api/documents/:id/grants/:username` | level 5 atau security officer | 204 |
| GET | `/api/users` | level 5 atau security officer | 200 daftar user |
| POST | `/api/users/:username/level-requests` | level 5 atau security officer; raise hanya oleh security officer, lower oleh security officer atau komandan | 201 raise (pending); 200 lower (langsung) |
| GET | `/api/level-requests` | level 5 atau security officer | 200 daftar request level |
| POST | `/api/level-requests/:id/decision` | approve: komandan saja; deny: security officer atau komandan | 200 |

`POST /api/documents/:id/grants` sudah dihapus dan mengembalikan 405.

## Hidden means hidden

Dokumen yang tidak bisa dibaca user tidak dikirim ke browser. Filter ada di `backend/grc-filter.mjs`.

Security officer melihat metadata saja untuk dokumen yang tidak bisa ia baca: `id`, `tlp`, `createdAt`, `versionCount`, dan daftar penerima grant aktif. Tidak ada judul, nama file, atau isi.

## Unit

- `users.unit` adalah label biasa per akun. Unit tidak dipakai untuk keputusan akses.
- Security officer berada di Unit Intelijen pada data demo (`db/scripts/demo-users.mjs`). Database tidak memaksa ini.
- Cakupan security officer berlaku lintas semua unit.

## Kepala Unit

- Setiap unit punya tepat satu Kepala Unit, ditandai `users.unit_head` dan dijaga partial unique index `users_one_head_per_unit`.
- Kepala dipilih dari akun berpangkat (level) tertinggi di unit itu; kepala Markas Komando adalah akun level 5.
- `unit_head` hanya label tampilan: tidak menambah hak akses dan tidak ada jalur otorisasi.
- Diekspos sebagai `unitHead` di `/api/me` dan daftar user.

Migrasi: `012_unit_head.sql`. Status: belum diterapkan ke volume.

Terapkan manual:

```
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/012_unit_head.sql
```

## Security officer

- Ditandai dengan flag `users.security_officer` (migrasi 010).
- Tidak pernah level 5 (CHECK `users_officer_not_l5_check`).
- Dapat menjadi approver grant (satu dari dua), mencabut grant, mengajukan raise level, menolak request level, dan menurunkan level.
- Melihat tampilan metadata untuk dokumen yang tidak bisa dibaca.

## Keterbatasan yang diketahui

- Ringkasan audit dokumen anak dibuang dari respons bila menyebut id dokumen yang tersembunyi (perilaku `backend/grc-filter.mjs`).

## Keputusan akses baca

Alur route GET file (`backend/server.mjs`, fungsi `file`):

1. Dokumen dan versi harus ada. Jika tidak, 404.
2. Jika `canReadLevel(level user, TLP dokumen)` true, izinkan.
3. Jika tidak, cek grant aktif: `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`. Jika aktif, izinkan.
4. Selain itu, 404 (keberadaan dokumen disembunyikan).

## Alur briefing turunan (sanitasi)

1. Pelaku: user level 5 yang aktif (`derive_document`, `009_derive.sql`, error 42501).
2. Yang dibuat: dokumen baru status draft, type Procedure, owner dan approver = pelaku, `derived_from` = id parent. Konten ditulis manual. Tidak ada salinan file atau ciphertext parent.
3. TLP turunan harus lebih rendah dari TLP parent (ditolak dengan 22023). Parent tidak berubah.
4. Hak akses dokumen turunan mengikuti aturan biasa (`canReadLevel` dan grant).
5. Audit: action `derive`, object_type `document`.
6. Sebelum dibagikan: judul harus ditokenisasi (`tokenize-titles.mjs`).

## Penerapan kontrol

Pemetaan ini adalah desain, bukan bukti kepatuhan.

| Kontrol | Penerapan | Status |
|---|---|---|
| AC-2 | Raise level wajib `review_due` maksimal 12 bulan dan ditolak jika lewat saat apply. Tinjauan akun berkala belum diimplementasikan. | Migrasi 011, belum diterapkan ke volume. Tinjauan berkala: belum diimplementasikan. |
| AC-3(2) | Grant dokumen butuh komandan dan security officer. Raise level butuh pengaju officer dan persetujuan komandan. | Migrasi 010 dan 011, belum diterapkan ke volume. |
| AC-5 | Requester dan target tidak boleh menyetujui. Komandan dan officer harus orang berbeda. Officer tidak pernah level 5. | Migrasi 010 dan 011, belum diterapkan ke volume. |
| AC-6 | Grant per dokumen, berbasis need-to-know. RED+STRICT hanya lewat grant. | Migrasi 010, belum diterapkan ke volume. Pembacaan TLP oleh level sudah ada di kode. |
| PS-3 | Raise level wajib referensi screening (`screening_ref`). Dokumen screening tidak disimpan di DB. | Migrasi 011, belum diterapkan ke volume. |
| PS-6 | Raise level wajib perjanjian akses yang sudah ditandatangani. Grant dokumen tidak memakai kontrol ini. | Migrasi 011, belum diterapkan ke volume. |
| AU-2 / AU-3 | Audit untuk request, approve, deny, grant, revoke, denial, dan perubahan level, dengan daftar kontrol. | Migrasi 010 dan 011, belum diterapkan ke volume. Denial lewat `log_access_denied` sudah ada di kode. |
| FIPS 199 | Basis LOW, MODERATE, HIGH dipetakan ke level saat raise dan apply. Akses dokumen belum dipetakan ke FIPS 199. | Migrasi 011, belum diterapkan ke volume. |

## Menerapkan migrasi 010 dan 011 secara manual

Init script tidak berjalan ulang pada volume yang sudah ada. Terapkan berurutan, 010 dulu, lalu 011 (011 memakai kolom dari 010):

```
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/010_red_strict_dual_auth.sql
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/011_level_change.sql
```

Kedua file dibungkus `BEGIN` dan `COMMIT`, dan idempoten.

## Belum diimplementasikan

- Tinjauan akun berkala (AC-2) yang memicu pengingat atau penonaktifan otomatis.

## Referensi

- NIST SP 800-150, "Guide to Cyber Threat Information Sharing"
- NIST SP 800-53 Rev. 5, "Security and Privacy Controls for Information Systems and Organizations" (kontrol yang dirujuk: AC-2, AC-3, AC-5, AC-6, AC-16, AC-21, AU-2, AU-3, AU-10, PS-3, PS-6)
- FIPS 199, "Standards for Security Categorization of Federal Information and Information Systems"
- FIRST, "Traffic Light Protocol (TLP) Version 2.0"
