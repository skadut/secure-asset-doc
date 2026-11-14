// Self-check: document create validation + nextId. Pure; no DB, no HTTP.
import assert from 'node:assert/strict';
import { validateDocBody, nextId } from './doc-create.mjs';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
const GOOD = {
  title: 'Access policy', type: 'Policy', owner: 'Unit OT', approver: 'Captain Budi', tlp: 'AMBER',
  status: 'draft', nextReview: '2026-12-01', version: '1.0', summary: 'Summary.',
  file: { name: 'C:\\tmp\\policy.pdf', mime: 'application/pdf', data: PDF },
};
const bad = (patch) => validateDocBody({ ...GOOD, ...patch });

// valid doc: trimmed fields, sanitized name, no buffer returned
const ok = validateDocBody({ ...GOOD, title: '  Access policy  ' });
assert.equal(ok.ok, true);
assert.equal(ok.value.title, 'Access policy');
assert.equal(ok.value.file.name, 'policy.pdf');
assert.equal(ok.value.file.data, PDF);
assert.equal(Object.hasOwn(ok.value.file, 'buf'), false);

// xlsx: ZIP magic accepted
const xlsxData = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]).toString('base64');
assert.equal(bad({ file: { name: 'a.xlsx', mime: XLSX, data: xlsxData } }).ok, true);

// rejected
const cases = [
  { tlp: 'SECRET' },
  { type: 'Unknown' },
  { version: '1' },
  { version: '1.0.0' },
  { nextReview: '2026-02-30' },
  { title: 'x'.repeat(201) },
  { title: '   ' },
  { status: 'approved' },
  { file: { ...GOOD.file, mime: 'image/png' } },
  { file: { ...GOOD.file, name: '' } },
  { file: { ...GOOD.file, data: Buffer.from('hello').toString('base64') } },
  { file: { name: 'a.xlsx', mime: XLSX, data: Buffer.from('hello').toString('base64') } },
];
for (const p of cases) assert.equal(bad(p).ok, false, JSON.stringify(p).slice(0, 100));

// oversize base64: 413 before decode
const big = bad({ file: { ...GOOD.file, data: 'A'.repeat(14000000) } });
assert.equal(big.status, 413);
assert.equal(big.error, 'too large');

// nextId
assert.equal(nextId('DOC', []), 'DOC-0001');
assert.equal(nextId('DOC', ['DOC-0003', 'DOC-0007', 'DOC-0001']), 'DOC-0008');
assert.equal(nextId('DOC', ['DOC-12', 'DOC-00010', 'AST-0009', 'DOC-0002x', 'DOC-0005']), 'DOC-0006');
assert.equal(nextId('AST', ['AST-0009']), 'AST-0010');

console.log('doc-create ok');
