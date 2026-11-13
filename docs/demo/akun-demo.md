# Katalog akun demo

Sumber: `db/scripts/seed-users.mjs` dan `db/scripts/demo-users.mjs`. Semua nama, pangkat, dan unit fiktif.

- 80 akun mengikuti pangkat. Satu akun tambahan, `super.admin`, bukan slot pangkat.
- Semua akun memakai satu kata sandi demo dari `DEMO_USER_PASSWORD` di `.env` dan satu secret TOTP demo bersama. Nilai keduanya tidak dicatat di folder ini.
- Kolom `Perwira keamanan` dan `Super admin` berisi `ya` hanya untuk akun dengan flag tersebut.
- Grant per dokumen tidak menaikkan level. Grant hanya membuka dokumen tertentu.

## PATI

| Username | Pangkat / peran | Level | Perwira keamanan | Super admin | Cocok untuk |
|---|---|---:|---|---|---|
| `hendra.wiratama` | Jenderal TNI | 5 | — | — | Komandan; pengaju dan pemberi grant di seed |
| `super.admin` | Super admin | 5 | — | ya | Token super admin, traffic, database view, audit |
| `ratna.sekarsari` | Jenderal TNI | 5 | — | — | Penerima grant DOC-0011 |
| `yudi.ananda` | Letnan Jenderal TNI | 5 | — | — | Komandan yang menyetujui grant DOC-0011 dan DOC-0013 |
| `maya.kusumawati` | Letnan Jenderal TNI | 5 | — | — | Contoh level 5 tanpa grant |
| `teguh.prasetya` | Mayor Jenderal TNI | 4 | ya | — | Perwira keamanan level 4; penyetuju grant DOC-0011 |
| `dewi.anggraini` | Mayor Jenderal TNI | 4 | — | — | Contoh level 4 tanpa flag |
| `bambang.sulistyo` | Brigadir Jenderal TNI | 4 | — | — | Contoh level 4 tanpa flag |
| `nurul.hikmah` | Brigadir Jenderal TNI | 4 | — | — | Contoh level 4 tanpa flag |

## PAMEN

| Username | Pangkat / peran | Level | Perwira keamanan | Super admin | Cocok untuk |
|---|---|---:|---|---|---|
| `rizky.firmansyah` | Kolonel | 3 | — | — | Penerima grant DOC-0013 |
| `ayu.lestari` | Kolonel | 3 | — | — | Contoh level 3 tanpa grant |
| `fajar.nugraha` | Letnan Kolonel | 3 | — | — | Contoh level 3 tanpa grant |
| `mega.puspitasari` | Letnan Kolonel | 3 | ya | — | Perwira keamanan level 3; penyetuju grant DOC-0013 |
| `agung.setiadi` | Mayor | 3 | — | — | Contoh level 3 tanpa grant |
| `lia.marlina` | Mayor | 3 | — | — | Contoh level 3 tanpa grant |

## PAMA

| Username | Pangkat / peran | Level | Perwira keamanan | Super admin | Cocok untuk |
|---|---|---:|---|---|---|
| `wahyu.hidayat` | Kapten | 2 | — | — | Level 2; bisa membaca daftar berkas terunggah |
| `sri.wahyuni` | Kapten | 2 | — | — | Contoh level 2 |
| `dimas.saputra` | Letnan Satu | 2 | — | — | Contoh level 2 |
| `intan.permatasari` | Letnan Satu | 2 | — | — | Contoh level 2 |
| `arif.budiman` | Letnan Dua | 2 | ya | — | Perwira keamanan level 2; kontras peran tanpa level 5 |
| `tika.rahmadani` | Letnan Dua | 2 | — | — | Contoh level 2 |

## Bintara Tinggi

| Username | Pangkat / peran | Level | Perwira keamanan | Super admin | Cocok untuk |
|---|---|---:|---|---|---|
| `surya.pratama` | Pembantu Letnan Satu | 1 | — | — | Level 1 dengan `owner_label` aset |
| `nina.oktaviani` | Pembantu Letnan Satu | 1 | — | — | Contoh level 1 |
| `gilang.ramadhan` | Pembantu Letnan Satu | 1 | — | — | Contoh level 1 |
| `putri.handayani` | Pembantu Letnan Satu | 1 | — | — | Contoh level 1 |
| `eko.wicaksono` | Pembantu Letnan Satu | 1 | — | — | Contoh level 1 |
| `rudi.hermawan` | Pembantu Letnan Dua | 1 | — | — | Contoh level 1 |
| `sinta.oktavia` | Pembantu Letnan Dua | 1 | — | — | Contoh level 1 |
| `andre.kurniawan` | Pembantu Letnan Dua | 1 | — | — | Contoh level 1 |
| `winda.safitri` | Pembantu Letnan Dua | 1 | — | — | Contoh level 1 |
| `ilham.maulana` | Pembantu Letnan Dua | 1 | — | — | Contoh level 1 |

## Bintara

| Username | Pangkat / peran | Level | Perwira keamanan | Super admin | Cocok untuk |
|---|---|---:|---|---|---|
| `kusnadi.hartono` | Sersan Mayor | 2 | — | — | Contoh level 2 dari golongan Bintara |
| `ani.widiastuti` | Sersan Mayor | 2 | — | — | Contoh level 2 |
| `heru.susanto` | Sersan Mayor | 2 | ya | — | Perwira keamanan level 2 |
| `rina.anggriani` | Sersan Mayor | 2 | — | — | Contoh level 2 |
| `bayu.aditya` | Sersan Mayor | 2 | — | — | Contoh level 2 |
| `doni.setiawan` | Sersan Kepala | 1 | — | — | Level 1 dengan `owner_label` aset |
| `yuni.astuti` | Sersan Kepala | 1 | — | — | Contoh level 1 |
| `faisal.akbar` | Sersan Kepala | 1 | — | — | Contoh level 1 |
| `lestari.ningsih` | Sersan Kepala | 1 | — | — | Contoh level 1 |
| `made.wirawan` | Sersan Kepala | 1 | — | — | Contoh level 1 |
| `martin.simanjuntak` | Sersan Satu | 1 | — | — | Contoh level 1 |
| `nadia.herlina` | Sersan Satu | 1 | — | — | Contoh level 1 |
| `hasan.basri` | Sersan Satu | 1 | — | — | Contoh level 1 |
| `ratih.puspita` | Sersan Satu | 1 | — | — | Contoh level 1 |
| `yoga.pradipta` | Sersan Satu | 1 | — | — | Contoh level 1 |
| `komang.adnyana` | Sersan Dua | 1 | — | — | Penerima grant DOC-0017 |
| `wati.susilowati` | Sersan Dua | 1 | — | — | Contoh level 1 |
| `hafiz.ramadan` | Sersan Dua | 1 | — | — | Contoh level 1 |
| `dian.permadi` | Sersan Dua | 1 | — | — | Contoh level 1 |
| `yusuf.mahendra` | Sersan Dua | 1 | — | — | Contoh level 1 |

## Tamtama Kepala

| Username | Pangkat / peran | Level | Perwira keamanan | Super admin | Cocok untuk |
|---|---|---:|---|---|---|
| `agus.rusdiana` | Kopral Kepala | 1 | — | — | Contoh level 1 |
| `melinda.kartika` | Kopral Kepala | 1 | — | — | Contoh level 1 |
| `iwan.setyawan` | Kopral Kepala | 1 | — | — | Contoh level 1 |
| `ika.purwanti` | Kopral Kepala | 1 | — | — | Contoh level 1 |
| `ridwan.gunadi` | Kopral Kepala | 1 | — | — | Contoh level 1 |
| `bima.pamungkas` | Kopral Satu | 1 | — | — | Contoh level 1 |
| `siska.amelia` | Kopral Satu | 1 | — | — | Contoh level 1 |
| `taufik.hidayatullah` | Kopral Satu | 1 | — | — | Contoh level 1 |
| `laras.wulandari` | Kopral Satu | 1 | — | — | Contoh level 1 |
| `wawan.kristanto` | Kopral Satu | 1 | — | — | Contoh level 1 |
| `nanda.prasetyo` | Kopral Dua | 1 | — | — | Penerima grant DOC-0017 |
| `mawar.pertiwi` | Kopral Dua | 1 | — | — | Contoh level 1 |
| `arman.hakim` | Kopral Dua | 1 | — | — | Contoh level 1 |
| `fitria.wahyuni` | Kopral Dua | 1 | — | — | Contoh level 1 |
| `joni.iskandar` | Kopral Dua | 1 | — | — | Contoh level 1 |

## Tamtama

| Username | Pangkat / peran | Level | Perwira keamanan | Super admin | Cocok untuk |
|---|---|---:|---|---|---|
| `samsul.bahri` | Prajurit Kepala | 1 | — | — | Contoh level 1 |
| `ayu.kartini` | Prajurit Kepala | 1 | — | — | Contoh level 1 |
| `reza.fahlevi` | Prajurit Kepala | 1 | — | — | Contoh level 1 |
| `citra.dewantari` | Prajurit Kepala | 1 | — | — | Contoh level 1 |
| `agus.triyono` | Prajurit Kepala | 1 | — | — | Contoh level 1 |
| `bagus.hartanto` | Prajurit Satu | 1 | — | — | Penerima grant DOC-0017 dan dokumen turunannya |
| `dina.maharani` | Prajurit Satu | 1 | — | — | Contoh level 1 |
| `yanto.suprapto` | Prajurit Satu | 1 | — | — | Contoh level 1 |
| `linda.tanuwijaya` | Prajurit Satu | 1 | — | — | Contoh level 1 |
| `kevin.halim` | Prajurit Satu | 1 | — | — | Contoh level 1 |
| `ahmad.zaelani` | Prajurit Dua | 1 | — | — | Penerima grant DOC-0017; grant berakhir 1 Oktober 2026 |
| `sari.rejeki` | Prajurit Dua | 1 | — | — | Contoh level 1 |
| `dedi.kurniadi` | Prajurit Dua | 1 | — | — | Contoh level 1 |
| `nurhayati.lubis` | Prajurit Dua | 1 | — | — | Contoh level 1 |
| `rendi.pangestu` | Prajurit Dua | 1 | — | — | Contoh level 1 |

## Catatan akun

- Empat perwira keamanan: `teguh.prasetya`, `mega.puspitasari`, `arif.budiman`, dan `heru.susanto`. Tidak ada yang berlevel 5.
- Super admin hanya `super.admin`. Flag ini tidak mengubah level; ia tetap level 5.
- `owner_label` hanya dimiliki `doni.setiawan` dan `surya.pratama`. Ini label pemilik aset, bukan hak baca tambahan.
- Penerima grant DOC-0017: `bagus.hartanto`, `nanda.prasetyo`, `komang.adnyana`, dan `ahmad.zaelani`.
- `ratna.sekarsari` menerima grant DOC-0011 dan `rizky.firmansyah` menerima grant DOC-0013. Grant dibuat lewat seed dengan alur permintaan dan persetujuan ganda.
- Grant `ahmad.zaelani` berakhir 1 Oktober 2026. Setelah tanggal itu akun ini tidak lagi membuka DOC-0017 lewat grant.
