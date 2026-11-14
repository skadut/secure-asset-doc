import type { Tlp } from '@/data/grc'
import { bytesToBase64 } from '../uploads/uploads-helpers'
import {
  DOC_MIMES,
  type DocMime,
  type DocStatus,
  type UploadMeta,
} from './upload-helpers'

const TIMEOUT_MS = 60_000

type CreateDocInput = UploadMeta & {
  file: { name: string; mime: DocMime; data: string }
}

export type CreatedDoc = {
  id: string
  title: string
  type: string
  tlp: Tlp
  status: DocStatus
  version: string
  nextReview: string
  owner: string
  approver: string
  fileName: string
  size: number
  uploadedBy: string
  at: string
}

type CreateResult =
  | { ok: true; doc: CreatedDoc }
  | { ok: false; status: number; error?: string }

export function encodeFile(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    try {
      return bytesToBase64(bytes)
    } finally {
      bytes.fill(0)
    }
  })
}

export async function createDocument(
  input: CreateDocInput
): Promise<CreateResult> {
  if (!DOC_MIMES.includes(input.file.mime))
    return { ok: false, status: 415, error: 'invalid mime' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('/api/documents', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const error =
        json && typeof json === 'object' && 'error' in json
          ? String((json as { error: unknown }).error)
          : undefined
      return { ok: false, status: res.status, error }
    }
    if (!json || typeof json !== 'object' || !('id' in json))
      return { ok: false, status: res.status }
    return { ok: true, doc: json as CreatedDoc }
  } catch {
    return { ok: false, status: 0 }
  } finally {
    clearTimeout(timer)
  }
}
