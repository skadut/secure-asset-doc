# Hardware acceptance walk-through for TPM-rooted mode. Run interactively from any directory.
# Logs only status lines, exit codes and HTTP codes. No transcript: PIN prompts must stay off disk.
param([string]$TpmMsk = (Join-Path $PSScriptRoot 'tpm-services\bin\tpm-msk.exe'))

$root = $PSScriptRoot
$run = Join-Path $root 'run'
$compose = Join-Path $root 'compose.yaml'
New-Item -ItemType Directory -Force $run | Out-Null
$log = Join-Path $run ("hw-acceptance-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$results = New-Object System.Collections.Generic.List[object]

function Log-Line([string]$msg) {
    Write-Host $msg
    "$(Get-Date -Format s) $msg" | Out-File -FilePath $log -Append -Encoding utf8
}
function Add-Result([string]$step, [string]$result, [string]$note) {
    $results.Add([pscustomobject]@{ Step = $step; Result = $result; Note = $note })
    Log-Line "[$result] $step - $note"
}
function Heading([string]$t) { Write-Host ''; Log-Line "=== $t ===" }

# Container curl. Body goes in on stdin, response body and HTTP code come back in a variable; nothing is printed.
# crypto-api cert SAN is crypto-api/localhost/127.0.0.1 (internal\pki\pki.go), not host.docker.internal,
# so the URL uses localhost and --connect-to routes it to the host gateway. TLS verification stays on.
$mount = ($run -replace '\\', '/') + ':/r:ro'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Invoke-Api([string]$path, [string]$body) {
    $out = @($body | docker run --rm -i --add-host host.docker.internal:host-gateway -v $mount curlimages/curl:8.10.1 `
        -s --connect-to localhost:2896:host.docker.internal:2896 `
        --cacert /r/pki/api/ca.pem --cert /r/pki/api/app-cert.pem --key /r/pki/api/app-cert-key.pem `
        -H 'Content-Type: application/json' --data-binary '@-' -w '\n%{http_code}' "https://localhost:2896$path")
    if ($out.Count -eq 0) { return @{ Code = 'none'; Body = '' } }
    @{ Code = [string]$out[-1]; Body = ($out | Select-Object -SkipLast 1) -join "`n" }
}
$plain = 'hw-acceptance-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$encBody = ConvertTo-Json -Compress -Depth 5 -InputObject @{ Plaintext = @(@{ Text = $plain }) }
function Encrypt-Once {
    $r = Invoke-Api '/encrypt' $encBody
    $ct = $null
    if ($r.Code -eq '200') { try { $ct = ConvertTo-Json -Compress -Depth 10 -InputObject @{ Ciphertext = @(($r.Body | ConvertFrom-Json).Ciphertext) } } catch { } }
    @{ Code = $r.Code; DecBody = $ct }
}
function Decrypt-Once([string]$decBody) {
    $r = Invoke-Api '/decrypt' $decBody
    $ok = $false
    if ($r.Code -eq '200') { try { $ok = (($r.Body | ConvertFrom-Json).Plaintext[0].text -ceq $plain) } catch { } }
    @{ Code = $r.Code; Match = $ok }
}

Log-Line "Log file: $log"

# 1. Preflight. Reports only; never changes settings.
Heading '1. Preflight'
$isAdmin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Add-Result 'Admin' $(if ($isAdmin) { 'PASS' } else { 'WARN' }) "running as admin: $isAdmin"

$pc = (powercfg /a | Out-String)
$avail = ($pc -split 'not available')[0]
if ($avail -match 'Hibernate') { Add-Result 'Hibernate' 'WARN' 'hibernate available; fix (admin): powercfg /h off' }
else { Add-Result 'Hibernate' 'PASS' 'hibernate not listed by powercfg /a' }

$swap = docker run --rm alpine:3.20 grep SwapTotal /proc/meminfo
if ($LASTEXITCODE -ne 0 -or -not $swap) { Add-Result 'Docker VM swap' 'FAIL' "docker unavailable (exit $LASTEXITCODE)" }
elseif ([int64](([string]$swap) -replace '\D', '') -ne 0) {
    Add-Result 'Docker VM swap' 'WARN' "$swap; fix: add [wsl2] / swap=0 to $env:UserProfile\.wslconfig, then wsl --shutdown"
} else { Add-Result 'Docker VM swap' 'PASS' 'SwapTotal 0 kB' }

if ($isAdmin) {
    manage-bde -status C:
    Add-Result 'BitLocker C:' $(if ($LASTEXITCODE -eq 0) { 'INFO' } else { 'FAIL' }) "manage-bde exit $LASTEXITCODE; check Protection Status above"
} else { Add-Result 'BitLocker C:' 'SKIP' 'not admin' }

# Build tpm-msk only if missing.
if (-not (Test-Path $TpmMsk)) {
    Log-Line "tpm-msk not found at $TpmMsk; building"
    Push-Location (Join-Path $root 'tpm-services')
    go build -o bin\tpm-msk.exe ./cmd/tpm-msk
    $rc = $LASTEXITCODE
    Pop-Location
    if ($rc -ne 0) { Add-Result 'Build tpm-msk' 'FAIL' "go build exit $rc"; exit 1 }
    $TpmMsk = Join-Path $root 'tpm-services\bin\tpm-msk.exe'
}

# 2. selftest and info need no PIN and print only TPM properties and the key path, so their output is logged.
Heading '2. TPM selftest and info'
$st = & $TpmMsk selftest
$rc = $LASTEXITCODE
$st | ForEach-Object { Log-Line "  $_" }
Add-Result 'selftest' $(if ($rc -eq 0) { 'PASS' } else { 'FAIL' }) "exit $rc"
$info = & $TpmMsk info
$rc = $LASTEXITCODE
$info | ForEach-Object { Log-Line "  $_" }
Add-Result 'info' $(if ($rc -eq 0) { 'PASS' } else { 'FAIL' }) "exit $rc"
$needInit = [bool]($info | Select-String -SimpleMatch 'keyFile: no')

# 3. init and kek create prompt for a PIN: called directly, never captured.
Heading '3. Key setup'
if ($needInit) {
    Log-Line 'No MSK key file. Running tpm-msk init, then tpm-msk kek create --id kek-01 in this window.'
    Log-Line 'WARNING: wrong PIN entries count toward TPM dictionary-attack lockout.'
    & $TpmMsk init
    $rc = $LASTEXITCODE
    Add-Result 'init' $(if ($rc -eq 0) { 'PASS' } else { 'FAIL' }) "exit $rc"
    if ($rc -ne 0) { exit 1 }
    & $TpmMsk kek create --id kek-01
    $rc = $LASTEXITCODE
    Add-Result 'kek create' $(if ($rc -eq 0) { 'PASS' } else { 'FAIL' }) "exit $rc"
    if ($rc -ne 0) { exit 1 }
} else { Add-Result 'init' 'SKIP' 'keyFile: yes' }

# 4. PKI and run dirs. delivery.pub.pem is written by keyd (KEYD_PUBKEY_FILE, key-container/src/main.rs)
# into the run\keyd-pub bind mount; serve waits for it.
Heading '4. PKI and run directories'
$pki = Join-Path $run 'pki'
if (-not (Test-Path $pki)) {
    & $TpmMsk pki --out $pki
    $rc = $LASTEXITCODE
    Add-Result 'pki' $(if ($rc -eq 0) { 'PASS' } else { 'FAIL' }) "exit $rc"
    if ($rc -ne 0) { exit 1 }
} else { Add-Result 'pki' 'SKIP' "$pki exists" }
New-Item -ItemType Directory -Force (Join-Path $run 'audit\keyd'), (Join-Path $run 'audit\crypto-api'), (Join-Path $run 'keyd-pub') | Out-Null
Log-Line 'run\audit\keyd, run\audit\crypto-api, run\keyd-pub ready'

# 5. serve runs in a second window so its PIN and approval prompts stay interactive.
Heading '5. Start tpm-msk serve'
$serveCmd = "& '$TpmMsk' serve --pki-dir '$pki' --pubkey-file '$(Join-Path $run 'keyd-pub\delivery.pub.pem')'"
Write-Host 'In a SECOND PowerShell window run:'
Write-Host "  $serveCmd"
Write-Host 'Enter the PIN there.'
Read-Host 'Press Enter when serve is running' | Out-Null

# 6. Containers and fingerprint approval.
Heading '6. docker compose up'
docker compose -f $compose up -d --build
$rc = $LASTEXITCODE
Add-Result 'compose up' $(if ($rc -eq 0) { 'PASS' } else { 'FAIL' }) "exit $rc"
if ($rc -ne 0) { exit 1 }
Start-Sleep -Seconds 3
$fp = docker compose -f $compose logs keyd | Select-String -SimpleMatch 'delivery key fingerprint: sha256:' | Select-Object -Last 1
if ($fp) { Log-Line "keyd: $($fp.Line.Trim())" } else { Log-Line 'keyd fingerprint line not found yet; check: docker compose -f compose.yaml logs keyd' }
Write-Host 'Approve this fingerprint in the serve window (it must match "Delivery key fingerprint" there).'
Read-Host 'Press Enter after approval' | Out-Null

# 7. Round trip. Ciphertext stays in variables; plaintext compared, never printed.
Heading '7. Encrypt/decrypt round trip'
$e = Encrypt-Once
$d = if ($e.DecBody) { Decrypt-Once $e.DecBody } else { @{ Code = 'skipped'; Match = $false } }
$ok = ($e.Code -eq '200' -and $d.Code -eq '200' -and $d.Match)
Add-Result 'Round trip' $(if ($ok) { 'PASS' } else { 'FAIL' }) "encrypt HTTP $($e.Code), decrypt HTTP $($d.Code), match $($d.Match)"

# 8. Sleep test.
Heading '8. Sleep test'
$e = Encrypt-Once
Log-Line "encrypt HTTP $($e.Code)"
if (-not $e.DecBody) { Add-Result 'Sleep test' 'FAIL' 'no ciphertext from encrypt' }
else {
    Read-Host 'Put laptop to sleep (Start > Power > Sleep) for at least 6 minutes, wake, press Enter' | Out-Null
    Read-Host 'Stop serve in the other window (Ctrl+C), press Enter' | Out-Null
    $d = Decrypt-Once $e.DecBody
    Add-Result 'After sleep, serve down' $(if ($d.Code -eq '503') { 'PASS' } else { 'FAIL' }) "decrypt HTTP $($d.Code), expected 503"
    Write-Host "Restart serve: $serveCmd"
    Write-Host 'If keyd restarted (new fingerprint line in: docker compose -f compose.yaml logs keyd), approve again; otherwise no approval needed.'
    Read-Host 'Press Enter' | Out-Null
    $d = Decrypt-Once $e.DecBody
    Add-Result 'After serve restart' $(if ($d.Code -eq '200' -and $d.Match) { 'PASS' } else { 'FAIL' }) "decrypt HTTP $($d.Code), expected 200, match $($d.Match)"
}

# 9. Audit chains.
Heading '9. Audit chain verification'
foreach ($f in @((Join-Path $run 'audit\keyd\audit.jsonl'), (Join-Path $run 'audit\crypto-api\audit.jsonl'), (Join-Path $env:APPDATA 'tpm-msk\audit.jsonl'))) {
    if (-not (Test-Path $f)) { Add-Result "audit $f" 'SKIP' 'file missing'; continue }
    & $TpmMsk audit verify $f
    $rc = $LASTEXITCODE
    Add-Result "audit $f" $(if ($rc -eq 0) { 'PASS' } else { 'FAIL' }) "exit $rc"
}

# 10. Summary.
Heading '10. Summary'
$table = $results | Format-Table -AutoSize -Wrap | Out-String -Width 200
Write-Host $table
$table -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object { $_ | Out-File -FilePath $log -Append -Encoding utf8 }
Write-Host "Log: $log"
