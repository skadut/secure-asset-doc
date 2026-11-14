import {
  bytesToBase64,
  checkUploadFile,
  contentErrorMessage,
  resolveUploadMime,
  UNSUPPORTED_TYPE_MESSAGE,
  uploadErrorMessage,
} from './uploads-helpers'

export type UploadRecord = {
  id: string
  name: string
  mime: string
  size: number
  uploadedAt: string
  uploadedBy: string | null
}

/** @public Retained for the encrypted-uploads tab; no UI entry point after the wizard replaced the dialog. */
export type UploadOutcome =
  | { ok: true; file: UploadRecord }
  | { ok: false; message: string }

const UPLOAD_TIMEOUT_MS = 60_000
const NETWORK_ERROR = 'Jaringan bermasalah. Berkas tidak disimpan.'
const TIMEOUT_ERROR = 'Unggahan melebihi waktu tunggu. Berkas tidak disimpan.'

/** @public Retained for the encrypted-uploads tab; no UI entry point after the wizard replaced the dialog. */
export async function uploadFile(file: File): Promise<UploadOutcome> {
  const mime = resolveUploadMime(file)
  const invalid = checkUploadFile(file, mime)
  if (invalid || mime === null)
    return { ok: false, message: invalid ?? UNSUPPORTED_TYPE_MESSAGE }
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, UPLOAD_TIMEOUT_MS)
  try {
    const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    const res = await fetch('/api/uploads', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, mime, data }),
      signal: ctrl.signal,
    })
    if (!res.ok) return { ok: false, message: uploadErrorMessage(res.status) }
    const json: unknown = await res.json()
    if (!json || typeof json !== 'object' || !('id' in json))
      return { ok: false, message: 'Unggahan gagal. Berkas tidak disimpan.' }
    return { ok: true, file: json as UploadRecord }
  } catch {
    return { ok: false, message: timedOut ? TIMEOUT_ERROR : NETWORK_ERROR }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchUploads(): Promise<UploadRecord[]> {
  const res = await fetch('/api/uploads', { credentials: 'same-origin' })
  if (!res.ok)
    throw new Error(
      res.status === 403
        ? 'Anda tidak memiliki izin membaca berkas terunggah.'
        : 'Berkas terunggah gagal dimuat.'
    )
  const json: unknown = await res.json()
  if (!Array.isArray(json)) throw new Error('Berkas terunggah gagal dimuat.')
  return json as UploadRecord[]
}

export async function openUploadContent(
  id: string
): Promise<{ blob: Blob; mime: string }> {
  const res = await fetch(`/api/uploads/${encodeURIComponent(id)}/content`, {
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(contentErrorMessage(res.status))
  return {
    blob: await res.blob(),
    mime: res.headers.get('content-type') ?? '',
  }
}
