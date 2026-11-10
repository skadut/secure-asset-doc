# Key Zone simulation

Three-node Vault Community cluster (1.18.5, official `hashicorp/vault` image): integrated Raft, Shamir 3-of-5 unseal, internal mTLS, Transit KEK, AppRole and audit devices. It implements the **Vault** portions of `docs/Crypto_Module_Management.md`: architecture/sizing (§Architecture); key hierarchy/lifecycle (§Key hierarchy, §Key lifecycle); mTLS and least-privilege policy (§Access control, network and container hardening); Raft, unseal and audit (§Operations). It does not implement the Go crypto module, database, snapshots, SIEM shipping, LUKS/TPM, or FIPS validation.

## Services

| Service | Role | IP | Volume |
|---|---|---|---|
| vault-1 | Vault node, Raft peer | 172.30.10.11 / 172.30.20.11 | `keyzone-raft-1` |
| vault-2 | Vault node, Raft peer | 172.30.10.12 / 172.30.20.12 | `keyzone-raft-2b` |
| vault-3 | Vault node, Raft peer | 172.30.10.13 / 172.30.20.13 | `keyzone-raft-3b` |
| vault-certs | One-shot simulation PKI generator | - | - |
| vault-bootstrap-dash | Dashboard for init, unseal and key logs | 172.30.20.20 | `keyzone-dash-data` |

Networks: vault nodes sit on `key-zone` (172.30.10.0/24, internal) and `key-zone-service` (172.30.20.0/24). The dashboard is on `key-zone-service` and `keyzone-dash` (publishes `127.0.0.1:8090`). No Vault host ports are published.

Audit volumes: `keyzone-audit-1/2/3`. Custodian volume: `keyzone-custodians` holds role_id in both modes; share-N files only in unsafe mode. Crypto-service connects with `VAULT_ADDRS=https://vault-1:8200,https://vault-2:8200,https://vault-3:8200`.

## KEYZONE_MODE

Default `safe`. Both modes use Vault Transit DEK/KEK for crypto-service. The mode only controls Shamir unseal.

- `safe`: Shamir shares are never stored. After restart, nodes stay sealed until custodians enter 3 shares in the dashboard.
- `unsafe`: shares are stored in volume `keyzone-custodians`. The dashboard auto-unseals on start and restart.

## Dashboard

- URL: http://127.0.0.1:8090
- Token: `KEYZONE_DASH_TOKEN`, set in root `.env`.
- Ceremonies:
  - init: first start. Initializes Vault and runs one-shot config (Transit, AppRole, audit, cert auth).
  - unseal: 3 shares (safe mode).
  - reveal, store and destroy shares; rekey.
  - key logs.
- Configure steps report PASS/FAIL. Init and safe-mode rekey responses include shares; `POST /api/shares/reveal` returns stored shares when available.

## Commands

Run from repo root.

```sh
docker compose up -d --build
docker compose ps
docker compose logs vault-1
docker compose logs -f vault-2
docker compose restart vault-1 vault-2 vault-3
docker compose exec vault-1 vault status
docker compose exec vault-1 sh
```

## Migration (one-time)

- `vault-1` keeps existing single-peer Raft data in `keyzone-raft-1`.
- `vault-2` and `vault-3` start empty and join via `retry_join`.
- Old `keyzone-raft-2` and `keyzone-raft-3` volumes are untouched backups.

## Simplifications

- 3-node Raft: HA, quorum of 2 of 3 required.
- Each node capped at 512 MB, swap off. The doc specifies 2 vCPU/4 GB per node.
- `disable_mlock` because all capabilities are dropped. The doc adds IPC_LOCK instead, so host swap should be off.
- Local volumes and generated custodian shares replace encrypted media, encrypted node disks/TPM, backups, SIEM shipping and real offline custody.
- Audit devices are local stand-ins. Key network is internal-only, so no audit egress.
- Certificates are simulation PKI, not a production PKI.
- Vault Community is not FIPS 140-3 validated.

## Recovery

If first-init fails after initialization, the root token is lost by design. Recovery requires `vault operator generate-root` with 3 shares, entered interactively by custodians: from volume `keyzone-custodians` (unsafe mode) or entered in the dashboard (safe mode). Do not put a generated token in shell history or logs.
