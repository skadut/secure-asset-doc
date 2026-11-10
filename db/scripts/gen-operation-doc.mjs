// Writes a fictional 2-page training PDF. Hand-written PDF 1.4, Helvetica only, no deps.
// ponytail: no font embedding, ASCII text only. Add embedding when non-ASCII text is needed.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const target = new URL('../seed-files/operation-order-exercise-glasswing.pdf', import.meta.url);
const F1 = 'F1', F2 = 'F2';
const esc = (s) => s.replace(/[\\()]/g, '\\$&');
const T = (x, y, size, font, s) => `BT /${font} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET\n`;
const L = (x1, y1, x2, y2) => `${x1} ${y1} m ${x2} ${y2} l S\n`;
const H = (y, s) => T(72, y, 12, F2, s);
const B = (y, s) => T(72, y, 10, F1, s);

function table(x, top, widths, head, rows) {
  const rh = 18, pad = 4, all = [head, ...rows], W = widths.reduce((a, b) => a + b, 0);
  let c = '';
  for (let r = 0; r <= all.length; r++) c += L(x, top - r * rh, x + W, top - r * rh);
  let cx = x;
  for (let k = 0; k <= widths.length; k++) {
    c += L(cx, top, cx, top - all.length * rh);
    if (k < widths.length) cx += widths[k];
  }
  all.forEach((row, r) => {
    let tx = x;
    row.forEach((cell, k) => {
      c += T(tx + pad, top - r * rh - 13, 9, r === 0 ? F2 : F1, cell);
      tx += widths[k];
    });
  });
  return c;
}

function frame(n) {
  return T(40, 772, 8, F2, 'TLP:AMBER+STRICT') + L(40, 765, 572, 765)
    + L(40, 50, 572, 50)
    + T(40, 38, 8, F1, 'FICTIONAL TRAINING DOCUMENT - no real operational detail')
    + T(500, 38, 8, F1, `Page ${n} of 2`)
    + T(40, 24, 8, F2, 'TLP:AMBER+STRICT');
}

const p1 = frame(1)
  + T(72, 735, 18, F2, 'OPERATION ORDER - EXERCISE GLASSWING')
  + T(72, 714, 9, F1, 'Document: DOC-0017  Version: 1.0  Status: approved  TLP: AMBER+STRICT')
  + T(72, 700, 9, F1, 'Owner: Tim Respons Insiden Simulasi  Approver: Dewan Pengarah Simulasi  Next review: 2027-04-28')
  + H(672, '1 Situation')
  + B(656, 'Fictional tabletop scenario only. A simulated telemetry fault is reported at the')
  + B(642, 'fictional relay site "Marlow Supply Depot Relay Site". Generic conditions only; no real')
  + B(628, 'system, vendor, or network is described.')
  + H(600, '2 Mission')
  + B(584, 'Validate notification and recovery procedures for fictional OT sites in a training exercise.')
  + H(552, '3 Execution')
  + table(72, 536, [60, 80, 220, 108], ['Phase', 'Window', 'Activity', 'Lead'], [
    ['P0 Notify', 'T+00:00', 'Issue exercise start notice', 'Exercise Control'],
    ['P1 Assess', 'T+00:30', 'Simulated triage of fictional asset list', 'Control Cell Lead'],
    ['P2 Contain', 'T+01:30', 'Tabletop containment decision', 'Incident Team'],
    ['P3 Recover', 'T+03:00', 'Simulated restore walk-through', 'Recovery Team'],
    ['P4 Debrief', 'T+04:30', 'Lessons recorded', 'Recorder'],
  ]);

const p2 = frame(2)
  + H(735, '4 Sustainment / Logistics')
  + B(719, '- Printed checklists (simulated, fictional)')
  + B(705, '- Simulated tickets for the exercise board')
  + B(691, '- Exercise binders for each control cell')
  + B(677, '- Room booking for the tabletop session')
  + H(645, '5 Command & Signal')
  + B(629, 'Exercise Control is led by Dewan Pengarah Simulasi (Exercise Director role).')
  + B(615, 'Simulated message channel: EX-GLASS only. No other channel is used in this exercise.')
  + H(585, 'Annex A - Linked assets')
  + table(72, 569, [90, 180, 198], ['ID', 'Name', 'Site'], [
    ['AST-0003', 'Water SCADA Server A', 'Camp Halvard Operations Center'],
    ['AST-0013', 'Energy SCADA Server', 'Kestrel Naval Station Operations Center'],
    ['AST-0006', 'Water Zone Firewall', 'Camp Halvard Operations Center'],
  ])
  + H(465, 'Annex B - Points of contact (roles only)')
  + B(449, '- Exercise Director')
  + B(435, '- Control Cell Lead')
  + B(421, '- Incident Team Lead')
  + B(407, '- Recorder');

const stream = (s) => `<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}endstream`;
const pageDict = (contents) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contents} 0 R >>`;
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [5 0 R 7 0 R] /Count 2 >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  pageDict(6), stream(p1),
  pageDict(8), stream(p2),
];

const chunks = [];
let pos = 0;
const put = (s) => { const b = Buffer.from(s, 'latin1'); chunks.push(b); pos += b.length; };
put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
const offs = objs.map((body, i) => { const off = pos; put(`${i + 1} 0 obj\n${body}\nendobj\n`); return off; });
const xref = pos;
put(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join(''));
put(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
const out = Buffer.concat(chunks);

// Self-check
const s = out.toString('latin1');
assert.ok(s.startsWith('%PDF-'));
assert.ok(s.trimEnd().endsWith('%%EOF'));
assert.equal((s.match(/\/Type \/Page(?!s)/g) || []).length, 2);
assert.equal(s.slice(xref, xref + 4), 'xref');
assert.equal(parseInt(s.slice(s.lastIndexOf('startxref') + 9), 10), xref);
offs.forEach((o, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, o)));

fs.writeFileSync(target, out);
console.log(`ok ${out.length}`);
