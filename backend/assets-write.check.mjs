// Self-check: asset create/patch validation + zoneFor. Pure; no DB, no HTTP.
import assert from 'node:assert/strict';
import { validateAssetBody, validateAssetPatch, zoneFor } from './assets-write.mjs';

const ASSET = {
  name: 'PLC-01', type: 'PLC', site: 'Substation A', sector: 'Energy', purdueLevel: 'L1',
  vendor: 'Siemens', model: 'S7-1500', firmware: '2.9', ipAddress: '10.0.1.5',
  criticality: 'high', status: 'active', owner: 'Unit OT', lastReviewed: '2026-03-01',
};

// asset body
assert.equal(validateAssetBody(ASSET).ok, true);
for (const p of [
  { ipAddress: '256.1.1.1' },
  { ipAddress: '1.2.3' },
  { ipAddress: '01.2.3.4' },
  { criticality: 'critical' },
  { status: 'deleted' },
  { type: 'Router' },
  { sector: 'Mining' },
  { lastReviewed: '2026-02-30' },
]) assert.equal(validateAssetBody({ ...ASSET, ...p }).ok, false, JSON.stringify(p));

// zoneFor
assert.equal(zoneFor('L0', 'PLC'), 'Z1 Control');
assert.equal(zoneFor('L1', 'PLC'), 'Z1 Control');
assert.equal(zoneFor('L2', 'HMI'), 'Z2 Supervisory');
assert.equal(zoneFor('L3', 'Engineering workstation'), 'Z3 Engineering');
assert.equal(zoneFor('L3', 'Historian'), 'Z2 Supervisory');
assert.equal(zoneFor('L3.5', 'Firewall'), 'DMZ');
assert.equal(zoneFor('L4', 'Switch'), 'Z4 Enterprise');
assert.equal(zoneFor('L5', 'Switch'), null);

// patch
assert.equal(validateAssetPatch({ criticality: 'low', reason: 'annual review' }).ok, true);
assert.equal(validateAssetPatch({ reason: 'no field change' }).ok, true);
assert.equal(validateAssetPatch({ ipAddress: '1.1.1.1', reason: 'x' }).ok, false, 'unknown key');
assert.equal(validateAssetPatch({ criticality: 'low' }).ok, false, 'missing reason');
assert.equal(validateAssetPatch({ criticality: 'x', reason: 'r' }).ok, false, 'bad value');

console.log('assets-write ok');
