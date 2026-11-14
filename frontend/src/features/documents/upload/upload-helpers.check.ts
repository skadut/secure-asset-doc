// Self-check. Run: node --experimental-strip-types src/features/documents/upload/upload-helpers.check.ts
import assert from 'node:assert/strict'
import {
  DOC_PDF_MIME,
  DOC_XLSX_MIME,
  addMonths,
  clampStep,
  createErrorMessage,
  docFileError,
  docMimeLabel,
  formatAuditTime,
  previewDocId,
  resolveDocMime,
  reviewDayLabel,
  stepForError,
  todayIso,
  uniqueValues,
  validateStep,
  type UploadMeta,
} from './upload-helpers.ts'

const meta: UploadMeta = {
  title: 'Prosedur patch OT',
  type: 'Procedure',
  owner: 'B. Santoso · Unit OT',
  approver: 'K. Hidayat',
  version: '1.0',
  tlp: 'AMBER',
  status: 'in review',
  nextReview: '2026-09-12',
  summary: 'Revisi awal prosedur patch.',
}

assert.equal(resolveDocMime({ name: 'a.pdf', type: '' }), DOC_PDF_MIME)
assert.equal(resolveDocMime({ name: 'a.xlsx', type: '' }), DOC_XLSX_MIME)
assert.equal(resolveDocMime({ name: 'a.PDF', type: '' }), DOC_PDF_MIME)
assert.equal(resolveDocMime({ name: 'a.txt', type: 'text/plain' }), null)
assert.equal(docMimeLabel(DOC_XLSX_MIME), 'XLSX')
assert.equal(docMimeLabel('text/plain'), '—')

const MAX = 10 * 1024 * 1024
assert.equal(docFileError({ name: 'a.pdf', type: '', size: MAX }), null)
assert.equal(
  docFileError({ name: 'a.pdf', type: '', size: MAX + 1 }),
  'Berkas melebihi 10 MB.'
)
assert.equal(
  docFileError({ name: 'a.pdf', type: '', size: 0 }),
  'Berkas kosong tidak dapat diunggah.'
)
assert.equal(
  docFileError({ name: 'a.txt', type: '', size: 10 }),
  'Hanya PDF atau XLSX yang diterima.'
)

assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
assert.equal(addMonths('2026-09-12', 6), '2027-03-12')
assert.equal(addMonths('2026-03-31', 12), '2027-03-31')
assert.equal(addMonths('bogus', 1), 'bogus')

assert.equal(reviewDayLabel('2026-09-12', '2026-09-12'), 'hari ini')
assert.equal(reviewDayLabel('2026-09-10', '2026-09-12'), 'lewat 2 hari')
assert.equal(reviewDayLabel('2026-09-12', '2026-09-12'), 'hari ini')
assert.equal(reviewDayLabel('2026-09-14', '2026-09-12'), '2 hari lagi')
assert.equal(reviewDayLabel('2026-09-10', '2026-09-12'), 'lewat 2 hari')
assert.equal(reviewDayLabel('x', '2026-09-12'), '—')
assert.match(todayIso(new Date(2026, 0, 5)), /^\d{4}-\d{2}-\d{2}$/)

assert.equal(clampStep(1), 1)
assert.equal(clampStep(6), 6)
assert.equal(clampStep(0), 1)
assert.equal(clampStep(7), 1)
assert.equal(clampStep('3'), 3)
assert.equal(clampStep(undefined), 1)

assert.equal(previewDocId(['DOC-0001', 'DOC-0042']), 'DOC-0043')
assert.equal(previewDocId([]), 'DOC-0001')
assert.equal(previewDocId(['DOC-9999']), 'DOC-10000')

assert.deepEqual(
  uniqueValues(
    [
      { owner: 'B', approver: 'K' },
      { owner: 'A', approver: 'K' },
    ],
    'owner'
  ),
  ['A', 'B']
)

assert.equal(
  validateStep(1, meta, false),
  'Pilih berkas PDF atau XLSX terlebih dahulu.'
)
assert.equal(validateStep(1, meta, true), null)
assert.equal(validateStep(2, meta, true), null)
assert.equal(
  validateStep(2, { ...meta, title: ' ' }, true),
  'Judul dokumen wajib diisi.'
)
assert.equal(
  validateStep(2, { ...meta, version: '1' }, true),
  'Versi harus berbentuk angka.angka, misalnya 1.0.'
)
assert.equal(validateStep(3, meta, true), null)
assert.equal(validateStep(4, meta, true), null)
assert.equal(
  validateStep(4, { ...meta, summary: '' }, true),
  'Catatan perubahan wajib diisi.'
)
assert.equal(
  validateStep(4, { ...meta, nextReview: '2026-02-30' }, true),
  'Tanggal tinjauan tidak valid.'
)

assert.equal(stepForError(403), 3)
assert.equal(stepForError(413), 1)
assert.equal(stepForError(415), 1)
assert.equal(stepForError(400, 'invalid title'), 2)
assert.equal(stepForError(400, 'invalid tlp'), 3)
assert.equal(stepForError(400, 'invalid nextReview'), 4)
assert.equal(stepForError(400, 'bad request'), 5)
assert.equal(stepForError(502), 5)

assert.match(createErrorMessage(403), /melebihi batas akses/)
assert.equal(createErrorMessage(413), 'Berkas melebihi 10 MB.')
assert.equal(
  createErrorMessage(400, 'invalid owner'),
  'Isian pemilik tidak valid.'
)
assert.match(createErrorMessage(503), /Modul enkripsi/)

assert.equal(
  formatAuditTime(new Date(2026, 0, 1, 10, 4, 12).toISOString()),
  '10:04:12'
)
assert.equal(formatAuditTime('not-a-date'), '—')
