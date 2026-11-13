import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { Tlp } from '@/data/grc'
import { toast } from 'sonner'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SealedTitle } from '@/components/sealed-title'
import { TlpBadge } from '@/components/tlp-badge'
import { TLP_LEVELS } from '../helpers'

type Provenance = {
  derivedFrom: string | null
  children: { id: string; title: string; tlp: Tlp }[]
}
type DeriveResponse = { documentId: string; auditId: string }

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    const json: { error?: string } = await res.json().catch(() => ({}))
    throw new Error(
      res.status === 403 ? 'Not allowed' : (json.error ?? `HTTP ${res.status}`)
    )
  }
  return res
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Request failed'
const getJson = async <T,>(url: string): Promise<T> =>
  (await request(url)).json() as Promise<T>

export function DeriveBriefing({
  documentId,
  parentTlp,
}: {
  documentId: string
  parentTlp: Tlp
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [tlp, setTlp] = useState<Tlp | ''>('')
  const [summary, setSummary] = useState('')
  const [titleError, setTitleError] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const allowedTlps = TLP_LEVELS.slice(0, TLP_LEVELS.indexOf(parentTlp))

  const provenance = useQuery({
    queryKey: ['document-derived', documentId],
    queryFn: () =>
      getJson<Provenance>(
        `/api/documents/${encodeURIComponent(documentId)}/derived`
      ),
    retry: false,
  })
  const derive = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('Title is required')
      if (!summary.trim()) throw new Error('Summary is required')
      if (!tlp || !allowedTlps.includes(tlp))
        throw new Error('Select a lower TLP level')
      const response = await request(
        `/api/documents/${encodeURIComponent(documentId)}/derive`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim(),
            tlp,
            summary: summary.trim(),
          }),
        }
      )
      return response.json() as Promise<DeriveResponse>
    },
    onSuccess: () => {
      toast.success('Derived briefing created')
      setOpen(false)
      void queryClient.invalidateQueries({
        queryKey: ['document-derived', documentId],
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <section className='flex min-w-0 flex-col gap-4'>
      {getMe()?.accessLevel === 5 && allowedTlps.length > 0 && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className='min-h-11 w-fit'>Create derived briefing</Button>
          </DialogTrigger>
          <DialogContent className='max-h-[90dvh] overflow-y-auto'>
            <DialogHeader>
              <DialogTitle>Create derived briefing</DialogTitle>
              <DialogDescription>
                Create a summary with a TLP classification lower than the parent
                document.
              </DialogDescription>
            </DialogHeader>
            <form
              noValidate
              className='flex min-w-0 flex-col gap-4'
              onSubmit={(event) => {
                event.preventDefault()
                const nextTitleError = title.trim() ? '' : 'Title is required.'
                const nextSummaryError = summary.trim()
                  ? ''
                  : 'Summary is required.'
                setTitleError(nextTitleError)
                setSummaryError(nextSummaryError)
                if (!nextTitleError && !nextSummaryError) derive.mutate()
              }}
            >
              <div className='flex min-w-0 flex-col gap-1.5'>
                <Label htmlFor='derive-title'>Title</Label>
                <Input
                  id='derive-title'
                  className='h-11 sm:h-9'
                  maxLength={120}
                  required
                  value={title}
                  aria-invalid={!!titleError}
                  aria-describedby={
                    titleError ? 'derive-title-error' : undefined
                  }
                  onChange={(event) => {
                    setTitle(event.target.value)
                    setTitleError('')
                  }}
                />
                {titleError && (
                  <p
                    id='derive-title-error'
                    className='text-sm text-destructive'
                    role='alert'
                  >
                    {titleError}
                  </p>
                )}
              </div>
              <div className='flex min-w-0 flex-col gap-1.5'>
                <Label htmlFor='derive-tlp'>TLP</Label>
                <Select
                  value={tlp}
                  onValueChange={(value) => setTlp(value as Tlp)}
                >
                  <SelectTrigger id='derive-tlp' className='min-h-11 w-full'>
                    <SelectValue placeholder='Select a lower TLP level' />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedTlps.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='flex min-w-0 flex-col gap-1.5'>
                <Label htmlFor='derive-summary'>Briefing summary</Label>
                <Textarea
                  id='derive-summary'
                  maxLength={4000}
                  required
                  rows={6}
                  value={summary}
                  aria-invalid={!!summaryError}
                  aria-describedby={
                    summaryError ? 'derive-summary-error' : undefined
                  }
                  onChange={(event) => {
                    setSummary(event.target.value)
                    setSummaryError('')
                  }}
                />
                {summaryError && (
                  <p
                    id='derive-summary-error'
                    className='text-sm text-destructive'
                    role='alert'
                  >
                    {summaryError}
                  </p>
                )}
              </div>
              <DialogFooter className='flex-col-reverse gap-2 sm:flex-row'>
                <Button
                  type='button'
                  variant='outline'
                  className='min-h-11'
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type='submit'
                  className='min-h-11'
                  disabled={derive.isPending}
                >
                  {derive.isPending ? 'Saving…' : 'Create briefing'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {provenance.data?.derivedFrom && (
        <p className='text-sm break-words'>
          Derived from{' '}
          <Link
            className='underline underline-offset-4'
            to='/documents/$documentId'
            params={{ documentId: provenance.data.derivedFrom }}
          >
            {provenance.data.derivedFrom}
          </Link>
        </p>
      )}
      {!!provenance.data?.children.length && (
        <div className='flex min-w-0 flex-col gap-2'>
          <h2 className='text-lg font-semibold'>Derived briefings</h2>
          <ul className='flex min-w-0 flex-col gap-2'>
            {provenance.data.children.map((child) => (
              <li
                key={child.id}
                className='flex min-w-0 flex-wrap items-center gap-2 text-sm break-words'
              >
                <Link
                  className='break-all underline underline-offset-4'
                  to='/documents/$documentId'
                  params={{ documentId: child.id }}
                >
                  {child.id}
                </Link>
                <SealedTitle
                  title={child.title}
                  className='min-w-0 break-words'
                />
                <TlpBadge tlp={child.tlp} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
