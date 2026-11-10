// Self-check. Run: node --experimental-strip-types src/features/dashboard/stats.check.ts
import assert from 'node:assert/strict'
import { assets, csfSubcategories, documents, evidenceLinks, TODAY } from '../../data/grc.ts'
import * as fixture from '../../test-utils/grc-fixture.ts'

// stats.ts computes at import time: fill arrays first, then import it.
assets.push(...fixture.assets)
csfSubcategories.push(...fixture.csfSubcategories)
documents.push(...fixture.documents)
evidenceLinks.push(...fixture.evidenceLinks)
const {
  dashboardStats, documentFileCounts, documentReviewCounts, documentStatusData, withinLast365,
  totals, tlpCounts, statusByTlp, reviewBuckets, versionsByMonth, documentsByType,
} = await import('./stats.ts')

const day = (iso: string) => Date.parse(iso)
const today = day(TODAY)
const fnOf = (id: string) => csfSubcategories.find((s) => s.id === id)?.fn

assert.equal(dashboardStats.totalAssets, 20)
assert.equal(
  dashboardStats.reviewedAssets,
  assets.filter((a) => (today - day(a.lastReviewed)) / 86_400_000 <= 365).length
)
const monitored = new Set(
  evidenceLinks
    .filter((l) => l.assetId && fnOf(l.subcategoryId) === 'DE')
    .map((l) => l.assetId)
)
assert.equal(dashboardStats.monitoringEvidenceAssets, monitored.size)
assert.equal(dashboardStats.currentDocuments, documents.filter((d) => d.status === 'approved' && d.nextReview >= TODAY).length)
// Future lastReviewed (after TODAY) must not count as reviewed.
assert.equal(withinLast365('2026-10-22', '2026-10-21'), false)
assert.equal(withinLast365('2026-10-21', '2026-10-21'), true)
assert.equal(withinLast365('2025-10-21', '2026-10-21'), true)
assert.equal(withinLast365('2025-10-20', '2026-10-21'), false)

const statusCounts = Object.fromEntries(documentStatusData.map((row) => [row.key, row.value]))
assert.equal(statusCounts.approved, documents.filter((d) => d.status === 'approved').length)
assert.equal(statusCounts['in review'], documents.filter((d) => d.status === 'in review').length)
assert.equal(statusCounts.draft, documents.filter((d) => d.status === 'draft').length)
assert.equal(statusCounts.expired, documents.filter((d) => d.status === 'expired').length)
assert.equal(documentStatusData.reduce((n, row) => n + row.value, 0), documents.length)

const reviewDays = (iso: string) => (day(iso) - today) / 86_400_000
assert.equal(documentReviewCounts.overdue, documents.filter((d) => reviewDays(d.nextReview) < 0).length)
assert.equal(documentReviewCounts.dueWithin30, documents.filter((d) => reviewDays(d.nextReview) >= 0 && reviewDays(d.nextReview) <= 30).length)

const pdf = documents.filter((d) => d.versions[0]?.file?.mime === 'application/pdf').length
const xlsx = documents.filter((d) => d.versions[0]?.file?.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').length
assert.equal(documentFileCounts.PDF, pdf)
assert.equal(documentFileCounts.Excel, xlsx)
assert.equal(documentFileCounts.None, documents.length - pdf - xlsx)

const totalVersions = documents.reduce((n, d) => n + d.versions.length, 0)
const t = totals(documents)
assert.equal(t.totalDocuments, documents.length)
assert.equal(t.totalVersions, totalVersions)
assert.equal(t.currentDocuments, documents.filter((d) => d.status === 'approved' && d.nextReview >= TODAY).length)
assert.equal(t.overdueReviews, documents.filter((d) => d.nextReview < TODAY).length)

const buckets = reviewBuckets(documents)
assert.equal(buckets.reduce((n, b) => n + b.count, 0), documents.length)

const tlps = tlpCounts(documents)
assert.equal(tlps.reduce((n, r) => n + r.count, 0), documents.length)

const byTlp = statusByTlp(documents)
assert.equal(byTlp.reduce((n, r) => n + r.counts.reduce((m, c) => m + c.count, 0), 0), documents.length)

const months = versionsByMonth(documents)
assert.equal(months.reduce((n, r) => n + r.count, 0), totalVersions)
const monthIdx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1
for (let i = 1; i < months.length; i++) assert.equal(monthIdx(months[i].month) - monthIdx(months[i - 1].month), 1)

const types = documentsByType(documents)
assert.equal(types.reduce((n, r) => n + r.count, 0), documents.length)
for (let i = 1; i < types.length; i++) {
  assert.ok(types[i - 1].count >= types[i].count, 'documentsByType sorted descending')
  if (types[i - 1].count === types[i].count) assert.ok(types[i - 1].type < types[i].type, 'ties alphabetical')
}


