# Backend

## Service traffic

`GET /api/traffic` returns live edge stats for the service map.

Response:

```json
{ "ts": 1793030000, "edges": [{ "source": "frontend", "target": "backend", "rps": 12.4, "errorRate": 0, "avgMs": 35 }], "down": ["crypto-service"] }
```

- Edges: `frontend>backend`, `backend>db`, `backend>crypto-service`, `client>crypto-service`. The backend-owned edges are always present with zero defaults; crypto-service edges are included only when its `/internal/traffic` fetch succeeds.
- `down`: `crypto-service` if its `/internal/traffic` fetch fails (crypto-service edges are omitted); `db` if `SELECT 1` fails.
- Window: 10s. Metadata only (IDs, counts, durations, status class).
- Limits: 5 req/s global token bucket, excess -> `429 {"error":"rate_limited"}`. In-memory, resets on restart. Requires a valid session cookie; without one, returns `401 {"error":"unauthenticated"}`.
- Self-check: `node backend/traffic.check.mjs`.

## Uploads

Files are sealed by crypto-service (`CRYPTO_URL`, default `https://crypto-api:2796`). Only ciphertext is stored in `uploaded_files`.

`POST /api/uploads` (`Content-Type: application/json`)

Request: `{ "name": "a.pdf", "mime": "application/pdf", "data": "<std base64>" }`

Response `201`: `{ "id": "<uuid>", "name": "a.pdf", "mime": "application/pdf", "size": 1234, "uploadedAt": "2026-10-28T00:00:00Z", "uploadedBy": "<username>" }`

- Errors: `400 {"error":"bad request"}`, `408 {"error":"timeout"}`, `413 {"error":"too large"}`, `415 {"error":"unsupported media type"}`, `429 {"error":"rate_limited"}`, `502 {"error":"crypto unavailable"}`, `503 {"error":"unavailable"}`.
- Limits: body 14 MiB, file 10 MiB, 2 req/s (burst 2). Mime allowlist: PDF, PNG, JPEG, plain text. Magic bytes checked. Name: basename, max 200 chars, no control chars.

`GET /api/uploads`: list, newest first, max 50. Response `200` array of `{id, name, mime, size, uploadedAt, uploadedBy}`. `uploadedBy` is the username, or null if unknown.

- Errors: `403 {"error":"forbidden"}` (tier lacks `upload.r`).

`GET /api/uploads/:id/content`: raw file bytes. Headers: `Content-Type` (stored mime), `Content-Length`, `Content-Disposition: inline; filename*=UTF-8''...`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`, `Cache-Control: no-store`.

- Errors: `403 {"error":"forbidden"}` (tier lacks `upload.r`), `400 {"error":"bad request"}` (id not UUID), `404 {"error":"not found"}`, `502 {"error":"crypto unavailable"}`, `503 {"error":"unavailable"}`.
- Self-check: `node backend/uploads.check.mjs`.

## Protection

Files: `protection.mjs` (`protectionFor` TLP mapping, `INTEGRITY_ERROR`), `protection.check.mjs` (run with `node backend/protection.check.mjs`).

- `protectionFor(tlp)`: `CLEAR` -> `integrity`. `GREEN`, `AMBER`, `AMBER+STRICT`, `RED`, `RED+STRICT` -> `encrypted`. Unknown TLP throws `unknown tlp`.
- `INTEGRITY_ERROR` = `integrity check failed`.

### Read path: `GET /api/files/:doc/:ver`

- `none`: served as stored.
- `integrity`: HMAC verified over the stored base64 (crypto-service `/verifyhmac`).
- `encrypted`: unsealed (`/unsealfile`), then tag verified over the recovered base64.
- Bytes are never sent when a check fails.

Errors:

- Integrity check fails: `500 {"error":"integrity check failed"}`.
- Crypto unavailable: `503 {"error":"crypto unavailable"}`.
- Other crypto failure: `502 {"error":"crypto failure"}`.

### Startup warning

At startup, the backend logs `WARN: <n> GREEN+ document versions unprotected; run db/scripts/protect-documents.mjs` when versions with TLP above `CLEAR` still have `protection='none'` and stored content. Those versions are served without a check. The check runs once at startup, not per request. If the query fails, it logs `WARN: protection check skipped`.

To fix, see db/README.md, section Protecting documents. Use `--dry-run` first. Admin credentials come from `PG*` environment variables only. Do not commit them.

## TLP and read ceiling

- `TLP_ORDER` in `auth.mjs`: CLEAR, GREEN, AMBER, AMBER+STRICT, RED, RED+STRICT.
- `canReadLevel(level, tlp)` reads TLP index <= `min(level, 4)`. RED+STRICT is never readable by level; only an active grant opens it (`hasGrant` in `server.mjs`, `grantedIds` argument of `filterGrc` in `grc-filter.mjs`).
- Unknown TLP throws in `tlpRank`. Unknown level or TLP makes `canReadLevel` return false. `can()` returns false for every permission of an unknown rank; its access flags still derive from level and officer flag.

## Levels

`levels.mjs`:

- `validateRaise(input, currentLevel)`: pure pre-check mirroring `request_level_change`. Returns null, or the failing field name (or `unchanged` / `not-raise`).
- `makeLevelRoutes(deps)`: factory. Returns `requestRaise`, `listRequests`, `decideRaise`, `lowerLevel` (wired in `server.mjs` as `levelRoutes`).
- `requestRaise`: `POST /api/users/:username/level-requests`. Raise, or delegates to `lowerLevel` when the level is lower.
- `listRequests`: `GET /api/level-requests`. `decideRaise`: `POST /api/level-requests/:id/decision`.
- `lowerLevel`: immediate lower via `lower_user_level`.

Rules:

- Raise request: security officer only (DB). Approve: commander only. Deny: commander or officer.
- No self-change: requester, target, and approver are checked.
- Lowering is immediate. Target sessions are deleted on apply and on lower.
- Required fields: `justification`, `screeningVerified` and `screeningRef` (PS-3), `accessAgreementSigned` and `accessAgreementDate` (PS-6), `reviewDue` within 12 months (AC-2), `fips199Basis` (AC-3(2)).
- FIPS 199 basis: level 1-2 LOW, 3 MODERATE, 4-5 HIGH.
- Audit rows carry `changes.controls`: AC-2, AC-3(2), AC-5, AC-6, PS-3, PS-6, AU-2, AU-3. This is a design mapping, not compliance evidence.

## Access requests

- Routes: `GET /api/access-requests`, `POST /api/documents/:id/access-requests`, `POST /api/access-requests/:id/decision`.
- Commander (level 5) and security officer must both approve, in any order. Requester and grantee cannot approve (403). A duplicate or already-taken role gets 409.
- Deny closes the request. Both approvals write the grant (`decide_access_request`, `010_red_strict_dual_auth.sql`).
- Revoke by either role (`revoke_document_access`) sets `revoked_at` and applies on the next request. No session deletion.

## Grants

- `GET /api/documents/:id/grants` and `DELETE /api/documents/:id/grants/:username` (204). Both gate on `canManage`: level 5 or `securityOfficer`. Others get 403.
- `POST /api/documents/:id/grants` is removed. The path now returns 405.
- `010_red_strict_dual_auth.sql` revokes EXECUTE on `grant_document_access` from `sad_app`. New grants come only through access requests.

## `/api/me` and `/api/users`

- `/api/me` (`meJson` in `session.mjs`) returns `accessLevel`, `tlpMax`, `securityOfficer`, `unit`, `unitHead`, and `can.access` = `{grant, request, approve, revoke}`. `grant` is level 5 only. The others are level 5 or officer.
- `/api/users` returns `username, name` (string|null), `rankName, golongan, accessLevel, unit, unitHead, securityOfficer`. Gated by `canManage`.
- `unit` and `unitHead` are labels only. No authorization path uses them. `unit_head` allows one head per unit (`012_unit_head.sql`).

## Restricted documents

- `GET /api/grc` calls `filterGrc` (`grc-filter.mjs`). Unreadable documents are removed, with their evidence links, asset links, and audit events that reference them. Audit events whose summary or changes text contains a hidden ID are dropped too.
- Security officers only: `restrictedDocuments` lists `{id, tlp, createdAt, versionCount, grantees}`. `createdAt` is the earliest version date. No title, file name, or content.
- Level 5 without the officer flag gets no `restrictedDocuments`.

## Fail closed

- Unknown TLP throws (`tlpRank`, `protectionFor`). `canReadLevel` returns false for unknown level or TLP.
- `can()` returns false for every permission of an unknown rank. `authorize()` returns false for unknown rank or action.
- `verifyPassword` returns false on any error. `/api/files/:doc/:ver` returns 404 above the ceiling with no grant.
- `revealTokens` falls back to the masked part on crypto failure, never the token.
- SQLSTATE 42501 maps to 403 (audited) in grant and level routes. Unknown SQLSTATE rethrows. P0002 maps to 404, 22023 to 400, and 23505 and 55000 to 409.
