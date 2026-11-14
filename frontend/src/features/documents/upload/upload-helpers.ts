import type { Document, Tlp } from '@/data/grc'

// Server MAX_FILE in backend/uploads.mjs.
const DOC_MAX_BYTES = 10 * 1024 * 1024
export const DOC_MAX_LABEL = '10 MB'

export const DOC_PDF_MIME = 'application/pdf'
export const DOC_XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const DOC_MIMES = [DOC_PDF_MIME, DOC_XLSX_MIME] as const
export type DocMime = (typeof DOC_MIMES)[number]

export function resolveDocMime(file: {
  name: string
  type: string
}): DocMime | null {
  if (file.type === DOC_PDF_MIME || file.type === DOC_XLSX_MIME)
    return file.type
  const ext = file.name.split('.').pop()?.toLowerCase()
  return ext === 'pdf' ? DOC_PDF_MIME : ext === 'xlsx' ? DOC_XLSX_MIME : null
}

export function docFileError(file: {
  name: string
  size: number
  type: string
}): string | null {
  if (file.size > DOC_MAX_BYTES) return `Berkas melebihi ${DOC_MAX_LABEL}.`
  if (file.size === 0) return 'Berkas kosong tidak dapat diunggah.'
  if (resolveDocMime(file) === null) return 'Hanya PDF atau XLSX yang diterima.'
  return null
}

export function docMimeLabel(mime: string): string {
  if (mime === DOC_PDF_MIME) return 'PDF'
  if (mime === DOC_XLSX_MIME) return 'XLSX'
  return '—'
}

export const UPLOAD_STEPS = [
  { n: 1, label: 'Berkas', column: 'PDF · XLSX · 10 MB' },
  { n: 2, label: 'Identitas', column: 'KOLOM 12 · DOKUMEN' },
  { n: 3, label: 'Klasifikasi', column: 'KOLOM TLP · AKSES' },
  { n: 4, label: 'Siklus', column: 'KOLOM STATUS · TINJAUAN' },
  { n: 5, label: 'Tinjau', column: 'SIAP DIKIRIM' },
  { n: 6, label: 'Selesai', column: 'TERKIRIM' },
] as const

export type UploadStep = 1 | 2 | 3 | 4 | 5 | 6

export function clampStep(value: unknown): UploadStep {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 6 ? (n as UploadStep) : 1
}

export type DocStatus = 'draft' | 'in review'

export type UploadMeta = {
  title: string
  type: string
  owner: string
  approver: string
  version: string
  tlp: Tlp
  status: DocStatus
  nextReview: string
  summary: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const DAY_MS = 86_400_000

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// ponytail: UTC month math, day clamped to the target month; ISO dates only.
export function addMonths(iso: string, months: number): string {
  if (!isIsoDate(iso)) return iso
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

function reviewDays(iso: string, today: string): number {
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS
  )
}

export function reviewDayLabel(iso: string, today: string): string {
  if (!isIsoDate(iso)) return '—'
  const days = reviewDays(iso, today)
  if (days < 0) return `lewat ${Math.abs(days)} hari`
  if (days === 0) return 'hari ini'
  return `${days} hari lagi`
}

const VERSION_PATTERN = /^\d+\.\d+$/

export function previewDocId(ids: string[]): string {
  const max = ids.reduce((m, id) => {
    const match = /^DOC-(\d{4})$/.exec(id)
    return match ? Math.max(m, Number(match[1])) : m
  }, 0)
  return `DOC-${String(max + 1).padStart(4, '0')}`
}

export function uniqueValues(
  docs: Pick<Document, 'owner' | 'approver'>[],
  key: 'owner' | 'approver'
): string[] {
  return [...new Set(docs.map((doc) => doc[key]).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'id')
  )
}

export function validateStep(
  step: UploadStep,
  meta: UploadMeta,
  hasFile: boolean
): string | null {
  if (step === 1) {
    return hasFile ? null : 'Pilih berkas PDF atau XLSX terlebih dahulu.'
  }
  if (step === 2) {
    if (!meta.title.trim()) return 'Judul dokumen wajib diisi.'
    if (meta.title.trim().length > 200) return 'Judul maksimal 200 karakter.'
    if (!meta.type) return 'Jenis dokumen wajib dipilih.'
    if (!meta.owner.trim()) return 'Pemilik wajib diisi.'
    if (meta.owner.trim().length > 120) return 'Pemilik maksimal 120 karakter.'
    if (!meta.approver.trim()) return 'Penyetuju wajib diisi.'
    if (meta.approver.trim().length > 120)
      return 'Penyetuju maksimal 120 karakter.'
    if (!VERSION_PATTERN.test(meta.version))
      return 'Versi harus berbentuk angka.angka, misalnya 1.0.'
    return null
  }
  if (step === 3) return null
  if (step === 4) {
    if (!meta.nextReview) return 'Tanggal tinjauan wajib diisi.'
    if (!isIsoDate(meta.nextReview)) return 'Tanggal tinjauan tidak valid.'
    if (!meta.summary.trim()) return 'Catatan perubahan wajib diisi.'
    if (meta.summary.trim().length > 500)
      return 'Catatan perubahan maksimal 500 karakter.'
    return null
  }
  return null
}

const STEP_BY_FIELD: Record<string, UploadStep> = {
  file: 1,
  mime: 1,
  title: 2,
  type: 2,
  owner: 2,
  approver: 2,
  version: 2,
  tlp: 3,
  status: 4,
  nextReview: 4,
  summary: 4,
}

const FIELD_LABEL: Record<string, string> = {
  file: 'berkas',
  mime: 'jenis berkas',
  title: 'judul',
  type: 'jenis',
  owner: 'pemilik',
  approver: 'penyetuju',
  version: 'versi',
  tlp: 'TLP',
  status: 'status',
  nextReview: 'tanggal tinjauan',
  summary: 'catatan perubahan',
}

export function stepForError(status: number, error?: string): UploadStep {
  if (status === 403) return 3
  if (status === 413 || status === 415) return 1
  if (status === 400 && error?.startsWith('invalid ')) {
    const field = error.slice('invalid '.length).trim()
    return STEP_BY_FIELD[field] ?? 5
  }
  return 5
}

export function createErrorMessage(status: number, error?: string): string {
  if (status === 403)
    return 'TLP yang dipilih melebihi batas akses akun Anda. Pilih TLP yang lebih rendah.'
  if (status === 413) return `Berkas melebihi ${DOC_MAX_LABEL}.`
  if (status === 415)
    return 'Jenis berkas tidak didukung. Gunakan PDF atau XLSX.'
  if (status === 429) return 'Terlalu banyak unggahan. Coba lagi nanti.'
  if (status === 502 || status === 503)
    return 'Modul enkripsi tidak merespons. Berkas tidak disimpan.'
  if (status === 0) return 'Jaringan bermasalah. Berkas tidak disimpan.'
  if (status === 400 && error?.startsWith('invalid ')) {
    const field = error.slice('invalid '.length).trim()
    return `Isian ${FIELD_LABEL[field] ?? field} tidak valid.`
  }
  return 'Unggahan gagal. Berkas tidak disimpan.'
}

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: 'Draft',
  'in review': 'In review',
}

export function formatAuditTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
