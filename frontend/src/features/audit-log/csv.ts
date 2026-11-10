import type { AuditEvent } from '@/data/grc'

const COLUMNS = ['id', 'at', 'actor', 'action', 'objectType', 'objectId', 'summary'] as const

// Neutralize spreadsheet formula injection: a leading = + - @ TAB or CR becomes a literal text cell.
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(events: AuditEvent[]): string {
  return [
    COLUMNS.join(','),
    ...events.map((e) => COLUMNS.map((c) => cell(String(e[c] ?? ''))).join(',')),
  ].join('\r\n')
}
