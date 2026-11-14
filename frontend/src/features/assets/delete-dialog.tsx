import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { assets, assetDocLinks, evidenceLinks, type Asset } from '@/data/grc'
import { refreshGrc } from '@/lib/grc-refresh'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Chip } from '@/components/chip'
import { statusLabel } from './columns'
import { zoneFor } from './zone'

const labelClass = 'font-mono text-[9px] tracking-[.08em] text-ink-3 uppercase'
const fieldClass =
  'rounded-none border-line bg-surface font-mono text-[12px] text-ink focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
const formatTime = () =>
  new Date().toLocaleTimeString('id-ID', { hour12: false })

export function DeleteAssetDialog({
  asset,
  open,
  onOpenChange,
  onDeleted,
}: {
  asset: Asset
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const [phase, setPhase] = useState<'confirm' | 'deleted'>('confirm')
  const [reason, setReason] = useState('')
  const [confirmId, setConfirmId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState({ assets: 0, retired: 0 })
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return
    setPhase('confirm')
    setReason('')
    setConfirmId('')
    setError('')
    setBusy(false)
  }, [asset, open])
  /* eslint-enable react-hooks/set-state-in-effect */
  const evidenceCount = evidenceLinks.filter(
    (link) => link.assetId === asset.id
  ).length
  const documentCount = assetDocLinks.filter(
    (link) => link.assetId === asset.id
  ).length
  const canDelete = reason.trim().length > 0 && confirmId === asset.id && !busy

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!canDelete) return
    setBusy(true)
    setError('')
    const before = {
      assets: assets.length,
      retired: assets.filter((item) => item.status === 'retired').length,
    }
    try {
      const response = await fetch(
        `/api/assets/${encodeURIComponent(asset.id)}`,
        {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim(), confirmId }),
        }
      )
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok)
        throw new Error(
          result &&
            typeof result === 'object' &&
            'error' in result &&
            typeof result.error === 'string'
            ? result.error
            : `Gagal menghapus aset (HTTP ${response.status}).`
        )
      await refreshGrc()
      setCounts(before)
      onDeleted?.()
      setPhase('deleted')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal menghapus aset.')
    } finally {
      setBusy(false)
    }
  }

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      (event.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return
    event.preventDefault()
    if (phase === 'confirm' && canDelete) void submit()
  }
  const newAssetCount =
    phase === 'deleted' ? assets.length : Math.max(0, counts.assets - 1)
  const newRetiredCount =
    phase === 'deleted'
      ? assets.filter((item) => item.status === 'retired').length
      : counts.retired

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className='max-h-[92dvh] max-w-[calc(100%-2rem)] gap-0 overflow-y-auto rounded-none border-line bg-surface p-0 shadow-xl sm:max-w-[600px]'
        aria-describedby='delete-dialog-description'
      >
        <div className='flex items-center justify-between bg-ink px-5 py-3 text-surface'>
          <span className='font-mono text-[10px] tracking-[.1em]'>
            {phase === 'confirm' ? '05 · HAPUS' : '06 · TERHAPUS'}
          </span>
          <Chip tone={phase === 'confirm' ? 'fail' : 'pass'}>
            {phase === 'confirm' ? 'DESTRUKTIF' : 'TERCATAT'}
          </Chip>
        </div>
        <form
          onSubmit={submit}
          onKeyDown={onFormKeyDown}
          className='flex min-h-[420px] flex-col p-5 sm:p-6'
        >
          <div className='mb-5'>
            <DialogTitle className='text-xl font-semibold text-ink'>
              {phase === 'confirm' ? `Hapus ${asset.id}?` : 'Aset dihapus'}
            </DialogTitle>
            <DialogDescription
              id='delete-dialog-description'
              className='mt-2 text-[12px] leading-5 text-ink-2'
            >
              {phase === 'confirm'
                ? `${asset.name} · ${asset.zone || zoneFor(asset.purdueLevel, asset.type)} · ${asset.purdueLevel} · ${statusLabel[asset.status]}. Aset tertaut hilang dari daftar dan statistik.`
                : `${asset.id} tidak lagi tampil. TOTAL ASET ${counts.assets} → ${newAssetCount}. STATUS RETIRED ${counts.retired} → ${newRetiredCount}.`}
            </DialogDescription>
          </div>

          {phase === 'confirm' ? (
            <>
              <dl className='mb-5 border border-line text-[12px]'>
                <div className='grid grid-cols-[100px_minmax(0,1fr)] gap-3 border-b border-line px-3 py-3'>
                  <dt className={labelClass}>BUKTI CSF</dt>
                  <dd className='text-ink'>
                    <strong className='font-semibold'>{evidenceCount}</strong>{' '}
                    bukti tertaut akan dilepas
                  </dd>
                </div>
                <div className='grid grid-cols-[100px_minmax(0,1fr)] gap-3 px-3 py-3'>
                  <dt className={labelClass}>DOKUMEN</dt>
                  <dd className='text-ink'>
                    <strong className='font-semibold'>{documentCount}</strong>{' '}
                    dokumen tertaut akan dilepas
                  </dd>
                </div>
              </dl>
              <div className='mb-4 flex flex-col gap-1.5'>
                <Label htmlFor='delete-asset-reason' className={labelClass}>
                  ALASAN *
                </Label>
                <Textarea
                  id='delete-asset-reason'
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  aria-invalid={!reason.trim() && !!error}
                  className={`${fieldClass} min-h-20 resize-y`}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='delete-asset-confirm-id' className={labelClass}>
                  KETIK ID UNTUK KONFIRMASI *
                </Label>
                <Input
                  id='delete-asset-confirm-id'
                  value={confirmId}
                  onChange={(e) => setConfirmId(e.target.value)}
                  placeholder={asset.id}
                  autoComplete='off'
                  className={fieldClass}
                  aria-describedby='delete-asset-confirm-help'
                />
                <span
                  id='delete-asset-confirm-help'
                  className='font-mono text-[9px] text-ink-3'
                >
                  Tombol hapus aktif setelah ID cocok.
                </span>
              </div>
              <p className='mt-4 border-s-2 border-fail bg-surface-2 px-3 py-2 text-[11px] leading-5 text-ink-2'>
                Pertimbangkan status Retired bila aset masih perlu dilacak.
                Hapus tidak dapat dibatalkan.
              </p>
            </>
          ) : (
            <dl className='border border-line text-[12px]'>
              {[
                ['AUDIT', `asset.delete · ${formatTime()}`],
                ['OLEH', getMe()?.name ?? '—'],
                ['ALASAN', reason.trim()],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className='grid grid-cols-[100px_minmax(0,1fr)] gap-3 border-b border-line px-3 py-2 last:border-b-0'
                >
                  <dt className={labelClass}>{label}</dt>
                  <dd className='break-words text-ink'>{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {error && (
            <p
              role='alert'
              aria-live='assertive'
              className='mt-3 text-[12px] text-fail'
            >
              {error}
            </p>
          )}
          <div className='mt-auto flex flex-col gap-2 pt-6'>
            {phase === 'confirm' ? (
              <>
                <Button
                  type='submit'
                  disabled={!canDelete}
                  className='h-11 w-full justify-between rounded-none bg-fail px-3 text-left text-white hover:bg-fail/90 disabled:opacity-50'
                >
                  <span>{busy ? 'Menghapus…' : 'Hapus aset'}</span>
                  <span className='font-mono text-[9px]'>ENTER</span>
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => onOpenChange(false)}
                  className='h-11 w-full rounded-none border-line'
                >
                  Batal
                </Button>
              </>
            ) : (
              <Button
                type='button'
                onClick={() => onOpenChange(false)}
                className='h-11 w-full justify-between rounded-none bg-ink px-3 text-left text-surface hover:bg-ink/90'
              >
                <span>Kembali ke daftar</span>
                <span className='font-mono text-[9px]'>ENTER</span>
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
