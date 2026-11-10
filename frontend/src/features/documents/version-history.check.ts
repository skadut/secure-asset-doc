import { versionPair } from './version-history.ts'

// Self-check, no framework: run with `node --experimental-strip-types`. Throws on failure.
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`version-history check failed: ${message}`)
}

const v30 = {
  version: '3.0',
  date: '2026-03-01',
  author: 'Kantor',
  summary: 'Tinjauan tahunan',
}
const v21 = {
  version: '2.1',
  date: '2025-03-04',
  author: 'Kantor',
  summary: 'Cakupan diperluas',
}

const none = versionPair([])
check(none.kind === 'none', 'empty list gives none')

const single = versionPair([v30])
check(
  single.kind === 'single' && single.current.version === '3.0',
  'one version gives single'
)

const pair = versionPair([v30, v21])
check(pair.kind === 'pair', 'two versions give pair')
if (pair.kind === 'pair') {
  check(pair.current.version === '3.0', 'current is newest (index 0)')
  check(pair.previous.version === '2.1', 'previous is index 1')
}
