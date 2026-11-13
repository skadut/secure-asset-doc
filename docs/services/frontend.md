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
- Batas body `/api/uploads` dan `/api/documents` 15 MB.
- Header keamanan: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options`, dan CSP. `/api/files/` mengizinkan frame same-origin untuk pratinjau PDF.
- Aset statis yang tidak ada mengembalikan 404, bukan fallback SPA. Hanya route non-file yang jatuh ke `/index.html`.

Nilai `APP_ORIGINS` dibaca backend, bukan frontend; lihat [backend](backend.md).

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
