// Pure chart data for the dashboard. No React, no globals: every input is a parameter.
import {
  CSF_FUNCTIONS,
  type Asset,
  type Criticality,
  type CsfFunction,
  type CsfSubcategory,
  type Document,
  type EvidenceLink,
  type Sector,
  type Tlp,
} from '../../data/grc.ts'
import { coverage } from '../../lib/grc.ts'
import { withinLast365 } from './stats.ts'

const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// 'YYYY-MM-DD' -> whole UTC days since epoch. Missing, malformed or impossible dates (2026-02-30) -> undefined.
const dayNum = (iso: unknown): number | undefined => {
  if (typeof iso !== 'string' || !DATE_RE.test(iso)) return undefined
  const ms = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== iso)
    return undefined
  return ms / DAY_MS
}

// `today` is a caller bug if invalid: throw rather than silently bucket everything as undefined.
const todayNum = (today: string): number => {
  const day = dayNum(today)
  if (day === undefined)
    throw new RangeError(`today must be YYYY-MM-DD, got ${today}`)
  return day
}

// Doc type order: the prototype order (chart-grid.reference.dc.html buildView). Matches the
// Document['type'] union declaration order in data/grc.ts (10 members, verified).
const DOC_TYPE_ORDER: Document['type'][] = [
  'Policy',
  'Procedure',
  'Network diagram',
  'Risk assessment',
  'Incident response plan',
  'Configuration baseline',
  'Audit report',
  'Personnel roster',
  'Installation register',
  'Equipment register',
]

const TLP_ORDER: Tlp[] = [
  'CLEAR',
  'GREEN',
  'AMBER',
  'AMBER+STRICT',
  'RED',
  'RED+STRICT',
]
const CRITICALITY_ORDER: Criticality[] = ['high', 'medium', 'low']
const CRITICALITY_LABEL: Record<Criticality, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}
const ASSET_STATUS_LABEL: Record<Asset['status'], string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  retired: 'Retired',
}
const CSF_ORDER: CsfFunction[] = ['GV', 'ID', 'PR', 'DE', 'RS', 'RC']

export const tlpRows = (docs: Document[]) =>
  TLP_ORDER.map((key) => ({
    key,
    label: `TLP:${key}`,
    value: docs.filter((doc) => doc.tlp === key).length,
  }))

export const tlpStatusRows = (docs: Document[]) =>
  TLP_ORDER.map((key) => {
    const mine = docs.filter((doc) => doc.tlp === key)
    const count = (status: Document['status']) =>
      mine.filter((doc) => doc.status === status).length
    return {
      key,
      label: `TLP:${key}`,
      approved: count('approved'),
      inReview: count('in review'),
      draft: count('draft'),
      expired: count('expired'),
      total: mine.length,
    }
  })

// Missing or invalid nextReview: counted in NO bucket (not invented, not dropped into Over 180).
// Sum of values < docs.length means some nextReview is missing or invalid.
export const reviewScheduleRows = (docs: Document[], today: string) => {
  const now = todayNum(today)
  const counts = { overdue: 0, d0_30: 0, d31_90: 0, d91_180: 0, over180: 0 }
  for (const doc of docs) {
    const due = dayNum(doc.nextReview)
    if (due === undefined) continue
    const days = due - now
    const key =
      days < 0
        ? 'overdue'
        : days <= 30
          ? 'd0_30'
          : days <= 90
            ? 'd31_90'
            : days <= 180
              ? 'd91_180'
              : 'over180'
    counts[key] += 1
  }
  const labels = {
    overdue: 'Overdue',
    d0_30: '0–30 days',
    d31_90: '31–90 days',
    d91_180: '91–180 days',
    over180: 'Over 180 days',
  }
  return (Object.keys(counts) as (keyof typeof counts)[]).map((key) => ({
    key,
    label: labels[key],
    value: counts[key],
  }))
}

export const documentTypeRows = (docs: Document[]) =>
  DOC_TYPE_ORDER.map((label) => ({
    label,
    value: docs.filter((doc) => doc.type === label).length,
  }))

// Every month from first to last version month, inclusive. Versions with invalid date are skipped.
export const versionMonthRows = (docs: Document[]) => {
  const indexes: number[] = []
  for (const doc of docs) {
    for (const version of doc.versions) {
      const day = dayNum(version.date)
      if (day === undefined) continue
      const d = new Date(day * DAY_MS)
      indexes.push(d.getUTCFullYear() * 12 + d.getUTCMonth())
    }
  }
  if (indexes.length === 0) return []
  const counts = new Map<number, number>()
  for (const index of indexes) counts.set(index, (counts.get(index) ?? 0) + 1)
  const min = Math.min(...indexes)
  const max = Math.max(...indexes)
  return Array.from({ length: max - min + 1 }, (_, offset) => {
    const index = min + offset
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
    return { month, value: counts.get(index) ?? 0 }
  })
}

export const criticalityRows = (assets: Asset[]) =>
  CRITICALITY_ORDER.map((key) => ({
    key,
    label: CRITICALITY_LABEL[key],
    value: assets.filter((asset) => asset.criticality === key).length,
  }))

// Sectors = distinct sectors present in the data. Sorted by total desc, then sector asc.
export const sectorCriticalityRows = (assets: Asset[]) => {
  const sectors = [...new Set(assets.map((asset) => asset.sector))] as Sector[]
  return sectors
    .map((sector) => {
      const mine = assets.filter((asset) => asset.sector === sector)
      const count = (level: Criticality) =>
        mine.filter((asset) => asset.criticality === level).length
      return {
        sector,
        high: count('high'),
        medium: count('medium'),
        low: count('low'),
        total: mine.length,
      }
    })
    .sort((a, b) => b.total - a.total || a.sector.localeCompare(b.sector))
}

export const assetStatusRows = (assets: Asset[]) =>
  (Object.keys(ASSET_STATUS_LABEL) as Asset['status'][]).map((key) => ({
    label: ASSET_STATUS_LABEL[key],
    value: assets.filter((asset) => asset.status === key).length,
  }))

// "overdue" = not reviewed within 365 days (spec). Future or unparseable lastReviewed also lands here.
export const assetReviewRows = (assets: Asset[], today: string) => {
  const reviewed = assets.filter((asset) =>
    withinLast365(asset.lastReviewed, today)
  ).length
  return [
    { key: 'reviewed', label: 'Reviewed within 365 days', value: reviewed },
    { key: 'overdue', label: 'Overdue', value: assets.length - reviewed },
  ]
}

// "With" = coverage() === 'covered' (current approved doc). "Without" = partial + gap.
export const csfFunctionRows = (
  subcats: CsfSubcategory[],
  evidence: EvidenceLink[],
  docs: Document[],
  today: string
) =>
  CSF_ORDER.map((fn) => {
    const mine = subcats.filter((sub) => sub.fn === fn)
    const withEvidence = mine.filter(
      (sub) => coverage(sub.id, evidence, docs, today) === 'covered'
    ).length
    return {
      fn,
      label: `${fn} ${CSF_FUNCTIONS[fn]}`,
      with: withEvidence,
      without: mine.length - withEvidence,
      total: mine.length,
    }
  })

export const documentTileStats = (docs: Document[], today: string) => {
  const now = todayNum(today)
  return {
    total: docs.length,
    versions: docs.reduce((n, doc) => n + doc.versions.length, 0),
    current: docs.filter((doc) => {
      const due = dayNum(doc.nextReview)
      return doc.status === 'approved' && due !== undefined && due >= now
    }).length,
    overdue:
      reviewScheduleRows(docs, today).find((row) => row.key === 'overdue')
        ?.value ?? 0,
  }
}

// monitoring = distinct assets linked (assetId) to a DE.* subcategory. Same rule as stats.ts dashboardStats.
export const assetTileStats = (
  assets: Asset[],
  evidence: EvidenceLink[],
  subcats: CsfSubcategory[],
  today: string
) => {
  const fnOf = new Map(subcats.map((sub) => [sub.id, sub.fn] as const))
  const monitoring = new Set(
    evidence
      .filter((link) => link.assetId && fnOf.get(link.subcategoryId) === 'DE')
      .map((link) => link.assetId)
  ).size
  return {
    total: assets.length,
    reviewed: assets.filter((asset) => withinLast365(asset.lastReviewed, today))
      .length,
    monitoring,
  }
}

export const asOfLabel = (today: string) => `AS OF ${today}`
