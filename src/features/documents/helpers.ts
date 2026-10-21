import { TODAY, type Document, type Tlp } from '@/data/grc'

export const TLP_LEVELS: Tlp[] = ['CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED']

export const TLP_NOTES: Record<Tlp, string> = {
  RED: 'For the eyes and ears of individual recipients only, no further disclosure.',
  AMBER: 'Limited disclosure: recipients may share on a need-to-know basis within their organization and its clients.',
  'AMBER+STRICT': 'Limited disclosure: recipients may share on a need-to-know basis within their organization only.',
  GREEN: 'Limited disclosure: recipients may share within their community.',
  CLEAR: 'No limit on disclosure.',
}

export const DOC_TYPES: Document['type'][] = [
  'Policy',
  'Procedure',
  'Network diagram',
  'Risk assessment',
  'Incident response plan',
  'Configuration baseline',
  'Audit report',
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
