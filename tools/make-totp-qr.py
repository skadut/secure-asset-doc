#!/usr/bin/env python3
import os
import re
import sys
from pathlib import Path

import segno

ROOT = Path(__file__).resolve().parents[1]

def read_env(path):
    if not path.exists():
        return {}
    return {
        key: value
        for line in path.read_text(encoding='utf-8').splitlines()
        if line and not line.startswith('#') and '=' in line
        for key, raw in [line.split('=', 1)]
        for value in [raw.strip().removeprefix("'").removesuffix("'")]
    }

def base32(data):
    alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    bits = value = 0
    out = ''
    for byte in data:
        value = (value << 8) | byte
        bits += 8
        while bits >= 5:
            out += alphabet[(value >> (bits - 5)) & 31]
            bits -= 5
    if bits:
        out += alphabet[(value << (5 - bits)) & 31]
    return out

def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: python tools/make-totp-qr.py <out.png>')
    secret = os.environ.get('DEMO_TOTP_SECRET') or read_env(ROOT / '.env').get('DEMO_TOTP_SECRET', '')
    if not re.fullmatch(r'[\x21-\x7e]{20}', secret):
        raise SystemExit('DEMO_TOTP_SECRET missing or not 20 printable ASCII chars')
    encoded = base32(secret.encode('ascii'))
    uri = f'otpauth://totp/Skadut:demo?algorithm=SHA1&digits=6&issuer=Skadut&period=30&secret={encoded}'
    output = Path(sys.argv[1])
    segno.make(uri, error='M').save(output, kind='png', scale=12, border=4)
    print(f'wrote {output} {output.stat().st_size}')

if __name__ == '__main__':
    main()
