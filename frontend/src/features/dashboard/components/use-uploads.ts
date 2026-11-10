import { useCallback } from 'react'
import { bytesToBase64, checkUploadFile, errorMessageForStatus, resolveUploadMime, UNSUPPORTED_TYPE_MESSAGE } from './uploads-helpers'

type UploadResult = { ok: true } | { ok: false; message: string }

const NETWORK_ERROR = 'Network error. File not uploaded.'
const TIMEOUT_ERROR = 'Upload timed out. File not stored.'
const UPLOAD_TIMEOUT_MS = 60_000

export function useUploads() {
  const upload = useCallback(async (file: File): Promise<UploadResult> => {
    const mime = resolveUploadMime(file)
    const invalid = checkUploadFile(file, mime)
    if (invalid || mime === null) return { ok: false, message: invalid ?? UNSUPPORTED_TYPE_MESSAGE }
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, mime, data }),
        signal: ctrl.signal,
      })
      if (!res.ok) return { ok: false, message: errorMessageForStatus(res.status) }
      return { ok: true }
    } catch {
      return { ok: false, message: timedOut ? TIMEOUT_ERROR : NETWORK_ERROR }
    } finally {
      clearTimeout(timer)
    }
  }, [])

  return { upload }
}
