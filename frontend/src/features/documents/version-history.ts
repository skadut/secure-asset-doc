export type VersionRecord = {
  version: string
  date: string
  author: string
  summary: string
  approvedBy?: string
}

export type VersionPair<T extends VersionRecord> =
  | { kind: 'none' }
  | { kind: 'single'; current: T }
  | { kind: 'pair'; current: T; previous: T }

// versions: newest first (src/data/grc.ts, Document.versions contract)
export function versionPair<T extends VersionRecord>(
  versions: readonly T[]
): VersionPair<T> {
  const [current, previous] = versions
  if (!current) return { kind: 'none' }
  if (!previous) return { kind: 'single', current }
  return { kind: 'pair', current, previous }
}
