#!/bin/sh
# Cert auth untuk crypto-module: login pakai client cert (trust: ca.pem, CN client-crypto-module).
# Mode:
#   configure (default): butuh VAULT_TOKEN admin/root di env. Idempotent. Token tidak pernah dicetak.
#   check: self-check login cert tanpa token.
# Dipanggil dari configure.sh (first-init) dan enable-cert-auth-existing.sh.
# Check harus lewat VAULT_ADDR=https://vault-1:8200 (172.30.20.11, di dalam CIDR token_bound_cidrs); 127.0.0.1 ditolak.
set -eu
set +x
umask 077

CA_FILE=/vault/tls/admin/ca.pem
CLIENT_DIR=/vault/tls/crypto-module
# CN dari certs.sh (make_cert). openssl tidak ada di image vault, jadi CN tidak dibaca dari cert;
# CN salah akan gagal di mode check.
MODULE_CN=client-crypto-module
CIDR=${SERVICE_ZONE_CIDR:-172.30.20.0/24}

say() { printf '%s\n' "$*"; }
fail() { say "FAIL: $1"; exit 1; }
json_field() { awk -v k="\"$1\"" 'index($0, k) { sub(/^[^:]*:[ \t]*/, ""); gsub(/[",]/, ""); print; exit }'; }

configure() {
  [ -n "${VAULT_TOKEN:-}" ] || fail 'VAULT_TOKEN wajib (admin/root token dari caller)'
  [ -s "$CA_FILE" ] || fail "CA tidak ada: $CA_FILE"
  if ! vault auth list -format=json 2>/dev/null | grep -q '"cert/"'; then
    vault auth enable cert >/dev/null 2>&1 || fail 'auth enable cert gagal'
  fi
  say 'PASS: auth/cert enabled'
  vault policy write crypto-module /policies/crypto-module.hcl >/dev/null 2>&1 || fail 'policy crypto-module gagal'
  vault write auth/cert/certs/crypto-module \
    certificate=@"$CA_FILE" \
    allowed_common_names="$MODULE_CN" \
    display_name=crypto-module \
    token_policies=crypto-module \
    token_no_default_policy=true \
    token_ttl=1h \
    token_max_ttl=1h \
    token_bound_cidrs="$CIDR" >/dev/null 2>&1 || fail 'cert role crypto-module gagal'
  say 'PASS: cert role crypto-module configured'
}

check() {
  login=$(
    unset VAULT_TOKEN
    VAULT_ADDR=https://vault-1:8200 VAULT_CACERT="$CA_FILE" VAULT_CLIENT_CERT="$CLIENT_DIR/cert.pem" VAULT_CLIENT_KEY="$CLIENT_DIR/key.pem" \
      vault login -no-store -method=cert -path=cert -format=json name=crypto-module 2>/dev/null
  ) || fail 'cert login gagal (role belum ada, CN salah, atau client cert tidak valid)'
  pol=$(printf '%s' "$login" | tr -d ' \t\n' | grep -o '"policies":\[[^]]*\]' | head -n 1)
  [ "$pol" = '"policies":["crypto-module"]' ] || fail "policies login tidak sesuai: ${pol:-kosong}"
  say 'PASS: cert login ok, policies=[crypto-module]'

  tok=$(printf '%s' "$login" | json_field client_token)
  unset login
  [ -n "$tok" ] || fail 'client_token kosong'
  if VAULT_TOKEN="$tok" vault write transit/encrypt/crypto-module-kek plaintext=YWJj >/dev/null 2>&1; then
    fail 'encrypt allowed untuk token crypto-module'
  fi
  say 'PASS: transit encrypt denied for crypto-module token'
  # Revoke bisa ditolak token_bound_cidrs bila caller di luar service-zone; token expire dalam 1h.
  VAULT_TOKEN="$tok" vault token revoke -self >/dev/null 2>&1 || true
  unset tok
}

case "${1:-configure}" in
  configure) configure ;;
  check) check ;;
  *) fail "mode tidak dikenal: $1" ;;
esac
