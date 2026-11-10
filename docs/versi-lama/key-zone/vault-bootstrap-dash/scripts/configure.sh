#!/bin/sh
# One-shot cluster config, dijalankan dashboard sesaat setelah first init (node sudah unseal, 3 voter).
# Input env: VAULT_TOKEN (root token, tidak pernah dicetak), SERVICE_ZONE_CIDR.
# Output: hanya PASS: <name> / FAIL: <name>. FAIL pertama -> exit non-zero. Output vault dibuang.
# Root token di-revoke di akhir; bila gagal, trap EXIT tetap me-revoke.
set -eu
set +x
umask 077

export VAULT_ADDR=https://vault-1:8200
export VAULT_CACERT=/vault/tls/admin/ca.pem
export VAULT_CLIENT_CERT=/vault/tls/admin/cert.pem
export VAULT_CLIENT_KEY=/vault/tls/admin/key.pem

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; exit 1; }
# Values may contain ':' (vault:v1:...), so strip only the first "key": prefix.
json_field() { awk -v k="\"$1\"" 'index($0, k) { sub(/^[^:]*:[ \t]*/, ""); gsub(/[",]/, ""); print; exit }'; }

revoke_root() {
  [ -n "${VAULT_TOKEN:-}" ] || return 0
  vault token revoke -self >/dev/null 2>&1 || true
  unset VAULT_TOKEN
}
trap revoke_root EXIT

[ -n "${VAULT_TOKEN:-}" ] || fail 'VAULT_TOKEN unset'

# a. audit devices
vault audit enable file file_path=/vault/logs/audit.log >/dev/null 2>&1 || fail 'audit devices'
vault audit enable -path=stdout file file_path=stdout >/dev/null 2>&1 || fail 'audit devices'
pass 'two audit devices enabled (file + stdout)'

# b. transit
vault secrets enable transit >/dev/null 2>&1 || fail 'transit enable'

# c. KEK
vault write transit/keys/crypto-module-kek type=aes256-gcm96 exportable=false \
  allow_plaintext_backup=false auto_rotate_period=8760h >/dev/null 2>&1 || fail 'KEK create'

# d. policies
vault policy write crypto-module /policies/crypto-module.hcl >/dev/null 2>&1 || fail 'policy crypto-module'
vault policy write kek-admin /policies/kek-admin.hcl >/dev/null 2>&1 || fail 'policy kek-admin'

# e. AppRole role + role_id file
vault auth enable approle >/dev/null 2>&1 || fail 'approle enable'
vault write auth/approle/role/crypto-module token_policies=crypto-module token_ttl=1h \
  token_max_ttl=24h secret_id_ttl=24h secret_id_num_uses=10 \
  secret_id_bound_cidrs="${SERVICE_ZONE_CIDR:-172.30.20.0/24}" token_bound_cidrs="${SERVICE_ZONE_CIDR:-172.30.20.0/24}" >/dev/null 2>&1 || fail 'approle role'
role_id=$(vault read -field=role_id auth/approle/role/crypto-module/role-id 2>/dev/null) || fail 'role_id read'
printf '%s' "$role_id" > /custodians/role_id || fail 'role_id write'
chmod 0444 /custodians/role_id
unset role_id
pass 'transit KEK, policies, AppRole role created (role_id written, no secret_id)'

# f. module self-check
self_check() {
  token=$1
  wrap=$(VAULT_TOKEN="$token" vault write -format=json transit/datakey/wrapped/crypto-module-kek bits=256 2>/dev/null) || { printf '%s\n' 'FAIL: datakey/wrapped call'; return 1; }
  ciphertext=$(printf '%s' "$wrap" | json_field ciphertext)
  case "$ciphertext" in vault:v1:*) ;; *) printf '%s\n' 'FAIL: ciphertext prefix'; return 1 ;; esac
  printf '%s' "$wrap" | grep -q '"plaintext"' && { printf '%s\n' 'FAIL: wrapped datakey returned plaintext'; return 1; }
  pass 'datakey/wrapped returns vault:v1 ciphertext, no plaintext'

  dec=$(VAULT_TOKEN="$token" vault write -format=json transit/decrypt/crypto-module-kek ciphertext="$ciphertext" 2>/dev/null) || { printf '%s\n' 'FAIL: decrypt call'; return 1; }
  len=$(printf '%s' "$dec" | json_field plaintext | base64 -d 2>/dev/null | wc -c | tr -d ' ')
  [ "$len" = 32 ] || { printf '%s\n' 'FAIL: decrypted DEK is not 32 bytes'; return 1; }
  pass 'decrypt returns 32-byte DEK (not printed)'

  rw=$(VAULT_TOKEN="$token" vault write -format=json transit/rewrap/crypto-module-kek ciphertext="$ciphertext" 2>/dev/null) || { printf '%s\n' 'FAIL: rewrap call'; return 1; }
  case "$(printf '%s' "$rw" | json_field ciphertext)" in vault:v1:*) ;; *) printf '%s\n' 'FAIL: rewrap result'; return 1 ;; esac
  pass 'rewrap succeeds'

  if VAULT_TOKEN="$token" vault read transit/keys/crypto-module-kek >/dev/null 2>&1; then printf '%s\n' 'FAIL: key read allowed'; return 1; fi
  if VAULT_TOKEN="$token" vault read transit/export/encryption-key/crypto-module-kek >/dev/null 2>&1; then printf '%s\n' 'FAIL: key export allowed'; return 1; fi
  if VAULT_TOKEN="$token" vault write transit/encrypt/crypto-module-kek plaintext=YWJj >/dev/null 2>&1; then printf '%s\n' 'FAIL: encrypt allowed'; return 1; fi
  pass 'key read, export, encrypt denied for module token'
  return 0
}

test_token=$(vault token create -policy=crypto-module -no-default-policy -ttl=5m -field=token 2>/dev/null) || fail 'self-check token create'
check_ok=1
self_check "$test_token" || check_ok=0
vault token revoke "$test_token" >/dev/null 2>&1 || fail 'self-check token revoke'
unset test_token
[ "$check_ok" = 1 ] || exit 1

# g. KEK config
cfg=$(vault read -format=json transit/keys/crypto-module-kek 2>/dev/null) || fail 'KEK config read'
printf '%s' "$cfg" | grep -q '"exportable": false' || fail 'exportable not false'
printf '%s' "$cfg" | grep -q '"allow_plaintext_backup": false' || fail 'allow_plaintext_backup not false'
printf '%s' "$cfg" | grep -Eq '"auto_rotate_period": (31536000|"8760h0m0s")' || fail 'auto_rotate_period not 8760h'
pass 'KEK exportable=false, allow_plaintext_backup=false, auto_rotate 8760h'
unset cfg

# h. raft: 3 voter
voters=0
end=$(( $(date +%s) + 120 ))
while [ "$(date +%s)" -lt "$end" ]; do
  peers=$(vault operator raft list-peers -format=json 2>/dev/null) || { sleep 2; continue; }
  voters=$(printf '%s' "$peers" | grep -o '"voter": true' | wc -l | tr -d ' ')
  if [ "$voters" = 3 ]; then break; fi
  sleep 2
done
[ "$voters" = 3 ] || fail "raft expected 3 voters, found $voters"
pass 'Raft has 3 voters'

# i. cert auth
sh /scripts/enable-cert-auth.sh configure >/dev/null 2>&1 || fail 'cert auth configure'
pass 'cert auth configured (auth/cert crypto-module)'

# j. revoke root token
vault token revoke -self >/dev/null 2>&1 || fail 'root token revoke'
unset VAULT_TOKEN
