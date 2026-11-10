# keyd

Environment defaults:

- `KEYD_PUBKEY_FILE=/run/keyd-pub/delivery.pub.pem`
- `KEYD_AUDIT_FILE=/var/log/keyd/audit.jsonl`
- `KEYD_SOCKET=/run/keyd/keyd.sock`
- `KEYD_DEK_STORE=/var/lib/keyd/deks.json`
- `KEYD_ALLOWED_UID=65532`
- `TPM_SERVICE_ADDR=host.docker.internal:2798`
- `TPM_CA_FILE=/pki/ca.pem`
- `TPM_CLIENT_CERT=/pki/crypto-service.pem`
- `TPM_CLIENT_KEY=/pki/crypto-service-key.pem`
- `KEK_ID=kek-01`, `KEK_VERSION=1`

Unix socket uses newline-delimited JSON requests and responses.

Run with a read-only root filesystem, `--cap-drop ALL --cap-add IPC_LOCK`, `--ulimit core=0`, and no PID sharing. Writable volumes: `/var/lib/keyd`, `/var/log/keyd`, `/run/keyd`, `/run/keyd-pub`.

## Key TTL

- `KEYD_DEK_TTL` (seconds). Default `300`.
- Valid range `31..=300` seconds; other values fail startup.
- Cache expiry uses the shorter of boot-time and realtime elapsed; effective lifetime subtracts 5–30 seconds of jitter.
- Docker Compose sets the container `memlock` ulimit for per-secret `mlock`.

## Operations

Protocol: one JSON object per line. Absent response fields are omitted.

Request fields: `id` (8-64 chars, ASCII alphanumeric or `-`, required), `op`, `plaintext` (base64), `dek_id` (`d` + 16 lowercase hex), `iv` (base64, 12 bytes), `ct` (base64), `message` (base64).

| op | Request | Response |
|---|---|---|
| `encrypt` | `{"id","op":"encrypt","plaintext"}` | `ok`, `dek_id`, `iv`, `ct` |
| `decrypt` | `{"id","op":"decrypt","dek_id","iv","ct"}` | `ok`, `plaintext` |
| `hmac` | `{"id","op":"hmac","message"}`, optional `dek_id` | `ok`, `dek_id`, `mac` |

- `encrypt` uses the active data DEK for the current year. Creates it if missing.
- `decrypt` requires `dek_id` to refer to a data-purpose DEK.
- `hmac` uses `dek_id` to pick a specific mac DEK. `mac` is HMAC-SHA256, base64.

## Error codes

| Code | Cause |
|---|---|
| `bad_request` | Malformed JSON, invalid `id` or `dek_id`, bad base64, wrong `iv` length, unknown `op`, line over 14 MiB |
| `bad_cipher` | Unknown `dek_id` or wrong purpose, GCM auth failure, DEK unwrap failure |
| `unavailable` | KEK fetch or delivery failure over TPM link, cache load failure, active key unavailable |
| `internal` | RNG failure, DEK persist failure, encrypt failure |

## File modes

- `deks.json` and `audit.jsonl` are created with mode `0600`.
- Socket is set to `0600`.
- Pre-existing files keep their existing mode.
