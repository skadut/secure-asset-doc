# Arsitektur sistem

Aplikasi berjalan sebagai satu stack Compose dengan tiga zona: aplikasi, data, dan kripto. `tpm-msk` berada di host Windows native atau, pada VPS, di container bersama `swtpm`.

```mermaid
flowchart TB
  browser["Browser"]
  subgraph APP["App zone (Compose default network)"]
    frontend["frontend<br/>nginx, 127.0.0.1:8088"]
    backend["backend<br/>Node"]
  end
  db[("db<br/>PostgreSQL 17")]
  subgraph TPM["Key zone (native Windows host; VPS uses the vTPM overlay)"]
    tpmsvc["tpm-msk serve<br/>127.0.0.1:2798, mTLS"]
    tpm["TPM 2.0, MSK non-exportable"]
    kekfile["Wrapped KEK file"]
    pubfile["run/keyd-pub/delivery.pub.pem"]
    tpmaudit["TPM-signed audit log (%APPDATA%\\tpm-msk\\audit.jsonl)"]
  end
  subgraph CRYPTO["Crypto zone (see cryptography-service/compose.yaml)"]
    api["crypto-api (Go, CRYPTO_MODE=tpm)<br/>mTLS container 2796, host 127.0.0.1:2896"]
    keyd["keyd (Rust)<br/>RSA-3072 in memory, AES-256-GCM, zeroize"]
    sock["keyd-sock volume<br/>/run/keyd/keyd.sock"]
    deks["keyd-deks volume<br/>/var/lib/keyd/deks.json (wrapped DEKs)"]
    audits["Audit logs (run/audit/keyd, run/audit/crypto-api)"]
  end
  browser -->|"HTTP 127.0.0.1:8088"| frontend
  frontend -->|"proxy /api/"| backend
  backend -->|"SQL"| db
  backend -->|"mTLS https://crypto-api:2796"| api
  api -->|"NDJSON over Unix socket (base64 data, dek_id)"| sock
  sock --> keyd
  keyd -->|"POST /v1/kek/wrapped over mTLS via host.docker.internal:2798"| tpmsvc
  tpmsvc -->|"wrapped KEK: RSA-OAEP plus AES-KWP"| keyd
  tpmsvc -->|"MSK use with PIN"| tpm
  kekfile -->|"wrapped KEK"| tpmsvc
  keyd -->|"DEK store (AES-256-GCM wrapped)"| deks
  keyd -->|"audit"| audits
  keyd -->|"writes delivery public key"| pubfile
  pubfile -->|"polls every 2 s, RSA-3072 only"| tpmsvc
  api -->|"audit"| audits
  tpmsvc -->|"audit"| tpmaudit
```

## Zona dan port

| Zona | Container | Port host |
| --- | --- | --- |
| App | `frontend` (nginx), `backend` (Node 24) | `frontend` 127.0.0.1:8088; backend tanpa port host |
| Data | `db` (PostgreSQL 17) | 127.0.0.1:5432 |
| Crypto | `crypto-api` (mTLS), `keyd` | `crypto-api` 127.0.0.1:2896 ke container 2796; keyd tanpa port host |
| Key zone | `tpm-msk serve`, TPM 2.0, MSK | 127.0.0.1:2798 |

Backend hanya bisa dijangkau dari jaringan Compose. Frontend mem-proxy `/api/` ke `backend:3000`. crypto-api memakai mTLS dengan client certificate wajib; CN client yang tidak ada di `APP_IDENTITIES` ditolak 403.

## Deploy VPS

Deployment VPS memuat `cryptography-service/compose.vps.yaml` di atas `compose.yaml`. Overlay itu menjalankan `swtpm` sebagai TPM software dan `tpm-msk` sebagai container; MSK disegel ke state vTPM di volume `swtpm-state`. `keyd` diarahkan ke `tpm-msk:2798` lewat jaringan `crypto-tpm-net`.

## Cara baca dokumen

Frontend meminta `/api/grc`; backend memfilter dokumen berdasarkan level akses, grant, role officer, dan role super admin, lalu mendetokenkan judul yang boleh dibaca. Membuka dokumen membuat sesi viewer berbatas waktu. Saat file diminta, backend memeriksa plafon TLP dan grant, lalu memanggil crypto-api `/unsealfile`; crypto-api meminta dekripsi ke keyd lewat Unix socket, dan keyd mengambil KEK terbungkus dari `tpm-msk` bila DEK belum ada di cache. Kegagalan di zona kunci menghasilkan 503 dan tidak ada byte yang dikirim.

Urutan lengkap, termasuk perilaku per komponen dan kondisi gagal: [alur-baca-dokumen.md](alur-baca-dokumen.md).
