# Deployment (CI/CD)

`.github/workflows/deploy.yml` berjalan pada push ke `main` dan pada dispatch manual. Workflow memakai self-hosted runner dengan label `self-hosted`, `linux`, dan `vps`, dan men-deploy ke `/opt/secure-asset-doc`. Setup compose VPS adalah `compose.yaml` root ditambah `cryptography-service/compose.vps.yaml` (overlay vTPM). Jalur vTPM ini berbeda dari [demo TPM native di laptop](tpm-native-demo.md).

Workflow CI (`.github/workflows/ci.yml`) juga punya job `tpm-swtpm` yang memakai `cryptography-service/compose.ci.yaml`. Software TPM khusus CI ini terpisah dari overlay VPS maupun jalur native laptop. Detail komponen vTPM ada di [vps-swtpm](../services/vps-swtpm.md).

## Graf job

1. `sync`: menyalin checkout ke `APP_DIR`, mengecualikan `.git/`, `.env`, `cryptography-service/run/`, dan `docs/demo/akun-demo.md`.
2. `build-frontend`, `build-backend`, `build-keyd-tpm` (keyd dan tpm-msk), `build-crypto-api`: berjalan paralel setelah `sync`.
3. `deploy` (environment `production`): menulis `.env`, menyiapkan zona TPM, menjalankan service, menyetujui kunci delivery keyd, menjalankan health check, dan menyemai database.

## Setelan environment `production` di GitHub

- Secret wajib: `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `DEMO_USER_PASSWORD`, `TPM_MSK_PIN`.
- Variable wajib: `POSTGRES_USER`, `POSTGRES_DB`.
- Variable opsional: `APP_ORIGINS`, `MSK_CRYPTOPERIOD_DAYS`.

## Yang dilakukan `deploy`

- Menulis `.env` dari nilai-nilai tersebut. Nilai yang mengandung kutip tunggal atau newline membuat run gagal.
- Menyiapkan zona TPM. PKI dibuat hanya jika `run/pki/keyzone/ca.pem` tidak ada. `tpm-msk init` berjalan jika tidak ada file kunci. `kek-01` dibuat jika belum ada, dan diperiksa pada setiap deploy.
- Membaca `delivery key fingerprint` keyd dari log, lalu menjalankan `tpm-msk` dengan `TPM_MSK_APPROVE_FP` di-set ke nilai itu.
- Mem-poll `http://127.0.0.1:8088/api/health`.
- Menyemai data dan user demo hanya jika tabel `users` kosong. Pada deploy berikutnya, data yang ada dipertahankan. `protect-documents`, `protect-fields`, dan `tokenize-titles` berjalan pada setiap deploy dan melewati baris yang sudah diproses.

## Yang bertahan antar deploy di server

- Data PostgreSQL (volume `pgdata`).
- `swtpm-state` (state vTPM) dan `tpm-msk-data` (data layanan TPM).
- `cryptography-service/run/` (PKI, file PIN, log audit, public key keyd).

## Peringatan

- Jangan pernah menjalankan `docker compose down -v` di VPS. Perintah itu menghapus state vTPM dan MSK, sehingga semua kunci terbungkus tidak dapat dipulihkan, dan menghapus volume database.
- `TPM_MSK_PIN` tidak boleh berubah setelah deploy pertama. MSK terikat pada PIN.
- Setelah VPS reboot, jalankan ulang workflow deploy. keyd membuat kunci delivery baru pada setiap start, dan `tpm-msk` menyetujui kunci itu hanya saat deploy.

## Langkah pasca-deploy

1. Pastikan health check lulus dan `docker compose ps` menunjukkan service `running` atau `healthy`.
2. Verifikasi log audit seperti di [run.md](run.md#operasi-tpm).
3. Buka aplikasi di `http://127.0.0.1:8088` (atau origin yang dikonfigurasi di `APP_ORIGINS`).
4. Jika `protect-documents`, `protect-fields`, atau `tokenize-titles` melaporkan baris gagal, perbaiki penyebabnya lalu deploy ulang; ketiganya aman dijalankan ulang.

Untuk start, stop, dan reset lokal, lihat [run.md](run.md) dan [seeding.md](seeding.md).
