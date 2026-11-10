import type { Tlp } from '@/data/grc'
import { setMe, type Me } from './session'

export type Fips199 = 'LOW' | 'MODERATE' | 'HIGH'

export type DirectoryUser = {
  username: string
  name: string | null
  rankName: string | null
  golongan: string | null
  accessLevel: number
  unit: string | null
  unitHead: boolean
  securityOfficer: boolean
}

export type Approval = {
  approver: string
  role: 'commander' | 'security_officer'
  decision: 'approve' | 'deny'
  reason: string | null
  at: string
}

export type AccessRequest = {
  id: string
  documentId: string
  tlp: Tlp
  grantee: string
  granteeUnit: string | null
  requestedBy: string
  reason: string
  expiresAt: string | null
  status: 'pending' | 'approved' | 'denied' | 'cancelled'
  createdAt: string
  approvals: Approval[]
}

export type LevelRequest = {
  id: string
  targetUser: string
  requestedBy: string
  currentLevel: number
  newLevel: number
  justification: string
  screeningVerified: boolean
  screeningRef: string | null
  accessAgreementSigned: boolean
  accessAgreementDate: string | null
  reviewDue: string | null
  fips199Basis: Fips199 | null
  status: string
  decidedBy: string | null
  decidedAt: string | null
  decisionReason: string | null
  createdAt: string
}

export type Grant = {
  username: string
  rankName: string | null
  accessLevel: number
  unit: string | null
  unitHead: boolean
  grantedBy: string | null
  grantedAt: string
  expiresAt: string | null
  active: boolean
}

export type LevelChangeInput = {
  newLevel: number
  justification: string
  screeningVerified?: boolean
  screeningRef?: string
  accessAgreementSigned?: boolean
  accessAgreementDate?: string
  reviewDue?: string
  fips199Basis?: Fips199
}

const MESSAGES: Record<number, string> = {
  400: 'Permintaan tidak valid',
  403: 'Tidak diizinkan',
  404: 'Tidak tersedia',
  409: 'Konflik: status sudah berubah',
  413: 'Terlalu besar',
  415: 'Format tidak didukung',
}

export class ApiError extends Error {
  status: number
  constructor(status: number) {
    super(MESSAGES[status] ?? 'Gagal memuat')
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    if (res.status === 401) {
      setMe(null)
      window.location.reload()
    }
    throw new ApiError(res.status)
  }
  return res
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await request(url, init)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

const post = <T>(url: string, body: unknown) =>
  call<T>(url, { method: 'POST', body: JSON.stringify(body) })

export function fips199For(level: number): Fips199 {
  if (level <= 2) return 'LOW'
  if (level === 3) return 'MODERATE'
  return 'HIGH'
}

export function listUsers(): Promise<DirectoryUser[]> {
  return call('/api/users')
}

export function listAccessRequests(): Promise<AccessRequest[]> {
  return call('/api/access-requests')
}

export function createAccessRequest(
  docId: string,
  body: { grantee: string; reason: string; expiresAt?: string }
): Promise<{ id: string; status: 'pending' }> {
  return post(
    `/api/documents/${encodeURIComponent(docId)}/access-requests`,
    body
  )
}

export function decideAccessRequest(
  id: string,
  body: { decision: 'approve' | 'deny'; reason?: string }
): Promise<{ id: string; status: string; granted: boolean }> {
  return post(`/api/access-requests/${encodeURIComponent(id)}/decision`, body)
}

export function listGrants(docId: string): Promise<Grant[]> {
  return call(`/api/documents/${encodeURIComponent(docId)}/grants`)
}

export async function revokeGrant(
  docId: string,
  username: string
): Promise<void> {
  await request(
    `/api/documents/${encodeURIComponent(docId)}/grants/${encodeURIComponent(username)}`,
    { method: 'DELETE' }
  )
}

export async function addGrant(docId: string, username: string): Promise<void> {
  await request(`/api/documents/${encodeURIComponent(docId)}/grants`, {
    method: 'POST',
    body: JSON.stringify({ username }),
  })
}

export function listLevelRequests(): Promise<LevelRequest[]> {
  return call('/api/level-requests')
}

export function createLevelRequest(
  username: string,
  body: LevelChangeInput
): Promise<
  | { id: string; status: 'pending' }
  | { username: string; fromLevel: number; toLevel: number; applied: true }
> {
  return post(`/api/users/${encodeURIComponent(username)}/level-requests`, body)
}

export function decideLevelRequest(
  id: string,
  body: { decision: 'approve' | 'deny'; reason?: string }
): Promise<{ id: string; status: string; applied: boolean }> {
  return post(`/api/level-requests/${encodeURIComponent(id)}/decision`, body)
}

const TLP_ORDER: Tlp[] = [
  'CLEAR',
  'GREEN',
  'AMBER',
  'AMBER+STRICT',
  'RED',
  'RED+STRICT',
]

export function explainAccess(
  me: Me,
  tlp: Tlp,
  hasActiveGrant: boolean
): { permit: boolean; reasons: string[] } {
  const i = TLP_ORDER.indexOf(tlp)
  const L = me.accessLevel
  const levelOk =
    Number.isInteger(L) && L >= 1 && L <= 5 && i !== -1 && i <= Math.min(L, 4)
  if (hasActiveGrant)
    return { permit: true, reasons: ['Grant aktif untuk dokumen ini'] }
  if (levelOk)
    return { permit: true, reasons: [`Level akses ${L} mencakup TLP:${tlp}`] }
  const reasons: string[] = []
  if (i === 5)
    reasons.push(
      'TLP:RED+STRICT hanya dapat dibuka dengan grant aktif, termasuk untuk level 5'
    )
  else if (i === -1) reasons.push('TLP tidak dikenal')
  else reasons.push(`Level akses ${L} tidak mencakup TLP:${tlp}`)
  reasons.push('Tidak ada grant aktif untuk dokumen ini')
  return { permit: false, reasons }
}
