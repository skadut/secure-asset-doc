// Protects existing document_versions rows by documents.tlp: every TLP, CLEAR included, is sealed (t1:) with an HMAC tag.
// Migrates protection='none' rows and upgrades old protection='integrity' rows (CLEAR, plaintext base64) to 'encrypted'.
// Runs inside backend image: node /app/protect-documents.mjs [--dry-run]. Admin creds via PG* env only. Prints no payloads.
// ponytail: if a document TLP changes later, re-running this script does NOT re-protect or un-protect existing versions. Re-run protect requires manual reset. Out of scope.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { protectionFor } from './protection.mjs';
import { post } from './crypto-client.mjs';

const DRY = process.argv.includes('--dry-run');

class Fail extends Error {}

const sha256 = (b) => createHash('sha256').update(b).digest();

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

// One transaction per row. Row must still have its original protection (rowCount 1), else nothing is written.
async function write(client, sql, params) {
  await client.query('BEGIN');
  try {
    const r = await client.query(sql, params);
    if (r.rowCount !== 1) throw new Fail('row changed');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

// p is always 'encrypted' now; the branch stays simple. Old integrity rows keep their tag if it still verifies.
async function protectRow(client, row) {
  let p;
  try {
    p = protectionFor(row.tlp);
  } catch {
    throw new Fail('unknown tlp');
  }
  if (p !== 'encrypted') throw new Fail('unexpected target');
  let raw = null;
  let rec = null;
  let recBuf = null;
  try {
    const b64 = row.content_base64;
    raw = Buffer.from(b64, 'base64');
    let tag = row.integrity_tag;
    if (tag && (await call('/verifyhmac', { Message: b64, HMACstring: tag }, 'Value')) !== true) tag = null;
    if (!tag) {
      tag = await call('/hmac', { Message: b64 }, 'Value');
      if (typeof tag !== 'string') throw new Fail('crypto /hmac bad response');
    }

    const ct = await call('/sealfile', { Data: b64 }, 'Ciphertext');
    if (typeof ct !== 'string' || !ct.startsWith('skadut-t1:')) throw new Fail('ciphertext format');
    rec = await call('/unsealfile', { Ciphertext: ct }, 'Data');
    if (typeof rec !== 'string' || rec !== b64) throw new Fail('roundtrip mismatch');
    recBuf = Buffer.from(rec, 'base64');
    if (!sha256(recBuf).equals(sha256(raw))) throw new Fail('roundtrip mismatch');
    if ((await call('/verifyhmac', { Message: rec, HMACstring: tag }, 'Value')) !== true) throw new Fail('hmac verify failed');
    if (!DRY) {
      await write(client, "UPDATE document_versions SET content_ciphertext=$1, integrity_tag=$2, content_base64=NULL, protection='encrypted' WHERE document_id=$3 AND version=$4 AND protection=$5", [ct, tag, row.document_id, row.version, row.protection]);
    }
  } finally {
    raw?.fill(0);
    recBuf?.fill(0);
    rec = null;
  }
}

// Fail -> its fixed message. pg error -> SQLSTATE only (pg messages can echo row values). Anything else -> generic.
const reason = (e) => (e instanceof Fail ? e.message : e.code ? `db ${e.code}` : 'unexpected error');

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
    const rows = await client.query(
      "SELECT v.document_id, v.version, v.content_base64, v.integrity_tag, v.protection, d.tlp FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.protection IN ('none','integrity') AND v.content_base64 IS NOT NULL ORDER BY 1,2",
    );
    const noFile = await client.query(
      "SELECT count(*)::int AS n FROM document_versions WHERE protection IN ('none','integrity') AND content_base64 IS NULL AND content_ciphertext IS NULL",
    );
    const stats = new Map();
    let failed = 0;
    let migratedIntegrity = 0;
    for (const row of rows.rows) {
      if (!stats.has(row.tlp)) stats.set(row.tlp, { processed: 0, ok: 0, failed: 0 });
      const s = stats.get(row.tlp);
      s.processed++;
      try {
        await protectRow(client, row);
        s.ok++;
        if (row.protection === 'integrity') migratedIntegrity++;
      } catch (e) {
        s.failed++;
        failed++;
        console.log(`doc ${row.document_id} v${row.version} FAILED ${reason(e)}`);
      } finally {
        row.content_base64 = null;
      }
    }

    for (const [tlp, s] of stats) console.log(`summary tlp=${tlp} processed=${s.processed} ok=${s.ok} failed=${s.failed}`);
    console.log(`migrated integrity=${migratedIntegrity}`);
    console.log(`no file=${noFile.rows[0].n}`);
    const after = await client.query('SELECT protection, count(*)::int AS n FROM document_versions GROUP BY 1 ORDER BY 1');
    for (const r of after.rows) console.log(`protection ${r.protection}=${r.n}`);
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
