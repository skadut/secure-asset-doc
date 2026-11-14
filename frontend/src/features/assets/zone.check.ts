// Self-check. Run: node --experimental-strip-types src/features/assets/zone.check.ts
import assert from 'node:assert/strict'
import { zoneFor } from './zone.ts'

assert.equal(zoneFor('L0', 'PLC'), 'Z1 Control')
assert.equal(zoneFor('L1', 'RTU'), 'Z1 Control')
assert.equal(zoneFor('L2', 'HMI'), 'Z2 Supervisory')
assert.equal(zoneFor('L3', 'SCADA server'), 'Z2 Supervisory')
assert.equal(zoneFor('L3.5', 'Switch'), 'DMZ')
assert.equal(zoneFor('L4', 'Historian'), 'Z4 Enterprise')
assert.equal(zoneFor('L0', 'Firewall'), 'Z1 Control')
assert.equal(zoneFor('L3', 'Engineering workstation'), 'Z3 Engineering')
assert.equal(zoneFor('L4', 'Engineering workstation'), 'Z4 Enterprise')
assert.equal(zoneFor('L4', 'Data diode'), 'Z4 Enterprise')
assert.equal(zoneFor('L3.5', 'Switch'), 'DMZ')
// eslint-disable-next-line no-console
console.log('zone.check: ok')
