import { TODAY, type Document, type Tlp } from '@/data/grc'
import { explainAccess } from '@/lib/access-api'
import { getMe } from '@/lib/session'

// Tiers that only open with a grant (explainAccess: RED+STRICT needs grant even for level 5).
export const isGrantOnly = (tlp: Tlp): boolean => tlp === 'RED+STRICT'

export const TLP_LEVELS: Tlp[] = [
  'CLEAR',
  'GREEN',
  'AMBER',
  'AMBER+STRICT',
  'RED',
  'RED+STRICT',
]

export type LevelFilter = Tlp | 'ALL'

// Table filters: TLP tile/select match exactly; search matches ID or title.
export function filterDocs(
  docs: Document[],
  query: string,
  level: LevelFilter
): Document[] {
  const q = query.trim().toLocaleLowerCase()
  return docs.filter(
    (doc) =>
      (level === 'ALL' || doc.tlp === level) &&
      (!q ||
        doc.id.toLocaleLowerCase().includes(q) ||
        doc.title.toLocaleLowerCase().includes(q))
  )
}

// Filled TLP chip / header bar colors, same tokens as TlpMark swatches.
export const TLP_BAR: Record<Tlp, string> = {
  CLEAR: 'bg-tlp-clear text-white',
  GREEN: 'bg-tlp-green text-white',
  AMBER: 'bg-tlp-amber text-[#0f1411]',
  'AMBER+STRICT': 'bg-tlp-amber-strict text-white',
  RED: 'bg-tlp-red text-white',
  'RED+STRICT': 'bg-tlp-red-strict text-white',
}

// Session TTL the viewer enforces locally when the server sends none.
export function sessionLimitSeconds(tlp: Tlp): number | null {
  switch (tlp) {
    case 'RED':
    case 'RED+STRICT':
      return 600
    case 'AMBER':
    case 'AMBER+STRICT':
      return 900
    case 'GREEN':
    case 'CLEAR':
      return null
  }
}

export const TLP_NOTES: Record<Tlp, string> = {
  RED: 'Terbatas untuk penerima yang dituju. Jangan meneruskan di luar kewenangan penerima.',
  'RED+STRICT':
    'Terbatas untuk penerima yang dituju saja. Dilarang meneruskan kepada pihak mana pun.',
  AMBER:
    'Bagikan hanya kepada pihak yang memerlukan informasi sesuai kebijakan organisasi.',
  'AMBER+STRICT':
    'Bagikan hanya kepada pihak yang memerlukan informasi di dalam organisasi.',
  GREEN: 'Dapat dibagikan di lingkungan komunitas penerima sesuai kebijakan.',
  CLEAR: 'Tidak ada pembatasan tambahan dari label TLP ini.',
}

export const DOC_TYPES: Document['type'][] = [
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

export const DOC_STATUS_LABEL: Record<Document['status'], string> = {
  draft: 'Draft',
  'in review': 'In review',
  approved: 'Approved',
  expired: 'Expired',
}

const DAY_MS = 86_400_000

export function daysUntil(iso: string): number {
  return Math.round((Date.parse(iso) - Date.parse(TODAY)) / DAY_MS)
}

// ponytail: day count is UTC-date based; fine for ISO dates, not for times
export function reviewLabel(iso: string): string {
  const days = daysUntil(iso)
  if (days < 0) return `lewat ${Math.abs(days)} hari`
  if (days === 0) return 'hari ini'
  return `${days} hari lagi`
}

// Server decides access; this only explains the result for the signed-in user. Null when no session.
export const accessFor = (doc: Document) => {
  const me = getMe()
  return me ? explainAccess(me, doc.tlp, doc.granted === true) : null
}
