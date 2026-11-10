import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { auditEvents } from '@/data/grc'
import { setMe } from '@/lib/session'
import { toCsv } from './csv'

type Preview = { before: string; count: number; oldest: string | null }

type PurgeDialogProps = {
  open: boolean
  onOpenChange: (o: boolean) => void
  onPurged: () => void
}

export function PurgeDialog({ open, onOpenChange, onPurged }: PurgeDialogProps) {
  const [before, setBefore] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  // Synchronous resets live in the date onChange handler (see below), not in this effect.
  useEffect(() => {
    if (!before) return
    let stale = false
    ;(async () => {
      try {
        const res = await fetch(`/api/audit/purge-preview?before=${encodeURIComponent(before)}`, {
          credentials: 'same-origin',
        })
        if (stale) return
        if (res.status === 401) {
          toast.error('Session expired')
          setMe(null)
          window.location.reload()
        } else if (res.status === 403) {
          setPreviewError('Not allowed')
        } else if (!res.ok) {
          const json: { error?: string } = await res.json().catch(() => ({}))
          if (stale) return
          setPreviewError(json.error ?? `HTTP ${res.status}`)
        } else {
          const json: Preview = await res.json()
          if (stale) return
          setPreview(json)
        }
      } catch {
        if (!stale) setPreviewError('Preview failed')
      } finally {
        if (!stale) setLoading(false)
      }
    })()
    return () => {
      stale = true
    }
  }, [before])

  const cutoff = preview ? Date.parse(preview.before) : NaN
  const rows = auditEvents.filter((e) => e.action !== 'purge' && Date.parse(e.at) < cutoff)

  function download() {
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-before-${before}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const phrase = `PURGE AUDIT BEFORE ${before}`
  const canDelete = !!preview && preview.count > 0 && typed === phrase && !pending

  const close = (o: boolean) => {
    if (!o) {
      setBefore('')
      setPreview(null)
      setPreviewError(null)
      setLoading(false)
      setTyped('')
      setPending(false)
    }
    onOpenChange(o)
  }

  async function handleDelete() {
    setPending(true)
    try {
      const res = await fetch('/api/audit/purge', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ before, confirm: phrase }),
      })
      const json: { deleted?: number; error?: string } = await res.json().catch(() => ({}))
      if (res.status === 200) {
        const n = typeof json.deleted === 'number' ? json.deleted : 0
        toast.success(`Deleted ${n} entries`)
        close(false)
        onPurged()
      } else if (res.status === 400) {
        toast.error(json.error ?? 'Request rejected')
      } else if (res.status === 403) {
        toast.error('Not allowed')
      } else if (res.status === 401) {
        toast.error('Session expired')
        setMe(null)
        window.location.reload()
      } else {
        toast.error(`HTTP ${res.status}`)
      }
    } catch {
      toast.error('Network error')
    } finally {
      setPending(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={close}
      title="Purge old entries"
      desc="Permanently delete audit entries older than a date. Purge records are kept."
      destructive
      confirmText="Delete"
      isLoading={pending}
      disabled={!canDelete}
      handleConfirm={handleDelete}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="purge-before">Delete entries older than</Label>
          <Input
            id="purge-before"
            type="date"
            max={today}
            value={before}
            onChange={(e) => {
              const next = e.target.value
              setBefore(next)
              setTyped('')
              // Drop the previous count so delete cannot be enabled against an old date's preview.
              setPreview(null)
              setPreviewError(null)
              setLoading(!!next)
            }}
          />
        </div>

        <p aria-live="polite" className="text-sm text-muted-foreground">
          {loading
            ? 'Loading preview…'
            : previewError
              ? previewError
              : preview
                ? `${preview.count} entries before ${before} will be deleted (oldest: ${preview.oldest ? preview.oldest.slice(0, 10) : 'none'}). Purge records are kept.`
                : null}
        </p>

        <Button type="button" variant="outline" disabled={!before || rows.length === 0} onClick={download}>
          Download CSV ({rows.length} entries)
        </Button>

        {before && (
          <>
            <p className="text-sm">
              Type <code>{phrase}</code> to confirm.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="purge-confirm">Confirmation phrase</Label>
              <Input
                id="purge-confirm"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={!before}
              />
            </div>
          </>
        )}
      </div>
    </ConfirmDialog>
  )
}
