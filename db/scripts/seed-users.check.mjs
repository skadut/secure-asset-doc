// Self-check: demo user slots. Pure: no DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_NAMES, GOLONGAN_COUNT, HQ_UNIT, LEVELS, SECURITY_OFFICERS, UNITS, unitFor, usernameFor, buildSlots, computeUnitHeads } from './demo-users.mjs';

// 22 ranks, sort order, golongan per rank (mirrors db/seed/001_reference.sql).
const RANKS = [
  ['jenderal-tni', 'PATI'], ['letnan-jenderal-tni', 'PATI'], ['mayor-jenderal-tni', 'PATI'], ['brigadir-jenderal-tni', 'PATI'],
  ['kolonel', 'PAMEN'], ['letnan-kolonel', 'PAMEN'], ['mayor', 'PAMEN'],
  ['kapten', 'PAMA'], ['letnan-satu', 'PAMA'], ['letnan-dua', 'PAMA'],
  ['pembantu-letnan-satu', 'Bintara Tinggi'], ['pembantu-letnan-dua', 'Bintara Tinggi'],
  ['sersan-mayor', 'Bintara'], ['sersan-kepala', 'Bintara'], ['sersan-satu', 'Bintara'], ['sersan-dua', 'Bintara'],
  ['kopral-kepala', 'Tamtama Kepala'], ['kopral-satu', 'Tamtama Kepala'], ['kopral-dua', 'Tamtama Kepala'],
  ['prajurit-kepala', 'Tamtama'], ['prajurit-satu', 'Tamtama'], ['prajurit-dua', 'Tamtama'],
].map(([code, golongan]) => ({ code, golongan }));

const slots = buildSlots(RANKS);
assert.equal(slots.length, 80);
assert.equal(DEMO_NAMES.length, 80);

const usernames = slots.map((s) => s.username);
assert.equal(new Set(usernames).size, 80, 'usernames unique');
for (const u of usernames) assert.match(u, /^[a-z0-9.-]{3,40}$/, `regex ${u}`);
assert.equal(new Set(slots.map((s) => s.oldUsername)).size, 80, 'old usernames unique');

// Counts per golongan.
const perGol = {};
for (const s of slots) perGol[s.golongan] = (perGol[s.golongan] ?? 0) + 1;
for (const [g, n] of Object.entries(GOLONGAN_COUNT)) {
  assert.equal(perGol[g], RANKS.filter((r) => r.golongan === g).length * n, `count ${g}`);
}
assert.deepEqual(perGol, { PATI: 8, PAMEN: 6, PAMA: 6, 'Bintara Tinggi': 10, Bintara: 20, 'Tamtama Kepala': 15, Tamtama: 15 });

// Spot-check deterministic mapping.
assert.equal(slots[0].username, 'hendra.wiratama');
assert.equal(slots[0].oldUsername, 'jenderal-tni');
assert.equal(slots[1].oldUsername, 'jenderal-tni-2');
assert.equal(usernameFor('Ahmad Zaelani'), 'ahmad.zaelani');
assert.equal(usernameFor('  Sari   Rejeki '), 'sari.rejeki');

console.log('PASS slots count 80');

// Level 5 = commanders. Level lookup mirrors seed: unlisted rank code -> 1.
const levelOf = (s) => (Object.hasOwn(LEVELS, s.rankCode) ? LEVELS[s.rankCode] : 1);

// Every slot has a known unit.
for (const s of slots) {
  assert.equal(typeof s.unit, 'string', `unit type ${s.username}`);
  assert.ok(UNITS.includes(s.unit), `unit in UNITS ${s.username}`);
}
console.log('PASS every slot unit in UNITS');

// Level-5 slots: exactly 4, all HQ.
const level5 = slots.filter((s) => levelOf(s) === 5);
assert.equal(level5.length, 4, 'level 5 count');
for (const s of level5) assert.equal(s.unit, HQ_UNIT, `level 5 unit ${s.username}`);
console.log('PASS level 5 slots all HQ_UNIT (4)');

// Security officers.
assert.ok(SECURITY_OFFICERS.length >= 3 && SECURITY_OFFICERS.length <= 5, 'SO count 3-5');
assert.equal(new Set(SECURITY_OFFICERS).size, SECURITY_OFFICERS.length, 'SO unique');
const bySlot = new Map(slots.map((s) => [s.username, s]));
for (const u of SECURITY_OFFICERS) {
  const s = bySlot.get(u);
  assert.ok(s, `SO present in slots ${u}`);
  assert.equal(s.unit, 'Unit Intelijen', `SO unit ${u}`);
  assert.notEqual(levelOf(s), 5, `SO not level 5 ${u}`);
}
console.log('PASS security officers valid');

// At least one Unit Intelijen slot is not an SO.
const intel = slots.filter((s) => s.unit === 'Unit Intelijen');
assert.ok(intel.some((s) => !SECURITY_OFFICERS.includes(s.username)), 'non-SO in Unit Intelijen');
console.log('PASS non-SO exists in Unit Intelijen');

// Unit distribution.
const dist = {};
for (const s of slots) dist[s.unit] = (dist[s.unit] ?? 0) + 1;
assert.deepStrictEqual(dist, {
  'Markas Komando': 4,
  'Unit Intelijen': 11,
  'Unit Operasi': 11,
  'Unit Logistik': 11,
  'Unit Komunikasi dan Elektronika': 11,
  'Unit Personel': 11,
  'Unit Zeni': 11,
  'Unit Kesehatan': 10,
});
console.log('PASS unit distribution');

// unitFor wrap and HQ slots.
for (const i of [0, 1, 2, 3]) assert.equal(unitFor(i), HQ_UNIT, `unitFor(${i})`);
assert.equal(unitFor(4), 'Unit Intelijen');
assert.equal(unitFor(10), 'Unit Kesehatan');
assert.equal(unitFor(11), 'Unit Intelijen');
console.log('PASS unitFor mapping and wrap');

// No password-like literal in demo-users.mjs.
const src = readFileSync(new URL('./demo-users.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(src, /pass(word)?\s*[:=]/i, 'no password literal in demo-users.mjs');
console.log('PASS no password literal in demo-users.mjs');

// unit_head: exactly one head per unit, highest level, tie -> lowest slot index.
assert.equal(UNITS.length, 8, '8 units');
const heads = computeUnitHeads(slots);
const unitsInSlots = new Set(slots.map((s) => s.unit));
assert.equal(heads.size, unitsInSlots.size, 'one head per distinct unit');
for (const u of UNITS) assert.ok(heads.has(u), `head exists for ${u}`);
const idxOf = new Map(slots.map((s, i) => [s.username, i]));
for (const [unit, username] of heads) {
  assert.ok(idxOf.has(username), `head in slots ${username}`);
  const headLvl = levelOf(slots[idxOf.get(username)]);
  const inUnit = slots.filter((s) => s.unit === unit);
  const maxLvl = Math.max(...inUnit.map(levelOf));
  assert.equal(headLvl, maxLvl, `head max level ${username}`);
  const firstMax = inUnit.find((s) => levelOf(s) === maxLvl);
  assert.equal(firstMax.username, username, `head is lowest index at max level ${username}`);
  assert.equal(new Set(inUnit.map((s) => s.username)).size, inUnit.length, 'usernames unique per unit');
}
assert.equal(heads.get(HQ_UNIT), 'hendra.wiratama', 'HQ head lowest index level 5');
assert.equal(levelOf(slots[idxOf.get(heads.get(HQ_UNIT))]), 5, 'HQ head level 5');
console.log('PASS unit heads (1 per unit, HQ level 5)');
for (const [unit, username] of heads) console.log(`  ${unit}: ${username}`);

console.log('seed-users check ok');
