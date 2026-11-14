# Dokumentasi

Dokumentasi ARCA — Hardware-Backed Digital Asset Security.

Dikembangkan oleh Aeru Team untuk Kartika Cyberhackaton 2026.

Repositori ini memakai satu jalur baca: mulai dari gambaran sistem, lalu jalur baca dokumen, lalu detail per layanan. Dokumen keamanan, operasi, referensi, dan demo melengkapi sisanya.

Stack ini TPM-only. Vault sudah pensiun, data dimulai dari nol, dan tidak ada rekey.

## Urutan baca

1. [README](../README.md) — apa aplikasinya dan pratinjau.
2. [Arsitektur sistem](arsitektur/sistem.md) — komponen, zona, port, diagram.
3. [Alur baca dokumen](arsitektur/alur-baca-dokumen.md) — dari `/api/grc` sampai TPM, termasuk fail-closed.
4. [Layanan](services/) — satu dokumen per container atau proses.
5. [Keamanan](keamanan/) — model akses, desain kriptografi, batas yang diketahui.
6. [Operasi](operasi/) — panduan menjalankan, tutorial operator, PowerShell, retensi audit.
7. [Referensi](referensi/) — blueprint TPM dan peta traffic.
8. [Demo](demo/) — skenario demo.
9. [Versi lama](versi-lama/) — arsip, bukan bagian stack TPM.

## Indeks

| Folder | Isi |
| --- | --- |
| [arsitektur/](arsitektur/) | [sistem.md](arsitektur/sistem.md), [alur-baca-dokumen.md](arsitektur/alur-baca-dokumen.md) |
| [services/](services/) | [frontend](services/frontend.md), [backend](services/backend.md), [database](services/database.md), [crypto-api](services/crypto-api.md), [keyd](services/keyd.md), [tpm-msk](services/tpm-msk.md), [vps-swtpm](services/vps-swtpm.md) |
| [keamanan/](keamanan/) | Model akses dan desain keamanan |
| [operasi/](operasi/) | Panduan menjalankan, [tutorial operator](operasi/tutorial-operator.md), [run PowerShell](operasi/run-powershell.md) |
| [referensi/](referensi/) | Blueprint TPM, peta traffic |
| [demo/](demo/) | Skenario demo |
| [versi-lama/](versi-lama/) | [README sebelum pemecahan](versi-lama/README.pre-split.md), arsip Vault |

Daftar akun demo ada di [demo/akun-demo.md](demo/akun-demo.md).

## Konvensi

- Prosa berbahasa Indonesia. Nama perintah, path, variabel environment, endpoint, dan identifier kode ditulis apa adanya.
- Tidak ada nilai rahasia di dokumen. Kata sandi demo selalu ditulis `<DEMO_USER_PASSWORD>`.
- Setiap klaim mengacu ke kode, `compose.yaml`, atau dokumen yang ada di repositori.
