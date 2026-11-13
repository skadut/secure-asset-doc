# Run guide

Operational steps for the stack: setup, start and stop, seeding, TPM operations, development, tests, deployment, and maintenance. The overview is in the [README](../README.md); the technical design is in [SECURITY-DESIGN.md](SECURITY-DESIGN.md). The operator tutorial in Indonesian is [cryptography-service/tpm-services/TUTORIAL.md](../cryptography-service/tpm-services/TUTORIAL.md).

Never paste `.env` values, real PINs, or passwords into docs, commands, or shell history.

## Contents

- [Quick start](#quick-start)
  - [First-time setup (once)](#first-time-setup-once)
  - [Each start](#each-start)
  - [Fresh start](#fresh-start)
  - [Stop](#stop)
- [Seeding after fresh start](#seeding-after-fresh-start)
- [Demo accounts](#demo-accounts)
- [TPM operations](#tpm-operations)
  - [Container-mode `tpm-msk` environment](#container-mode-tpm-msk-environment)
- [Backup before migration](#backup-before-migration)
- [Protection migration](#protection-migration)
- [Development](#development)
- [Tests](#tests)
- [Deployment (CI/CD)](#deployment-cicd)
- [Audit log retention](#audit-log-retention)
- [Repository layout](#repository-layout)
- [Hardware used](#hardware-used)

## Quick start

### First-time setup (once)

Requires Docker Desktop (Compose v2) and the TPM service on the Windows host. From repo root, copy `.env.example` to `.env`, then replace the sample values with secrets for `POSTGRES_PASSWORD` and `APP_DB_PASSWORD` (16+ characters). `APP_DB_PASSWORD` must not be empty; see `db/init/005_app_role.sh`. Never put `.env` values in docs or shell history.

```powershell
Copy-Item .env.example .env
```

From `cryptography-service\tpm-services\` (after building `bin\tpm-msk.exe` as described in [TPM service setup](../cryptography-service/tpm-services/README.md#build-tpm-mskexe)):

```powershell
& .\bin\tpm-msk.exe pki --out ..\run\pki
& .\bin\tpm-msk.exe init
& .\bin\tpm-msk.exe kek create --id kek-01
New-Item -ItemType Directory -Force ..\run\audit\keyd, ..\run\audit\crypto-api | Out-Null
```

### Each start

1. On the host, from `cryptography-service\tpm-services\`, run `& .\bin\tpm-msk.exe serve --pki-dir ..\run\pki --pubkey-file ..\run\keyd-pub\delivery.pub.pem`; enter a PIN of at least 6 characters.
2. From repo root, run `docker compose up -d --build`.
3. Run `docker compose logs keyd` and read the `delivery key fingerprint: sha256:...` line.
4. Compare the fingerprint, then type `y` at the `tpm-msk serve` console.
5. Open http://127.0.0.1:8088. Re-approval is needed after each keyd restart.

On a fresh install, follow [Fresh start](#fresh-start).

### Fresh start

All data starts from zero. The stack is TPM-only; there is no rekey and no migration from Vault. Operator steps (optional backup, `docker compose down -v`, seeding, SQL checks) are in [TUTORIAL step 5, Reset data dari nol](../cryptography-service/tpm-services/TUTORIAL.md#5-reset-data-dari-nol).

> **Warning:** `docker compose down -v` deletes all DB data and named volumes. Use it only for a deliberate local reset. Never run it on the VPS; see [Deployment (CI/CD)](#deployment-cicd). For normal stops, use `docker compose down` (data kept).

### Stop

`docker compose down` (data kept). Before sleep: `docker compose -f cryptography-service/compose.yaml stop keyd`.

## Seeding after fresh start

A fresh volume gets schema only (`db/init`, 0 rows). Seed order after a fresh start: `db/seed/*.sql`, then `seed-users`, then `seed-totp`, then `protect-documents`, then `tokenize-titles`. Commands and checks are in [Fresh start](#fresh-start) and [TUTORIAL step 5](../cryptography-service/tpm-services/TUTORIAL.md#5-reset-data-dari-nol).

`seed-totp` stores the shared demo TOTP secret for login OTP. Set `DEMO_TOTP_SECRET` to 20 printable ASCII characters, then run:

```powershell
$env:DEMO_TOTP_SECRET = "<20-char-ascii>"
docker compose run --rm --no-deps -v "./db/scripts/seed-totp.mjs:/app/seed-totp.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> -e DEMO_TOTP_SECRET backend node /app/seed-totp.mjs
```

`--print-uri` prints an `otpauth://` URI for an authenticator app. Operator-only, never in CI:

```powershell
docker compose run --rm --no-deps -v "./db/scripts/seed-totp.mjs:/app/seed-totp.mjs:ro" -e DEMO_TOTP_SECRET backend node /app/seed-totp.mjs --print-uri
```

## Demo accounts

Every demo account uses the password in `DEMO_USER_PASSWORD` from `.env`. Usernames are the person's first and last name, for example `hendra.wiratama`; every account is fictional. The script seeds 80 accounts across 22 ranks and sets `access_level` per rank. For the full account list and old-to-new username mapping, see [db/CREDENTIALS.md](../db/CREDENTIALS.md). To seed these accounts, follow [Fresh start](#fresh-start); `DEMO_USER_PASSWORD` must be at least 16 characters. Sign in at http://127.0.0.1:8088.

Access level is independent of rank. For example, `sersan-mayor` is Bintara but has level 2.

| Golongan | Ranks | Level | Access |
| --- | --- | --- | --- |
| PATI | `jenderal-tni`, `letnan-jenderal-tni` | 5 | Full CRUD on uploads, documents, assets, and accounts. Approve documents. Purge audit-log entries older than a chosen date. |
| PATI | `mayor-jenderal-tni`, `brigadir-jenderal-tni` | 4 | Full CRUD on uploads, documents, assets, and accounts. Approve documents. Purge audit-log entries older than a chosen date. |
| PAMEN | `kolonel`, `letnan-kolonel`, `mayor` | 3 | CRUD on uploads and assets. Create, update, and approve documents. Read accounts. |
| PAMA | `kapten`, `letnan-satu`, `letnan-dua` | 2 | Upload and view uploads. Create and update draft documents. Create, read, and update assets. |
| Bintara | `sersan-mayor` | 2 | Upload. Read assets and update own. |
| Bintara Tinggi | `pembantu-letnan-satu`, `pembantu-letnan-dua` | 1 | Upload. Read assets and update own. |
| Bintara | `sersan-kepala`, `sersan-satu`, `sersan-dua` | 1 | Upload. Read assets and update own. |
| Tamtama Kepala | `kopral-kepala`, `kopral-satu`, `kopral-dua` | 1 | Upload. Read assets. |
| Tamtama | `prajurit-kepala`, `prajurit-satu`, `prajurit-dua` | 1 | Upload. Read assets. |

The Access column lists rank-based permissions only. Document reads depend on access level and grants, not rank. See [Access levels and document grants](SECURITY-DESIGN.md#access-levels-and-document-grants).

The table shows the permission matrix from `can()`, not every endpoint. `ROUTES` in `backend/server.mjs` has no account or asset write routes. Its write routes are `POST /api/login`, `POST /api/logout`, `POST /api/uploads`, `POST /api/audit/purge`, `POST /api/documents/:id/access-requests`, `POST /api/access-requests/:id/decision`, `POST /api/users/:username/level-requests`, `POST /api/level-requests/:id/decision`, `DELETE /api/documents/:id/grants/:username`, and `POST /api/documents/:id/derive`.

**Quick pick:** one account per golongan for testing: `hendra.wiratama` (PATI), `rizky.firmansyah` (PAMEN), `wahyu.hidayat` (PAMA), `surya.pratama` (Bintara Tinggi), `kusnadi.hartono` (Bintara), `agus.rusdiana` (Tamtama Kepala), `samsul.bahri` (Tamtama).

Ranks are fictional demo data.

## TPM operations

The design is in [TPM blueprint](tpm-development-crypto-service.md). Command steps are in [Quick start](#quick-start).

If the TPM service stops, crypto operations fail closed once loaded DEKs expire, within 5 minutes.

Each service writes a hash-chained JSONL audit log (SHA-256 chain). From `cryptography-service\tpm-services`, run `& .\bin\tpm-msk.exe audit verify ..\run\audit\keyd\audit.jsonl`, `& .\bin\tpm-msk.exe audit verify ..\run\audit\crypto-api\audit.jsonl`, and `& .\bin\tpm-msk.exe audit verify "$env:APPDATA\tpm-msk\audit.jsonl"`. These logs are separate from the `audit_events` database table.

`[DEMO]` Shamir shares: `tpm-msk serve` prints them by default (`--demo-ceremony`, default true). They are split from a throwaway random secret, not the MSK, and cannot recover the MSK. `init` does not print them.

Laptop hardening is manual, not performed by tooling: BitLocker on the system drive (`manage-bde -status`), `powercfg /h off`, `swap=0` under `[wsl2]` in `%UserProfile%\.wslconfig`, and stop keyd before sleep with `docker compose -f compose.yaml stop keyd`. See [cryptography-service README](../cryptography-service/README.md#laptop-hardening-blueprint-section-9).

This single-laptop setup is for development and demonstrations, with no zone separation. Malware with Windows administrator rights, an attacker controlling the running keyd container, and a compromised application using its own valid certificate are not protected against. See blueprint section 12, Security boundaries.

The backend calls crypto-api in TPM mode through the root compose. `cryptography-service/e2e.sh` exercises the path with a software TPM harness. A real-TPM run via `cryptography-service/hw-acceptance.ps1` has not been done yet.

Never paste real PIN values or secrets into docs, commands, or shell history.

### Container-mode `tpm-msk` environment

These three variables are for the vTPM/container mode only (`cryptography-service/compose.vps.yaml`). When they are unset, native Windows/TBS behavior is unchanged.

- `TPM_MSK_TCP`: dial a TCP TPM (for example `swtpm:2321`) instead of the platform TPM transport (`internal/tpm/tpm.go`).
- `TPM_MSK_PIN_FILE`: read the PIN from this file instead of prompting. The file must hold at least 6 bytes (`cmd/tpm-msk/main.go`).
- `TPM_MSK_APPROVE_FP`: auto-approve the delivery key only when its fingerprint equals this `sha256:<64 hex>` value; otherwise manual approval is still required (`cmd/tpm-msk/serve.go`).

## Backup before migration

Back up before any protection migration. Backup files contain plaintext. Keep them outside the repo and never commit them.

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\secure-asset-doc-backups" | Out-Null
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t document_versions -t documents -f /tmp/sad-backup.sql'
docker compose cp db:/tmp/sad-backup.sql "$env:USERPROFILE\secure-asset-doc-backups\documents-backup.sql"
docker compose exec db rm /tmp/sad-backup.sql
```

## Protection migration

Seeded or new files stay plaintext (`protection='none'`) until migrated. `protect-documents.mjs` also migrates legacy `integrity` rows; re-running it is safe. After a fresh `docker compose up`, run the dry run first:

```powershell
docker compose run --rm --no-deps -v "./db/scripts/protect-documents.mjs:/app/protect-documents.mjs:ro" -e PGUSER=<POSTGRES_USER> -e PGDATABASE=<POSTGRES_DB> -e PGPASSWORD=<POSTGRES_PASSWORD> backend node /app/protect-documents.mjs --dry-run
```

The real run is the same command without `--dry-run`. Values in `<...>` come from root `.env`. Real values must never be pasted into docs or shell history.

- Re-running is safe: only `protection='none'` rows are touched.
- Exit code is 1 if any row failed.
- Limit: sealfile accepts up to 10 MiB decoded per file. Larger files stay `none` and are reported as failed.
- If a document's TLP changes later, re-running does not re-protect or un-protect existing versions. This is out of scope; handle it manually.

## Development

Frontend:

```powershell
cd frontend
npm ci
npm run dev
npm run lint
npm run build
```

The Vite dev server proxies `/api` to `http://localhost:3000`. Compose does not publish the backend port, so run the backend locally as well:

```powershell
cd backend
npm ci
$env:PGHOST = '127.0.0.1'; $env:PGPORT = '5432'; $env:PGDATABASE = 'secure_asset_doc'; $env:PGUSER = 'sad_app'
$env:PGPASSWORD = '<APP_DB_PASSWORD from .env>'
node server.mjs
```

Regenerate the seed from `frontend/src/test-utils/grc-fixture.ts` and the sample files in `db/seed-files/`:

```powershell
node --experimental-strip-types db/scripts/seed-db.mjs
Get-ChildItem db\seed\*.sql | Sort-Object Name | ForEach-Object { Get-Content -Raw $_.FullName } | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

psql as `sad` above is admin access for maintenance. It is not backend runtime, which connects as `sad_app`.

The seed uses `ON CONFLICT DO NOTHING`. Re-applying it adds missing rows but does not update existing ones. Do not use `docker compose down -v`; it deletes named volumes.

## Tests

| Area | Command | Last result |
| --- | --- | --- |
| Frontend self-checks | `node --experimental-strip-types src/lib/grc.check.ts` (same for `src/lib/xlsx.check.ts`, `src/features/dashboard/stats.check.ts`, `src/features/traffic/graph.check.ts`, `src/features/documents/version-history.check.ts`, run from `frontend/`) | 5 of 5 PASS (2026-10-27) |
| Backend self-checks | `node backend/<name>.check.mjs` for `audit-purge`, `auth`, `csf-order`, `protection`, `session`, `traffic`, `uploads` | `csf-order` and `traffic` PASS (2026-10-27). Predates RBAC, not re-run. No recorded result for the other five |
| Frontend lint and build | `npm run lint`, `npm run build` (in `frontend/`) | Build PASS. Lint 0 errors, 2 `react-refresh` warnings (2026-10-26) |
| Frontend browser tests | `npm test` (in `frontend/`, Vitest with headless Chromium) | 107 of 109 PASS. 2 failures in `src/context/search-provider.test.tsx`: expect search options "Tasks" (no such item in sidebar data) and "Settings Account" (label built from sidebar parent and sub-item in `command-menu.tsx`; failure cause not re-verified) (2026-10-26) |
| Crypto Go unit tests | `docker run --rm -v "${PWD}\cryptography-service\encryption-services:/src" -w /src golang:1.21-alpine sh -c "go vet ./... && go test -count=1 -v ./..."` | `go vet` PASS. Seven `main_test.go` tests PASS (2026-10-26). The 2026-10-26 record does not list results for the eight `traffic_test.go` tests |
| Crypto Go unit tests | `go test ./...` from `cryptography-service/encryption-services/` | TPM mode tests recorded separately; see cryptography-service README |
| Integration | Stack healthy, `127.0.0.1:8088` 200, `/api/health` 200, `/api/grc` 200, file download 200 | PASS (2026-10-26). Predates session/RBAC, not re-run. `/api/grc` and file download now return 401 without a session |
| TPM-rooted e2e (software TPM harness) | `bash e2e.sh` (run from `cryptography-service/`) | 22/22 PASS on last run |
| keyd unit tests, including `acceptance_memory_dump_kek_dek_absent_after_zeroize` (`key-container/src/memdump_test.rs`, Linux only) | `cargo test` (in `cryptography-service/key-container/`) | 17/17 PASS on last run (`rust:1.85-bookworm` container) |
| Hardware acceptance (operator, real TPM with PIN) | `.\hw-acceptance.ps1` (run from `cryptography-service/`) | Not yet run |

configure.sh prints PASS and FAIL lines only. It never prints shares, the root token, private keys, the role ID, or plaintext DEKs.

## Deployment (CI/CD)

`.github/workflows/deploy.yml` runs on pushes to `main` and on manual dispatch. It uses a self-hosted runner with labels `self-hosted`, `linux`, and `vps`, and deploys to `/opt/secure-asset-doc`. The VPS compose setup is root `compose.yaml` plus `cryptography-service/compose.vps.yaml` (vTPM overlay).
The CI workflow (`.github/workflows/ci.yml`) also has a `tpm-swtpm` job using `cryptography-service/compose.ci.yaml`. This CI-only software TPM is separate from both the VPS overlay and the native laptop path.

Job graph:

1. `sync`: copies the checkout to `APP_DIR`, excluding `.git/`, `.env`, `cryptography-service/run/`, and `db/CREDENTIALS.md`.
2. `build-frontend`, `build-backend`, `build-keyd-tpm` (keyd and tpm-msk), `build-crypto-api`: run in parallel after `sync`.
3. `deploy` (environment `production`): writes `.env`, prepares the TPM zone, starts services, approves keyd's delivery key, runs the health check, and seeds the database.

GitHub `production` environment settings:

- Secrets, required: `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `DEMO_USER_PASSWORD`, `TPM_MSK_PIN`.
- Variables, required: `POSTGRES_USER`, `POSTGRES_DB`.
- Variables, optional: `APP_ORIGINS`, `MSK_CRYPTOPERIOD_DAYS`.

What `deploy` does:

- Writes `.env` from these values. Values containing a single quote or newline fail the run.
- Prepares the TPM zone. PKI is generated only when `run/pki/keyzone/ca.pem` is missing. `tpm-msk init` runs when no key file exists. `kek-01` is created if it is missing, checked on every deploy.
- Reads keyd's `delivery key fingerprint` from its logs and starts `tpm-msk` with `TPM_MSK_APPROVE_FP` set to that value.
- Polls `http://127.0.0.1:8088/api/health`.
- Seeds data and demo users only when the `users` table is empty. On later deploys, existing data is kept. `protect-documents` and `tokenize-titles` run on every deploy and skip rows already done.

What persists across deploys on the server:

- PostgreSQL data (`pgdata` volume).
- `swtpm-state` (vTPM state) and `tpm-msk-data` (TPM service data) volumes.
- `cryptography-service/run/` (PKI, PIN file, audit logs, keyd public key).

Warnings:

- Never run `docker compose down -v` on the VPS. It deletes the vTPM and MSK state, so all wrapped keys become unrecoverable, and it deletes the database volume.
- `TPM_MSK_PIN` must not change after the first deploy. The MSK is bound to the PIN.
- After a VPS reboot, re-run the deploy workflow. keyd generates a new delivery key on each start, and `tpm-msk` approves that key only during a deploy.

## Audit log retention

- PATI can purge audit-log entries older than a cutoff date from the audit log page.
- The purge requires typing `PURGE AUDIT BEFORE YYYY-MM-DD` exactly.
- Before the purge, the user can optionally download the matching entries as CSV. The download runs in the browser.
- Each purge writes a `purge` audit record with the actor, cutoff, and deleted count. Purge records cannot be deleted.
- The database enforces the rule. Function `purge_audit_events(text, timestamptz)` in `db/init/007_audit_purge.sql` is the only path that deletes `audit_events` rows. Trigger function `reject_audit_mutation()` rejects UPDATE, DELETE, and TRUNCATE unless the function sets `audit.purge_ok`, and never allows deleting `purge` rows. Role `sad_app` has SELECT only on `audit_events` and no direct DELETE. It can execute the function.
- Known limit: the PATI check is in the app layer (`backend/audit-purge.mjs`). Role `sad_app` can call `purge_audit_events` directly, bypassing that check.
- Apply `007_audit_purge.sql` manually to a live database, as admin, as the file header states.

## Repository layout

| Path | Contents |
| --- | --- |
| `frontend/` | Vite, React 19, TanStack Router and Table, Tailwind CSS 4, shadcn/ui on Radix, Recharts. `nginx.conf` proxies `/api/` to `backend:3000`. Dockerfile builds to nginx-unprivileged. Ships no sample data; hydrates from `/api/grc`. Also `public/`, `scripts/` (`make-sample-xlsx.py`), `demo/` |
| `backend/` | Node 24 `node:http` API (`server.mjs`), `pg` client, traffic recorder (`traffic.mjs`), file protection (`protection.mjs`), uploads (`uploads.mjs`), self-checks |
| `db/` | `init/001_schema.sql` to `init/017_ui_additive.sql`. `compose.yaml` mounts `init/` to `/docker-entrypoint-initdb.d`; the postgres image runs these scripts only on first init of an empty `pgdata` volume. Files whose headers say "Manual apply" must also be applied to existing volumes as admin. `scripts/seed-db.mjs` (regenerates the seed), `scripts/protect-documents.mjs` (document protection), `scripts/protect-fields.mjs` (field protection), `scripts/seed-users.mjs` (demo accounts), `scripts/tokenize-titles.mjs` (title and file name tokenization) |
| `db/seed-files/` | Sample files used by the seed (`db/scripts/seed-db.mjs`). Not served by the app |
| `cryptography-service/encryption-services/` | TPM-only Go crypto API, tests, `Dockerfile`, `README.md` |
| `docs/versi-lama/crypt-module-vault/` | Legacy Vault crypto module, `docker-compose.yml`, `functional.ps1`, `setup.sh`, and README |
| `cryptography-service/tpm-services/` | Go module `tpm-msk` (TPM 2.0 CLI and delivery service): `cmd/`, `internal/`, own `README.md` |
| `cryptography-service/key-container/` | Rust keyd, the key container for TPM-rooted mode. Run `cargo test` |
| `cryptography-service/compose.yaml` | TPM-rooted topology, project `crypto-tpm`, included by root `compose.yaml` |
| `cryptography-service/e2e.sh` | End-to-end test with a software TPM harness |
| `cryptography-service/hw-acceptance.ps1` | Hardware acceptance walkthrough with a real TPM and PIN |
| `docs/versi-lama/key-zone/` | Legacy Vault configuration, archive only |
| `docs/` | `RUN.md` (run guide), `SECURITY-DESIGN.md` (security design and blueprint conformance), `access-levels.md` (access model, Indonesian), `service-traffic-visualization.md` (traffic map guide), `tpm-development-crypto-service.md` (TPM blueprint), `screenshots/`, `versi-lama/` (pre-blueprint Vault docs) |
| `ref/` | Reference image (`details style.jpg`) |
| `.verification/` | Review screenshots and their capture scripts (`access-capture.mjs`, `contrast-probe.mjs`) |
| `.github/` | CI, deploy, and stale workflows, issue and PR templates, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` |
| `compose.yaml` | Root compose includes `cryptography-service/compose.yaml`; TPM-only stack, no Vault services |
| `DEMO.md` | Five-minute demo script (Indonesian) |
| `.env.example` | Template for root `.env`, copied in Quick start |
| `CHANGELOG.md`, `cz.yaml` | Changelog and Commitizen config |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | MIT license and third-party notices |

The three parts under `cryptography-service/` (`encryption-services/`, `tpm-services/`, `key-container/`) are described in [cryptography-service/README.md](../cryptography-service/README.md).

## Hardware used

| Item | Detail |
| --- | --- |
| Laptop | Lenovo ThinkPad X1 Carbon, Intel Core Ultra 7 265U |
| TPM | Discrete TPM 2.0 (dTPM), built in from the factory |
| OS | Windows 11 |
| RAM | 64 GB |
| Storage | SSD 1 TB |

