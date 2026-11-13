# vps-swtpm

## Tujuan

TPM software untuk deployment VPS. `swtpm` menyediakan TPM 2.0 berbasis TCP, sehingga `tpm-msk` bisa menyegel MSK ke state vTPM tanpa hardware TPM. Ini overlay khusus VPS; jalur laptop native tidak memuatnya.

## Image dan port

- Image `ghcr.io/stefanberger/swtpm:v0.10.0`.
- Command: `socket --tpm2 --server type=tcp,port=2321,bindaddr=0.0.0.0 --ctrl type=tcp,port=2322,bindaddr=0.0.0.0 --flags not-need-init,startup-clear --tpmstate dir=/state`.
- Port `2321` (TPM) dan `2322` (control) hanya di jaringan internal Compose, tidak dipublikasikan ke host.
- State disimpan di volume `swtpm-state` yang di-mount ke `/state`.

## Konfigurasi

Overlay tidak membaca environment variable sendiri. Variabel terkait ada di service lain:

- `tpm-msk`: `TPM_MSK_TCP=swtpm:2321`, `TPM_MSK_PIN_FILE=/run/secrets/tpm_pin`, `TPM_MSK_APPROVE_FP`.
- `keyd`: `TPM_SERVICE_ADDR=tpm-msk:2798`.

Secret `tpm_pin` dibaca dari `./cryptography-service/run/secrets/tpm_pin` dan di-mount sebagai Docker secret. Jangan menulis nilai PIN ke dokumen atau shell history.

## Jaringan dan volume

- `tpm-internal`: jaringan internal khusus `swtpm` dan `tpm-msk`. `swtpm` tidak ikut `crypto-tpm-net`.
- `crypto-tpm-net`: dipakai `tpm-msk`, `keyd`, `crypto-api`, dan backend.
- `swtpm-state`: state vTPM persisten.
- `tpm-msk-data`: data `tpm-msk`.
- Bind read-only hanya untuk tiga file yang dimuat `tpm-msk`: `run/pki/keyzone/ca.pem`, `tpm-service.pem`, `tpm-service-key.pem`. Kunci privat CA tidak masuk container.
- `run/keyd-pub` dan `run/audit/tpm-msk` di-mount dari host.

## Berkomunikasi dengan

- `tpm-msk` memakai `TPM_MSK_TCP` untuk bicara ke `swtpm`.
- `keyd` memakai `TPM_SERVICE_ADDR=tpm-msk:2798`; verifikasi TLS memakai nama `host.docker.internal`, sehingga dial ke `tpm-msk:2798` tetap lolos.
- Deployment VPS memakai `COMPOSE_FILE` yang menggabungkan `compose.yaml` root dan `cryptography-service/compose.vps.yaml`.

## Perilaku gagal

- `swtpm` tidak tersedia: `tpm-msk` tidak bisa membuka MSK, delivery KEK gagal, keyd mengembalikan `unavailable`, dan crypto-api meneruskan 503. Tidak ada fallback plaintext.
- Volume `swtpm-state` hilang: state vTPM hilang; MSK yang tersegel ke state itu tidak bisa dipulihkan.
- `tpm-msk` berhenti: DEK di cache keyd tetap dipakai sampai TTL habis, lalu operasi kripto gagal.

## Kode

`cryptography-service/compose.vps.yaml`, dengan service `swtpm` dan override `tpm-msk`/`keyd`.
