// Seeds fictional PDFs into document_versions rows that have no file content yet.
// Run in backend image: node /app/seed-version-files.mjs [--dry-run]
// Afterwards run protect-documents.mjs to encrypt per TLP.
// Self-check (no DB): node db/scripts/seed-version-files.mjs --self-check
// ponytail: single-page PDF, Helvetica, ASCII only. Add embedding when non-ASCII text is needed.
import assert from 'node:assert/strict';

const esc = (s) => s.replace(/[\\()]/g, '\\$&');
const ascii = (s) => String(s ?? '').replace(/[^\x20-\x7E]/g, '?');
const T = (y, s) => `BT /F1 11 Tf 72 ${y} Td (${esc(s)}) Tj ET\n`;

function wrap(s, width = 80, max = 6) {
  const lines = [];
  for (const word of ascii(s).split(/\s+/).filter(Boolean)) {
    if (lines.length && (lines.at(-1) + ' ' + word).length <= width) lines[lines.length - 1] += ' ' + word;
    else lines.push(word);
  }
  return lines.slice(0, max);
}

function pdfFor(row) {
  const date = new Date(row.date).toISOString().slice(0, 10);
  let content = T(730, 'FICTIONAL DEMO DOCUMENT')
    + T(710, ascii(row.document_id))
    + T(690, `Version ${ascii(row.version)}`)
    + T(670, `Date ${date}`)
    + T(650, `Author ${ascii(row.author)}`);
  wrap(`Summary: ${row.summary ?? ''}`).forEach((line, i) => { content += T(630 - i * 16, line); });

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
  ];
  const chunks = [];
  let pos = 0;
  const put = (s) => { const b = Buffer.from(s, 'latin1'); chunks.push(b); pos += b.length; };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offs = objs.map((body, i) => { const off = pos; put(`${i + 1} 0 obj\n${body}\nendobj\n`); return off; });
  const xref = pos;
  put(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join(''));
  put(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

async function selfCheck() {
  const out = pdfFor({ document_id: 'DOC-0001', version: '1.0', date: '2026-01-02T00:00:00Z', author: 'Demo Author', summary: 'Fictional summary. '.repeat(20) });
  const s = out.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const xref = Number(s.slice(s.lastIndexOf('startxref') + 'startxref'.length).trim().split(/\s/)[0]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
  console.log(`self-check ok (${out.length} bytes, xref at ${xref})`);
}

async function seed() {
  const dryRun = process.argv.includes('--dry-run');
  const { default: pg } = await import('pg');
  const client = new pg.Client();
  await client.connect();
  let count = 0, bytesTotal = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      SELECT document_id, version, date, author, summary
      FROM document_versions
      WHERE content_base64 IS NULL AND content_ciphertext IS NULL AND protection = 'none'
      ORDER BY document_id, version`);
    for (const row of rows) {
      const bytes = pdfFor(row);
      const res = await client.query(`
        UPDATE document_versions
        SET file_name = $3, mime_type = 'application/pdf', size_bytes = $4, content_base64 = $5
        WHERE document_id = $1 AND version = $2
          AND content_base64 IS NULL AND content_ciphertext IS NULL AND protection = 'none'`,
      [row.document_id, row.version,
        `${row.document_id.toLowerCase()}-v${row.version}.pdf`,
        bytes.length, bytes.toString('base64')]);
      if (res.rowCount) {
        count++; bytesTotal += bytes.length;
        console.log(`doc ${row.document_id} v${row.version}  ${bytes.length} bytes`);
      }
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    console.log(`${dryRun ? 'dry-run: would update' : 'updated'} ${count} rows, ${bytesTotal} bytes total`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv.includes('--self-check')) await selfCheck();
else await seed();
