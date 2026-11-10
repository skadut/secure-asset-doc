// Self-check: sid cookie parsing, Me shape (incl. security officer + access flags), GRC filter via session path. Pure; DB lookup via fake q.
import assert from 'node:assert/strict';
import { parseSid, sidSetCookie, meJson, meFromRow, lookupSession, SID } from './session.mjs';
import { filterGrc } from './grc-filter.mjs';
import { hashSessionToken } from './auth.mjs';

const TOK = 'A'.repeat(43);

// Cookie parsing
assert.equal(parseSid(`x=1; ${SID}=${TOK}; y=2`), TOK);
assert.equal(parseSid(`${SID}=short`), null);
assert.equal(parseSid(`${SID}=${'A'.repeat(42)}!`), null);
assert.equal(parseSid(undefined), null);
assert.match(sidSetCookie(TOK), /HttpOnly/);
assert.match(sidSetCookie(TOK), /SameSite=Strict/);
assert.match(sidSetCookie(TOK), /Max-Age=1800/);

// Lookup: hashes token, returns null when no row
const seen = [];
const q = async (sql, params) => {
  seen.push(params);
  return { rows: [] };
};
assert.equal(await lookupSession(q, `${SID}=${TOK}`), null);
assert.equal(seen[0][0], hashSessionToken(TOK));
assert.equal(await lookupSession(q, 'nope=1'), null);
assert.equal(seen.length, 1, 'no DB hit without sid cookie');

// meFromRow: security_officer + unit mapping; missing -> false/null.
{
  const me = meFromRow({ id: 'u', username: 'k', name: 'n', rank_code: 'kolonel', owner_label: null, access_level: '2', security_officer: true, unit: 'Unit Intelijen' });
  assert.equal(me.securityOfficer, true);
  assert.equal(me.unit, 'Unit Intelijen');
  assert.equal(me.accessLevel, 2);
  const plain = meFromRow({ id: 'u', username: 'k', name: 'n', rank_code: 'kapten', owner_label: null, access_level: '3' });
  assert.equal(plain.securityOfficer, false);
  assert.equal(plain.unit, null);
  assert.equal(meFromRow({ id: 'u', username: 'k', name: 'n', rank_code: 'kapten', owner_label: null, access_level: '3', security_officer: 'true' }).securityOfficer, false, 'only boolean true');
  // unit_head: display label only. true -> true; false/missing/non-boolean -> false.
  assert.equal(meFromRow({ id: 'u', username: 'k', name: 'n', rank_code: 'kolonel', owner_label: null, access_level: '2', unit_head: true }).unitHead, true);
  assert.equal(meFromRow({ id: 'u', username: 'k', name: 'n', rank_code: 'kolonel', owner_label: null, access_level: '2', unit_head: false }).unitHead, false);
  assert.equal(plain.unitHead, false, 'missing unit_head -> false');
  assert.equal(meFromRow({ id: 'u', username: 'k', name: 'n', rank_code: 'kapten', owner_label: null, access_level: '3', unit_head: 'true' }).unitHead, false, 'only boolean true');
}

// Me shape
const me = meJson({ id: 'u', username: 'kapten', name: 'n', rankCode: 'kapten', ownerLabel: null, accessLevel: 2 });
assert.equal(me.golongan, 'PAMA');
assert.equal(me.rank, 'kapten');
assert.equal(me.rankName, 'Kapten');
assert.equal(me.accessLevel, 2);
assert.equal(me.tlpMax, 'AMBER');
assert.equal(me.securityOfficer, false);
assert.equal(me.unit, null);
assert.equal(me.unitHead, false);
assert.equal(me.can.document.uDraftOnly, true);
assert.equal(me.can.document.approve, false);
assert.equal(me.can.account.r, false);
assert.equal(me.can.version, undefined);
assert.equal(me.can.upload.r, true);
assert.equal(me.can.access.grant, false);
assert.equal(me.can.access.request, false);
assert.equal(me.can.access.approve, false);
assert.equal(me.can.access.revoke, false);
const adm = meJson({ id: 'u', username: 'jend', name: 'n', rankCode: 'jenderal-tni', ownerLabel: null, accessLevel: 5 });
assert.equal(adm.tlpMax, 'RED');
assert.equal(adm.can.access.grant, true);
assert.equal(adm.can.access.approve, true);
assert.equal(adm.can.access.request, true);
assert.equal(adm.can.access.revoke, true);
assert.equal(meJson({ id: 'u', username: 'x', name: 'n', rankCode: 'prajurit-dua', ownerLabel: null, accessLevel: 1 }).tlpMax, 'GREEN');

// Security officer (level 2, PAMA): access request/approve/revoke, no grant.
const so = meJson({ id: 'u', username: 'so', name: 'n', rankCode: 'kapten', ownerLabel: null, accessLevel: 2, securityOfficer: true, unit: 'Unit Intelijen' });
assert.equal(so.securityOfficer, true);
assert.equal(so.unit, 'Unit Intelijen');
assert.equal(so.unitHead, false);
const head = meJson({ id: 'u', username: 'head', name: 'n', rankCode: 'kolonel', ownerLabel: null, accessLevel: 3, unit: 'Unit Intelijen', unitHead: true });
assert.equal(head.unitHead, true);
assert.equal(head.securityOfficer, false, 'unit_head does not grant security officer');
assert.equal(head.can.access.approve, false, 'unit_head does not grant access approve');
assert.equal(so.accessLevel, 2);
assert.equal(so.can.access.grant, false);
assert.equal(so.can.access.request, true);
assert.equal(so.can.access.approve, true);
assert.equal(so.can.access.revoke, true);

// GRC filter via session path (hidden = absent; no stubs).
const grc = {
  documents: [
    { id: 'DOC-0001', tlp: 'CLEAR', versions: [{ version: '1.0' }] },
    { id: 'DOC-0002', tlp: 'AMBER', versions: [] },
    { id: 'DOC-0003', tlp: 'RED', versions: [] },
    { id: 'DOC-0004', tlp: 'RED+STRICT', versions: [] },
  ],
  evidenceLinks: [{ documentId: 'DOC-0003' }, { documentId: 'DOC-0001' }],
  assetDocLinks: [{ documentId: 'DOC-0003' }, { documentId: 'DOC-0002' }],
  auditEvents: [
    { objectType: 'document', objectId: 'DOC-0003' },
    { objectType: 'document', objectId: 'DOC-0001' },
    { objectType: 'asset', objectId: 'DOC-0003' },
  ],
  assets: [], csfSubcategories: [],
};
const level1 = filterGrc(grc, { accessLevel: 1 });
assert.deepEqual(level1.documents.map((d) => d.id), ['DOC-0001']);
assert.equal(JSON.stringify(level1).includes('"locked"'), false);
assert.equal(level1.evidenceLinks.length, 1);
assert.equal(level1.assetDocLinks.length, 0);
assert.equal(level1.auditEvents.length, 2, 'asset-typed event kept, hidden-doc event dropped');
const level5 = filterGrc(grc, { accessLevel: 5 });
assert.deepEqual(level5.documents.map((d) => d.id), ['DOC-0001', 'DOC-0002', 'DOC-0003']);
assert.equal(grc.documents.length, 4, 'input not mutated');

console.log('session ok');
