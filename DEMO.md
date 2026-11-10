# Demo script (5 minutes)

Cerita demo: pengelola administrasi pada Satuan Demo Nusantara meninjau contoh dokumen keamanan OT. **Seluruh data fiktif. SIMULASI DEMO - BUKAN DOKUMEN RESMI TNI.** Nama satuan/lokasi/personel, kode, dan materi PDF/XLSX adalah sintetis; tidak menggambarkan satuan, pangkalan, personel, atau sistem nyata.

## Start

Prasyarat: Docker Desktop berjalan; `.env` ada di root; layanan TPM sudah disiapkan (lihat [First-time setup](README.md#first-time-setup-once)).

1. Di host Windows, dari `cryptography-service\tpm-services\`, jalankan `& .\bin\tpm-msk.exe serve --pki-dir ..\run\pki --pubkey-file ..\run\keyd-pub\delivery.pub.pem` (binary hasil build: `bin\tpm-msk.exe`), lalu masukkan PIN (minimal 6 karakter).
2. Dari root repo: `docker compose up -d --build`.
3. Cek fingerprint: `docker compose logs keyd`, cari baris `delivery key fingerprint: sha256:...`.
4. Bandingkan fingerprint, lalu ketik `y` di konsol `tpm-msk serve` untuk menyetujui.
5. Buka http://localhost:8088.

Catatan: persetujuan diulang setiap keyd di-restart (lihat [Each start](README.md#each-start)). Jangan pernah memasukkan PIN ke dalam dokumen atau riwayat shell.

## Walkthrough

1. **Masuk**. Gunakan username nama orang (misalnya `hendra.wiratama`, atau `bagus.hartanto` untuk level 1) dan password `DEMO_USER_PASSWORD` dari `.env`. Semua akun fiktif; daftar lengkap di [db/CREDENTIALS.md](db/CREDENTIALS.md). Akun demo harus sudah di-seed; lihat [Fresh start](README.md#fresh-start) atau [TUTORIAL langkah 5](cryptography-service/tpm-services/TUTORIAL.md#5-reset-data-dari-nol).
2. **Overview** (sidebar "Overview" > "Dashboard"). Ringkasan menampilkan jumlah sampel aset, tinjauan, bukti pemantauan tercatat, dan dokumen. Angka berasal dari data demo, bukan metrik operasional.
3. **CSF 2.0 evidence** (sidebar "Compliance" > "CSF 2.0 evidence"). Coba filter **Coverage** (Gap / Partial / Covered). Ini hanya menunjukkan kelengkapan bukti simulasi, bukan sertifikasi.
4. Kembalikan **Coverage** ke **All coverage**. Buka `ID.AM-01`, lihat aset contoh dan dokumen terkait. Kode `AST-*` dan lokasi adalah data fiktif.
5. Buka `DOC-0003` **Diagram Jaringan Instalasi Air Simulasi Halvard**. Tinjau label TLP dan riwayat versi. PDF adalah lembar administrasi demo, bukan diagram jaringan operasional.
6. Buka `DOC-0011` **Daftar Personel Simulasi**. XLSX memakai 40 baris sintetis, kode `DEMO-*`, dan marker simulasi pada tiap sheet. Nama, pangkat, unit, dan lokasi tidak merujuk personel atau formasi nyata.
7. Buka audit log untuk melihat contoh jejak perubahan; entri historis tetap merupakan sampel fiktif.

## Optional DB beat (terminal)

```sh
docker compose ps
```

DB demo memiliki `audit_events` append-only. Hindari memasukkan data pribadi atau operasional nyata.

## Batas penggunaan

- Dataset untuk prototipe UI saja; tidak untuk penilaian, perencanaan, koordinasi, atau penggunaan operasional.
- Login berbasis sesi dan kontrol akses (RBAC pangkat, level akses, dan grant dokumen) sudah ada; frontend memuat data dari `/api/grc` yang dibaca backend dari DB.
- Tidak mewakili TNI, tidak resmi, tidak terverifikasi, dan bukan alat kepatuhan NIST.
