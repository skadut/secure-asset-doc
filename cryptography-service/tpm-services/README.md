# tpm-services

`tpm-msk` now exists here as Go source (module `tpm-msk`), using go-tpm v0.9.8, golang.org/x/term v0.29.0, and golang.org/x/sys v0.30.0. `go.mod` pins `toolchain go1.26.8` because the installed `C:\Program Files\Go` is 1.21.2 and go-tpm needs Go 1.22 or newer; Go automatically uses the toolchain from the module cache or downloads it. It is not wired into compose.

## 0. Check the TPM with built-in Windows tools (no download needed)

Run these in an elevated PowerShell (Run as administrator):

```powershell
tpmtool getdeviceinformation
Get-Tpm
```

Expect `TPM Present: True`, `TPM Version: 2.0`, `Ready For Storage: True`, and `Is Locked Out: False`. Note the `Lockout Counter` and `Max Auth Fail` values. Every wrong PIN later raises the counter.

Checked on this laptop on 2026-11-02: STMicroelectronics ST33KTPM2XSPI, TPM 2.0 (spec 1.59), ready for storage and attestation, not locked out, lockout counter 0 of 32, lockout interval 7200 s, no vulnerable firmware.

## Build tpm-msk.exe

From the `tpm-services` directory, build the binary. `bin/` is gitignored. Set `$exe` once per PowerShell window:

```powershell
cd "D:\_Dev\_hackaton\secure-asset-doc\cryptography-service\tpm-services"
go build -o bin\tpm-msk.exe ./cmd/tpm-msk
$exe = "$PWD\bin\tpm-msk.exe"
```

## 1. Check the binary and the TPM

The earlier hash `551710...6C87` was for a different published binary; it does not apply to a self-built binary. Print the hash of your build. For reference, the build made on 2026-11-02 had the hash below; other Go versions or paths may produce a different hash.

```powershell
(Get-FileHash $exe -Algorithm SHA256).Hash
# 2026-11-02 reference build: FC560D60757FCB714C34FAE6607BBD802F78A44E44DD3DED384DEA1B0E15773D
& $exe selftest
& $exe info
```

`selftest` prints `PASS`, `FAIL`, `SKIP`, and `INFO` lines. Non-admin Windows TBS blocks `TPM2_SelfTest` and `TPM2_GetTestResult`, so those checks show `SKIP` when run non-elevated; run PowerShell elevated to include them. Any `FAIL` means stop. On this laptop on 2026-11-02, all checks passed; those two checks were skipped when run non-elevated. PCR banks: SHA1, SHA256, SHA384, SHA3_256, SHA3_384. Persistent SRK `0x81000001` was present. Lockout counter was 0 of 32, interval 7200 s, `lockoutRecovery` 86400 s, not in lockout.

## 2. Try it with a test key

This uses a throwaway folder and does not touch the real MSK path. Enter a PIN of at least 6 characters when prompted.

```powershell
mkdir "$HOME\tpm-msk-test" -Force | Out-Null
cd "$HOME\tpm-msk-test"

# Create a test MSK inside the TPM (asks for the PIN twice)
& $exe init --key .\test.key

# Create a random 32-byte test DEK
$dek = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($dek)
[IO.File]::WriteAllBytes("$PWD\dek.bin", $dek)

# Wrap and unwrap it (asks for the PIN each time)
& $exe wrap --key .\test.key --label dek/test --in .\dek.bin --out .\dek.env
& $exe unwrap --key .\test.key --in .\dek.env --out .\dek.out

# This should print: True
(Get-FileHash .\dek.bin).Hash -eq (Get-FileHash .\dek.out).Hash
```

If that prints `True`, the TPM works with tpm-msk on this laptop.

## 3. Clean up the test

```powershell
cd "$HOME"
Remove-Item "$HOME\tpm-msk-test" -Recurse -Force
```

Avoid testing wrong PINs more than necessary. Each failure counts toward the TPM's lockout: 32 failures on this laptop; each failure decays after 7200 s.

## 4. Create the real MSK (only after steps 1 to 3 pass)

Choose one option. Both save the key file to `%APPDATA%\tpm-msk\msk.key`, outside this repo. Never copy it into the repo.

### Option A: Generate the key inside the TPM

The key cannot be backed up. Losing the TPM or `msk.key` loses everything wrapped with it.

```powershell
& $exe init
```

### Option B: Import a key generated offline

The key can be recovered on a new machine. A copy exists outside the TPM, so store it securely.

```powershell
$hex = Read-Host "MSK as hex (64 to 128 characters)"
$hex | & $exe init --import
Remove-Variable hex
```

### Back up the key file

The key file only works with this TPM.

```powershell
Copy-Item "$env:APPDATA\tpm-msk\msk.key" "<your backup location>"
```

## Commands

- `tpm-msk kek create --id <id> [--file <path>] [--key <path>]` creates a KEK using the TPM-bound MSK and prompts for the PIN; `--id` is required.
- `tpm-msk kek list [--file <path>]` lists KEK IDs, versions, and creation times without using the TPM.
- `tpm-msk pki --out <dir> [--force]` generates the development PKI in the specified directory; `--out` is required.
- `tpm-msk audit verify <file>` checks an audit log's hash chain without using the TPM. Takes one positional file and no flags.
- `tpm-msk init [--key <path>] [--force] [--import]` creates or imports the MSK and prompts for a PIN. All flags are optional.
- `tpm-msk serve --pki-dir <dir> [--pubkey-file <path>] [--listen <addr>] [--allow-kek <id>] [--audit-file <path>] [--rate <n>] [--demo-ceremony <bool>] [--key <path>]` runs the delivery service. `--pki-dir` is required; `--listen` defaults to `127.0.0.1:2798`.
- `tpm-msk selftest` checks TPM capabilities. Takes no flags.
- `tpm-msk info [--key <path>]` reports TPM and key-file properties.

## Run order

Steps 1-4 run from the `tpm-services` directory.

1. Generate the PKI: `tpm-msk pki --out ..\run\pki`
2. Initialize the MSK: `tpm-msk init` (prompts for a PIN; this is a human step).
3. Create the KEK: `tpm-msk kek create --id kek-01`
4. Start the service: `tpm-msk serve --pki-dir ..\run\pki` (prompts for a PIN and prints `Key ID:` at startup. `pki-dir` is the PKI output root; `pki` creates its `keyzone/` subdirectory. The public-key default resolves to `..\run\keyd-pub\delivery.pub.pem`. The listen address defaults to `127.0.0.1:2798` and can be changed with `--listen`.)
5. Approve the fingerprint: check that it matches the fingerprint printed by keyd/the public key, then answer `y` at the `[y/N]` prompt.

From the `cryptography-service` directory, the step 4 equivalent is `tpm-services\bin\tpm-msk.exe serve --pki-dir run\pki`.

## Firewall

Optional; requires an elevated shell. This blocks inbound TCP 2798 (the default listen port) on this host. Remove it with `Remove-NetFirewallRule -DisplayName tpm-msk-block-2798`.

```powershell
New-NetFirewallRule -DisplayName tpm-msk-block-2798 -Direction Inbound -LocalPort 2798 -Protocol TCP -Action Block
```

## PIN lockout warning

A wrong PIN increments the TPM lockout counter. Run `init` and `serve` only with the correct PIN.

## Compose layout note

The serve public-key default resolves to `cryptography-service\run\keyd-pub\delivery.pub.pem` when run from `tpm-services`, matching compose's `./run/keyd-pub` mount. `pki --out run\pki` (from `cryptography-service`) creates `run\pki\keyzone\` and `run\pki\api\`; pass the `run\pki` root to `--pki-dir`, not `run\pki\keyzone`. `pki` writes both `tpm-service.pem` / `tpm-service-key.pem` (server cert, loaded by `serve`) and `crypto-service.pem` / `crypto-service-key.pem` (client cert, mounted into `keyd` by compose). Compose has no `tpm-service` or `tpm-msk` service, so no compose mount for the server cert is needed.

## Design
Commands: `init` creates or imports the MSK; `wrap` encrypts a DEK into an envelope; `unwrap` decrypts it; `selftest` checks TPM capabilities; `info` reports TPM properties and key-file status.

The MSK is a keyedHash HMAC-SHA256 object created under persistent SRK `0x81000001`, or a transient ECC P-256 SRK if that handle is absent. The MSK never leaves the TPM in clear. The key file is versioned JSON containing `TPM2B_PUBLIC` and `TPM2B_PRIVATE`; the private blob is encrypted by its TPM parent, so it loads only on that TPM and is useless elsewhere. Losing the TPM loses the MSK. The default path is `%APPDATA%\tpm-msk\msk.key`; `--key` overrides it. Windows ACLs restrict the key file to the current user. Existing files are not overwritten without `--force`; writes are atomic.

PINs must be at least 6 characters and are entered twice during `init`, including `--import`. The TPM authValue is SHA-256(PIN). There is no `noDA` attribute: wrong PINs raise the TPM lockout counter. This laptop allows 32 failures; each failure decays after 7200 s. The error is `wrong PIN; failures count toward lockout: X of Y`.

The KEK is `TPM2_HMAC(MSK, "tpm-msk/kek/v1" 0x00 label 0x00 nonce)` using a random 32-byte nonce. AES-256-GCM encrypts DEKs with a 12-byte IV and AAD `"tpm-msk/v1"||label`. The version-1 JSON envelope is `{"v":1,"alg":"HMAC-SHA256+AES-256-GCM","label","nonce","iv","ct"}` with byte fields base64-encoded. DEKs are 1–1024 bytes. Any envelope parse, validation, or decrypt failure reports only `unwrap failed`.

Limits: no PCR binding, key rotation, or export/backup of a generated MSK. HMAC uses a salted session with an SRK salt and AES-128-CFB parameter encryption, so the PIN digest and KEK are not sent in clear on the local TBS bus. Key files from other `tpm-msk` implementations, including the earlier published binary, are not compatible.

## Not covered yet

The `tpm-msk` service is not wired into compose; compose has no `tpm-service` or `tpm-msk` service. The Vault cluster in `../key-zone` still uses Shamir unseal.
