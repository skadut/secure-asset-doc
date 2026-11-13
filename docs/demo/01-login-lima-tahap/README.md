# 01 — Login lima tahap

## Tujuan

Membuktikan login memerlukan kata sandi, kode TOTP 6 digit, dan pemeriksaan perangkat sebelum sesi dibuat.

## Akun

`bagus.hartanto` — level 1, hak paling kecil. Akun ini cukup untuk membuktikan seluruh tahap login tanpa membuka data sensitif.

## Langkah

1. Buka <http://127.0.0.1:8088>. Halaman masuk menampilkan lima tahap: `PEMBERITAHUAN`, `MASUK`, `KODE`, `PERANGKAT`, `KONFIRMASI`.
2. Di tahap 1, centang `Saya telah membaca pemberitahuan ini dan menyetujui pemantauan.`, lalu klik `Lanjutkan`.
3. Di tahap 2, isi username `bagus.hartanto` dan kata sandi dari `DEMO_USER_PASSWORD` di `.env`. Klik `Lanjutkan`.
4. Di tahap 3, masukkan kode 6 digit dari aplikasi autentikator. Setiap kode berlaku 30 detik. Klik `Lanjutkan`.
5. Di tahap 4, tunggu baris `Jaringan`, `Kode autentikator`, `Modul Enkripsi`, dan `Jam` selesai. Klik `Lanjutkan`.
6. Di tahap 5, periksa ringkasan sesi: `Sesi 30 menit · idle 5 menit`. Klik tombol masuk.
7. Setelah dashboard terbuka, diamkan 5 menit lalu klik menu apa pun. Aplikasi meminta masuk kembali.

## Hasil yang diharapkan

- Sesi tidak dibuat sebelum kata sandi dan kode 6 digit lolos. Server memvalidasi kode lewat crypto-api `POST /totpvalidate`, bukan di browser.
- Kode yang salah menampilkan sisa percobaan. Lima kegagalan mengunci akun 15 menit. Hitungan ini mencakup kegagalan kata sandi dan kode.
- Pemeriksaan perangkat menampilkan status `LULUS` untuk jaringan, kode autentikator, modul enkripsi, dan jam.
- Sesi berakhir setelah 30 menit sejak dibuat dan terkunci setelah 5 menit tanpa aktivitas. Keduanya diperiksa server pada setiap permintaan.
- Akun yang dikunci menampilkan layar `Akun dikunci` dan waktu aktif kembali.

## Bukti

![Tahap pemberitahuan login](../../screenshots/login.png)

![Pemeriksaan perangkat tahap 4](../../screenshots/login-device-check.png)

## Catatan

Jangan mencoba lima kali gagal pada demo langsung. Akun akan terkunci 15 menit dan data demo ikut berubah. Bila perlu menguji lockout, pakai akun sekali pakai, bukan akun yang dipakai skenario lain.
