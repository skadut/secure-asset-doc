import { useSyncExternalStore } from 'react'
import {
  assets,
  assetDocLinks,
  auditEvents,
  csfSubcategories,
  documents,
  evidenceLinks,
  lockedDocuments,
  type Asset,
  type AssetDocLink,
  type AuditEvent,
  type CsfSubcategory,
  type Document,
  type EvidenceLink,
  type LockedDocument,
} from '@/data/grc'

let version = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useGrcVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}

function hydrate<T>(
  payload: Record<string, unknown>,
  key: string,
  target: T[]
) {
  const items = payload[key]
  if (!Array.isArray(items))
    throw new Error(`Invalid API response: ${key} must be an array`)
  target.length = 0
  for (const item of items) target.push(item as T)
}

export async function refreshGrc(): Promise<'ok' | 'unauthorized'> {
  const response = await fetch('/api/grc')
  if (response.status === 401) return 'unauthorized'
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object') throw new Error('Invalid API response')
  const payload = data as Record<string, unknown>
  hydrate<Asset>(payload, 'assets', assets)
  const rawDocs = payload.documents
  if (!Array.isArray(rawDocs))
    throw new Error('Invalid API response: documents must be an array')
  documents.length = 0
  lockedDocuments.length = 0
  for (const item of rawDocs as (Document | LockedDocument)[]) {
    if (item.locked === true) lockedDocuments.push(item)
    else documents.push(item)
  }
  hydrate<CsfSubcategory>(payload, 'csfSubcategories', csfSubcategories)
  hydrate<EvidenceLink>(payload, 'evidenceLinks', evidenceLinks)
  hydrate<AssetDocLink>(payload, 'assetDocLinks', assetDocLinks)
  hydrate<AuditEvent>(payload, 'auditEvents', auditEvents)
  version += 1
  for (const listener of listeners) listener()
  return 'ok'
}
