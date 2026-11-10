import type { Tlp } from '@/data/grc'
import { ApiError, listAccessRequests } from '@/lib/access-api'

export const usersKey = ['operation', 'users'] as const
export const documentsKey = ['operation', 'documents'] as const
export const grantsKey = (docId: string) =>
  ['operation', 'grants', docId] as const

export type OperationDocument = { id: string; tlp: Tlp; title?: string | null }

const TLPS: readonly string[] = [
  'CLEAR',
  'GREEN',
  'AMBER',
  'AMBER+STRICT',
  'RED',
  'RED+STRICT',
]

function toDocument(value: unknown): OperationDocument | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (
    typeof v.id !== 'string' ||
    typeof v.tlp !== 'string' ||
    !TLPS.includes(v.tlp)
  )
    return null
  return {
    id: v.id,
    tlp: v.tlp as Tlp,
    title: typeof v.title === 'string' && v.title !== '' ? v.title : null,
  }
}

// GET /api/grc: `documents` holds what this caller may read (title included). `restrictedDocuments` is sent
// only to security officers and has id + tlp, no title. Commanders without the officer flag get no restricted list,
// so their RED+STRICT docs are recovered from access requests (id + tlp, no title). Deduped by id, first wins.
export async function listDocuments(): Promise<OperationDocument[]> {
  const res = await fetch('/api/grc', { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status)
  const raw: unknown = await res.json()
  const body =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {}
  const pick = (key: string): unknown[] =>
    Array.isArray(body[key]) ? (body[key] as unknown[]) : []
  const requests = await listAccessRequests().catch(() => [])
  const docs = [...pick('documents'), ...pick('restrictedDocuments')]
    .map(toDocument)
    .filter((d): d is OperationDocument => d !== null)
  const fromRequests: OperationDocument[] = requests.map((r) => ({
    id: r.documentId,
    tlp: r.tlp,
  }))
  const byId = new Map<string, OperationDocument>()
  for (const d of [...docs, ...fromRequests])
    if (!byId.has(d.id)) byId.set(d.id, d)
  return [...byId.values()]
}
