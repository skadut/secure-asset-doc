import { describe, expect, it } from 'vitest'
import type { AuditEvent } from '@/data/grc'
import { toCsv } from './csv'

const base = { id: '1', at: '2026-01-01T00:00:00Z', actor: 'a', action: 'update', objectType: 'asset', objectId: 'x', summary: '' } as unknown as AuditEvent
const row = (summary: string) => toCsv([{ ...base, summary }]).split('\r\n')[1]

describe('toCsv', () => {
  it('writes the header', () => {
    expect(toCsv([]).split('\r\n')[0]).toBe('id,at,actor,action,objectType,objectId,summary')
  })
  it('quotes and doubles embedded quotes', () => {
    expect(row('a,"b"').endsWith(',"a,""b"""')).toBe(true)
  })
  it('quotes newlines', () => {
    expect(row('x\ny').endsWith(',"x\ny"')).toBe(true)
  })
  it('neutralizes formula prefixes', () => {
    for (const s of ['=1+1', '+x', '-x', '@x']) expect(row(s).endsWith(`,'${s}`)).toBe(true)
  })
  it('neutralizes leading tab', () => {
    expect(row('\tx').endsWith(",'\tx")).toBe(true)
  })
  it('joins rows with CRLF', () => {
    expect(toCsv([base, base]).split('\r\n')).toHaveLength(3)
  })
})
