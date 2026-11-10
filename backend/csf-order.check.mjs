// Self-check: canonical CSF function order used by the csf_subcategories query.
import assert from 'node:assert/strict';
const order = ['GV', 'ID', 'PR', 'DE', 'RS', 'RC'];
const rows = [{ id: 'RC.RP-01', fn: 'RC' }, { id: 'GV.OC-01', fn: 'GV' }, { id: 'ID.AM-01', fn: 'ID' }, { id: 'ID.AM-02', fn: 'ID' }];
const sorted = [...rows].sort((a, b) => order.indexOf(a.fn) - order.indexOf(b.fn) || a.id.localeCompare(b.id));
assert.deepEqual(sorted.map((r) => r.id), ['GV.OC-01', 'ID.AM-01', 'ID.AM-02', 'RC.RP-01']);
console.log('csf-order ok');
