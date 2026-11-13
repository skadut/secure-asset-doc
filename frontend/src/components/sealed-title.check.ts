import { maskTitle } from './sealed-title-helpers.ts'

// Self-check, no framework: run with `node --experimental-strip-types`. Throws on failure.
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`sealed-title check failed: ${message}`)
}

check(maskTitle('Pen******:t1:abc') === 'Pen******', 'masked prefix is kept')
check(
  maskTitle('Laporan biasa') === 'Laporan biasa',
  'plain title is unchanged'
)
check(maskTitle(':t1:abc') === '••••••', 'empty prefix falls back to dots')
check(maskTitle('a:t1:b:t1:c') === 'a', 'first marker wins')
