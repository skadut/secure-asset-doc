BEGIN;

INSERT INTO nist_controls (id, family, name, implementation, location) VALUES
    ('AC-2', 'AC', 'Manajemen akun', 'Perubahan level mensyaratkan tanggal tinjauan maksimal 12 bulan.', 'backend/levels.mjs; db/init/011_level_change.sql'),
    ('AC-3(2)', 'AC', 'Otorisasi ganda', 'Hibah RED+STRICT diberikan setelah persetujuan komandan dan petugas keamanan.', 'backend/grants.mjs; db/init/010_red_strict_dual_auth.sql'),
    ('AC-3(8)', 'AC', 'Pencabutan otorisasi akses', 'Pencabutan hibah berlaku pada permintaan berikutnya; penghentian sesi dan penghancuran handle kunci tidak dibuktikan.', 'backend/grants.mjs; db/init/008_access_levels.sql'),
    ('AC-3(13)', 'AC', 'Kontrol akses berbasis atribut', 'Keputusan baca memakai level pengguna, klasifikasi TLP dokumen, dan hibah aktif; atribut sesi tambahan tidak diklaim.', 'backend/auth.mjs; backend/server.mjs'),
    ('AC-5', 'AC', 'Pemisahan tugas', 'Pemohon dan penerima hibah tidak dapat menyetujui permintaannya sendiri; pembatasan baca khusus petugas keamanan tidak dibuktikan.', 'backend/grants.mjs; db/init/010_red_strict_dual_auth.sql'),
    ('AC-6', 'AC', 'Hak akses minimum', 'Hibah akses ditautkan ke dokumen tertentu, bukan seluruh operasi.', 'backend/server.mjs; db/init/008_access_levels.sql'),
    ('AC-11', 'AC', 'Penguncian perangkat', 'Penguncian penampil setelah tidak aktif belum diimplementasikan.', 'Desain saja'),
    ('AC-12', 'AC', 'Pengakhiran sesi', 'Sesi memiliki TTL 8 jam; penguncian saat diminta dan penghapusan halaman render tidak dibuktikan.', 'backend/auth.mjs; backend/session.mjs'),
    ('AC-16', 'AC', 'Atribut keamanan dan privasi', 'Dokumen memiliki klasifikasi TLP dan hibah per dokumen; pengikatan operasi tidak dibuktikan.', 'frontend/src/data/grc.ts; backend/server.mjs'),
    ('AC-21', 'AC', 'Berbagi informasi', 'Belum ditemukan implementasi atau bukti kontrol ini di kode aplikasi.', 'Belum diimplementasikan'),
    ('AU-2', 'AU', 'Pencatatan kejadian', 'Aksi hibah, persetujuan, pencabutan, dan perubahan level dicatat; pencatatan setiap keputusan Izin tidak diklaim.', 'db/init/006_rbac.sql; db/init/010_red_strict_dual_auth.sql; db/init/011_level_change.sql'),
    ('AU-3', 'AU', 'Isi catatan audit', 'Fungsi audit menerima aktor, aksi, objek, dan metadata perubahan kontrol.', 'db/init/006_rbac.sql; db/init/011_level_change.sql'),
    ('AU-9(3)', 'AU', 'Perlindungan kriptografis', 'Tabel audit mencegah mutasi biasa; rantai hash dan titik pemeriksaan HSM belum diimplementasikan.', 'db/init/001_schema.sql'),
    ('AU-10', 'AU', 'Anti-penyangkalan', 'Identitas penyetuju disimpan; tanda tangan individual tidak dibuktikan.', 'db/init/010_red_strict_dual_auth.sql'),
    ('IA-2', 'IA', 'Identifikasi dan autentikasi (pengguna organisasi)', 'AAL3 dan token perangkat keras untuk sesi RED belum diimplementasikan.', 'Desain saja'),
    ('MP-6', 'MP', 'Sanitisasi media', 'Penghapusan kriptografis dan sertifikat pemusnahan belum dibuktikan.', 'Desain saja'),
    ('PS-3', 'PS', 'Penyaringan personel', 'Pengajuan perubahan level mensyaratkan status dan referensi penyaringan.', 'backend/levels.mjs; db/init/011_level_change.sql'),
    ('PS-6', 'PS', 'Perjanjian akses', 'Perubahan level mensyaratkan persetujuan perjanjian akses dan tanggalnya.', 'backend/levels.mjs; db/init/011_level_change.sql'),
    ('RA-2', 'RA', 'Kategorisasi keamanan', 'Dokumen menggunakan TLP; dasar FIPS 199 diperiksa pada alur perubahan level, bukan setiap dokumen.', 'frontend/src/data/grc.ts; backend/levels.mjs'),
    ('SC-12', 'SC', 'Pembentukan dan pengelolaan kunci kriptografis', 'Rotasi kunci terjadwal dan kunci berlingkup operasi belum dibuktikan.', 'Desain saja'),
    ('SC-28(1)', 'SC', 'Perlindungan kriptografis', 'Penyimpanan terenkripsi tersedia untuk unggahan; klaim AES-256-GCM dan kunci data terbungkus tidak dibuktikan di layanan ini.', 'backend/protection.mjs; db/init/003_uploads.sql; db/init/004_document_protection.sql'),
    ('SI-7', 'SI', 'Integritas perangkat lunak, firmware, dan informasi', 'Pemeriksaan HMAC tersedia untuk konten berproteksi integritas; pembekuan dokumen saat gagal dan pemeriksaan tanda tangan tidak dibuktikan.', 'backend/server.mjs; backend/protection.mjs')
ON CONFLICT (id) DO NOTHING;

COMMIT;
