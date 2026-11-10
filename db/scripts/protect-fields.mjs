// Protects sensitive text columns. Tokenize (masked:t1:...): assets.ip_address, uploaded_files.name.
// Seal (skadut-t1:...): assets.model/firmware, non-CLEAR document_versions.summary, request reasons, level-change free text.
// Runs inside backend image: node /app/protect-fields.mjs [--dry-run]. Admin creds via PG* env only. Prints counts only.
// Needs db/init/015_field_protection.sql applied first (ip_address as text, CHECKs sized for ciphertext).
// ponytail: one crypto round-trip per value; batch /seal when row counts reach thousands.
import pg from 'pg';
import { isToken, maskPattern, maskedPart } from './tokens.mjs';
import { post } from './crypto-client.mjs';

const DRY = process.argv.includes('--dry-run');
const SEALED = 'skadut-t1:';

class Fail extends Error {}

// Batch shape -> arr[0].text. Network error -> 'crypto unreachable'. Non-200 -> 'crypto <path> <status>'.
async function one(path, body, field) {
  let r;
  try {
    r = await post(path, body, 60000);
  } catch {
    throw new Fail('crypto unreachable');
  }
  if (r.status !== 200) throw new Fail(`crypto ${path} ${r.status}`);
  const t = r.json?.[field]?.[0]?.text;
  if (typeof t !== 'string') throw new Fail(`crypto ${path} bad response`);
  return t;
}

// Each protects v and verifies the round-trip before any write.
const KINDS = {
  token: {
    done: isToken,
    async protect(v) {
      const t = await one('/tokenize', { Masking: [{ Text: v, Format: maskPattern(v), Length: 0, Position: '' }] }, 'Ciphertext');
      if (!isToken(t) || maskedPart(t).includes(':')) throw new Fail('token format');
      if ((await one('/detokenize', { Masking: [{ Text: t }] }, 'Ciphertext')) !== v) throw new Fail('roundtrip mismatch');
      return t;
    },
  },
  seal: {
    done: (v) => v.startsWith(SEALED),
    async protect(v) {
      const c = await one('/seal', { Plaintext: [{ Text: v }] }, 'Ciphertext');
      if (!c.startsWith(SEALED)) throw new Fail('ciphertext format');
      if ((await one('/unseal', { Ciphertext: [{ Text: c }] }, 'Plaintext')) !== v) throw new Fail('roundtrip mismatch');
      return c;
    },
  },
};

// table, column, kind, key columns, extra filter. Fixed identifiers only (no user input in SQL).
const TARGETS = [
  ['assets', 'ip_address', 'token', ['id']],
  ['assets', 'model', 'seal', ['id']],
  ['assets', 'firmware', 'seal', ['id']],
  ['document_versions', 'summary', 'seal', ['document_id', 'version'], "document_id IN (SELECT id FROM documents WHERE tlp <> 'CLEAR')"],
  ['uploaded_files', 'name', 'token', ['id']],
  ['access_requests', 'reason', 'seal', ['id']],
  ['access_approvals', 'reason', 'seal', ['request_id', 'role']],
  ['level_change_requests', 'justification', 'seal', ['id']],
  ['level_change_requests', 'screening_ref', 'seal', ['id']],
  ['level_change_requests', 'decision_reason', 'seal', ['id']],
];

// One transaction per row. Guard on old value: rowCount must be 1, else nothing is written.
async function writeRow(client, sql, params) {
  await client.query('BEGIN');
  try {
    const r = await client.query(sql, params);
    if (r.rowCount !== 1) throw new Fail('row changed');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

// Fail -> its fixed message. pg error -> SQLSTATE only (pg messages can echo row values). Anything else -> generic.
const reason = (e) => (e instanceof Fail ? e.message : e.code ? `db ${e.code}` : 'unexpected error');

async function protectColumn(client, [table, col, kind, keys, filter]) {
  const k = KINDS[kind];
  const s = { processed: 0, ok: 0, skipped: 0, failed: 0 };
  const where = filter ? ` WHERE ${filter}` : '';
  const { rows } = await client.query(`SELECT ${keys.join(', ')}, ${col}::text AS v FROM ${table}${where} ORDER BY ${keys.join(', ')}`);
  const guard = keys.map((c, i) => `${c}::text = $${i + 2}`).join(' AND ');
  const sql = `UPDATE ${table} SET ${col} = $1 WHERE ${guard} AND ${col}::text = $${keys.length + 2}`;
  for (const row of rows) {
    s.processed++;
    const v = row.v;
    row.v = null;
    if (typeof v !== 'string' || v.trim() === '' || k.done(v)) {
      s.skipped++;
      continue;
    }
    try {
      const out = await k.protect(v);
      if (!DRY) await writeRow(client, sql, [out, ...keys.map((c) => String(row[c])), v]);
      s.ok++;
    } catch (e) {
      s.failed++;
      console.log(`${table} ${keys.map((c) => row[c]).join('/')} ${col} FAILED ${reason(e)}`);
    }
  }
  console.log(`summary ${table}.${col} processed=${s.processed} ok=${s.ok} skipped=${s.skipped} failed=${s.failed}`);
  return s.failed;
}

async function main() {
  const client = new pg.Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });
  await client.connect();
  try {
    const { rows: [t] } = await client.query(
      "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'ip_address'",
    );
    if (t?.data_type !== 'text') {
      console.log('assets.ip_address is not text: apply db/init/015_field_protection.sql first');
      return 1;
    }
    let failed = 0;
    for (const target of TARGETS) failed += await protectColumn(client, target);
    console.log(DRY ? 'dry-run: no writes' : 'writes committed');
    return failed ? 1 : 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(`fatal ${e.code ?? 'error'}`);
    process.exitCode = 1;
  },
);
