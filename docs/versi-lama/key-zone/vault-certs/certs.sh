#!/bin/sh
# One-shot: internal CA + per-node / client certs into volume keyzone-tls. Idempotent: yang sudah ada di-skip.
# Layout: /tls/ca.pem, /tls/vault-{1,2,3}/{cert,key,ca}.pem, /tls/client-admin/, /tls/client-crypto-module/
# Each vault node dir and client-admin dir also gets a copy of ca.pem (public) so the container can mount
# just its own dir, never another node's private key.
# client-crypto-module: key dimiliki uid 65532 (distroless nonroot), group 1000 (gid runtime dashboard) untuk self-check.
# Fix ownership dijalankan setiap run (idempotent, juga untuk volume yang sudah ada).
set -eu
umask 077

# Custodian share dir must be writable by the dashboard user (uid 100).
mkdir -p /custodians
chown 100:1000 /custodians
chmod 0700 /custodians

fix_crypto_module() {
  d=/tls/client-crypto-module
  [ -d "$d" ] || return 0
  if [ ! -s "$d/ca.pem" ] && [ -s /tls/ca.pem ]; then cp /tls/ca.pem "$d/ca.pem"; fi
  chown 65532:1000 "$d"
  chmod 0550 "$d"
  for f in "$d/key.pem" "$d/cert.pem" "$d/ca.pem"; do
    if [ -f "$f" ]; then chown 65532:1000 "$f"; fi
  done
  if [ -f "$d/key.pem" ]; then chmod 0440 "$d/key.pem"; fi
  if [ -f "$d/cert.pem" ]; then chmod 0444 "$d/cert.pem"; fi
  if [ -f "$d/ca.pem" ]; then chmod 0444 "$d/ca.pem"; fi
}

# Jalan di setiap run, termasuk saat cert sudah ada (fix volume lama). Tidak regenerate.
fix_crypto_module

mkdir -p /tls/vault-1 /tls/vault-2 /tls/vault-3 /tls/client-admin /tls/client-crypto-module
# CA key lives only in tmpfs (/tmp) and is deleted at the end; never on the TLS volume.
# CA dibuat hanya jika belum ada. Run berikutnya tidak punya CA key, jadi cert yang hilang tidak bisa dibuat ulang.
if [ ! -s /tls/ca.pem ]; then
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out /tmp/ca-key.pem
  openssl req -x509 -new -key /tmp/ca-key.pem -sha256 -days 730 \
    -subj "/CN=Key Zone Internal CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out /tls/ca.pem
  printf '%s\n' "generated: ca"
else
  printf '%s\n' "skip: ca (sudah ada)"
fi

make_cert() {
  name=$1
  usage=$2
  dir=/tls/$name
  if [ -s "$dir/cert.pem" ] && [ -s "$dir/key.pem" ]; then
    printf '%s\n' "skip: $name (sudah ada)"
    return 0
  fi
  if [ ! -s /tmp/ca-key.pem ]; then
    printf '%s\n' "FAIL: $name belum ada dan CA key tidak tersedia (hanya ada saat run pertama)"
    exit 1
  fi
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$dir/key.pem"
  openssl req -new -key "$dir/key.pem" -subj "/CN=$name" -out "/tmp/$name.csr"
  if [ "$usage" = server ]; then
    printf '%s\n' \
      "subjectAltName=DNS:$name,DNS:localhost,IP:127.0.0.1" \
      "keyUsage=critical,digitalSignature" \
      "extendedKeyUsage=serverAuth,clientAuth" > "/tmp/$name.ext"
  else
    printf '%s\n' \
      "keyUsage=critical,digitalSignature" \
      "extendedKeyUsage=clientAuth" > "/tmp/$name.ext"
  fi
  openssl x509 -req -in "/tmp/$name.csr" -CA /tls/ca.pem -CAkey /tmp/ca-key.pem \
    -CAcreateserial -out "$dir/cert.pem" -days 365 -sha256 -extfile "/tmp/$name.ext"
  cp /tls/ca.pem "$dir/ca.pem"
  chown -R 100:1000 "$dir"
  chmod 0440 "$dir/key.pem"
  chmod 0444 "$dir/cert.pem" "$dir/ca.pem"
  printf '%s\n' "generated: $name"
}

make_cert vault-1 server
make_cert vault-2 server
make_cert vault-3 server
make_cert client-admin client
make_cert client-crypto-module client
fix_crypto_module

chmod 0444 /tls/ca.pem
rm -f /tmp/ca-key.pem /tmp/*.csr /tmp/*.ext /tls/ca.srl
printf '%s\n' "certificates done"
