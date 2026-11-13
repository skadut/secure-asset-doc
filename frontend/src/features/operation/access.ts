import type { Tlp } from '@/data/grc'
import type { DirectoryUser } from '@/lib/access-api'

// Mirrors explainAccess in lib/access-api.ts and canReadLevel in backend/auth.mjs. Display only: the server decides.
const TLP_ORDER: Tlp[] = [
  'CLEAR',
  'GREEN',
  'AMBER',
  'AMBER+STRICT',
  'RED',
  'RED+STRICT',
]

export function levelPermits(accessLevel: number, tlp: Tlp): boolean {
  const i = TLP_ORDER.indexOf(tlp)
  return (
    Number.isInteger(accessLevel) &&
    accessLevel >= 1 &&
    accessLevel <= 5 &&
    i !== -1 &&
    i <= Math.min(accessLevel, 4)
  )
}

export function explainOperationAccess(
  accessLevel: number,
  tlp: Tlp,
  hasActiveGrant: boolean
): { permit: boolean; reasons: string[] } {
  const i = TLP_ORDER.indexOf(tlp)
  if (hasActiveGrant)
    return { permit: true, reasons: ['Grant aktif untuk dokumen ini'] }
  if (levelPermits(accessLevel, tlp))
    return {
      permit: true,
      reasons: [`Level akses ${accessLevel} mencakup TLP:${tlp}`],
    }
  const reasons: string[] = []
  if (i === 5)
    reasons.push(
      'TLP:RED+STRICT hanya dapat dibuka dengan grant aktif, termasuk untuk level 5'
    )
  else if (i === -1) reasons.push('TLP tidak dikenal')
  else reasons.push(`Level akses ${accessLevel} tidak mencakup TLP:${tlp}`)
  reasons.push('Tidak ada grant aktif untuk dokumen ini')
  return { permit: false, reasons }
}

export type CellState = 'grant' | 'level' | 'expired' | 'deny'

export function cellState(
  accessLevel: number,
  tlp: Tlp,
  grant: 'active' | 'expired' | null
): CellState {
  if (grant === 'active') return 'grant'
  if (levelPermits(accessLevel, tlp)) return 'level'
  return grant === 'expired' ? 'expired' : 'deny'
}

export type UserDimension = 'all' | 'level' | 'rank' | 'unit'

export function dimKey(
  u: DirectoryUser,
  dim: 'level' | 'rank' | 'unit'
): string {
  if (dim === 'level')
    return u.accessLevel == null ? '__none__' : String(u.accessLevel)
  if (dim === 'rank') return u.rankName ?? '__none__'
  return u.unit ?? '__none__'
}

export function filterUsers(
  users: DirectoryUser[],
  { query, dim, value }: { query: string; dim: UserDimension; value: string }
): DirectoryUser[] {
  const q = query.trim().toLowerCase()
  return users.filter(
    (u) =>
      (!q ||
        (u.name ?? '').toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)) &&
      (dim === 'all' || dimKey(u, dim) === value)
  )
}

export function groupUsers(
  users: DirectoryUser[],
  dim: UserDimension
): Array<{ key: string; label: string; users: DirectoryUser[] }> {
  if (dim === 'all') return [{ key: 'all', label: 'Semua pengguna', users }]
  const keys = [...new Set(users.map((u) => dimKey(u, dim)))]
  if (dim === 'level')
    keys.sort((a, b) =>
      a === '__none__' ? 1 : b === '__none__' ? -1 : Number(a) - Number(b)
    )
  else if (dim === 'unit')
    keys.sort((a, b) =>
      a === '__none__' ? 1 : b === '__none__' ? -1 : a.localeCompare(b, 'id')
    )
  return keys.map((key) => {
    const group = users.filter((u) => dimKey(u, dim) === key)
    const label =
      key === '__none__'
        ? dim === 'rank'
          ? 'Tanpa pangkat'
          : dim === 'unit'
            ? 'Tanpa unit'
            : 'Tanpa level'
        : dim === 'level'
          ? `Level ${key}`
          : key
    return { key, label, users: group }
  })
}

export function switchFor(state: CellState): {
  checked: boolean
  disabled: boolean
} {
  return {
    checked: state === 'grant' || state === 'level',
    disabled: state === 'level',
  }
}
