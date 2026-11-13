// Seeds the shared demo TOTP secret (env DEMO_TOTP_SECRET, 20 printable ASCII chars) into users.totp_secret, sealed via crypto-api /seal.
// Runs inside backend image: node /app/seed-totp.mjs [--reseal] [--print-uri]. PG* and DEMO_TOTP_SECRET via env only. Prints counts only.
// --print-uri is operator-only (scan into an authenticator app). Never use --print-uri in CI.
// --reseal updates ALL users. Default updates only users with totp_secret IS NULL.
// ponytail: one shared secret is demo-only; per-user secrets via /totpgenerate + enrollment UI later.
import pg from 'pg';
import { post } from './crypto-client.mjs';

const secret = process.env.DEMO_TOTP_SECRET ?? '';
if (!/^[\x21-\x7e]{20}$/.test(secret)) {
  console.log('DEMO_TOTP_SECRET missing or not 20 printable ASCII chars');
  process.exit(1);
}

const SEALED = 'skadut-t1:';
const RESEAL = process.argv.includes('--reseal');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

if (process.argv.includes('--print-uri')) {
  console.log(`otpauth://totp/Skadut:demo?algorithm=SHA1&digits=6&issuer=Skadut&period=30&secret=${base32(Buffer.from(secret, 'ascii'))}`);
  process.exit(0);
}

async function call(path, body, field) {
  const r = await post(path, body, 60000);
  const t = r.json?.[field]?.[0]?.text;
  if (r.status !== 200 || typeof t !== 'string') throw new Error(`crypto ${path} ${r.status}`);
  return t;
}

const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

try {
  await client.connect();
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text');
  const sealed = await call('/seal', { Plaintext: [{ Text: secret }] }, 'Ciphertext');
  if (!sealed.startsWith(SEALED)) throw new Error('ciphertext format');
  if ((await call('/unseal', { Ciphertext: [{ Text: sealed }] }, 'Plaintext')) !== secret) throw new Error('roundtrip mismatch');
  const r = await client.query(
    RESEAL ? 'UPDATE users SET totp_secret = $1' : 'UPDATE users SET totp_secret = $1 WHERE totp_secret IS NULL',
    [sealed],
  );
  console.log(`totp seeded=${r.rowCount}`);
} catch (e) {
  console.log(`fatal ${e.code ?? e.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
