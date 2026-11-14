// Self-check. Run: node --experimental-strip-types src/features/requests/pending-count.check.ts
import assert from 'node:assert/strict'
import type { AccessRequest } from '@/lib/access-api'
import { pendingDocCount } from './pending-count.ts'

const r = (documentId: string, status: AccessRequest['status']) =>
  ({ documentId, status }) as AccessRequest

assert.equal(pendingDocCount([]), 0)
assert.equal(pendingDocCount([r('D1', 'pending'), r('D1', 'pending')]), 1)
assert.equal(pendingDocCount([r('D1', 'pending'), r('D2', 'approved')]), 1)
assert.equal(pendingDocCount([r('D1', 'pending'), r('D2', 'pending')]), 2)
// eslint-disable-next-line no-console
console.log('pending-count.check: ok')
