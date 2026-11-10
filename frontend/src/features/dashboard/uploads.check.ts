// Self-check. Run: node --experimental-strip-types src/features/dashboard/uploads.check.ts
import assert from 'node:assert/strict'
import {
  bytesToBase64,
  checkUploadFile,
  errorMessageForStatus,
  resolveUploadMime,
} from './components/uploads-helpers.ts'

const MIB10 = 10 * 1024 * 1024

assert.equal(bytesToBase64(new TextEncoder().encode('hi')), 'aGk=')
assert.equal(bytesToBase64(new Uint8Array(MIB10)).length, Math.ceil(MIB10 / 3) * 4)

assert.notEqual(checkUploadFile({ size: MIB10 + 1 }, resolveUploadMime({ name: 'a.pdf', type: 'application/pdf' })), null)
assert.equal(checkUploadFile({ size: MIB10 }, resolveUploadMime({ name: 'a.pdf', type: 'application/pdf' })), null)
assert.notEqual(checkUploadFile({ size: 1 }, resolveUploadMime({ name: 'a.zip', type: 'application/zip' })), null)
assert.equal(checkUploadFile({ size: 1 }, resolveUploadMime({ name: 'a.TXT', type: '' })), null)
assert.equal(resolveUploadMime({ name: 'a.txt', type: '' }), 'text/plain')

assert.equal(errorMessageForStatus(413), 'File is larger than 10 MiB')
assert.equal(errorMessageForStatus(429), 'Too many uploads, wait a moment')
