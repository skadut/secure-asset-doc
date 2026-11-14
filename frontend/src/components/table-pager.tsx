import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function TablePager({
  summary,
  pageIndex,
  pageCount,
  onPage,
  canPrev,
  canNext,
  label,
}: {
  summary: ReactNode
  pageIndex: number
  pageCount: number
  onPage: (i: number) => void
  canPrev: boolean
  canNext: boolean
  label: string
}) {
  const n = Math.max(1, pageCount)
  const shown =
    n > 7
      ? [...new Set([0, pageIndex - 1, pageIndex, pageIndex + 1, n - 1])]
          .map((i) => Math.min(Math.max(i, 0), n - 1))
          .filter((i, pos, all) => all.indexOf(i) === pos)
          .sort((a, b) => a - b)
      : Array.from({ length: n }, (_, i) => i)

  return (
    <footer className='flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-3.5 py-2'>
      <span className='font-mono text-[10.5px] text-ink-3'>{summary}</span>
      <nav aria-label={label} className='flex items-center gap-1'>
        <Button
          variant='outline'
          size='icon'
          className='size-6 font-mono text-[11.5px]'
          disabled={!canPrev}
          onClick={() => onPage(pageIndex - 1)}
          aria-label='Halaman sebelumnya'
        >
          ‹
        </Button>
        {shown.map((index, pos) => (
          <span key={index} className='contents'>
            {pos > 0 && index - shown[pos - 1] > 1 ? (
              <span
                aria-hidden='true'
                className='px-1 font-mono text-[11.5px] text-ink-3'
              >
                …
              </span>
            ) : null}
            <Button
              variant='outline'
              size='icon'
              className={`size-6 font-mono text-[11.5px] tabular-nums ${index === pageIndex ? 'border-ink bg-ink text-surface hover:bg-ink' : ''}`}
              aria-label={`Halaman ${index + 1}`}
              aria-current={index === pageIndex ? 'page' : undefined}
              onClick={() => onPage(index)}
            >
              {index + 1}
            </Button>
          </span>
        ))}
        <Button
          variant='outline'
          size='icon'
          className='size-6 font-mono text-[11.5px]'
          disabled={!canNext}
          onClick={() => onPage(pageIndex + 1)}
          aria-label='Halaman berikutnya'
        >
          ›
        </Button>
      </nav>
    </footer>
  )
}
