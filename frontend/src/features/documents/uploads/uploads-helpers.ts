const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const ALLOWED_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
]
const CHUNK = 0x8000

export function parseUploadFlag(value: unknown): boolean | undefined {
  return value === true || value === 1 || value === '1' || value === 'true'
    ? true
    : undefined
}

export const UNSUPPORTED_TYPE_MESSAGE =
  'Jenis berkas tidak didukung. Gunakan PDF, PNG, JPG, atau TXT.'
export const TOO_LARGE_MESSAGE = 'Berkas melebihi 10 MB.'
export const CRYPTO_DOWN_MESSAGE =
  'Modul enkripsi tidak merespons. Berkas tidak disimpan.'

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function resolveUploadMime(file: {
  name: string
  type: string
}): string | null {
  const type =
    file.type || (file.name.toLowerCase().endsWith('.txt') ? 'text/plain' : '')
  return ALLOWED_MIMES.includes(type) ? type : null
}

export function checkUploadFile(
  file: { size: number },
  mime: string | null
): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE_MESSAGE
  if (mime === null) return UNSUPPORTED_TYPE_MESSAGE
  return null
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`
}

const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'text/plain': 'Teks',
}

export function mimeLabel(mime: string): string {
  return MIME_LABEL[mime] ?? (mime || '—')
}

export function uploadErrorMessage(status: number): string {
  switch (status) {
    case 400:
    case 415:
      return 'Jenis atau isi berkas tidak sesuai. Berkas tidak disimpan.'
    case 403:
      return 'Anda tidak diizinkan mengunggah berkas.'
    case 408:
      return 'Unggahan melebihi waktu tunggu. Berkas tidak disimpan.'
    case 413:
      return TOO_LARGE_MESSAGE
    case 429:
    case 502:
    case 503:
    case 504:
      return CRYPTO_DOWN_MESSAGE
    default:
      return 'Unggahan gagal. Berkas tidak disimpan.'
  }
}

export function contentErrorMessage(status: number): string {
  switch (status) {
    case 403:
      return 'Anda tidak diizinkan membuka berkas ini.'
    case 404:
      return 'Berkas tidak ditemukan.'
    case 429:
    case 502:
    case 503:
    case 504:
      return 'Modul dekripsi tidak merespons. Coba lagi.'
    default:
      return 'Berkas gagal dibuka.'
  }
}
