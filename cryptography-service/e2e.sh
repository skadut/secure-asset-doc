#!/usr/bin/env bash
set -euo pipefail
export MSYS_NO_PATHCONV=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$HERE/run-e2e"
# Use Windows paths for native Go tools and Docker Desktop bind mounts.
WIN_RUN="$(cygpath -m "$RUN")"
API_PORT="${CRYPTO_API_PORT:-2897}"
TPM_PORT="${TPM_MSK_E2E_PORT:-2798}"
# keyd accepts KEYD_DEK_TTL only in 31..=300 seconds (KEYD_DEK_TTL parse in key-container/src/main.rs).
TTL=31
# RandomJitter subtracts 5..=30s from the TTL (RandomJitter in key-container/src/time.rs); wait for the worst case.
JITTER=30
WAIT=$((TTL+JITTER+2))
export CRYPTO_TPM_RUN="$WIN_RUN" CRYPTO_API_PORT="$API_PORT" KEYD_DEK_TTL="$TTL"
# Git Bash curl is Schannel and does not send PEM client certs, so every HTTPS call runs in a curl container.
CURL_IMG=curlimages/curl:8.10.1
# Compose project crypto-tpm-e2e, network crypto-tpm-net. crypto-api cert SAN covers crypto-api, so verification stays on.
NET=crypto-tpm-e2e_crypto-tpm-net
BASE="https://crypto-api:2796"
RESULTS=()
HARNESS_PID=""
TMP=""
PASS_COUNT=0
FAIL_COUNT=0

record() {
  local status="$1" name="$2" evidence="$3"
  RESULTS+=("$status|$name|$evidence")
  printf '%-5s %-30s %s\n' "$status" "$name" "$evidence"
  if [[ "$status" == PASS ]]; then ((PASS_COUNT+=1)); else ((FAIL_COUNT+=1)); fi
}
check() {
  local name="$1" evidence="$2"; shift 2
  if "$@"; then record PASS "$name" "$evidence"; else record FAIL "$name" "$evidence"; fi
}
neg() { ! "$@"; }
# Kill the harness subshell, its direct children, and the Windows process tree (go test -> test binary).
kill_tree() {
  local pid="$1" wpid
  [[ -n "$pid" ]] || return 0
  pkill -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
  wpid="$(cat "/proc/$pid/winpid" 2>/dev/null || true)"
  [[ -z "$wpid" ]] || taskkill //F //T //PID "$wpid" >/dev/null 2>&1 || true
}
stop_harness() {
  [[ -n "$HARNESS_PID" ]] || return 0
  touch "$RUN/stop" 2>/dev/null || true
  for _ in {1..20}; do kill -0 "$HARNESS_PID" 2>/dev/null || break; sleep .25; done
  if kill -0 "$HARNESS_PID" 2>/dev/null; then kill_tree "$HARNESS_PID"; fi
  wait "$HARNESS_PID" 2>/dev/null || true
}
cleanup() {
  stop_harness || true
  docker compose -p crypto-tpm-e2e -f "$(cygpath -w "$HERE/compose.yaml")" down >/dev/null 2>&1 || true
  docker compose -p crypto-tpm-e2e -f "$(cygpath -w "$HERE/compose.yaml")" down -v >/dev/null 2>&1 || true
  [[ -z "$TMP" ]] || rm -rf "$TMP"
}
trap cleanup EXIT; trap 'exit 130' INT TERM

rm -rf "$RUN"
mkdir -p "$RUN"
BIN="$RUN/tpm-msk.exe"
WIN_BIN="$(cygpath -w "$BIN")"
(cd "$HERE/tpm-services" && go build -o "$WIN_BIN" ./cmd/tpm-msk)
"$WIN_BIN" pki --out "$WIN_RUN/pki"

# Container paths under /r map to $RUN.
TPM_CERT=(--cert /r/pki/keyzone/crypto-service.pem --key /r/pki/keyzone/crypto-service-key.pem --cacert /r/pki/keyzone/ca.pem)
API_CERT=(--cert /r/pki/api/app-cert.pem --key /r/pki/api/app-cert-key.pem --cacert /r/pki/api/ca.pem)
TPM_URL="https://host.docker.internal:$TPM_PORT"
# Host-side TPM stand-in: container reaches it via host-gateway.
ccurl() { docker run --rm --add-host host.docker.internal:host-gateway -v "$WIN_RUN:/r:ro" "$CURL_IMG" "$@"; }
# Compose-network calls to crypto-api. jq is not installed on this Windows host.
ncurl() { docker run --rm --network "$NET" -v "$WIN_RUN:/r:ro" "$CURL_IMG" "$@"; }
jq() { docker run --rm -i alpine:3.20 sh -c 'apk add --no-cache jq >/dev/null 2>&1 && exec jq "$@"' sh "$@"; }

start_harness() {
  rm -f "$RUN/stop"
  (cd "$HERE/tpm-services" && TPM_MSK_E2E_RUN="$WIN_RUN" TPM_MSK_E2E_LISTEN="${TPM_MSK_E2E_LISTEN:-127.0.0.1:$TPM_PORT}" go test -run TestTPMMSKE2E -count=1 -timeout 20m ./cmd/tpm-msk) >>"$RUN/harness.log" 2>&1 &
  HARNESS_PID=$!
}
tpm_ready() {
  local code
  code="$(ccurl -sS -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 5 "${TPM_CERT[@]}" "$TPM_URL/v1/kek/wrapped" 2>/dev/null || true)"
  [[ -n "$code" && "$code" != 000 ]]
}
# Returns 0 ready, 1 timeout, 2 harness process exited.
harness_ready() {
  local i
  for i in $(seq 1 "$1"); do
    if tpm_ready; then return 0; fi
    if ! kill -0 "$HARNESS_PID" 2>/dev/null; then return 2; fi
    sleep 1
  done
  return 1
}

# Reachability: 127.0.0.1 binding first, then 0.0.0.0.
start_harness
if harness_ready 20; then
  REACH='127.0.0.1 binding reachable from curl container via host.docker.internal'
else
  rc=$?
  if (( rc == 2 )); then printf 'Harness exited before readiness; see %s\n' "$RUN/harness.log" >&2; exit 1; fi
  REACH='127.0.0.1 binding unreachable from container; retried on 0.0.0.0'
  stop_harness
  TPM_MSK_E2E_LISTEN="0.0.0.0:$TPM_PORT" start_harness
  if ! harness_ready 30; then
    printf 'Harness not reachable at host.docker.internal:%s (127.0.0.1 and 0.0.0.0 bindings); see %s\n' "$TPM_PORT" "$RUN/harness.log" >&2
    exit 1
  fi
  REACH='0.0.0.0 binding reachable via host.docker.internal'
fi
printf 'Reachability: %s\n' "$REACH"

# Project-scoped volume reset: stale keyd-deks holds DEKs wrapped by an older KEK.
docker compose -p crypto-tpm-e2e -f "$(cygpath -w "$HERE/compose.yaml")" down -v >/dev/null
docker compose -p crypto-tpm-e2e -f "$(cygpath -w "$HERE/compose.yaml")" up -d --build

# Wait for TLS + API readiness: no dedicated health route is defined. Timeout is explicit.
READY=0
for _ in {1..90}; do
  CODE="$(ncurl -sS -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 5 "${API_CERT[@]}" "$BASE/" 2>/dev/null || true)"
  if [[ "$CODE" =~ ^(200|404)$ ]]; then READY=1; break; fi
  sleep 1
done
if (( ! READY )); then printf 'crypto-api failed readiness on %s within 90s (network %s)\n' "$BASE" "$NET" >&2; exit 1; fi

req() { ncurl -sS --fail-with-body "${API_CERT[@]}" -H 'Content-Type: application/json' "$@"; }

PLAIN='B3-e2e-plaintext-7f29'
B64="$(printf %s "$PLAIN" | base64 | tr -d '\r\n')"
ENC="$(req -d "{\"Plaintext\":[{\"Text\":\"$PLAIN\"}]}" "$BASE/encrypt")"
CT="$(printf %s "$ENC" | jq -c '.Ciphertext')"
DECRYPT="$(req -d "{\"Ciphertext\":$CT}" "$BASE/decrypt")"
check 'encrypt/decrypt' 'round trip matched' test "$(printf %s "$DECRYPT" | jq -r '.Plaintext[0].text')" = "$PLAIN"
SEALED="$(req -d "{\"Plaintext\":[{\"Text\":\"$PLAIN\"}]}" "$BASE/seal" | jq -r '.Ciphertext[0].text')"
UNSEALED="$(req -d "{\"Ciphertext\":[{\"text\":\"$SEALED\"}]}" "$BASE/unseal" | jq -r '.Plaintext[0].text')"
check 'seal/unseal' 'round trip matched' test "$UNSEALED" = "$PLAIN"
MAC="$(req -d "{\"Message\":\"$PLAIN\"}" "$BASE/hmac" | jq -r .Value)"
check 'hmac/verifyhmac' 'valid message verified' test "$(req -d "{\"Message\":\"$PLAIN\",\"HMACstring\":\"$MAC\"}" "$BASE/verifyhmac" | jq -r .Value)" = true
TOK="$(req -d '{"Masking":[{"Text":"4111111111111111","Format":"RIGHT","Length":4}]}' "$BASE/tokenize" | jq -r '.Ciphertext[0].text')"
DETOK="$(req -d "{\"Masking\":[{\"text\":\"$TOK\"}]}" "$BASE/detokenize" | jq -r '.Ciphertext[0].text')"
check 'tokenize/detokenize' 'token restored' test "$DETOK" = 4111111111111111

# Server cert verifies (--cacert set); only the client cert is missing or wrong.
check 'no client certificate' 'TLS handshake rejected' neg ncurl -sS --max-time 5 --cacert /r/pki/api/ca.pem "$BASE/encrypt"
TMP="$RUN/tmp"
mkdir -p "$TMP"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$(cygpath -w "$TMP/ca.key")" -out "$(cygpath -w "$TMP/ca.pem")" -subj /CN=wrong-ca -days 1 >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout "$(cygpath -w "$TMP/client.key")" -out "$(cygpath -w "$TMP/client.csr")" -subj /CN=app >/dev/null 2>&1
openssl x509 -req -in "$(cygpath -w "$TMP/client.csr")" -CA "$(cygpath -w "$TMP/ca.pem")" -CAkey "$(cygpath -w "$TMP/ca.key")" -CAcreateserial -out "$(cygpath -w "$TMP/client.pem")" -days 1 >/dev/null 2>&1
check 'wrong client CA' 'TLS handshake rejected' neg ncurl -sS --max-time 5 --cert /r/tmp/client.pem --key /r/tmp/client.key --cacert /r/pki/api/ca.pem "$BASE/encrypt"
# Expected rejection: app cert is not issued by the keyzone CA.
check 'TPM wrong-CA client' 'API app certificate rejected by TPM CA' neg ccurl -sS --max-time 5 --cert /r/pki/api/app-cert.pem --key /r/pki/api/app-cert-key.pem --cacert /r/pki/keyzone/ca.pem -H 'Content-Type: application/json' -d '{}' "$TPM_URL/v1/kek/wrapped"

# Exercise the public TPM mTLS endpoint with the stolen crypto-service identity.
WRAPPED="$(ccurl -sS --fail "${TPM_CERT[@]}" -H 'Content-Type: application/json' -d '{"kek_id":"kek-01","version":1,"nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}' "$TPM_URL/v1/kek/wrapped")"
WLEN="$(printf %s "$WRAPPED" | jq -r '.wrapped_kek' | base64 -d | wc -c | tr -d ' ')"
check 'stolen client cert wrapping' "wrapped payload $WLEN bytes; expected 424" test "$WLEN" -eq 424
# Response must carry wrapped_kek and no plaintext kek/key field.
nokek() { grep -q '"wrapped_kek"' <<<"$1" && ! grep -qE '"(kek|key)"' <<<"$1"; }
check 'no plaintext KEK' 'response contains only wrapped key' nokek "$WRAPPED"

REQID='e2e-audit-req-0001'
AUD_ENC="$(ncurl -sS --fail "${API_CERT[@]}" -H 'Content-Type: application/json' -H "X-Request-ID: $REQID" -d "{\"Plaintext\":[{\"Text\":\"$PLAIN\"}]}" "$BASE/encrypt")"
AUDCT="$(printf %s "$AUD_ENC" | jq -c '.Ciphertext')"
sleep "$WAIT"
if grep -q 'dek.expire' "$RUN/audit/keyd/audit.jsonl" && grep -q 'dek.zeroize' "$RUN/audit/keyd/audit.jsonl"; then record PASS 'DEK expiry/zeroize' "events after ${WAIT}s"; else record FAIL 'DEK expiry/zeroize' 'expected expiry events absent'; fi

# Modify a stored DEK purpose in the project-specific named volume only.
if docker run --rm -v crypto-tpm-e2e_keyd-deks:/d alpine sh -c 'apk add --no-cache jq >/dev/null 2>&1 && f=/d/deks.json && [ -f "$f" ] && jq '\''(.deks[0].purpose)="swapped"'\'' "$f" > /tmp/deks.json && cp /tmp/deks.json "$f"' >/dev/null 2>&1; then
  docker compose -p crypto-tpm-e2e -f "$(cygpath -w "$HERE/compose.yaml")" restart keyd >/dev/null
  sleep 3
  CODE="$(ncurl -sS -o /dev/null -w '%{http_code}' "${API_CERT[@]}" -H 'Content-Type: application/json' -d "{\"Ciphertext\":$AUDCT}" "$BASE/decrypt" 2>/dev/null || true)"
  # keyd bad_cipher maps to crypto-api cryptoFail -> 501; anything else (200, 503, 000) is a failure.
  if [[ "$CODE" == 501 ]]; then record PASS 'swapped wrapped DEK' "old ciphertext rejected (HTTP 501)"; else record FAIL 'swapped wrapped DEK' "expected 501, got $CODE"; fi
else record FAIL 'swapped wrapped DEK' 'could not edit expected volume store'; fi

# Outage must fail closed. Use a fresh ciphertext (the swapped DEK above would give bad_cipher, not 503).
OUTAGE_CT="$(req -d "{\"Plaintext\":[{\"Text\":\"$PLAIN\"}]}" "$BASE/encrypt" | jq -c '.Ciphertext')"
sleep "$WAIT"
stop_harness
CODE="$(ncurl -sS -o /dev/null -w '%{http_code}' "${API_CERT[@]}" -H 'Content-Type: application/json' -d "{\"Ciphertext\":$OUTAGE_CT}" "$BASE/decrypt" 2>/dev/null || true)"
if [[ "$CODE" == 503 ]]; then record PASS 'TPM outage fail closed' 'HTTP 503'; else record FAIL 'TPM outage fail closed' "expected 503, got $CODE"; fi

# Restore the harness and poll for recovery (up to 15s).
start_harness
if harness_ready 30; then :; else printf 'Harness did not recover within 30s; see %s\n' "$RUN/harness.log" >&2; fi
REC=0
for _ in {1..15}; do
  if req -d "{\"Plaintext\":[{\"Text\":\"$PLAIN\"}]}" "$BASE/encrypt" >/dev/null 2>&1; then REC=1; break; fi
  sleep 1
done
if (( REC )); then record PASS 'TPM recovery' 'new encryption succeeded'; else record FAIL 'TPM recovery' 'no successful encryption within 15s'; fi

# Suspend (docker pause approximation): freeze keyd past TTL+jitter with the harness down.
# Control decrypt right after encrypt, harness still up, must be served from cache: 200 and no kek.delivery
# for its request ID. DEK lifetime can be 1s (TTL 31 - jitter 30), so retry with fresh IDs on a reload.
# After unpause the DEK must be gone (503); with the harness back a decrypt must trigger a fresh kek.delivery.
dec_code() { ncurl -sS -o /dev/null -w '%{http_code}' "${API_CERT[@]}" -H 'Content-Type: application/json' -H "X-Request-ID: $1" -d "{\"Ciphertext\":$2}" "$BASE/decrypt" 2>/dev/null || true; }
delivered() { grep "\"request_id\":\"$1\"" "$RUN/audit/keyd/audit.jsonl" | grep -q '"action":"kek.delivery"'; }
CTRL=none
for i in 1 2 3 4 5; do
  SUSP_CT="$(req -d "{\"Plaintext\":[{\"Text\":\"$PLAIN\"}]}" "$BASE/encrypt" | jq -c '.Ciphertext')"
  CTRL="$(dec_code "e2e-suspend-ctrl-000$i" "$SUSP_CT")"
  if delivered "e2e-suspend-ctrl-000$i"; then CTRL="$CTRL/reloaded"; continue; fi
  [[ "$CTRL" == 200 ]] && break
done
stop_harness
KEYD_CID="$(docker compose -p crypto-tpm-e2e -f "$(cygpath -w "$HERE/compose.yaml")" ps -q keyd)"
docker pause "$KEYD_CID" >/dev/null
sleep "$WAIT"
docker unpause "$KEYD_CID" >/dev/null
AFTER="$(dec_code e2e-suspend-after-0001 "$SUSP_CT")"
start_harness
harness_ready 30 || printf 'Harness did not recover within 30s; see %s\n' "$RUN/harness.log" >&2
sleep 3 # past keyd's 2s KEK negative cache from the failed reload
RELOAD="$(dec_code e2e-suspend-reload-0001 "$SUSP_CT")"
RELOAD_AUD=0
grep '"request_id":"e2e-suspend-reload-0001' "$RUN/audit/keyd/audit.jsonl" | grep '"action":"kek.delivery"' | grep -q '"result":"ok"' && RELOAD_AUD=1
if [[ "$CTRL" == 200 && "$AFTER" == 503 && "$RELOAD" == 200 ]] && ((RELOAD_AUD)); then
  record PASS 'suspend (docker pause approximation)' "paused ${WAIT}s: cached 200 (no kek.delivery, attempt $i), after unpause 503, reload 200 + kek.delivery"
else
  record FAIL 'suspend (docker pause approximation)' "cached=$CTRL after=$AFTER reload=$RELOAD kek.delivery=$RELOAD_AUD"
fi

# New DEK forces KEK delivery and carries request ID end-to-end.
sleep "$WAIT"
ncurl -sS --fail "${API_CERT[@]}" -H 'Content-Type: application/json' -H "X-Request-ID: $REQID" -d "{\"Plaintext\":[{\"Text\":\"$PLAIN\"}]}" "$BASE/encrypt" >/dev/null
TRACE=1
for f in "$RUN/audit/crypto-api/audit.jsonl" "$RUN/audit/keyd/audit.jsonl" "$RUN/audit/tpm/audit.jsonl"; do grep -q "$REQID" "$f" || TRACE=0; done
if ((TRACE)); then record PASS 'audit request trace' "$REQID in all audit logs"; else record FAIL 'audit request trace' 'ID missing in one or more logs'; fi
VERIFY=1
for f in "$RUN/audit/crypto-api/audit.jsonl" "$RUN/audit/keyd/audit.jsonl" "$RUN/audit/tpm/audit.jsonl"; do "$WIN_BIN" audit verify "$(cygpath -w "$f")" >/dev/null 2>&1 || VERIFY=0; done
if ((VERIFY)); then record PASS 'audit chain verification' 'all three chains OK'; else record FAIL 'audit chain verification' 'verification failed'; fi
TAMPER_OK=1
for f in "$RUN/audit/crypto-api/audit.jsonl" "$RUN/audit/keyd/audit.jsonl" "$RUN/audit/tpm/audit.jsonl"; do
  cp "$f" "$TMP/audit-copy"
  sed -i '1s/"result":"[^"]*"/"result":"tampered"/' "$TMP/audit-copy"
  "$WIN_BIN" audit verify "$(cygpath -w "$TMP/audit-copy")" >/dev/null 2>&1 && TAMPER_OK=0
  sed '2d' "$f" > "$TMP/audit-copy"
  "$WIN_BIN" audit verify "$(cygpath -w "$TMP/audit-copy")" >/dev/null 2>&1 && TAMPER_OK=0
done
if ((TAMPER_OK)); then record PASS 'audit tamper/deletion' 'edits and deleted lines rejected'; else record FAIL 'audit tamper/deletion' 'tampering was accepted'; fi

SERVICE_LOGS="$(docker compose -p crypto-tpm-e2e -f "$(cygpath -w "$HERE/compose.yaml")" logs crypto-api keyd 2>&1 || true)"
if ! { grep -aE "$PLAIN|$B64|BEGIN" "$RUN/harness.log" "$RUN/audit/crypto-api/audit.jsonl" "$RUN/audit/keyd/audit.jsonl" "$RUN/audit/tpm/audit.jsonl" || grep -aE "$PLAIN|$B64|BEGIN" <<<"$SERVICE_LOGS"; } >/dev/null 2>&1; then record PASS 'audit/log secret scan' 'plaintext, base64, BEGIN absent'; else record FAIL 'audit/log secret scan' 'sensitive marker found'; fi

# Refresh ciphertext after expiry, then measure 200 sequential valid decrypts in one curl process.
FRESH="$(req -d "{\"Plaintext\":[{\"Text\":\"$PLAIN\"}]}" "$BASE/encrypt" | jq -c '.Ciphertext')"
sleep "$WAIT"
URLS=()
for _ in $(seq 1 200); do URLS+=("$BASE/decrypt"); done
START="$(date +%s)"
ncurl -sS --fail "${API_CERT[@]}" -H 'Content-Type: application/json' -d "{\"Ciphertext\":$FRESH}" "${URLS[@]}" >/dev/null
ELAPSED="$(($(date +%s)-START))"; ((ELAPSED<1)) && ELAPSED=1
RPS="$(awk -v n=200 -v s="$ELAPSED" 'BEGIN{printf "%.1f", n/s}')"
check 'decrypt throughput' "200 sequential; $RPS requests/s (min 1)" awk -v r="$RPS" 'BEGIN{exit !(r+0 >= 1)}'

KEYD_ID="$(docker compose -p crypto-tpm-e2e -f "$(cygpath -w "$HERE/compose.yaml")" ps -q keyd)"
INSPECT_LINE="$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}|{{json .HostConfig.CapAdd}}|{{json .HostConfig.CapDrop}}|{{range .HostConfig.Ulimits}}{{.Name}}={{.Hard}} {{end}}|{{.HostConfig.PidMode}}' "$KEYD_ID")"
printf 'keyd inspect: %s\n' "$INSPECT_LINE"
IFS='|' read -r HC_RO HC_CAP HC_CAPDROP HC_ULIMIT HC_PID <<<"$INSPECT_LINE"
if [[ "$HC_RO" == true && "$HC_CAP" == *'"CAP_IPC_LOCK"'* && "$HC_CAPDROP" == *'"ALL"'* && " $HC_ULIMIT" == *" core=0 "* ]]; then record PASS 'keyd hardening' 'readonly, IPC_LOCK, drop ALL, core=0'; else record FAIL 'keyd hardening' "inspect: $INSPECT_LINE"; fi
if [[ "$HC_PID" != host && " $HC_ULIMIT" == *" memlock="* ]]; then record PASS 'keyd PID/memlock' 'not host PID; memlock set'; else record FAIL 'keyd PID/memlock' "inspect: $INSPECT_LINE"; fi
KEYD_LOG="$(docker compose -p crypto-tpm-e2e -f "$(cygpath -w "$HERE/compose.yaml")" logs keyd 2>&1 || true)"
if grep -q 'mlock: ok' <<<"$KEYD_LOG"; then record PASS 'keyd mlock' 'mlock: ok'; elif grep -q 'mlock: unavailable' <<<"$KEYD_LOG"; then record FAIL 'keyd mlock' "$(grep -o 'mlock: unavailable ([0-9]*)' <<<"$KEYD_LOG" | head -1)"; else record FAIL 'keyd mlock' 'status not found in keyd logs'; fi

printf '\nSummary: %d PASS, %d FAIL\n' "$PASS_COUNT" "$FAIL_COUNT"
for result in "${RESULTS[@]}"; do IFS='|' read -r status name evidence <<<"$result"; printf '%-5s %-30s %s\n' "$status" "$name" "$evidence"; done
