# Retensi log audit

- PATI dapat mem-purge entri log audit yang lebih lama dari tanggal cutoff dari halaman audit log.
- Purge mewajibkan pengetikan `PURGE AUDIT BEFORE YYYY-MM-DD` secara persis.
- Sebelum purge, user dapat mengunduh entri yang cocok sebagai CSV. Unduhan berjalan di browser.
- Setiap purge menulis record audit `purge` berisi pelaku, cutoff, dan jumlah yang dihapus. Record purge tidak dapat dihapus.
- Database menegakkan aturan ini. Fungsi `purge_audit_events(text, timestamptz)` di `db/init/007_audit_purge.sql` adalah satu-satunya jalur yang menghapus baris `audit_events`. Fungsi trigger `reject_audit_mutation()` menolak UPDATE, DELETE, dan TRUNCATE kecuali fungsi men-set `audit.purge_ok`, dan tidak pernah mengizinkan penghapusan baris `purge`. Role `sad_app` hanya punya SELECT pada `audit_events` dan tidak punya DELETE langsung. Ia dapat mengeksekusi fungsi.
- Batas yang diketahui: pemeriksaan PATI ada di lapisan aplikasi (`backend/audit-purge.mjs`). Role `sad_app` dapat memanggil `purge_audit_events` langsung, melewati pemeriksaan itu.
- Terapkan `007_audit_purge.sql` secara manual ke database yang sudah berjalan, sebagai admin, seperti yang dinyatakan header file.

Detail role database dan pemeriksaan keamanan ada di [desain keamanan](../keamanan/desain-keamanan.md#role-database-aplikasi). Untuk operasi harian, lihat [run.md](run.md).
