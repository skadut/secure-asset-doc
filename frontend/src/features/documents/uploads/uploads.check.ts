// Self-check. Run: node --experimental-strip-types src/features/documents/uploads/uploads.check.ts
import assert from 'node:assert/strict'
import {
  CRYPTO_DOWN_MESSAGE,
  TOO_LARGE_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
  bytesToBase64,
  checkUploadFile,
  contentErrorMessage,
  formatBytes,
  mimeLabel,
  parseUploadFlag,
  resolveUploadMime,
  uploadErrorMessage,
} from './uploads-helpers.ts'

const MIB10 = 10 * 1024 * 1024

assert.equal(bytesToBase64(new TextEncoder().encode('hi')), 'aGk=')
assert.equal(
  bytesToBase64(new Uint8Array(MIB10)).length,
  Math.ceil(MIB10 / 3) * 4
)

const pdf = { name: 'a.pdf', type: 'application/pdf' }
assert.equal(checkUploadFile({ size: MIB10 }, resolveUploadMime(pdf)), null)
assert.equal(
  checkUploadFile({ size: MIB10 + 1 }, resolveUploadMime(pdf)),
  TOO_LARGE_MESSAGE
)
assert.equal(
  checkUploadFile(
    { size: 1 },
    resolveUploadMime({ name: 'a.zip', type: 'application/zip' })
  ),
  UNSUPPORTED_TYPE_MESSAGE
)
assert.equal(
  checkUploadFile({ size: 1 }, resolveUploadMime({ name: 'a.TXT', type: '' })),
  null
)
assert.equal(resolveUploadMime({ name: 'a.txt', type: '' }), 'text/plain')
assert.equal(resolveUploadMime({ name: 'a.exe', type: '' }), null)

assert.equal(formatBytes(0), '0 B')
assert.equal(formatBytes(1536), '2 KB')
assert.equal(formatBytes(MIB10), '10 MB')
assert.equal(formatBytes(1.25 * 1024 * 1024), '1,3 MB')
assert.equal(formatBytes(Number.NaN), '—')

assert.equal(mimeLabel('application/pdf'), 'PDF')
assert.equal(mimeLabel('image/jpeg'), 'JPEG')
assert.equal(mimeLabel('text/plain'), 'Teks')
assert.equal(mimeLabel('application/octet-stream'), 'application/octet-stream')

assert.equal(uploadErrorMessage(400), uploadErrorMessage(415))
assert.equal(uploadErrorMessage(413), TOO_LARGE_MESSAGE)
assert.equal(uploadErrorMessage(429), CRYPTO_DOWN_MESSAGE)
assert.equal(uploadErrorMessage(503), CRYPTO_DOWN_MESSAGE)
assert.match(uploadErrorMessage(403), /tidak diizinkan/)
assert.equal(
  contentErrorMessage(403),
  'Anda tidak diizinkan membuka berkas ini.'
)
assert.equal(contentErrorMessage(404), 'Berkas tidak ditemukan.')

// TanStack's default search parser coerces ?upload=1 to the number 1.
assert.equal(parseUploadFlag(true), true)
assert.equal(parseUploadFlag(1), true)
assert.equal(parseUploadFlag('1'), true)
assert.equal(parseUploadFlag('true'), true)
assert.equal(parseUploadFlag(0), undefined)
assert.equal(parseUploadFlag('0'), undefined)
assert.equal(parseUploadFlag(undefined), undefined)
assert.equal(parseUploadFlag(null), undefined)
assert.equal(parseUploadFlag('false'), undefined)
