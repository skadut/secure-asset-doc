#!/usr/bin/env bash
# setup.sh - generate MSK, simpan ke .env, build image, jalankan container, functional test.
# Jalankan dari folder crypt-module: ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=.env
BASE=http://localhost:2796
C='\033[36m' G='\033[32m' Y='\033[33m' R='\033[31m' N='\033[0m'

step() { printf "\n${C}[%s/5] %s${N}\n" "$1" "$2"; }
die()  { printf "${R}ERROR: %s${N}\n" "$1" >&2; exit 1; }
ask()  { local a; read -r -p "$1 [y/N]: " a || true; [[ "${a,,}" == y || "${a,,}" == yes ]]; }

command -v docker >/dev/null || die "docker tidak ditemukan"
command -v curl   >/dev/null || die "curl tidak ditemukan"
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null; then DC="docker-compose"
else die "docker compose tidak ditemukan"; fi

step 1 "Generate key"
KEY=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
[[ ${#KEY} -eq 64 ]] || die "gagal membangkitkan kunci"
echo "    Kunci baru: ${KEY:0:8}... (32 byte, AES-256)"

step 2 "Simpan CRYPT_KEY ke .env"
write=1
if [[ -f $ENV_FILE ]] && grep -q '^CRYPT_KEY=' "$ENV_FILE"; then
  printf "${Y}    CRYPT_KEY sudah ada di .env.
    PERINGATAN, jika kunci diganti:
     - Semua data hasil /encrypt, /seal, /tokenize dengan kunci lama TIDAK BISA didekripsi (501).
     - Nilai /hmac berubah: blind index di DB tidak cocok lagi, pencarian NIK gagal, perlu re-index.
     - Tidak ada pemulihan tanpa kunci lama. Backup .env dibuat otomatis.
     - Container yang jalan akan dibuat ulang dengan kunci baru.${N}\n"
  ask "    Ganti CRYPT_KEY dengan kunci baru?" || write=0
fi

if (( write )); then
  if [[ -f $ENV_FILE ]] && grep -q '^CRYPT_KEY=' "$ENV_FILE"; then
    bak="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$ENV_FILE" "$bak"
    echo "    Backup kunci lama: $bak"
    sed -i "s/^CRYPT_KEY=.*/CRYPT_KEY=$KEY/" "$ENV_FILE"
  else
    [[ -s $ENV_FILE ]] || printf '# Master Secret Key (MSK) crypt-module: 32 byte = 64 hex.\n# Ganti = semua data lama tidak bisa didekripsi. Jangan sebar file ini.\n' > "$ENV_FILE"
    echo "CRYPT_KEY=$KEY" >> "$ENV_FILE"
  fi
  grep -q '^CRYPT_ADDR=' "$ENV_FILE" || echo "CRYPT_ADDR=:2796" >> "$ENV_FILE"
  printf "${G}    CRYPT_KEY ditulis ke .env${N}\n"
else
  echo "    Kunci lama dipertahankan."
fi

step 3 "Build image crypt-module"
docker info >/dev/null 2>&1 || die "Docker tidak berjalan. Nyalakan Docker dulu."
$DC build

step 4 "Jalankan container ($DC)"
$DC up -d --force-recreate
for _ in $(seq 30); do
  curl -s -o /dev/null -X POST "$BASE/genrand" -d '{"CountByte":1}' && break
  sleep 1
done || true
curl -s -o /dev/null -X POST "$BASE/genrand" -d '{"CountByte":1}' || { $DC logs --tail 20; die "container tidak merespons di $BASE"; }
printf "${G}    crypt-module siap di %s${N}\n\n" "$BASE"

ask "Mau functional test?" || { echo "Selesai tanpa test."; exit 0; }

step 5 "Functional test"
pass=0 fail=0

# api METHOD PATH [BODY] -> CODE, BODY
api() {
  local out
  out=$(curl -s -w '%{http_code}' -X "$1" "$BASE$2" -H 'Content-Type: application/json' ${3:+-d "$3"}) || true
  CODE=${out: -3}; BODY=${out%???}; BODY=${BODY%$'\n'}
}
# field KEY -> nilai JSON mentah dari respons {"KEY":<nilai>}
field() { sed -n "s/^{\"$1\":\(.*\)}$/\1/p" <<<"$BODY"; }
check() {
  if eval "$2" >/dev/null 2>&1; then pass=$((pass+1)); printf "  ${G}[PASS]${N} %s\n" "$1"
  else fail=$((fail+1)); printf "  ${R}[FAIL]${N} %s\n" "$1"; fi
}

NIK=3302271000000001

api POST /genrand '{"CountByte":8}'
check "/genrand" '[[ $CODE == 200 ]] && grep -Eq "^\{\"Random\":\"[0-9a-f]{16}\"\}$" <<<"$BODY"'

api POST /encrypt "{\"Plaintext\":[{\"Text\":\"$NIK\"},{\"Text\":\"08123456789\"}]}"
CT=$(field Ciphertext)
check "/encrypt" '[[ $CODE == 200 && $(grep -o "\"versionkey\":\"s0\"" <<<"$BODY" | wc -l) -eq 2 ]]'
api POST /decrypt "{\"Ciphertext\":$CT}"
check "/decrypt" '[[ $CODE == 200 && $BODY == "{\"Plaintext\":[{\"text\":\"$NIK\"},{\"text\":\"08123456789\"}]}" ]]'

api POST /seal '{"Plaintext":[{"Text":"Budi Santoso"}]}'
SEAL=$(field Ciphertext)
check "/seal" '[[ $CODE == 200 && $BODY == *"\"text\":\"s0:"* ]]'
api POST /unseal "{\"Ciphertext\":$SEAL}"
check "/unseal" '[[ $CODE == 200 && $BODY == "{\"Plaintext\":[{\"text\":\"Budi Santoso\"}]}" ]]'

api POST /hmac "{\"Message\":\"$NIK\"}"
MAC=$(field Value)
check "/hmac" '[[ $CODE == 200 && $MAC == "\"s0:"* ]]'
api POST /verifyhmac "{\"Message\":\"$NIK\",\"HMACstring\":$MAC}"
check "/verifyhmac (data asli -> true)" '[[ $CODE == 200 && $BODY == "{\"Value\":true}" ]]'
api POST /verifyhmac "{\"Message\":\"3302271000000002\",\"HMACstring\":$MAC}"
check "/verifyhmac (data diubah -> false)" '[[ $CODE == 200 && $BODY == "{\"Value\":false}" ]]'

api POST /tokenize "{\"Masking\":[{\"Format\":\"LEFT\",\"Length\":3,\"Text\":\"budi santoso\"},{\"Format\":\"%\$%%%%%%%%%\$%%%\$\",\"Text\":\"$NIK\"}]}"
TOK=$(field Ciphertext)
check "/tokenize" '[[ $CODE == 200 && $BODY == *"\"***i santoso:s0:"* && $BODY == *"\"3*022710000*000*:s0:"* ]]'
api POST /detokenize "{\"Masking\":$TOK}"
check "/detokenize" '[[ $CODE == 200 && $BODY == "{\"Ciphertext\":[{\"text\":\"budi santoso\"},{\"text\":\"$NIK\"}]}" ]]'

api POST /encrypt '{bukan json'
check "JSON rusak -> 400" '[[ $CODE == 400 ]]'
api POST /unseal '{"Ciphertext":[{"text":"s0:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}'
check "ciphertext palsu -> 501" '[[ $CODE == 501 ]]'
api GET /encrypt
check "method GET -> 405" '[[ $CODE == 405 ]]'

total=$((pass+fail))
if (( fail )); then printf "\n${R}Hasil: %d/%d PASS${N}\n" "$pass" "$total"; exit 1; fi
printf "\n${G}Hasil: %d/%d PASS${N}\n" "$pass" "$total"
