import type { AccessRequest } from '@/lib/access-api'

// Jumlah dokumen unik yang punya permintaan berstatus pending.
export function pendingDocCount(requests: AccessRequest[]): number {
  return new Set(
    requests.filter((r) => r.status === 'pending').map((r) => r.documentId)
  ).size
}
