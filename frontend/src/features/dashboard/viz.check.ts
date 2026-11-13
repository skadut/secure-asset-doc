/* eslint-disable no-console -- self-check prints cross-tab tables by spec §8.1 */
// Self-check. Run: node --experimental-strip-types src/features/dashboard/viz.check.ts
import assert from 'node:assert/strict'
import * as fixture from '../../test-utils/grc-fixture.ts'
import {
  asOfLabel,
  assetReviewRows,
  assetStatusRows,
  assetTileStats,
  criticalityRows,
  csfFunctionRows,
  documentTileStats,
  documentTypeRows,
  reviewScheduleRows,
  sectorCriticalityRows,
  tlpRows,
  tlpStatusRows,
  versionMonthRows,
} from './viz-data.ts'

// Fixed date. Never new Date(): results must not depend on the wall clock.
const today = '2026-10-21'
const { assets, csfSubcategories, documents, evidenceLinks } = fixture

// ---- Spec 8.1: fixture values ----
const tlp = tlpRows(documents)
assert.deepEqual(
  tlp.map((r) => r.value),
  [1, 4, 5, 5, 2, 0]
)
assert.deepEqual(
  tlp.map((r) => r.label),
  [
    'TLP:CLEAR',
    'TLP:GREEN',
    'TLP:AMBER',
    'TLP:AMBER+STRICT',
    'TLP:RED',
    'TLP:RED+STRICT',
  ]
)

const tlpStatus = tlpStatusRows(documents)
const sumCol = (k: 'approved' | 'inReview' | 'draft' | 'expired') =>
  tlpStatus.reduce((n, r) => n + r[k], 0)
assert.equal(sumCol('approved'), 10)
assert.equal(sumCol('inReview'), 3)
assert.equal(sumCol('draft'), 2)
assert.equal(sumCol('expired'), 2)
for (const r of tlpStatus)
  assert.equal(
    r.approved + r.inReview + r.draft + r.expired,
    r.total,
    `row ${r.key} total`
  )

const review = reviewScheduleRows(documents, today)
assert.deepEqual(
  review.map((r) => r.value),
  [2, 6, 5, 3, 1]
)
assert.deepEqual(
  review.map((r) => r.label),
  ['Overdue', '0–30 days', '31–90 days', '91–180 days', 'Over 180 days']
)

const months = versionMonthRows(documents)
assert.equal(months.length, 33)
assert.equal(
  months.reduce((n, r) => n + r.value, 0),
  43
)
assert.equal(Math.max(...months.map((r) => r.value)), 6)
assert.equal(months.find((r) => r.value === 6)?.month, '2026-10')
assert.equal(months[0].month, '2024-02')
assert.equal(months[months.length - 1].month, '2026-10')

const crit = criticalityRows(assets)
assert.deepEqual(
  crit.map((r) => r.value),
  [12, 7, 1]
)
assert.deepEqual(
  crit.map((r) => r.label),
  ['High', 'Medium', 'Low']
)

const status = assetStatusRows(assets)
assert.deepEqual(
  status.map((r) => r.value),
  [17, 2, 1]
)
assert.deepEqual(
  status.map((r) => r.label),
  ['Active', 'Maintenance', 'Retired']
)

const sectors = sectorCriticalityRows(assets)
assert.deepEqual(
  sectors.map((r) => r.total),
  [8, 7, 5]
)
for (const r of sectors)
  assert.equal(r.high + r.medium + r.low, r.total, `sector ${r.sector} sums`)

const assetTiles = assetTileStats(
  assets,
  evidenceLinks,
  csfSubcategories,
  today
)
assert.equal(assetTiles.total, 20)
assert.equal(assetTiles.reviewed, 20)
assert.equal(assetTiles.monitoring, 1)
assert.deepEqual(
  assetReviewRows(assets, today).map((r) => r.value),
  [20, 0]
)

const csf = csfFunctionRows(csfSubcategories, evidenceLinks, documents, today)
assert.equal(csf.length, 6)
assert.equal(
  csf.reduce((n, r) => n + r.total, 0),
  21
)
assert.deepEqual(
  csf.map((r) => r.fn),
  ['GV', 'ID', 'PR', 'DE', 'RS', 'RC']
)
for (const r of csf)
  assert.equal(r.with + r.without, r.total, `fn ${r.fn} with+without`)

const docTiles = documentTileStats(documents, today)
assert.equal(docTiles.total, 17)
assert.equal(docTiles.versions, 43)
assert.equal(docTiles.overdue, 2)
assert.equal(asOfLabel(today), 'AS OF 2026-10-21')

// ---- Spec 8.1: printed (not asserted) ----
const types = documentTypeRows(documents)
assert.equal(types.length, 10, 'doc type order has 10 entries')
assert.equal(
  types.reduce((n, r) => n + r.value, 0),
  documents.length,
  'doc types cover every document'
)
console.log('Document types')
console.table(types)
console.log('TLP x status')
console.table(
  tlpStatus.map(({ label, approved, inReview, draft, expired, total }) => ({
    TLP: label,
    Approved: approved,
    'In review': inReview,
    Draft: draft,
    Expired: expired,
    Total: total,
  }))
)
console.log('Sector x criticality')
console.table(
  sectors.map(({ sector, high, medium, low, total }) => ({
    Sector: sector,
    High: high,
    Medium: medium,
    Low: low,
    Total: total,
  }))
)
console.log('CSF coverage by function')
console.table(
  csf.map(({ label, with: w, without, total }) => ({
    Function: label,
    'With evidence': w,
    'No evidence': without,
    Total: total,
  }))
)

// ---- Spec 8.2: empty data ----
const eType = documentTypeRows([])
assert.equal(eType.length, 10)
assert.ok(eType.every((r) => r.value === 0))
const eTlp = tlpRows([])
assert.equal(eTlp.length, 6)
assert.ok(eTlp.every((r) => r.value === 0))
const eTlpStatus = tlpStatusRows([])
assert.equal(eTlpStatus.length, 6)
assert.ok(
  eTlpStatus.every(
    (r) => r.approved + r.inReview + r.draft + r.expired + r.total === 0
  )
)
const eReview = reviewScheduleRows([], today)
assert.equal(eReview.length, 5)
assert.ok(eReview.every((r) => r.value === 0))
assert.deepEqual(versionMonthRows([]), [])
const eCrit = criticalityRows([])
assert.equal(eCrit.length, 3)
assert.ok(eCrit.every((r) => r.value === 0))
assert.deepEqual(sectorCriticalityRows([]), [])
const eStatus = assetStatusRows([])
assert.equal(eStatus.length, 3)
assert.ok(eStatus.every((r) => r.value === 0))
const eAssetReview = assetReviewRows([], today)
assert.equal(eAssetReview.length, 2)
assert.ok(eAssetReview.every((r) => r.value === 0))
const eCsf = csfFunctionRows([], [], [], today)
assert.equal(eCsf.length, 6)
assert.ok(eCsf.every((r) => r.with === 0 && r.without === 0 && r.total === 0))
assert.deepEqual(documentTileStats([], today), {
  total: 0,
  versions: 0,
  current: 0,
  overdue: 0,
})
assert.deepEqual(assetTileStats([], [], [], today), {
  total: 0,
  reviewed: 0,
  monitoring: 0,
})

process.stdout.write('viz self-check OK\n')
