# POC ini menguji kesesuaian stack TPM dengan blueprint: serve, persetujuan, layanan container, round trip kripto, penolakan mTLS, dan rantai audit.
# Prasyarat: tpm-msk serve berjalan dan fingerprint delivery disetujui; docker compose up.
# Skrip hanya menulis baris uji ke log audit, tanpa perubahan basis data.
# Seluruh data yang digunakan bersifat fiktif.

$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $root.Path
$passed = 0
$failed = 0
$skipped = 0

function Write-Check {
    param([string]$State, [string]$Name, [string]$Reason = '')
    if ($Reason) { Write-Output "$State  $Name  $Reason" } else { Write-Output "$State  $Name" }
}

$serveOk = Test-NetConnection 127.0.0.1 -Port 2798 -InformationLevel Quiet -WarningAction SilentlyContinue
if ($serveOk) { Write-Check PASS 'tpm-msk serve listening 127.0.0.1:2798'; $passed++ }
else { Write-Check FAIL 'tpm-msk serve listening 127.0.0.1:2798' 'port tidak merespons'; $failed++ }

$hostAudit = Join-Path $env:APPDATA 'tpm-msk\audit.jsonl'
$approvalOk = (Test-Path -LiteralPath $hostAudit) -and ((Get-Content -LiteralPath $hostAudit | Select-String -SimpleMatch '"action":"pubkey.approve"' -Quiet))
if ($approvalOk) { Write-Check PASS 'keyd delivery key approved'; $passed++ }
else { Write-Check FAIL 'keyd delivery key approved' 'ketik y di jendela serve'; $failed++ }

$composeOutput = & docker compose ps --format "{{.Service}} {{.State}}"
$composeExit = $LASTEXITCODE
$missingServices = @()
foreach ($service in @('keyd', 'crypto-api', 'backend')) {
    $serviceRunning = $false
    foreach ($line in $composeOutput) { if ($line -match ('^' + [regex]::Escape($service) + '\s+running\s*$')) { $serviceRunning = $true; break } }
    if (-not $serviceRunning) { $missingServices += $service }
}
if ($composeExit -eq 0 -and $missingServices.Count -eq 0) { Write-Check PASS 'compose services running (keyd, crypto-api, backend)'; $passed++ }
else { if ($missingServices.Count -eq 0) { $missingServices = @('docker compose ps gagal') }; Write-Check FAIL 'compose services running (keyd, crypto-api, backend)' ($missingServices -join ', '); $failed++ }

$js = @'
const { post, client } = await import('/app/crypto-client.mjs');
const fs = await import('node:fs');
const https = await import('node:https');
let failed = 0;
async function check(name, fn) { try { const r = await fn(); if (r === true) console.log('PASS  ' + name); else { console.log('FAIL  ' + name + '  ' + String(r).slice(0,120)); failed++; } } catch (err) { console.log('FAIL  ' + name + '  ' + String(err && err.message || err).slice(0,120)); failed++; } }
const S = 'DOKUMEN UJI POC - FIKTIF';
let sealedText;
await check('genrand 32 bytes', async () => { const r = await post('/genrand', {CountByte:32}); return r.status === 200 && /^[0-9a-f]{64}$/i.test(r.json.Random) || 'respons acak tidak valid'; });
await check('encrypt/decrypt roundtrip (DEK via keyd)', async () => { const e = await post('/encrypt', {Plaintext:[{text:S}]}); if (e.status !== 200 || !e.json.Ciphertext || typeof e.json.Ciphertext[0] !== 'object' || String(e.json.Ciphertext[0].text).includes(S)) return 'enkripsi gagal atau data tidak tersandi'; const d = await post('/decrypt', {Ciphertext:e.json.Ciphertext}); return d.status === 200 && d.json.Plaintext && d.json.Plaintext[0].text === S || 'hasil dekripsi tidak cocok'; });
await check('seal/unseal skadut-t1: format', async () => { const s = await post('/seal', {Plaintext:[{text:S}]}); if (s.status !== 200 || !s.json.Ciphertext || typeof s.json.Ciphertext[0].text !== 'string' || !s.json.Ciphertext[0].text.startsWith('skadut-t1:')) return 'format seal tidak valid'; sealedText = s.json.Ciphertext[0].text; const u = await post('/unseal', {Ciphertext:[{text:sealedText}]}); return u.status === 200 && u.json.Plaintext && u.json.Plaintext[0].text === S || 'hasil unseal tidak cocok'; });
await check('tampered ciphertext rejected (AES-GCM auth)', async () => { if (!sealedText) return 'data seal tidak tersedia'; const last = sealedText.slice(-1); const tampered = sealedText.slice(0,-1) + (last === 'A' ? 'B' : 'A'); const r = await post('/unseal', {Ciphertext:[{text:tampered}]}); return r.status !== 200 || 'ciphertext termodifikasi diterima'; });
await check('sealfile/unsealfile', async () => { const s = await post('/sealfile', {Data:Buffer.from(S).toString('base64')}); if (s.status !== 200 || typeof s.json.Ciphertext !== 'string' || !s.json.Ciphertext.startsWith('skadut-t1:')) return 'format sealfile tidak valid'; const u = await post('/unsealfile', {Ciphertext:s.json.Ciphertext}); return u.status === 200 && Buffer.from(u.json.Data,'base64').toString() === S || 'hasil unsealfile tidak cocok'; });
await check('HMAC sign/verify + wrong message rejected', async () => { const h = await post('/hmac', {Message:S}); if (h.status !== 200 || typeof h.json.Value !== 'string' || !h.json.Value.startsWith('skadut-t1:')) return 'HMAC tidak valid'; const v = await post('/verifyhmac', {Message:S, HMACstring:h.json.Value}); if (v.status !== 200 || v.json.Value !== true) return 'verifikasi HMAC gagal'; const w = await post('/verifyhmac', {Message:S+'x', HMACstring:h.json.Value}); return w.status === 200 && w.json.Value === false || 'pesan salah diterima'; });
await check('tokenize/detokenize masked token', async () => { const t = await post('/tokenize', {Masking:[{Text:'DOC-POC-0001', Format:'LEFT', Length:4, Position:''}]}); const token = t.json && t.json.Ciphertext && t.json.Ciphertext[0] && t.json.Ciphertext[0].text; if (t.status !== 200 || typeof token !== 'string' || !token.includes(':t1:') || token.startsWith('DOC-')) return 'token tidak valid'; const d = await post('/detokenize', {Masking:[{text:token}]}); return d.status === 200 && d.json.Ciphertext && d.json.Ciphertext[0].text === 'DOC-POC-0001' || 'hasil detokenisasi tidak cocok'; });
try { const call = client('https://crypto-api:2796', { ca: fs.readFileSync(process.env.CRYPTO_CA) }); const r = await call('/genrand', {CountByte:8}); if (r.status === 200) { console.log('FAIL  crypto-api rejects caller without client cert  caller diterima'); failed++; } else console.log('PASS  crypto-api rejects caller without client cert'); } catch (_) { console.log('PASS  crypto-api rejects caller without client cert'); }
function rawRequest(options, body) { return new Promise((resolve) => { const req = https.request(options, (res) => { res.resume(); res.on('end', () => resolve({status:res.statusCode})); }); req.setTimeout(5000, () => req.destroy(new Error('timeout'))); req.on('error', () => resolve({error:true})); req.end(body); }); }
const rawOptions = {hostname:'host.docker.internal', port:2798, path:'/v1/kek/wrapped', method:'POST', rejectUnauthorized:false, timeout:5000, headers:{'Content-Type':'application/json'}};
const body = JSON.stringify({});
const noCert = await rawRequest({...rawOptions}, body); if (noCert.error || noCert.status !== 200) console.log('PASS  tpm-msk rejects caller without client cert'); else { console.log('FAIL  tpm-msk rejects caller without client cert  caller diterima'); failed++; }
const appCert = await rawRequest({...rawOptions, cert:fs.readFileSync(process.env.CRYPTO_CERT), key:fs.readFileSync(process.env.CRYPTO_KEY)}, body); if (appCert.error || appCert.status !== 200) console.log('PASS  tpm-msk rejects cert from api CA (app identity)'); else { console.log('FAIL  tpm-msk rejects cert from api CA (app identity)  caller diterima'); failed++; }
process.exit(failed ? 1 : 0);
'@
$js | docker compose run --rm -T --no-deps backend node --input-type=module - | Tee-Object -Variable out | Out-Null
$containerExit = $LASTEXITCODE
foreach ($line in $out) { Write-Output $line }
$containerPass = @($out | Where-Object { $_ -match '^PASS\b' }).Count
$containerFail = @($out | Where-Object { $_ -match '^FAIL\b' }).Count
$passed += $containerPass
$failed += $containerFail
# JS keluar 1 saat ada FAIL; hitung exit code hanya jika tidak ada baris FAIL (mis. container gagal start).
if ($containerExit -ne 0 -and $containerFail -eq 0) { Write-Check FAIL 'container checks exit code' "exit code $containerExit"; $failed++ }

$checkDir = Join-Path $root.Path 'cryptography-service\tpm-services'
Push-Location $checkDir
try {
    $auditFiles = @(
        @{ Name='audit hash chain keyd'; Path=(Join-Path $checkDir '..\run\audit\keyd\audit.jsonl') },
        @{ Name='audit hash chain crypto-api'; Path=(Join-Path $checkDir '..\run\audit\crypto-api\audit.jsonl') },
        @{ Name='audit hash chain host'; Path=$hostAudit }
    )
    foreach ($audit in $auditFiles) {
        if (-not (Test-Path -LiteralPath $audit.Path)) { Write-Check SKIP $audit.Name 'file missing'; $skipped++; continue }
        & .\bin\tpm-msk.exe audit verify $audit.Path
        $verifyExit = $LASTEXITCODE
        if ($verifyExit -eq 0) { Write-Check PASS $audit.Name; $passed++ }
        else { Write-Check FAIL $audit.Name 'verifikasi gagal'; $failed++ }
    }
}
finally { Pop-Location }

Write-Output "Counts: PASS=$passed FAIL=$failed SKIP=$skipped"
if ($failed -gt 0) { exit 1 }
exit 0
