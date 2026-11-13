# Demo keamanan

Folder ini berisi skenario yang bisa dijalankan reviewer untuk membuktikan kontrol keamanan aplikasi. Setiap folder punya satu `README.md` dengan tujuan, akun, langkah, hasil, dan bukti.

## Prasyarat

1. Stack sudah berjalan dan aplikasi terbuka di <http://127.0.0.1:8088>.
2. Akun demo sudah di-seed, TOTP demo sudah di-seed, dan berkas dokumen sudah disegel. Urutan seed ada di [seeding](../operasi/seeding.md).
3. Kata sandi semua akun adalah nilai `DEMO_USER_PASSWORD` di `.env`. Jangan menuliskan nilainya di laporan atau tangkapan layar.
4. Kode TOTP 6 digit berasal dari aplikasi autentikator yang memakai secret demo bersama. Secret tidak dicantumkan di folder ini.

## Akun yang sering dipakai

| Username | Peran |
|---|---|
| `super.admin` | Super admin, level 5 |
| `hendra.wiratama` | Jenderal TNI, level 5, komandan |
| `yudi.ananda` | Letnan Jenderal TNI, level 5, komandan |
| `ratna.sekarsari` | Jenderal TNI, level 5, penerima grant DOC-0011 |
| `teguh.prasetya` | Mayor Jenderal TNI, level 4, perwira keamanan |
| `mega.puspitasari` | Letnan Kolonel, level 3, perwira keamanan |
| `rizky.firmansyah` | Kolonel, level 3, penerima grant DOC-0013 |
| `arif.budiman` | Letnan Dua, level 2, perwira keamanan |
| `wahyu.hidayat` | Kapten, level 2, bisa membaca daftar unggahan |
| `bagus.hartanto` | Prajurit Satu, level 1, penerima grant DOC-0017 |
| `komang.adnyana` | Sersan Dua, level 1, penerima grant DOC-0017 |
| `nanda.prasetyo` | Kopral Dua, level 1, penerima grant DOC-0017 |
| `ahmad.zaelani` | Prajurit Dua, level 1, grant DOC-0017 berakhir 1 Oktober 2026 |

Katalog lengkap 81 akun, flag perwira keamanan dan super admin, serta akun penerima grant ada di [akun-demo.md](akun-demo.md).

## Urutan skenario

Jalankan berurutan. Skenario berikutnya memakai keadaan yang dibuat skenario sebelumnya.

1. [Login lima tahap](01-login-lima-tahap/README.md) — membuktikan kata sandi, TOTP 6 digit, pemeriksaan perangkat, sesi idle 5 menit, dan batas sesi 30 menit.
2. [Registri dokumen](02-registri-dokumen/README.md) — membuktikan daftar dokumen hanya memuat dokumen yang boleh dibaca akun.
3. [Penampil aman](03-penampil-aman/README.md) — membuktikan viewer memakai sesi berbatas waktu dan menolak dokumen di atas izin.
4. [Level dan TLP](04-level-dan-tlp/README.md) — membuktikan level 1–5 memetakan TLP sampai RED, sedangkan RED+STRICT hanya lewat grant.
5. [Otorisasi ganda](05-otorisasi-ganda/README.md) — membuktikan grant dibuat setelah satu komandan dan satu perwira keamanan menyetujui.
6. [Akses operasi](06-akses-operasi/README.md) — membuktikan keputusan akses bisa diuji dan hanya dibuka untuk level 5 atau perwira keamanan.
7. [Unggah terenkripsi](07-unggah-terenkripsi/README.md) — membuktikan berkas disegel sebelum disimpan dan didekripsi di server saat dibuka.
8. [Token super admin](08-token-super-admin/README.md) — membuktikan super admin hanya melihat baris token tersamar untuk RED+STRICT tanpa grant.
9. [Audit log](09-audit-log/README.md) — membuktikan jejak audit tidak bisa diubah biasa dan purge hanya untuk PATI.
10. [CSF dan NIST](10-csf-dan-nist/README.md) — membuktikan bukti CSF 2.0 dan pemetaan 22 kontrol NIST 800-53 hanya menampilkan data yang boleh dilihat.
11. [Traffic dan database](11-traffic-dan-database/README.md) — membuktikan dua tampilan operasional hanya untuk super admin dan database view bersifat baca saja.
12. [Keadaan error](12-keadaan-error/README.md) — membuktikan 404, 403, dokumen tidak tersedia, sesi berakhir, filter kosong, akun terkunci, dan 503 tampil tanpa membocorkan dokumen.

## Aturan demo

- Jangan menuliskan kata sandi, kode TOTP, token mentah, atau secret ke dokumen dan tangkapan layar.
- Jangan menjalankan purge audit atau mengunci akun pada demo langsung. Dua tindakan itu mengubah data demo.
- Data di aplikasi fiktif. Jangan memasukkan data pribadi atau operasional nyata.
