export type ControlRow = {
  id: string
  name: string
  implementation: string
  location: string
}

export const decisionFlow = [
  {
    label: '1. PAP: Administrasi kebijakan',
    detail: 'Pengaturan akses operasi dan perubahan yang memerlukan otorisasi ganda.',
  },
  {
    label: '2. PIP: Informasi kebijakan',
    detail: 'Informasi pengguna, persetujuan akses, dan status sesi yang tersedia bagi server.',
  },
  {
    label: '3. PDP: Keputusan kebijakan',
    detail: 'Server memeriksa level akses, klasifikasi TLP, dan hibah dokumen aktif sebelum memutuskan.',
  },
  {
    label: '4. PEP: Penegakan kebijakan',
    detail: 'Endpoint server menegakkan keputusan. Pelepasan kunci HSM setelah izin belum dibuktikan.',
  },
] as const

export const controlRows = [
  { id: 'AC-2', name: 'Manajemen akun', implementation: 'Perubahan level mensyaratkan tanggal tinjauan maksimal 12 bulan.', location: 'backend/levels.mjs; db/init/011_level_change.sql' },
  { id: 'AC-3(2)', name: 'Otorisasi ganda', implementation: 'Hibah RED+STRICT diberikan setelah persetujuan komandan dan petugas keamanan.', location: 'backend/grants.mjs; db/init/010_red_strict_dual_auth.sql' },
  { id: 'AC-3(8)', name: 'Pencabutan otorisasi akses', implementation: 'Pencabutan hibah berlaku pada permintaan berikutnya; penghentian sesi dan penghancuran handle kunci tidak dibuktikan.', location: 'backend/grants.mjs; db/init/008_access_levels.sql' },
  { id: 'AC-3(13)', name: 'Kontrol akses berbasis atribut', implementation: 'Keputusan baca memakai level pengguna, klasifikasi TLP dokumen, dan hibah aktif; atribut sesi tambahan tidak diklaim.', location: 'backend/auth.mjs; backend/server.mjs' },
  { id: 'AC-5', name: 'Pemisahan tugas', implementation: 'Pemohon dan penerima hibah tidak dapat menyetujui permintaannya sendiri; pembatasan baca khusus petugas keamanan tidak dibuktikan.', location: 'backend/grants.mjs; db/init/010_red_strict_dual_auth.sql' },
  { id: 'AC-6', name: 'Hak akses minimum', implementation: 'Hibah akses ditautkan ke dokumen tertentu, bukan seluruh operasi.', location: 'backend/server.mjs; db/init/008_access_levels.sql' },
  { id: 'AC-11', name: 'Penguncian perangkat', implementation: 'Penguncian penampil setelah tidak aktif belum diimplementasikan.', location: 'Desain saja' },
  { id: 'AC-12', name: 'Pengakhiran sesi', implementation: 'Sesi memiliki TTL 8 jam; penguncian saat diminta dan penghapusan halaman render tidak dibuktikan.', location: 'backend/auth.mjs; backend/session.mjs' },
  { id: 'AC-16', name: 'Atribut keamanan dan privasi', implementation: 'Dokumen memiliki klasifikasi TLP dan hibah per dokumen; pengikatan operasi tidak dibuktikan.', location: 'frontend/src/data/grc.ts; backend/server.mjs' },
  { id: 'AC-21', name: 'Berbagi informasi', implementation: 'Belum ditemukan implementasi atau bukti kontrol ini di kode aplikasi.', location: 'Belum diimplementasikan' },
  { id: 'AU-2', name: 'Pencatatan kejadian', implementation: 'Aksi hibah, persetujuan, pencabutan, dan perubahan level dicatat; pencatatan setiap keputusan Izin tidak diklaim.', location: 'db/init/006_rbac.sql; db/init/010_red_strict_dual_auth.sql; db/init/011_level_change.sql' },
  { id: 'AU-3', name: 'Isi catatan audit', implementation: 'Fungsi audit menerima aktor, aksi, objek, dan metadata perubahan kontrol.', location: 'db/init/006_rbac.sql; db/init/011_level_change.sql' },
  { id: 'AU-9(3)', name: 'Perlindungan kriptografis', implementation: 'Tabel audit mencegah mutasi biasa; rantai hash dan titik pemeriksaan HSM belum diimplementasikan.', location: 'db/init/001_schema.sql' },
  { id: 'AU-10', name: 'Anti-penyangkalan', implementation: 'Identitas penyetuju disimpan; tanda tangan individual tidak dibuktikan.', location: 'db/init/010_red_strict_dual_auth.sql' },
  { id: 'IA-2', name: 'Identifikasi dan autentikasi (pengguna organisasi)', implementation: 'AAL3 dan token perangkat keras untuk sesi RED belum diimplementasikan.', location: 'Desain saja' },
  { id: 'MP-6', name: 'Sanitisasi media', implementation: 'Penghapusan kriptografis dan sertifikat pemusnahan belum dibuktikan.', location: 'Desain saja' },
  { id: 'PS-3', name: 'Penyaringan personel', implementation: 'Pengajuan perubahan level mensyaratkan status dan referensi penyaringan.', location: 'backend/levels.mjs; db/init/011_level_change.sql' },
  { id: 'PS-6', name: 'Perjanjian akses', implementation: 'Perubahan level mensyaratkan persetujuan perjanjian akses dan tanggalnya.', location: 'backend/levels.mjs; db/init/011_level_change.sql' },
  { id: 'RA-2', name: 'Kategorisasi keamanan', implementation: 'Dokumen menggunakan TLP; dasar FIPS 199 diperiksa pada alur perubahan level, bukan setiap dokumen.', location: 'frontend/src/data/grc.ts; backend/levels.mjs' },
  { id: 'SC-12', name: 'Pembentukan dan pengelolaan kunci kriptografis', implementation: 'Rotasi kunci terjadwal dan kunci berlingkup operasi belum dibuktikan.', location: 'Desain saja' },
  { id: 'SC-28(1)', name: 'Perlindungan kriptografis', implementation: 'Penyimpanan terenkripsi tersedia untuk unggahan; klaim AES-256-GCM dan kunci data terbungkus tidak dibuktikan di layanan ini.', location: 'backend/protection.mjs; db/init/003_uploads.sql; db/init/004_document_protection.sql' },
  { id: 'SI-7', name: 'Integritas perangkat lunak, firmware, dan informasi', implementation: 'Pemeriksaan HMAC tersedia untuk konten berproteksi integritas; pembekuan dokumen saat gagal dan pemeriksaan tanda tangan tidak dibuktikan.', location: 'backend/server.mjs; backend/protection.mjs' },
] satisfies readonly ControlRow[]
