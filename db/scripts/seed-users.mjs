import pg from 'pg';
import { hashPassword } from './auth.mjs';
import { buildSlots, computeUnitHeads, LEVELS, SECURITY_OFFICERS, SUPER_ADMIN } from './demo-users.mjs';

const RESET = process.argv.includes('--reset');
const RENAME = process.argv.includes('--rename');
const pw = process.env.DEMO_USER_PASSWORD ?? '';
if (pw.length < 16) {
  console.log('DEMO_USER_PASSWORD missing or too short');
  process.exit(1);
}

const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

// Owner accounts (n=1 slots): sersan-kepala -> doni.setiawan, pembantu-letnan-satu -> surya.pratama.
const OWNER_ACCOUNTS = ['doni.setiawan', 'surya.pratama'];

let exitCode = 0;
try {
  await client.connect();
  await client.query('BEGIN');

  const { rows: ranks } = await client.query('SELECT code, name, golongan FROM ranks ORDER BY sort');
  if (ranks.length !== 22) throw new Error(`expected 22 ranks, got ${ranks.length}`);
  const slots = buildSlots(ranks);

  // 010 objects (access_requests, users.security_officer, users.unit). 010 steps skipped when not applied.
  const { rows: v } = await client.query(`SELECT to_regclass('public.access_requests') IS NOT NULL AS has_requests,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'security_officer') AS has_so,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'unit') AS has_unit`);
  const v010 = v[0].has_requests && v[0].has_so && v[0].has_unit;
  if (!v010) console.log('010 steps skipped: access_requests / users.security_officer / users.unit missing (apply 010_red_strict_dual_auth.sql)');

  const { rows: owners } = await client.query('SELECT DISTINCT owner FROM assets ORDER BY owner LIMIT 2');
  if (owners.length < 2) throw new Error('need 2 distinct asset owners');
  const ownerFor = Object.fromEntries(OWNER_ACCOUNTS.map((u, i) => [u, owners[i].owner]));

  let renamed = 0;
  let inserted = 0;
  let skipped = 0;
  let reset = 0;
  let levelsSet = 0;
  let unitSet = 0;
  const seeded = [];
  for (const s of slots) {
    const hash = await hashPassword(pw);
    const lvl = Object.hasOwn(LEVELS, s.rankCode) ? LEVELS[s.rankCode] : 1;
    const owner = s.n === 1 ? (ownerFor[s.username] ?? null) : null;
    seeded.push(s.username);
    if (RENAME) {
      // Keeps id, so sessions, grants and levels survive. Never deletes.
      const rn = await client.query(
        `UPDATE users SET username = $2, name = $3, updated_at = now()
          WHERE username = $1
            AND NOT EXISTS (SELECT 1 FROM users WHERE username = $2)`,
        [s.oldUsername, s.username, s.name],
      );
      renamed += rn.rowCount;
    }
    const insParams = [s.username, s.name, s.rankCode, hash, owner, lvl];
    if (v010) insParams.push(s.unit);
    const ins = await client.query(
      `INSERT INTO users (username, name, rank_code, password_hash, active, owner_label, access_level${v010 ? ', unit' : ''})
       VALUES ($1, $2, $3, $4, true, $5, $6${v010 ? ', $7' : ''})
       ON CONFLICT (username) DO NOTHING`,
      insParams,
    );
    if (ins.rowCount === 1) {
      inserted++;
    } else if (RESET) {
      await client.query(
        `UPDATE users
            SET password_hash = $2, name = $3, rank_code = $4, active = true,
                owner_label = COALESCE($5::text, owner_label), updated_at = now()
          WHERE username = $1`,
        [s.username, hash, s.name, s.rankCode, owner],
      );
      reset++;
    } else {
      skipped++;
    }
    const lv = await client.query(
      'UPDATE users SET access_level = $2 WHERE username = $1 AND access_level <> $2',
      [s.username, lvl],
    );
    levelsSet += lv.rowCount;
    if (v010) {
      const un = await client.query(
        'UPDATE users SET unit = $2 WHERE username = $1 AND unit IS DISTINCT FROM $2',
        [s.username, s.unit],
      );
      unitSet += un.rowCount;
    }
  }

  // Super admin (014_super_admin.sql): not a rank slot. Needs users.super_admin and the 010 unit column.
  const { rows: sac } = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'super_admin') AS has_sa");
  if (sac[0].has_sa && v010) {
    const s = SUPER_ADMIN;
    const hash = await hashPassword(pw);
    const ins = await client.query(
      `INSERT INTO users (username, name, rank_code, password_hash, active, access_level, unit, super_admin)
       VALUES ($1, $2, $3, $4, true, $5, $6, true) ON CONFLICT (username) DO NOTHING`,
      [s.username, s.name, s.rankCode, hash, s.accessLevel, s.unit],
    );
    if (ins.rowCount === 1) inserted++;
    else if (RESET) {
      await client.query('UPDATE users SET password_hash = $2, name = $3, rank_code = $4, active = true, updated_at = now() WHERE username = $1', [s.username, hash, s.name, s.rankCode]);
      reset++;
    } else skipped++;
    await client.query('UPDATE users SET super_admin = (username = $1) WHERE super_admin IS DISTINCT FROM (username = $1)', [s.username]);
    levelsSet += (await client.query('UPDATE users SET access_level = $2 WHERE username = $1 AND access_level <> $2', [s.username, s.accessLevel])).rowCount;
    seeded.push(s.username);
  } else {
    console.log('super admin skipped: users.super_admin missing (apply 014_super_admin.sql)');
  }

  // unit_head (012_unit_head.sql): exactly one head per unit. Clear stale flags first so the partial unique index
  // (one head per unit) is never violated mid-statement, then set heads. Re-runs are no-ops.
  const { rows: uh } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'unit_head') AS has_uh",
  );
  const hasUh = uh[0].has_uh;
  if (hasUh) {
    const heads = [...computeUnitHeads(slots).values()];
    await client.query(
      'UPDATE users SET unit_head = false WHERE username = ANY($1::text[]) AND unit_head AND NOT (username = ANY($2::text[]))',
      [seeded, heads],
    );
    await client.query(
      'UPDATE users SET unit_head = (username = ANY($1::text[])) WHERE username = ANY($2::text[])',
      [heads, seeded],
    );
  } else {
    console.log('unit_head skipped: users.unit_head missing (apply 012_unit_head.sql)');
  }

  // 010 steps. Officer flags first (requests need them), then RED+STRICT, then dual-approval grants.
  let soSet = 0;
  let redStrict = 0;
  let accessGranted = 0;
  if (v010) {
    // Clears old officer flags (dewi.anggraini, nurul.hikmah, ayu.lestari) by omission.
    const so = await client.query(
      `UPDATE users SET security_officer = (username = ANY($1::text[]))
        WHERE username = ANY($2::text[]) AND security_officer IS DISTINCT FROM (username = ANY($1::text[]))`,
      [SECURITY_OFFICERS, seeded],
    );
    soSet = so.rowCount;

    const red = await client.query("UPDATE documents SET tlp = 'RED+STRICT' WHERE id IN ('DOC-0011', 'DOC-0013') AND tlp = 'RED'");
    redStrict = red.rowCount;

    // Real flow only: request as requester, then commander + security officer approve. No direct grant.
    const DUAL_GRANTS = [
      { doc: 'DOC-0011', grantee: 'ratna.sekarsari', requester: 'hendra.wiratama', approvers: ['yudi.ananda', 'teguh.prasetya'] },
      { doc: 'DOC-0013', grantee: 'rizky.firmansyah', requester: 'hendra.wiratama', approvers: ['yudi.ananda', 'mega.puspitasari'] },
    ];
    for (const g of DUAL_GRANTS) {
      const { rows: [st] } = await client.query(
        `SELECT EXISTS (SELECT 1 FROM document_access_grants dg JOIN users u ON u.id = dg.user_id
                 WHERE dg.document_id = $1 AND u.username = $2 AND dg.revoked_at IS NULL
                   AND (dg.expires_at IS NULL OR dg.expires_at > now())) AS has_grant,
                EXISTS (SELECT 1 FROM access_requests r
                 WHERE r.document_id = $1 AND r.grantee = $2 AND r.status IN ('pending', 'approved')) AS has_request`,
        [g.doc, g.grantee],
      );
      if (st.has_grant || st.has_request) {
        console.log(`access demo ${g.doc} -> ${g.grantee}: skipped (grant or request exists)`);
        continue;
      }
      const { rows: [rq] } = await client.query(
        "SELECT request_document_access($1, $2, $3, $4, now() + interval '90 days') AS r",
        [g.requester, g.doc, g.grantee, 'Demo: kebutuhan operasional tercatat'],
      );
      const requestId = rq.r.requestId;
      let last;
      for (const approver of g.approvers) {
        const { rows: [d] } = await client.query(
          "SELECT decide_access_request($1, $2::bigint, 'approve', NULL::text) AS r",
          [approver, requestId],
        );
        last = d.r;
      }
      if (last.granted !== true) throw new Error(`access demo ${g.doc}: grant not created`);
      accessGranted++;
      console.log(`access demo ${g.doc} -> ${g.grantee}: granted via request ${requestId}`);
    }
    console.log(`010: security_officers_updated=${soSet} red_strict=${redStrict} access_granted=${accessGranted}`);
  }

  if (!RENAME) {
    const { rows: old } = await client.query(
      'SELECT username FROM users WHERE username = ANY($1) ORDER BY username',
      [slots.map((s) => s.oldUsername)],
    );
    if (old.length) {
      console.log(`warning: ${old.length} old rank-code users still present: ${old.map((r) => r.username).join(', ')}`);
      console.log('warning: rerun with --rename to migrate them to the new names (keeps ids; nothing is deleted)');
    }
  }

  // Seed DOC-0017 grants only when both the table and the document exist.
  const { rows: tbl } = await client.query("SELECT to_regclass('public.document_access_grants') IS NOT NULL AS has_table");
  const { rows: doc } = await client.query("SELECT 1 FROM documents WHERE id = 'DOC-0017'");
  let grantsInserted = 0;
  if (tbl[0].has_table && doc.length === 1) {
    const g = await client.query(
      `INSERT INTO document_access_grants (document_id, user_id, granted_by, granted_at, expires_at)
       SELECT 'DOC-0017', u.id, g.id, s.granted_at, s.expires_at
         FROM (VALUES
           ('bagus.hartanto', now(), NULL::timestamptz),
           ('nanda.prasetyo', now(), NULL::timestamptz),
           ('komang.adnyana', now(), NULL::timestamptz),
           ('ahmad.zaelani', '2026-09-01T00:00:00Z'::timestamptz, '2026-10-01T00:00:00Z'::timestamptz)
         ) AS s(username, granted_at, expires_at)
         JOIN users u ON u.username = s.username
         JOIN users g ON g.username = 'hendra.wiratama'
       ON CONFLICT DO NOTHING`,
    );
    grantsInserted = g.rowCount;
  }

  // Derived example: GREEN child of DOC-0017, readable by bagus.hartanto (level 1).
  // Idempotent: skipped when a child with derived_from = 'DOC-0017' exists.
  // Level 1 reads GREEN per canReadLevel; the explicit grant below makes visibility
  // hold regardless of level mapping. Parent TLP is not assumed: derive_document enforces lower TLP.
  const DERIVED_SUMMARY =
    'Ringkasan briefing ini ditujukan untuk penerima yang tercantum. ' +
    'Dokumen ini merupakan turunan tersanitasi dari DOC-0017 dan hanya memuat ringkasan untuk keperluan baca. ' +
    'Tidak ada nama orang nyata, lokasi nyata, maupun rincian operasional di dalamnya. ' +
    'Penerima diharapkan membaca ringkasan ini saja dan tidak meneruskannya tanpa izin.';
  const { rows: col } = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'derived_from'",
  );
  if (col.length === 0) {
    console.log('derived example skipped: documents.derived_from missing (apply 009_derive.sql)');
  } else if (doc.length !== 1) {
    console.log('derived example skipped: DOC-0017 missing');
  } else {
    // Same lock key as derive_document (009_derive.sql). Serializes concurrent seed runs so the
    // check-then-create below is race-free; the check makes re-runs a no-op.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('derive_document'))");
    const { rows: child } = await client.query("SELECT 1 FROM documents WHERE derived_from = 'DOC-0017' LIMIT 1");
    if (child.length === 0) {
      const { rows: d } = await client.query(
        "SELECT derive_document('hendra.wiratama', 'DOC-0017', 'Briefing Operasi Glasswing (sanitasi)', 'GREEN', $1) AS r",
        [DERIVED_SUMMARY],
      );
      const documentId = d[0].r.documentId;
      await client.query(
        'SELECT grant_document_access($1, $2, $3, NULL::timestamptz)',
        ['hendra.wiratama', documentId, 'bagus.hartanto'],
      );
      console.log(`derived example created: ${documentId} from DOC-0017, granted bagus.hartanto`);
    } else {
      console.log('derived example present: skipped');
    }
  }

  await client.query('COMMIT');

  console.log(`renamed=${renamed} inserted=${inserted} skipped=${skipped} reset=${reset} levels_set=${levelsSet} unit_set=${unitSet}`);
  console.log(`grants inserted=${grantsInserted} doc_present=${doc.length === 1}`);
  const { rows: accts } = await client.query(
    `SELECT u.username, r.golongan, u.access_level,
            ${v010 ? 'u.unit, u.security_officer' : 'NULL::text AS unit, false AS security_officer'},
            ${hasUh ? 'u.unit_head' : 'false AS unit_head'}
       FROM users u JOIN ranks r ON r.code = u.rank_code
      WHERE u.username = ANY($1)
      ORDER BY r.sort, u.username`,
    [seeded],
  );
  for (const a of accts) console.log(`${a.username} ${a.golongan} L${a.access_level} ${a.unit ?? '-'}${a.unit_head ? ' KEPALA UNIT' : ''}${a.security_officer ? ' SO' : ''}`);
  console.log(`total=${accts.length}`);
} catch (err) {
  try { await client.query('ROLLBACK'); } catch {}
  console.log('error: ' + err.message);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exitCode = exitCode;
