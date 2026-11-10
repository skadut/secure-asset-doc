#!/bin/sh
# Cluster sudah init: pasang cert auth tanpa first-init. Jalankan di dalam container vault-bootstrap-dash.
#
# Host (satu sesi, token root tidak pernah keluar container):
#   docker compose exec vault-bootstrap-dash sh /scripts/enable-cert-auth-existing.sh
# Butuh /custodians/share-N (1-3); file itu hanya ada di mode unsafe.
#
# Alur: cek cert auth sudah ada (check tanpa token) -> skip. Jika belum: generate-root dengan 3 share
# dari /custodians (share-N, ditulis dashboard saat init), configure cert auth,
# self-check, lalu revoke token root via trap EXIT (juga saat gagal).
# OTP dan share tidak pernah dicetak; set +x; file sementara di /tmp (tmpfs) dihapus saat exit.
set -eu
set +x
umask 077

say() { printf '%s\n' "$*"; }
fail() { say "FAIL: $1"; exit 1; }
json_field() { awk -v k="\"$1\"" 'index($0, k) { sub(/^[^:]*:[ \t]*/, ""); gsub(/[",]/, ""); print; exit }'; }

export VAULT_ADDR=https://vault-1:8200
export VAULT_CACERT=/vault/tls/admin/ca.pem
export VAULT_CLIENT_CERT=/vault/tls/admin/cert.pem
export VAULT_CLIENT_KEY=/vault/tls/admin/key.pem
work=$(mktemp -d /tmp/gr.XXXXXX)
root_token=
cleanup() {
  if [ -n "$root_token" ]; then
    VAULT_TOKEN="$root_token" vault token revoke -self >/dev/null 2>&1 || say 'WARN: root token revoke failed'
    unset root_token
  fi
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

# Sudah terpasang? Cukup login cert (tanpa token admin).
if sh /scripts/enable-cert-auth.sh check >/dev/null 2>&1; then
  say 'SKIP: cert auth already configured and self-check passes'
  exit 0
fi

for n in 1 2 3; do
  [ -s "/custodians/share-$n" ] || fail "missing custodian share $n"
done

otp=$(vault operator generate-root -generate-otp 2>/dev/null) || fail 'generate-root otp gagal'
[ -n "$otp" ] || fail 'otp kosong'
init=$(vault operator generate-root -init -otp="$otp" -format=json 2>/dev/null) || fail 'generate-root init gagal'
nonce=$(printf '%s' "$init" | json_field nonce)
[ -n "$nonce" ] || fail 'nonce kosong'
unset init

encoded=
for n in 1 2 3; do
  res=$(vault operator generate-root -nonce="$nonce" -format=json "$(cat "/custodians/share-$n")" 2>/dev/null) || fail "share $n ditolak"
  encoded=$(printf '%s' "$res" | json_field encoded_token)
  unset res
done
[ -n "$encoded" ] || fail 'encoded token kosong (share belum lengkap?)'

root_token=$(vault operator generate-root -decode="$encoded" -otp="$otp" 2>/dev/null) || fail 'decode root token gagal'
unset otp nonce encoded
[ -n "$root_token" ] || fail 'root token kosong'

VAULT_TOKEN="$root_token" sh /scripts/enable-cert-auth.sh configure || fail 'cert auth configure gagal'
sh /scripts/enable-cert-auth.sh check || fail 'cert auth self-check gagal'
say 'PASS: cert auth enabled on existing cluster; root token revoked on exit'
