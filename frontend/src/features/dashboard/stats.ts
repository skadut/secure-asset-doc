import { assets, csfSubcategories, documents, evidenceLinks, TODAY, type Document, type Tlp } from '../../data/grc.ts'
import { coverage, isDocCurrent } from '../../lib/grc.ts'

const DAY_MS = 86_400_000
export const withinLast365 = (date: string, today: string = TODAY) => {
  const age = (Date.parse(today) - Date.parse(date)) / DAY_MS
  return age >= 0 && age <= 365
}
const reviewDays = (date: string) => Math.round((Date.parse(date) - Date.parse(TODAY)) / DAY_MS)

export const dashboardStats = {
  totalAssets: assets.length,
  reviewedAssets: assets.filter((asset) => withinLast365(asset.lastReviewed)).length,
  monitoringEvidenceAssets: new Set(evidenceLinks.filter((link) => {
    const subcategory = csfSubcategories.find((sub) => sub.id === link.subcategoryId)
    return Boolean(link.assetId && subcategory?.fn === 'DE')
  }).map((link) => link.assetId)).size,
  currentDocuments: documents.filter(isDocCurrent).length,
}

export const criticalityData = (['high', 'medium', 'low'] as const).map((key) => ({
  name: key === 'high' ? 'High' : key === 'medium' ? 'Medium' : 'Low',
  value: assets.filter((asset) => asset.criticality === key).length,
  key,
}))

export const statusData = (['active', 'maintenance', 'retired'] as const).map((key) => ({
  name: key === 'active' ? 'Active' : key === 'maintenance' ? 'Maintenance' : 'Retired',
  value: assets.filter((asset) => asset.status === key).length,
  key,
}))

export const sectorData = (['Energy', 'Water', 'Telecom'] as const).map((sector) => ({
  name: sector,
  High: assets.filter((asset) => asset.sector === sector && asset.criticality === 'high').length,
  Medium: assets.filter((asset) => asset.sector === sector && asset.criticality === 'medium').length,
  Low: assets.filter((asset) => asset.sector === sector && asset.criticality === 'low').length,
}))

export const reviewData = [
  { name: 'Reviewed within 365 days', value: dashboardStats.reviewedAssets },
  { name: 'Overdue', value: assets.length - dashboardStats.reviewedAssets },
]

export const coverageData = (['GV', 'ID', 'PR', 'DE', 'RS', 'RC'] as const).map((fn) => {
  const subs = csfSubcategories.filter((subcategory) => subcategory.fn === fn)
  return {
    name: fn,
    covered: subs.filter((sub) => coverage(sub.id) === 'covered').length,
    partial: subs.filter((sub) => coverage(sub.id) === 'partial').length,
    gap: subs.filter((sub) => coverage(sub.id) === 'gap').length,
  }
})

export const documentStatusData = (['approved', 'in review', 'draft', 'expired'] as const).map((key) => ({
  name: key === 'in review' ? 'In review' : key[0].toUpperCase() + key.slice(1),
  value: documents.filter((doc) => doc.status === key).length,
  key,
}))

export const documentReviewCounts = {
  overdue: documents.filter((doc) => reviewDays(doc.nextReview) < 0).length,
  dueWithin30: documents.filter((doc) => {
    const days = reviewDays(doc.nextReview)
    return days >= 0 && days <= 30
  }).length,
}

export const documentFileCounts = {
  PDF: documents.filter((doc) => doc.versions[0]?.file?.mime === 'application/pdf').length,
  Excel: documents.filter((doc) => doc.versions[0]?.file?.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').length,
  None: documents.filter((doc) => !doc.versions[0]?.file).length,
}

// Overview aggregates. Pure: each takes the docs array. Dates are date-only ISO, parsed as UTC.
const TLP_ORDER: Tlp[] = ['CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED', 'RED+STRICT']
const STATUS_ORDER: Document['status'][] = ['approved', 'in review', 'draft', 'expired']
const REVIEW_LABELS = ['Overdue', '0–30 days', '31–90 days', '91–180 days', '>180 days'] as const

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
const reviewLabel = (days: number) =>
  Number.isNaN(days) ? undefined : days < 0 ? 'Overdue' : days <= 30 ? '0–30 days' : days <= 90 ? '31–90 days' : days <= 180 ? '91–180 days' : '>180 days'

export const totals = (docs: Document[]) => ({
  totalDocuments: docs.length,
  totalVersions: docs.reduce((n, doc) => n + doc.versions.length, 0),
  currentDocuments: docs.filter(isDocCurrent).length,
  overdueReviews: docs.filter((doc) => daysBetween(TODAY, doc.nextReview) < 0).length,
})

export const tlpCounts = (docs: Document[]) =>
  TLP_ORDER.map((tlp) => ({ tlp, count: docs.filter((doc) => doc.tlp === tlp).length }))

export const statusByTlp = (docs: Document[]) =>
  TLP_ORDER.map((tlp) => ({
    tlp,
    counts: STATUS_ORDER.map((status) => ({
      status,
      count: docs.filter((doc) => doc.tlp === tlp && doc.status === status).length,
    })),
  }))

// Undated or unparseable nextReview lands in no bucket (not invented, not dropped into >180). Sum < docs.length flags it.
export const reviewBuckets = (docs: Document[], today: string = TODAY) =>
  REVIEW_LABELS.map((label) => ({
    label,
    count: docs.filter((doc) => reviewLabel(daysBetween(today, doc.nextReview)) === label).length,
  }))

const monthIndex = (date: string) => {
  const d = new Date(date)
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}
const monthLabel = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`

export const versionsByMonth = (docs: Document[]) => {
  const indexes = docs
    .flatMap((doc) => doc.versions.map((version) => monthIndex(version.date)))
    .filter((index) => !Number.isNaN(index))
  if (indexes.length === 0) return []
  const counts = new Map<number, number>()
  for (const index of indexes) counts.set(index, (counts.get(index) ?? 0) + 1)
  const min = Math.min(...indexes)
  const max = Math.max(...indexes)
  return Array.from({ length: max - min + 1 }, (_, offset) => ({
    month: monthLabel(min + offset),
    count: counts.get(min + offset) ?? 0,
  }))
}

export const documentsByType = (docs: Document[]) =>
  [...new Set(docs.map((doc) => doc.type))]
    .map((type) => ({ type, count: docs.filter((doc) => doc.type === type).length }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
