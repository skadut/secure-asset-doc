// Self-check: GRC filter. Level reads, grant unlock, hidden docs absent (no stubs), officer restrictedDocuments shape, audit leak drop. Pure.
import assert from 'node:assert/strict';
import { filterGrc } from './grc-filter.mjs';

// Fixture: CLEAR, AMBER+STRICT, RED, RED+STRICT. No title keys (hidden docs must not carry titles out).
const grc = {
  documents: [
    { id: 'DOC-0001', tlp: 'CLEAR', versions: [{ version: '1.0', date: '2026-01-01' }] },
    { id: 'DOC-0002', tlp: 'AMBER+STRICT', versions: [{ version: '1.0', date: '2026-03-01' }, { version: '0.9', date: '2026-02-01' }] },
    { id: 'DOC-0003', tlp: 'RED', versions: [] },
    { id: 'DOC-0004', tlp: 'RED+STRICT', versions: [{ version: '1.0', date: '2026-05-01' }] },
  ],
  evidenceLinks: [{ documentId: 'DOC-0004' }, { documentId: 'DOC-0001' }],
  assetDocLinks: [{ documentId: 'DOC-0004' }, { documentId: 'DOC-0003' }],
  auditEvents: [
    { objectType: 'document', objectId: 'DOC-0004', summary: 'create' },
    { objectType: 'document', objectId: 'DOC-0001', summary: 'create' },
  ],
  assets: [], csfSubcategories: [],
};
const RESTRICTED_KEYS = ['createdAt', 'grantees', 'id', 'tlp', 'versionCount'];

// (a) Level 5, no grant: RED readable, RED+STRICT hidden with all links and audit rows.
{
  const out = filterGrc(grc, { accessLevel: 5 });
  assert.deepEqual(out.documents.map((d) => d.id), ['DOC-0001', 'DOC-0002', 'DOC-0003']);
  assert.ok(out.documents.every((d) => d.granted === undefined));
  assert.equal(JSON.stringify(out).includes('"locked"'), false, 'no locked key');
  assert.equal(JSON.stringify(out).includes('"title"'), false, 'no title key');
  assert.deepEqual(out.evidenceLinks.map((e) => e.documentId), ['DOC-0001']);
  assert.deepEqual(out.assetDocLinks.map((e) => e.documentId), ['DOC-0003']);
  assert.deepEqual(out.auditEvents.map((e) => e.objectId), ['DOC-0001']);
  assert.equal(out.restrictedDocuments, undefined, 'non-officer: no restrictedDocuments');
}

// (b) Level 5 with grant on RED+STRICT: doc present, flagged granted.
{
  const out = filterGrc(grc, { accessLevel: 5, grantedIds: new Set(['DOC-0004']) });
  const d = out.documents.find((x) => x.id === 'DOC-0004');
  assert.ok(d, 'granted doc present');
  assert.equal(d.granted, true);
  assert.equal(out.documents.length, 4);
  assert.deepEqual(out.evidenceLinks.map((e) => e.documentId), ['DOC-0004', 'DOC-0001']);
}

// (c) Security officer, level 2: hidden docs listed as restricted metadata only.
{
  const granteesByDoc = new Map([['DOC-0004', ['kapten.test']], ['DOC-0002', ['letnan-satu.test']]]);
  const out = filterGrc(grc, { accessLevel: 2, securityOfficer: true, granteesByDoc });
  assert.deepEqual(out.documents.map((d) => d.id), ['DOC-0001']);
  assert.deepEqual(out.restrictedDocuments.map((d) => d.id), ['DOC-0002', 'DOC-0003', 'DOC-0004']);
  for (const r of out.restrictedDocuments) assert.deepEqual(Object.keys(r).sort(), RESTRICTED_KEYS);
  assert.equal(JSON.stringify(out).includes('"title"'), false, 'no title key anywhere');
  assert.equal(JSON.stringify(out).includes('"locked"'), false, 'no locked key anywhere');
  const byId = Object.fromEntries(out.restrictedDocuments.map((d) => [d.id, d]));
  assert.deepEqual(byId['DOC-0002'], { id: 'DOC-0002', tlp: 'AMBER+STRICT', createdAt: '2026-02-01', versionCount: 2, grantees: ['letnan-satu.test'] });
  assert.deepEqual(byId['DOC-0003'], { id: 'DOC-0003', tlp: 'RED', createdAt: null, versionCount: 0, grantees: [] });
  assert.deepEqual(byId['DOC-0004'], { id: 'DOC-0004', tlp: 'RED+STRICT', createdAt: '2026-05-01', versionCount: 1, grantees: ['kapten.test'] });
  assert.deepEqual(out.evidenceLinks.map((e) => e.documentId), ['DOC-0001']);
  assert.deepEqual(out.auditEvents.map((e) => e.objectId), ['DOC-0001']);
}

// Officer at level 5: restricted list is only RED+STRICT.
{
  const out = filterGrc(grc, { accessLevel: 5, securityOfficer: true });
  assert.deepEqual(out.restrictedDocuments.map((d) => d.id), ['DOC-0004']);
}

// (d) Non-officer: no restrictedDocuments key at all, even when docs are hidden.
{
  const out = filterGrc(grc, { accessLevel: 2 });
  assert.equal('restrictedDocuments' in out, false);
  assert.deepEqual(out.documents.map((d) => d.id), ['DOC-0001']);
}

// (e) Audit event mentioning a hidden doc id in summary/changes is dropped; unrelated events kept.
{
  const withLeaks = {
    ...grc,
    auditEvents: [
      { objectType: 'document', objectId: 'DOC-0001', summary: 'copied from DOC-0004' },
      { objectType: 'document', objectId: 'DOC-0001', summary: 'edit', changes: { ref: 'DOC-0004' } },
      { objectType: 'document', objectId: 'DOC-0001', summary: 'edit', changes: { ref: 'DOC-0003' } },
    ],
  };
  const out = filterGrc(withLeaks, { accessLevel: 5 });
  assert.equal(out.auditEvents.length, 1);
  assert.deepEqual(out.auditEvents[0].changes, { ref: 'DOC-0003' });
  assert.equal(JSON.stringify(out).includes('DOC-0004'), false, 'hidden id absent from output');
}

// (f) Leak check applies to every objectType, not only 'document'.
{
  const typed = {
    ...grc,
    auditEvents: [
      { objectType: 'evidence', objectId: 'EV-1', summary: 'linked DOC-0004' },
      { objectType: 'asset', objectId: 'AS-1', summary: 'attached DOC-0004' },
      { objectType: 'user', objectId: 'U-1', summary: 'edit', changes: { doc: 'DOC-0004' } },
      { objectType: 'user', objectId: 'U-2', summary: 'login', changes: { ref: 'DOC-0001' } },
    ],
  };
  const out = filterGrc(typed, { accessLevel: 5 });
  assert.deepEqual(out.auditEvents.map((e) => e.objectId), ['U-2']);
  assert.equal(JSON.stringify(out).includes('DOC-0004'), false, 'hidden id absent from typed events');
}

// Missing / invalid level fails closed: nothing readable except grants.
{
  const none = filterGrc(grc, {});
  assert.equal(none.documents.length, 0);
  assert.equal(filterGrc(grc, { accessLevel: 0 }).documents.length, 0);
  assert.equal(filterGrc(grc, { accessLevel: 0, grantedIds: new Set(['DOC-0004']) }).documents[0].granted, true);
}

// Controls pass through untouched; absent input -> [].
{
  const controls = [{ id: 'AC-2', family: 'AC', name: 'Account Management', implementation: 'x', location: 'y' }];
  const out = filterGrc({ ...grc, controls }, { accessLevel: 5 });
  assert.deepEqual(out.controls, controls);
  assert.deepEqual(filterGrc(grc, { accessLevel: 5 }).controls, []);
  assert.equal(filterGrc(grc, { accessLevel: 2 }).controls.length, 0);
}

// Input not mutated.
assert.equal(grc.documents.length, 4);
assert.equal(grc.documents[3].granted, undefined);
assert.equal(grc.auditEvents.length, 2);

console.log('grc-filter ok');
