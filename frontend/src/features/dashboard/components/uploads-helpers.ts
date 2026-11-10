const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const UNSUPPORTED_TYPE_MESSAGE = 'Unsupported file type. Use PDF, PNG, JPEG or plain text.'

const ALLOWED_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']
const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function resolveUploadMime(file: { name: string; type: string }): string | null {
  const type = file.type || (file.name.toLowerCase().endsWith('.txt') ? 'text/plain' : '')
  return ALLOWED_MIMES.includes(type) ? type : null
}

export function checkUploadFile(file: { size: number }, mime: string | null): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return 'File is larger than 10 MiB'
  if (mime === null) return UNSUPPORTED_TYPE_MESSAGE
  return null
}

export function errorMessageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'File content does not match its type or is invalid'
    case 413:
      return 'File is larger than 10 MiB'
    case 429:
      return 'Too many uploads, wait a moment'
    case 502:
    case 503:
    case 504:
      return 'Crypto service or key zone unavailable. File not stored.'
    default:
      return 'Upload failed. Try again.'
  }
}
