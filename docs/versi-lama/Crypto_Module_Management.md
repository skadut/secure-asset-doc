# Crypto Module Key Management Architecture

Oct 26, 2026 · @amerta

## Overview

The Go crypto module encrypts data with per-object DEKs, and every DEK is wrapped by a KEK that never leaves a self-hosted Vault Transit engine. Everything runs on-premise with no HSM and no cloud dependency.

**Scope:** key generation, wrapping, use, rotation and destruction for the crypto module container service. Out of scope: TLS PKI design and application-level authorization.

**Design principles**

- **Separation of keys:** the module holds plaintext DEKs only in locked memory, for one operation. It never holds the KEK.
- **NIST-aligned, not NIST-certified:** algorithms, key sizes and lifecycle follow NIST guidance. Formal FIPS 140-3 validation is listed as an upgrade path, not a day-one requirement.
- **Minimum moving parts:** one 3-node Vault cluster, one crypto module service, one database. No service mesh, no extra key brokers.
- **Fail closed:** if Vault is sealed or unreachable, the module stops encrypting and decrypting rather than falling back to a local key.

## NIST baseline

Eight NIST publications set the rules; each one maps to a concrete design decision below.

| Standard | What it governs | Decision in this design |
| --- | --- | --- |
| FIPS 197 | AES block cipher | AES-256 for both KEK and DEK |
| SP 800-38D | GCM mode | AES-256-GCM, 96-bit random nonce, 128-bit tag, AAD binds context |
| SP 800-38F | Key wrapping | DEK wrapped by KEK with an approved authenticated-encryption mode (Vault Transit AES-256-GCM96) |
| SP 800-57 Pt 1 Rev 5 | Key management, cryptoperiods | Two-tier KEK/DEK hierarchy, defined cryptoperiods, key states |
| SP 800-133 Rev 2 + SP 800-90A | Key generation, random bits | Keys come only from the OS CSPRNG via Go crypto/rand; no derived or hard-coded keys |
| SP 800-131A Rev 2 | Algorithm and key-length transitions | Only AES-256 and SHA-256 or stronger; no legacy algorithms |
| FIPS 140-3 (zeroization) | Destruction of unprotected secrets | Plaintext DEKs wiped immediately after use, locked memory, no swap or core dumps |
| SP 800-53 Rev 5 | Security controls | SC-12, SC-13, SC-28, AC-6, AU-2/AU-9, CP-9 mapped in the last section |

SP 800-88 Rev 1 also applies when Vault or database disks are decommissioned: purge or destroy, never just delete.

## Architecture

Three network zones and one offline group; the only path to the KEK is the module's unwrap call into the key zone.

&#91;embedded content: on-prem architecture · 3 network zones, 6 components\]

The module sends a wrapped DEK to Vault and gets the plaintext DEK back for one operation; the database holds only wrapped DEKs and ciphertext, and custodians hold the shares that unseal Vault after a restart.

| Component | Runs as | Minimum sizing |
| --- | --- | --- |
| Crypto module | Go container, 2+ replicas | 1 vCPU, 512 MB each |
| Vault | 3 VMs or bare-metal nodes, integrated Raft storage | 2 vCPU, 4 GB, SSD each |
| Database | Existing DB platform | No change; stores wrapped DEKs as a column |
| SIEM | Existing log platform | Receives Vault audit logs |

Sizing is a starting point for moderate load; measure unwrap latency and adjust.

## Key hierarchy

Four tiers, each protected by the one above it; only the bottom tier ever reaches the crypto module, and only in plaintext for one operation.

| Tier | Key | Algorithm | Lives in | Plaintext ever visible to | Cryptoperiod (SP 800-57) |
| --- | --- | --- | --- | --- | --- |
| 0 | Vault unseal shares | Shamir 3-of-5 | 5 custodians, offline | Vault process at unseal only | Rekey on custodian change, at least yearly |
| 1 | Vault root and barrier keys | AES-256-GCM | Vault storage, encrypted by tier 0 | Vault memory only | Barrier key rotated yearly (`vault operator rotate`) |
| 2 | KEK (`transit/keys/crypto-module-kek`) | AES-256-GCM96 | Vault Transit, `exportable=false` | Vault memory only | New version every 12 months (auto-rotate), old versions decrypt-only |
| 3 | DEK | AES-256-GCM | Database, wrapped by KEK | Crypto module locked memory, one operation | One DEK per tenant or object; re-key at 12 months or 2^32 encryptions, whichever first |

**Rules**

- The KEK is created non-exportable and with `allow_plaintext_backup=false`, so no API call can read it out.
- Each wrapped DEK carries its KEK version prefix (`vault:v3:…`), which tells the module which KEK version unwraps it.
- `min_decryption_version` is raised after every rewrap campaign, so retired KEK versions stop working.
- A DEK never protects another key; a KEK never encrypts data directly (SP 800-57 single-purpose rule).

## Key lifecycle and data flows

Every DEK operation is one round trip to Vault plus local AES-GCM; the KEK side of each flow happens entirely inside Vault.

**Generate a DEK** (new tenant or object)

1. Module calls `transit/datakey/wrapped/crypto-module-kek` with `bits=256`.
2. Vault generates the DEK from its CSPRNG, wraps it with the current KEK version, and returns only the wrapped form.
3. Module stores the wrapped DEK in the database. No plaintext DEK exists anywhere yet.

**Encrypt**

1. Module reads the wrapped DEK and calls `transit/decrypt/crypto-module-kek`.
2. Vault unwraps it; the module moves the plaintext DEK into a memguard locked buffer.
3. Module encrypts with AES-256-GCM: fresh 96-bit random nonce, AAD = tenant ID + record ID + schema version.
4. Module destroys the DEK buffer (zeroized) and stores `{wrapped DEK, nonce, ciphertext}`.

**Decrypt**

1. Same unwrap as encrypt, steps 1 and 2.
2. AES-256-GCM open with the same AAD; any tag mismatch returns one generic error.
3. DEK buffer destroyed before the plaintext is returned to the caller.

**Rotate**

1. KEK: Vault auto-rotates yearly. New wraps use the new version immediately.
2. Background job calls `transit/rewrap` on stored DEKs; the DEK and the data stay unchanged.
3. When no wrapped DEK uses an old version, raise `min_decryption_version`.
4. DEK: on its cryptoperiod, generate a new DEK and re-encrypt that tenant's data in batches.

**Destroy**

- Plaintext DEK: zeroized after every operation (next section).
- Wrapped DEK: deleting it from the database is crypto-shredding; the data becomes unrecoverable.
- KEK version: trimmed with `transit/keys/.../trim` once below `min_decryption_version`.

| SP 800-57 key state | KEK (Transit version) | DEK |
| --- | --- | --- |
| Active | Latest version: wraps and unwraps | In use for encrypt and decrypt |
| Deactivated | Older version: unwrap only | Decrypt only, after re-key |
| Compromised | Rotate now, rewrap all, raise min version | Re-key tenant, re-encrypt, revoke wrapped copy |
| Destroyed | Trimmed from keyring | Wrapped copy deleted |

## Zeroization mechanism

A plaintext DEK lives only in a memguard locked buffer and is wiped the moment one encrypt or decrypt finishes; every exit path, including panics and signals, triggers a wipe.

**How the buffer is protected**

- `mlock`: the page cannot be swapped to disk.
- Guard pages and a canary around the key: overflows crash the process instead of leaking.
- Core dumps disabled by memguard at start-up.
- Optional cache: a DEK kept between calls is held as a memguard Enclave, encrypted in memory, with a short TTL (60 s suggested; 0 disables the cache).

| Trigger | What gets wiped | Code path |
| --- | --- | --- |
| End of each operation | That DEK buffer | `defer dek.Destroy()` in `Encrypt` and `Decrypt` |
| Cache TTL expiry | Cached enclave entry | `fromCache` evicts on read |
| KEK rewrap | Cached copy of that DEK | `RewrapDEK` calls `evict` |
| SIGINT, SIGTERM, panic | All buffers and enclaves | `memguard.CatchInterrupt()` + `defer memguard.Purge()` in `main` |
| Security event (Vault sealed, auth revoked) | All cached DEKs | `Manager.Purge()`, called by the health watcher |

**Residual gaps in Go, and how they are handled**

- The Vault client decodes the unwrap response into Go strings, which cannot be wiped. Fix: parse the HTTP body directly into a locked buffer with a small custom client (recommended before production).
- `crypto/aes` keeps the expanded round keys in ordinary heap memory until garbage collection. Accepted risk: the cipher object is scoped to one call and swap is off, so the copy is short-lived and never reaches disk.
- No `[]byte` to `string` conversion of key material anywhere; enforced by code review and a lint rule.

## Access control, network and container hardening

The module can only wrap, unwrap and rewrap with one named KEK, over mTLS, from one network segment; nothing else in Vault is reachable to it.

**Vault policy for the module** (least privilege, SP 800-53 AC-6)

```hcl
path "transit/datakey/wrapped/crypto-module-kek" { capabilities = ["update"] }
path "transit/decrypt/crypto-module-kek"         { capabilities = ["update"] }
path "transit/rewrap/crypto-module-kek"          { capabilities = ["update"] }
```

No `read` on `transit/keys/*`, no `export`, no `encrypt` (the module never wraps its own keys). Key administration (rotate, config, trim) is a separate admin policy, used by people, not services.

**Authentication**

- AppRole with `secret_id` bound to the module's subnet (`secret_id_bound_cidrs`), short TTL, and `secret_id_num_uses` limited.
- `role_id` baked into the deployment; `secret_id` delivered at deploy time as a tmpfs-mounted file, never an environment variable.
- Vault tokens: TTL 1 h, renewed by the module, re-login on expiry.

**Network**

| Zone | Contains | Allowed in | Allowed out |
| --- | --- | --- | --- |
| Key zone (VLAN) | Vault cluster (3 nodes) | Module subnet on 8200, Vault peers on 8201 | Nothing, except audit log shipping |
| Service zone | Crypto module containers | Application callers on the module API port | Vault 8200, database |
| Data zone | Database | Module subnet only | Nothing |

All links use mTLS with an internal CA; TLS 1.2 minimum, TLS 1.3 preferred (SP 800-52 Rev 2).

**Container**

- `cap_add: IPC_LOCK` (needed for mlock); drop all other capabilities.
- Read-only root filesystem, non-root user, `no-new-privileges`.
- Memory swap limit equal to memory limit (no swap); host swap off or encrypted.
- Minimal base image (distroless or scratch) with a static Go binary; image signed and scanned in CI.

## Operations

A 3-node Vault cluster with integrated Raft storage, Shamir unseal and daily encrypted snapshots covers availability, recovery and audit without extra infrastructure.

**Vault cluster**

- 3 nodes, integrated storage (Raft): tolerates one node down. No Consul or external database.
- Shamir 3-of-5 unseal. Each node needs 3 custodians after a restart, so plan the custodian on-call rota and keep restarts rare.
- Each node's disk encrypted with LUKS, its key sealed to the host TPM 2.0. A stolen disk is unreadable; the TPM never protects Vault keys directly.

**Backup and disaster recovery** (SP 800-53 CP-9)

| Item | How | Where | Frequency |
| --- | --- | --- | --- |
| Vault Raft snapshot | `vault operator raft snapshot save` (data stays barrier-encrypted) | Separate on-prem site, offline copy | Daily, 30 days kept |
| Unseal shares | 5 shares on separate encrypted media or sealed paper | Different safes and people | On every rekey |
| Database | Normal DB backups (holds only wrapped DEKs and ciphertext) | Standard backup system | Per DB policy |
| Restore test | Restore snapshot to an isolated cluster and decrypt sample data | Lab | Quarterly |

A snapshot is useless without 3 unseal shares, and the database is useless without Vault, so no single backup leaks data.

**Audit and monitoring** (SP 800-53 AU-2, AU-9)

- Two Vault audit devices (file + syslog). Vault refuses requests if no audit device can write, which fails closed.
- Audit entries HMAC request and response values; ship to the SIEM over TLS, append-only storage.
- Alert on: Vault sealed, unwrap error spikes, policy or key config changes, any root token use, KEK nearing its 12-month rotation.
- Root token: revoked after setup; regenerated with 3 custodians only for emergencies.

**Incident: suspected KEK compromise**

1. Rotate the KEK, then rewrap every DEK.
2. Raise `min_decryption_version` past the compromised version and trim it.
3. If DEK exposure is possible, re-key affected tenants and re-encrypt their data.
4. Rekey unseal shares and rotate the barrier key if Vault itself is suspect.

## NIST control mapping, gaps and upgrade path

The design meets the intent of the main SP 800-53 key-management controls today; its one structural gap is that no component is FIPS 140-3 validated yet.

| SP 800-53 Rev 5 control | Met by |
| --- | --- |
| SC-12 Key establishment and management | KEK/DEK hierarchy, Vault Transit lifecycle, cryptoperiods, rotation and rewrap |
| SC-13 Cryptographic protection | AES-256-GCM only, per FIPS 197, SP 800-38D, SP 800-131A |
| SC-28 Protection of information at rest | Data encrypted by DEKs; DEKs stored only wrapped; Vault storage barrier-encrypted |
| SC-8 Transmission confidentiality | mTLS on every link, TLS 1.2 minimum |
| AC-6 Least privilege | Module policy limited to datakey, decrypt, rewrap on one KEK |
| AU-2, AU-9 Audit events and protection | Two Vault audit devices, HMAC entries, append-only SIEM |
| CP-9 System backup | Daily Raft snapshots, split unseal shares, quarterly restore test |
| MP-6 Media sanitization | SP 800-88 purge or destroy on disk decommission |

**Known gaps**

| Gap | Impact | Fix |
| --- | --- | --- |
| Vault Community is not a FIPS 140-3 validated module | Cannot claim FIPS compliance in audits | Vault Enterprise FIPS build, or accept as NIST-aligned |
| Go crypto in default mode | Same as above for the module side | Build with Go's FIPS 140-3 mode (`GOFIPS140`, Go 1.24+); confirm its CMVP certificate status first |
| No hardware root of trust | A full compromise of a running Vault node exposes the KEK in memory | Add a low-cost hardware HSM later (below) |
| Vault client leaves unwrap response in Go strings | Short-lived plaintext DEK copy on the heap | Custom unwrap client parsing into locked memory |
| Shamir unseal needs 3 people per restart | Slower recovery | Acceptable at this scale; revisit with an HSM seal |

**Upgrade path, only when needed**

1. **Compliance required:** switch to Vault Enterprise FIPS build and Go FIPS mode. No design change.
2. **Hardware root wanted:** add a YubiHSM 2 or Nitrokey HSM 2 as Vault's PKCS#11 seal (Vault Enterprise). The KEK hierarchy and the module code stay the same.
3. **Scale grows:** add Vault performance standbys before adding any new component.
