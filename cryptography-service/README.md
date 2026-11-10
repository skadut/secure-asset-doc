# Cryptography services

This directory is part of the root stack. The root `compose.yaml` includes `cryptography-service/compose.yaml` for the TPM-rooted topology (project `crypto-tpm`). Standalone `docker compose -f cryptography-service/compose.yaml` also works for end-to-end testing with `e2e.sh`.

Legacy material is archived under [`docs/versi-lama/`](../docs/versi-lama/); it is not part of the TPM-only stack.

## Encryption services

`encryption-services/` is the TPM-only Go crypto API, providing seal/unseal, HMAC, and tokenization. It runs in `tpm` mode; legacy `safe` and `unsafe` modes belong to the archived Vault stack. See [encryption-services README](encryption-services/README.md).

## TPM services

`tpm-services/` contains `tpm-msk`, a Go CLI that runs natively on the Windows host (not in a container), keeps the MSK in the laptop TPM 2.0, and wraps and unwraps DEKs with it. It is not a compose service. See [tpm-services README](tpm-services/README.md).

The root compose runs the full stack by including this directory's `compose.yaml`.

## TPM-rooted mode (blueprint)

Design: [TPM-Rooted KEK and DEK Blueprint](../docs/tpm-development-crypto-service.md). Standalone topology: [compose.yaml](compose.yaml), project name `crypto-tpm`.

| Component | Where | Role |
|---|---|---|
| TPM | Laptop (Intel PTT) | Holds the MSK, non-exportable |
| TPM service (`tpm-msk`) | Native Windows, `tpm-services/` | PIN, KEK wrap/unwrap, fingerprint approval |
| keyd | Docker, `key-container/` | Rust key container: requests KEKs, unwraps DEKs, AES, zeroize |
| crypto-api | Docker, `encryption-services/` | Go API, mTLS on `:2796`, mapped to `127.0.0.1:2896` |
| Applications | Clients | Call crypto-api with their own client certificate |

Start order, run from `cryptography-service`:

1. `tpm-msk pki --out run\pki` (creates `run\pki\keyzone` and `run\pki\api`)
2. `tpm-msk init`, then `tpm-msk kek create --id kek-01`
3. In PowerShell: `New-Item -ItemType Directory -Force run\audit\keyd, run\audit\crypto-api`
4. `tpm-msk serve --pki-dir run\pki --pubkey-file run\keyd-pub\delivery.pub.pem`, then enter the PIN
5. `docker compose -f compose.yaml up -d --build`
6. Approve the fingerprint shown on the serve console: `docker compose -f compose.yaml logs keyd`
7. Test encrypt:

```bash
curl --cert run/pki/api/app-cert.pem --key run/pki/api/app-cert-key.pem --cacert run/pki/api/ca.pem -H "Content-Type: application/json" -d "{\"Plaintext\":[{\"Text\":\"hello\"}]}" https://127.0.0.1:2896/encrypt
```

8. Verify audit chains:
   - `tpm-msk audit verify run\audit\keyd\audit.jsonl`
   - `tpm-msk audit verify run\audit\crypto-api\audit.jsonl`
   - `tpm-msk audit verify $env:APPDATA\tpm-msk\audit.jsonl`

Or run `.\hw-acceptance.ps1` to walk through these steps and the hardware acceptance checks.

Audit logs under `run\audit` are bind-mounted; the container can still write them (see Known limits).

The app client cert file names (`app-cert.pem`, `app-cert-key.pem`) come from the pki step.

### Laptop hardening (blueprint section 9)

Run these by hand. The tooling does not run them.

```powershell
manage-bde -status          # BitLocker must be On for the system drive
powercfg /h off             # disable hibernation, run in an admin shell
```

Firewall step, verify first:

1. Test before adding any block. Check that keyd (in Docker) can still reach `tpm-msk serve` on TCP 2798 via `host.docker.internal`.
2. The inbound Block rule can block that traffic. If the test in step 1 fails, scope the rule to the Docker/Hyper-V virtual adapter, or rely on loopback binding as blueprint section 9 allows.
3. Only then, and only if verified, add the rule:

```powershell
New-NetFirewallRule -DisplayName "Block TPM service inbound" -Direction Inbound -Protocol TCP -LocalPort 2798 -Action Block   # verify first
```

`.wslconfig` in `%UserProfile%`:

```ini
[wsl2]
swap=0
```

Stop keyd before sleep:

```bash
docker compose -f compose.yaml stop keyd
```

Vault is removed from the root stack. Data starts from zero; see the root README, [Fresh start](../README.md#fresh-start).

## End-to-end test (no hardware TPM)

Run `bash e2e.sh` from this directory. It builds the software TPM-service harness and checks mTLS, crypto round trips, wrapped-KEK handling, DEK expiry/outage behavior, audit chains, log hygiene, throughput, and keyd container hardening. Docker-to-host harness reachability and bind mode are printed in e2e output. It does not initialize or use a hardware TPM. Suspend is approximated with `docker pause` past TTL plus jitter; a real sleep cycle is still manual; hardware TPM testing requires a PIN. `cargo test` scans keyd's own process memory for a known KEK/DEK after zeroize; physical-memory forensics remain untested.

Prerequisites: Git Bash (with `cygpath`), curl, openssl, jq, Go (go1.26.8), Docker Desktop. Ports: 2798 (TPM harness) and 2897 (crypto-api) must be free. `run-e2e/` is wiped each run, and the `crypto-tpm-e2e` compose project volumes are removed before and after the run. The reachability result is printed by e2e.sh.

## Known limits

- Docker Desktop pause and suspend: keyd also checks the realtime clock.
- Audit logs are container-writable, so only the TPM log is TPM-signed.
- Single laptop, no zone separation.
- Go strings holding app plaintext are not wipeable.
- keyd writes one `op.encrypt`/`op.decrypt`/`op.hmac` record per successful request (DEK ID, KEK version); if that write fails the request returns `unavailable`.
