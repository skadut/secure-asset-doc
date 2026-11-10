// Tokenizes plaintext documents.title and document_versions.file_name for documents with tlp <> 'CLEAR'.
// Runs inside backend image: node /app/tokenize-titles.mjs [--dry-run]. Admin creds via PG* env only. Prints no values.
// ponytail: only rows still in plaintext are processed. Re-running is safe (tokenized rows are skipped). New rows need a re-run. Out of scope: scheduling.
import pg from 'pg';
import { isToken, maskPattern, maskedPart } from './tokens.mjs';
import { post } from './crypto-client.mjs';

const DRY = process.argv.includes('--dry-run');

class Fail extends Error {}

// Returns json[field]. Network error -> 'crypto unreachable'. Non-200 -> 'crypto <path> <status>'. Bad JSON -> 'bad response'.
async function call(path, body, field) {
  let r;
  try {
    r = await post(path, body, 60000);
  } catch {
    throw new Fail('crypto unreachable');
  }
  if (r.status !== 200) throw new Fail(`crypto ${path} ${r.status}`);
  if (r.json?.[field] === undefined || r.json?.[field] === null) throw new Fail(`crypto ${path} bad response`);
  return r.json[field];
}

// Single-item masking call. Returns Ciphertext[0].Text as a string.
async function masking(path, item) {
  const arr = await call(path, { Masking: [item] }, 'Ciphertext');
  const t = Array.isArray(arr) ? arr[0]?.text : undefined;
  if (typeof t !== 'string') throw new Fail(`crypto ${path} bad response`);
  return t;
}

// Tokenize, then verify by detokenize round-trip before any write.
async function tokenizeValue(v) {
  const token = await masking('/tokenize', { Text: v, Format: maskPattern(v), Length: 0, Position: '' });
  if (!isToken(token) || maskedPart(token).includes(':')) throw new Fail('token format');
  const plain = await masking('/detokenize', { Text: token });
  if (plain !== v) throw new Fail('roundtrip mismatch');
  return token;
}

// One transaction per row. rowCount must be 1 (guard on old value), else nothing is written.
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

const newStats = () => ({ processed: 0, ok: 0, skipped: 0, failed: 0 });

// Handles one value: skip empty/already-token, else tokenize+verify+(write). Returns outcome; logs failures by id only.
async function processValue(client, stats, label, v, write) {
  stats.processed++;
  if (typeof v !== 'string' || v === '' || isToken(v)) {
    stats.skipped++;
    return;
  }
  try {
    const token = await tokenizeValue(v);
    if (!DRY) await write(token);
    stats.ok++;
  } catch (e) {
    stats.failed++;
    console.log(`${label} FAILED ${reason(e)}`);
  }
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
    const titles = newStats();
    const docs = await client.query("SELECT id, title FROM documents WHERE tlp <> 'CLEAR' ORDER BY id");
    for (const row of docs.rows) {
      const old = row.title;
      await processValue(client, titles, `doc ${row.id}`, old, (token) =>
        writeRow(client, 'UPDATE documents SET title = $1 WHERE id = $2 AND title = $3', [token, row.id, old]),
      );
      row.title = null;
    }

    const files = newStats();
    const vers = await client.query(
      "SELECT v.document_id, v.version, v.file_name FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.tlp <> 'CLEAR' AND v.file_name IS NOT NULL ORDER BY 1, 2",
    );
    for (const row of vers.rows) {
      const old = row.file_name;
      await processValue(client, files, `version ${row.document_id} v${row.version}`, old, (token) =>
        writeRow(
          client,
          'UPDATE document_versions SET file_name = $1 WHERE document_id = $2 AND version = $3 AND file_name = $4',
          [token, row.document_id, row.version, old],
        ),
      );
      row.file_name = null;
    }

    const fmt = (name, s) => `summary ${name} processed=${s.processed} ok=${s.ok} skipped=${s.skipped} failed=${s.failed}`;
    console.log(fmt('documents.title', titles));
    console.log(fmt('document_versions.file_name', files));
    const failed = titles.failed + files.failed;
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
