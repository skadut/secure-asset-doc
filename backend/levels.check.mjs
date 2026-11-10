// Self-check: level change. validateRaise is pure (no DB); SQL and routes checked by source text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRaise } from './levels.mjs';

const sql = readFileSync(fileURLToPath(new URL('../db/init/011_level_change.sql', import.meta.url)), 'utf8');
const server = readFileSync(fileURLToPath(new URL('./server.mjs', import.meta.url)), 'utf8');

const today = new Date().toISOString().slice(0, 10);
const shift = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const inMonths = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };

const valid = {
  newLevel: 4,
  justification: 'Kebutuhan misi operasi',
  screeningVerified: true,
  screeningRef: 'PS-3/2026/07',
  accessAgreementSigned: true,
  accessAgreementDate: shift(-30),
  reviewDue: inMonths(6),
  fips199Basis: 'HIGH',
};
const with_ = (patch, base = valid) => ({ ...base, ...patch });
const dropKey = (k) => { const o = { ...valid }; delete o[k]; return o; };
const fail = (input, level = 2) => assert.notEqual(validateRaise(input, level), null, JSON.stringify(input));
const pass = (input, level = 2) => assert.equal(validateRaise(input, level), null);

// Valid raise, 2 -> 4.
pass(valid, 2);

// Basis mapping is exact: 1-2 LOW, 3 MODERATE, 4-5 HIGH.
pass(with_({ newLevel: 1, fips199Basis: 'LOW' }), 0);
pass(with_({ newLevel: 2, fips199Basis: 'LOW' }), 1);
pass(with_({ newLevel: 3, fips199Basis: 'MODERATE' }));
pass(with_({ newLevel: 5, fips199Basis: 'HIGH' }));
fail(with_({ newLevel: 3, fips199Basis: 'LOW' }));
fail(with_({ newLevel: 3, fips199Basis: 'HIGH' }));
fail(with_({ newLevel: 4, fips199Basis: 'MODERATE' }));
fail(with_({ fips199Basis: 'high' }));
fail(with_({ fips199Basis: 'moderate' }));
fail(with_({ fips199Basis: undefined }));

// Screening (PS-3).
fail(with_({ screeningVerified: false }));
fail(dropKey('screeningVerified'));

// Access agreement (PS-6): signed, valid date, not in the future.
fail(with_({ accessAgreementSigned: false }));
fail(dropKey('accessAgreementDate'));
fail(with_({ accessAgreementDate: '2999-13-01' }));
fail(with_({ accessAgreementDate: '2999-01-01' }));

// Review due (AC-2): strictly after today, at most 12 months out.
fail(dropKey('reviewDue'));
fail(with_({ reviewDue: 'tomorrow' }));
fail(with_({ reviewDue: shift(400) }));
fail(with_({ reviewDue: '2020-01-01' }));
fail(with_({ reviewDue: today }));

// Justification: 1..500 chars after trim.
fail(with_({ justification: '   ' }));
fail(with_({ justification: 'a'.repeat(501) }));

// newLevel: integer 1..5.
fail(with_({ newLevel: 6 }));
fail(with_({ newLevel: 0 }));
fail(with_({ newLevel: 2.5 }));
fail(with_({ newLevel: '4' }));

// Raise only. Equal and lower both rejected by validateRaise (route lowers before calling it).
fail(valid, 4);
fail(valid, 5);

// Source-text asserts on 011 (approval / role rules).
const sqlRules = [
  /security_officer/i,
  /access_level\s*=\s*5/i,
  /p_actor\s*=\s*p_target/i,
  /DELETE\s+FROM\s+sessions/i,
  /level_change_pending_uq/i,
  /users_officer_not_l5_check|new_level\s*=\s*5\s+AND\s+v_target\.security_officer/i,
  /review_due/i,
  /12\s+months/i,
  /'HIGH'/i,
  /'MODERATE'/i,
  /'LOW'/i,
];
for (const re of sqlRules) assert.match(sql, re, `011 missing ${re}`);

// Source-text asserts on server.mjs routes (regex-literal style used by the route table).
const routes = [
  String.raw`/^\/api\/users\/([^/]+)\/level-requests$/`,
  String.raw`/^\/api\/level-requests$/`,
  String.raw`/^\/api\/level-requests\/([^/]+)\/decision$/`,
];
for (const r of routes) assert.ok(server.includes(r), `server.mjs missing route ${r}`);

console.log('PASS validateRaise valid 2->4');
console.log('PASS validateRaise basis mapping, screening, agreement, review due, justification, newLevel, raise-only');
console.log('PASS 011_level_change.sql rule text');
console.log('PASS server.mjs level routes');
