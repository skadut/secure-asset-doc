# frontend

## Tujuan

Melayani SPA dashboard dan mem-proxy seluruh `/api/` ke backend. Tidak ada logika bisnis atau akses database di container ini.

## Image dan port

- Build dari `frontend/Dockerfile`, dua tahap: `node:24-slim` untuk `npm ci` dan `npm run build`, lalu `nginxinc/nginx-unprivileged:1.30-alpine` untuk runtime.
- Container listen di `8080`; Compose memetakannya ke `127.0.0.1:8088`.
- Stack: React 19, Vite 8, TypeScript 6, TanStack Router, TanStack Query, Tailwind CSS 4, komponen turunan shadcn/ui.

## Konfigurasi

Tidak ada environment variable runtime. Perilaku ditentukan `frontend/nginx.conf`:

- `/api/files/`, `/api/uploads`, `/api/traffic`, `/api/login`, `/api/auth/`, `/api/documents`, dan `/api/` di-proxy ke `http://backend:3000`.
- Rate limit nginx: `traffic` 5 r/s, `uploads` 2 r/s (burst 4), `login` 1 r/s (burst 5).
- Header keamanan: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options`, dan CSP. `/api/files/` mengizinkan frame same-origin untuk pratinjau PDF.
- Aset statis yang tidak ada mengembalikan 404, bukan fallback SPA. Hanya route non-file yang jatuh ke `/index.html`.

Nilai `APP_ORIGINS` dibaca backend, bukan frontend; lihat [backend](backend.md).

## Batas ukuran body

Sumber: `frontend/nginx.conf`.

- `location ^~ /api/uploads` dan `location ^~ /api/documents`: `client_max_body_size 15m`.
- `POST /api/documents` menerima berkas 10 MiB yang di-base64 dalam JSON, sekitar 13,3 MiB. Batas 15 MB memberi ruang untuk itu. Backend membatasi body 14 MiB (`MAX_BODY` di `backend/uploads.mjs`).
- `POST /api/assets` jatuh ke `location /api/`, yang tidak menetapkan batas sendiri, sehingga batas default nginx 1 MiB berlaku. Body aset kecil dan tidak mencapai batas itu.

## Rute tulis

- `/documents/upload`: wizard unggah 6 langkah (`?step=1` sampai `?step=6`, `frontend/src/routes/_authenticated/documents/upload.tsx`). Langkah: Berkas, Identitas, Klasifikasi, Siklus, Tinjau, Selesai. Nilai `step` di luar 1-6 jatuh ke 1 (`clampStep`). Langkah 5 mengirim `POST /api/documents`; langkah 6 menampilkan hasil. Komponen: `features/documents/upload/upload-wizard.tsx`.
- `/assets/new`: form buat aset (`frontend/src/routes/_authenticated/assets/new.tsx`, komponen `features/assets/create.tsx`). Mengirim `POST /api/assets`. Tombol muncul hanya bila `me.can.asset.c` true.
- Dialog unggah lama (`features/documents/uploads/upload-dialog.tsx`) sudah dihapus. Panel daftar unggahan `uploads-panel.tsx` tetap ada.
- Edit dan hapus aset memakai `features/assets/edit-dialog.tsx` dan `delete-dialog.tsx` (`PATCH` dan `DELETE /api/assets/:id`).

## Berkomunikasi dengan

- Browser ke `frontend` lewat HTTP loopback (atau Tailscale Funnel pada demo).
- `frontend` ke `backend:3000` lewat jaringan Compose. Backend tidak punya port host.

## Perilaku gagal

- Compose menunggu `backend` sehat sebelum start (`depends_on.condition: service_healthy`).
- Healthcheck: `wget --spider http://127.0.0.1:8080/`.
- `restart: unless-stopped`.
- Bila backend mati, nginx mengembalikan 502 untuk `/api/`; aset SPA tetap dilayani.

## Kode

`frontend/`, terutama `frontend/nginx.conf`, `frontend/Dockerfile`, `frontend/src/`, dan `frontend/dist/` sebagai hasil build.
