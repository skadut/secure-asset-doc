# Usage: EXPECT_PREFIX=k1|s0 [CRYPTO_URL=...] pwsh/powershell -File functional.ps1 [-CrossCipher <file>]
param([string]$CrossCipher)
$base = 'http://127.0.0.1:2796'
if ($env:CRYPTO_URL) { $base = $env:CRYPTO_URL }
$expect = $env:EXPECT_PREFIX
if ($expect -ne 'k1' -and $expect -ne 's0') { Write-Output 'FAIL EXPECT_PREFIX must be k1 or s0'; exit 1 }
$script:pass = 0
$script:fail = 0
$dummy = 'functional-test-data-1'

function Post($path, $obj) {
  try {
    return Invoke-RestMethod -Method Post -Uri ($base + $path) -ContentType 'application/json' -Body (ConvertTo-Json $obj -Depth 10 -Compress)
  } catch {
    if (-not $_.Exception.Response) { throw }
    return [int]$_.Exception.Response.StatusCode
  }
}
function Need($r) { if ($r -is [int]) { throw "HTTP $r" }; return $r }
function Check($name, [scriptblock]$test) {
  try {
    $ErrorActionPreference = 'Stop'
    & $test
    $script:pass++
    Write-Output "PASS $name"
  } catch {
    $script:fail++
    Write-Output "FAIL ${name}: $($_.Exception.Message)"
  }
}

Check 'genrand' {
  $r = Need (Post '/genrand' @{CountByte = 16})
  if ($r.Random -cnotmatch '^[0-9a-f]{32}$') { throw 'Random not 32 lowercase hex' }
}
Check 'encrypt' {
  $c = (Need (Post '/encrypt' @{Plaintext = @(@{Text = $dummy})})).Ciphertext[0]
  foreach ($p in 'versionkey', 'text', 'mac', 'iv') { if (-not $c.$p) { throw "missing $p" } }
  if ($expect -eq 'k1') { if (-not $c.versionkey.StartsWith('k1:')) { throw 'versionkey not k1:' } }
  elseif ($c.versionkey -ne 's0') { throw 'versionkey not s0' }
  $script:enc = $c
}
Check 'decrypt roundtrip' {
  $r = Need (Post '/decrypt' @{Ciphertext = @($script:enc)})
  if ($r.Plaintext[0].Text -ne $dummy) { throw 'plaintext mismatch' }
}
Check 'seal' {
  $script:sealed = (Need (Post '/seal' @{Plaintext = @(@{Text = $dummy})})).Ciphertext[0].text
  if (-not ($script:sealed -like "${expect}:*")) { throw "prefix not ${expect}:" }
}
Check 'unseal roundtrip' {
  $r = Need (Post '/unseal' @{Ciphertext = @(@{text = $script:sealed})})
  if ($r.Plaintext[0].Text -ne $dummy) { throw 'plaintext mismatch' }
}
Check 'hmac' {
  $script:hm = (Need (Post '/hmac' @{Message = 'functional-msg'})).Value
  if (-not ($script:hm -like "${expect}:*")) { throw "prefix not ${expect}:" }
}
Check 'verifyhmac true' {
  $r = Need (Post '/verifyhmac' @{Message = 'functional-msg'; HMACstring = $script:hm})
  if ($r.Value -ne $true) { throw 'expected true' }
}
Check 'verifyhmac false tampered' {
  $r = Need (Post '/verifyhmac' @{Message = 'functional-msg-tampered'; HMACstring = $script:hm})
  if ($r.Value -ne $false) { throw 'expected false' }
}
Check 'tokenize' {
  $script:tok = (Need (Post '/tokenize' @{Masking = @(@{Format = 'LEFT'; Length = 3; Text = 'ABCDEFGH'})})).Ciphertext[0].text
  if ($script:tok.Length -lt 3 -or $script:tok.Substring(0, 3) -ne '***') { throw 'masked prefix not ***' }
}
Check 'detokenize roundtrip' {
  $r = Need (Post '/detokenize' @{Masking = @(@{text = $script:tok})})
  if ($r.Ciphertext[0].text -ne 'ABCDEFGH') { throw 'detokenize mismatch' }
}
Check 'sealfile' {
  $script:sfCipher = (Need (Post '/sealfile' @{Data = [Convert]::ToBase64String([byte[]](0x00, 0x01, 0x7f, 0x80, 0xff))})).Ciphertext
  if (-not ($script:sfCipher -like "${expect}:*")) { throw "prefix not ${expect}:" }
}
Check 'unsealfile roundtrip' {
  $bytes = [byte[]](0x00, 0x01, 0x7f, 0x80, 0xff)
  $r = Need (Post '/unsealfile' @{Ciphertext = $script:sfCipher})
  if ([BitConverter]::ToString([Convert]::FromBase64String($r.Data)) -ne [BitConverter]::ToString($bytes)) { throw 'plaintext mismatch' }
}
Check 'tampered ciphertext rejected' {
  $t = [string]$script:enc.text
  $first = if ($t[0] -eq 'A') { 'B' } else { 'A' }
  $bad = [pscustomobject]@{versionkey = $script:enc.versionkey; text = ($first + $t.Substring(1)); mac = $script:enc.mac; iv = $script:enc.iv }
  if ((Post '/decrypt' @{Ciphertext = @($bad)}) -isnot [int]) { throw 'tampered accepted (200)' }
}
Check 'save artifacts' {
  if (-not $script:enc -or -not $script:sealed) { throw 'no artifacts to save' }
  $encFile = Join-Path $env:TEMP "crypto-func-encrypt-$expect.json"
  $sealFile = Join-Path $env:TEMP "crypto-func-seal-$expect.json"
  Set-Content -Path $encFile -Value (ConvertTo-Json $script:enc -Compress) -Encoding utf8
  Set-Content -Path $sealFile -Value (ConvertTo-Json $script:sealed -Compress) -Encoding utf8
  if (-not ((Test-Path $encFile) -and (Test-Path $sealFile))) { throw 'files not written' }
}
if ($CrossCipher) {
  Check 'cross-mode ciphertext rejected' {
    $raw = (Get-Content -LiteralPath $CrossCipher -Raw).Trim()
    if ($raw -match '"versionkey"') {
      $r = Post '/decrypt' @{Ciphertext = @(($raw | ConvertFrom-Json))}
    } else {
      $s = if ($raw.StartsWith('"')) { $raw | ConvertFrom-Json } else { $raw }
      $r = Post '/unseal' @{Ciphertext = @(@{text = $s})}
    }
    if ($r -isnot [int]) { throw 'cross-mode ciphertext accepted (200)' }
  }
}

$tot = $script:pass + $script:fail
Write-Output ('TOTAL {0} PASS {1} FAIL {2}' -f $tot, $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
