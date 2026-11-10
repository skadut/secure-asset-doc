import { TODAY, type Document, type Tlp } from '@/data/grc'

export const TLP_LEVELS: Tlp[] = [
  'CLEAR',
  'GREEN',
  'AMBER',
  'AMBER+STRICT',
  'RED',
  'RED+STRICT',
]

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
  if (days < 0) return 'Overdue'
  if (days === 0) return 'Due today'
  if (days <= 30) return `Due in ${days} days`
  return iso
}
