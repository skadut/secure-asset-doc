// Run: node --experimental-strip-types src/lib/xlsx.check.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readXlsx } from './xlsx.ts'

const load = (file: string) => {
  const b = readFileSync(
    new URL(`../../../db/seed-files/${file}`, import.meta.url)
  )
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

const roster = await readXlsx(load('personnel-roster.xlsx'))
const equipment = await readXlsx(load('equipment-register.xlsx'))

assert.deepEqual(
  roster.map((s) => s.name),
  ['Roster']
)
assert.deepEqual(
  equipment.map((s) => s.name),
  ['Vehicles', 'Comms', 'Power & Water']
)

for (const workbook of [roster, equipment]) {
  for (const sheet of workbook) {
    assert.ok(
      sheet.rows[0].some((c) =>
        c.includes('SIMULASI DEMO - BUKAN DOKUMEN RESMI TNI')
      ),
      `${sheet.name}: row 1 simulation notice`
    )
    assert.ok(
      ['Nomor Demo', 'Kode Aset'].includes(sheet.rows[1][0]),
      `${sheet.name}: Indonesian demo headers`
    )
    assert.ok(sheet.rows.length > 10, `${sheet.name}: rows > 10`)
  }
}

await assert.rejects(
  readXlsx(
    new TextEncoder().encode('this is plain text, not a zip archive at all')
      .buffer
  ),
  /Not a valid \.xlsx/
)

process.stdout.write('xlsx.check: ok\n')
