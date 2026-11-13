# ARCA

Hardware-Backed Digital Asset Security
Secure Asset Document Management · TPM 2.0 · Cryptographic Key Protection

Mengamankan dokumen operasional TNI-AD.

Dashboard GRC fiktif untuk aset dan dokumen terkendali. Aplikasi mencatat aset bergaya OT, dokumen dengan label TLP dan riwayat versi, serta 21 subkategori NIST CSF 2.0 yang tertaut ke bukti. File dokumen dilindungi melalui crypto-api dengan hierarki kunci berakar TPM.

Isi contoh berbahasa Indonesia dan dibingkai sebagai dokumen unit militer simulasi. Setiap halaman diberi tanda `SIMULASI DEMO - BUKAN DOKUMEN RESMI TNI`.

> **Penafian.** Semua data fiktif. Aplikasi ini bukan dokumen resmi, bukan alat penilaian atau pemenuhan NIST, dan kriptografinya belum tervalidasi FIPS 140-3. Jangan memasukkan informasi pribadi, operasional, atau rahasia yang nyata.

## Demo langsung

Buka [https://skadut-hack.tail9e496c.ts.net/](https://skadut-hack.tail9e496c.ts.net/). Demo disajikan lewat Tailscale Funnel dari VPS dalam mode vTPM. Masuk dengan akun demo. Nama akun dan kata sandi bersama (`<DEMO_USER_PASSWORD>`) diberikan terpisah.

## Pratinjau

<table>
  <tr>
    <td><img src="docs/screenshots/dashboard-light.png" width="480" alt="Dashboard, tema terang"></td>
    <td><img src="docs/screenshots/dashboard-dark.png" width="480" alt="Dashboard, tema gelap"></td>
  </tr>
  <tr>
    <td align="center">Dashboard, tema terang</td>
    <td align="center">Dashboard, tema gelap</td>
  </tr>
</table>

<table>
  <tr>
    <td><img src="docs/screenshots/documents.png" width="300" alt="Registri dokumen dengan label TLP"></td>
    <td><img src="docs/screenshots/document-detail.png" width="300" alt="Detail dokumen dengan riwayat versi"></td>
    <td><img src="docs/screenshots/viewer.png" width="300" alt="Viewer aman dengan watermark dan hitung mundur"></td>
  </tr>
  <tr>
    <td align="center">Registri dengan label TLP</td>
    <td align="center">Detail dan riwayat versi</td>
    <td align="center">Viewer aman</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/upload-dialog-done.png" width="300" alt="Unggahan dokumen terenkripsi"></td>
    <td><img src="docs/screenshots/uploads-panel.png" width="300" alt="Unggahan terenkripsi dengan dekripsi sisi server"></td>
    <td><img src="docs/screenshots/upload-decrypt.png" width="300" alt="Unggahan dibuka dan didekripsi lewat /unsealfile"></td>
  </tr>
  <tr>
    <td align="center">Unggahan terenkripsi (<code>/sealfile</code>)</td>
    <td align="center">Daftar unggahan terenkripsi</td>
    <td align="center">Buka unggahan (<code>/unsealfile</code>)</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/requests.png" width="300" alt="Permintaan otorisasi ganda"></td>
    <td><img src="docs/screenshots/operation.png" width="300" alt="Operasi akses per dokumen"></td>
    <td><img src="docs/screenshots/audit-log.png" width="300" alt="Log audit"></td>
  </tr>
  <tr>
    <td align="center">Otorisasi ganda</td>
    <td align="center">Operasi akses</td>
    <td align="center">Log audit</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/evidence.png" width="300" alt="Cakupan bukti CSF 2.0"></td>
    <td><img src="docs/screenshots/controls.png" width="300" alt="Kontrol NIST 800-53"></td>
    <td><img src="docs/screenshots/assets.png" width="300" alt="Inventaris aset"></td>
  </tr>
  <tr>
    <td align="center">Bukti CSF 2.0</td>
    <td align="center">Kontrol NIST 800-53</td>
    <td align="center">Aset</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/traffic.png" width="300" alt="Peta traffic layanan"></td>
    <td><img src="docs/screenshots/database.png" width="300" alt="Tampilan database read-only"></td>
    <td><img src="docs/screenshots/settings.png" width="300" alt="Pengaturan"></td>
  </tr>
  <tr>
    <td align="center">Traffic layanan</td>
    <td align="center">Tampilan database</td>
    <td align="center">Pengaturan</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/login.png" width="300" alt="Login, langkah 1"></td>
    <td><img src="docs/screenshots/login-device-check.png" width="300" alt="Pemeriksaan perangkat saat login"></td>
    <td><img src="docs/screenshots/login-otp.png" width="300" alt="Login tahap 3, kode autentikator"></td>
  </tr>
  <tr>
    <td align="center">Login</td>
    <td align="center">Pemeriksaan perangkat</td>
    <td align="center">Kode autentikator (TOTP)</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/error-404.png" width="300" alt="Halaman tidak ditemukan"></td>
    <td><img src="docs/screenshots/error-503.png" width="300" alt="Halaman layanan tidak tersedia"></td>
    <td><img src="docs/screenshots/error-403.png" width="300" alt="Halaman 403 di luar peran"></td>
  </tr>
  <tr>
    <td align="center">404</td>
    <td align="center">503</td>
    <td align="center">403</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/viewer-403-inline.png" width="300" alt="Viewer menampilkan 403 Dokumen tidak tersedia di bagian Berkas terkontrol, judul token tertutup"></td>
    <td></td>
    <td></td>
  </tr>
  <tr>
    <td align="center">Super admin tanpa grant: judul ber-mask, 403 inline</td>
    <td></td>
    <td></td>
  </tr>
</table>

## Demo TPM 2.0 native

Di laptop Windows, `tpm-msk serve` berjalan di host dan memakai TPM 2.0 perangkat keras lewat TBS, tanpa emulator. Aplikasi berjalan di Docker; keyd meminta KEK lewat mTLS. Operator menyetujui fingerprint delivery key keyd. VPS memakai vTPM (`swtpm`) sebagai gantinya. Nilai Shamir share pada tangkapan layar sudah dihitamkan.

<table>
  <tr>
    <td><img src="docs/screenshots/tpm-native-start.png" width="300" alt="tpm-msk serve dimulai, share disensor"></td>
    <td><img src="docs/screenshots/tpm-native-fingerprint.png" width="300" alt="Fingerprint delivery key keyd"></td>
    <td><img src="docs/screenshots/tpm-native-audit-verify.png" width="300" alt="Verifikasi audit berantai hash"></td>
  </tr>
  <tr>
    <td align="center">Start <code>tpm-msk serve</code> (share disensor)</td>
    <td align="center">Persetujuan fingerprint keyd</td>
    <td align="center">Verifikasi audit berantai hash: keyd, crypto-api, TPM OK</td>
  </tr>
</table>

Langkah lengkap: [docs/operasi/tpm-native-demo.md](docs/operasi/tpm-native-demo.md).

## Fitur

- **Aset:** 20 aset OT contoh dengan tipe, sektor, Purdue level, zona IEC 62443, kritikalitas, status, dan tanggal tinjauan.
- **Registri dokumen:** 18 dokumen contoh dengan riwayat versi, label TLP (CLEAR sampai RED+STRICT), aset tertaut, dan bukti CSF. Pratinjau PDF dan XLSX. Unggahan dienkripsi lewat crypto-api `/sealfile` sebelum disimpan dan didekripsi hanya saat dibuka lewat `/unsealfile`; unggahan terpisah dari versi registri.
- **Viewer aman:** sesi baca berbatas waktu yang terikat ke pengguna dan dokumen, dengan watermark dan hitung mundur. RED dan RED+STRICT mendapat jendela terpendek.
- **Otorisasi ganda:** pemberian akses RED+STRICT butuh satu commander (level 5) dan satu security officer, dengan urutan bebas.
- **Operasi akses:** matriks akses per dokumen, permintaan, pencabutan, dan penguji keputusan akses.
- **Alur perubahan level:** naik atau turun level pengguna lewat permintaan dengan justifikasi, penyaringan, pernyataan setuju, dan tanggal tinjauan.
- **Bukti CSF 2.0:** 21 subkategori di enam fungsi. `Covered` bila dokumen yang disetujui masih dalam tanggal tinjauan, `Partial` bila bukti tertaut tanpa dokumen disetujui yang berlaku, `Gap` bila tidak ada tautan.
- **Kontrol NIST 800-53:** baris kontrol dengan catatan implementasi dan lokasi kode.
- **Audit log:** tabel `audit_events` append-only yang dijaga trigger. PATI dapat menghapus entri lebih lama dari batas tanggal.
- **Traffic layanan:** peta permintaan dan panggilan crypto-api secara langsung. Hanya metadata. Hanya super admin.
- **Tampilan database:** penjelajah tabel read-only. Hanya super admin.
- **Pengaturan:** akun, tampilan, tata letak, dan preferensi notifikasi.
- **Tema:** mode terang dan gelap, responsif sampai viewport 390 px.

## Keamanan singkat

Model akses memisahkan pangkat dari level akses. Pangkat menentukan izin tulis; `users.access_level` (1-5) dan grant per dokumen menentukan baca. Level hanya membaca TLP sampai `min(level, 4)`, jadi RED+STRICT tidak pernah terbuka lewat level saja. Grant aktif hanya lahir dari otorisasi ganda. Route file mengembalikan 404, bukan 403, di atas plafon, supaya keberadaan dokumen tidak terbocor.

Semua versi file dokumen, termasuk CLEAR, disegel AES-256-GCM melalui `/sealfile` dan disimpan sebagai ciphertext. Judul dan nama file dokumen non-CLEAR ditokenkan menjadi `<masked>:<sealed>`. Super admin tanpa grant melihat dokumen tak terbaca sebagai baris khusus token: judul tetap tertutup atau berupa token, daftar versi kosong, dan ada tombol mata untuk menampilkan token. Security officer melihat dokumen terbatas sebagai metadata saja, tanpa judul, nama file, atau isi.

MSK dibuat di dalam TPM dan tidak pernah keluar. KEK dibungkus di bawah MSK dan disimpan sebagai file. DEK dibungkus di bawah KEK dan hidup di memori keyd paling lama 300 detik. Bila zona kunci tidak tersedia, panggilan kripto mengembalikan 503 dan tidak ada fallback ke plaintext. Rincian model akses, hierarki kunci, dan batas yang diketahui ada di [docs/keamanan/](docs/keamanan/).

## Arsitektur singkat

Frontend nginx melayani SPA dan mem-proxy `/api/` ke backend Node. Backend memakai PostgreSQL untuk data dan memanggil crypto-api lewat mTLS. crypto-api meminta enkripsi ke keyd lewat Unix socket; keyd mengambil KEK terbungkus dari `tpm-msk` lewat mTLS, lalu TPM memakai MSK. Pada VPS, `swtpm` dan `tpm-msk` berjalan sebagai container dengan state vTPM di volume persisten.

Komponen, zona, port, diagram, dan urutan baca dokumen lengkap: [docs/arsitektur/sistem.md](docs/arsitektur/sistem.md) dan [docs/arsitektur/alur-baca-dokumen.md](docs/arsitektur/alur-baca-dokumen.md).

## Dokumentasi

| Dokumen | Isi |
| --- | --- |
| [docs/README.md](docs/README.md) | Indeks dokumentasi dan urutan baca |
| [docs/arsitektur/sistem.md](docs/arsitektur/sistem.md) | Komponen, zona, port, dan gambaran alur baca |
| [docs/arsitektur/alur-baca-dokumen.md](docs/arsitektur/alur-baca-dokumen.md) | Jalur baca penuh dari `/api/grc` sampai TPM |
| [docs/services/](docs/services/) | Satu dokumen per container atau proses |
| [docs/keamanan/](docs/keamanan/) | Model akses, desain kriptografi, batas keamanan |
| [docs/operasi/](docs/operasi/) | Panduan menjalankan, tutorial operator, PowerShell, retensi |
| [docs/operasi/tpm-native-demo.md](docs/operasi/tpm-native-demo.md) | Demo TPM 2.0 native di laptop Windows |
| [docs/referensi/](docs/referensi/) | Blueprint TPM, peta traffic, referensi lain |
| [docs/demo/](docs/demo/) | Skenario demo |
| [docs/versi-lama/](docs/versi-lama/) | Arsip README dan modul lama |
| [docs/demo/akun-demo.md](docs/demo/akun-demo.md) | Katalog akun demo dan pemetaan username lama |

## Lisensi dan kredit

Dibangun dari template shadcn-admin (MIT, satnaing). Repositori memakai MIT License. Lihat [LICENSE](LICENSE).

Dikembangkan oleh Aeru Team. Bantuan teknis: https://github.com/skadut

Komponen shadcn/ui yang dimodifikasi dan perubahan terkait RTL ada di `frontend/src/components/ui/`. Referensi tampilan pihak ketiga, sumber, dan lisensinya ada di [docs/referensi/third-party-notices.md](docs/referensi/third-party-notices.md).
