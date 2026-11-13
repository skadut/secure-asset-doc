import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Frame from pen kU9Kv. `code` is "NNN · LABEL"; the leading number renders as the large Saira numeral.
// tone: 'neutral' (default), 'fail' (423 lock), 'dark' (403 on near-black card).
export function ErrorState({
  code,
  title,
  desc,
  action,
  tone = 'neutral',
}: {
  code: string
  title: string
  desc?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'fail' | 'dark'
}) {
  const titleId = useId()
  const [numeral, ...rest] = code.split(' · ')
  const isNumeric = /^\d{3}$/.test(numeral)
  const label = isNumeric ? rest.join(' · ') || code : code
  const dark = tone === 'dark'
  return (
    <section
      role='alert'
      aria-labelledby={titleId}
      data-tone={tone}
      className={cn(
        'mx-auto flex min-h-[429px] w-full max-w-[408px] flex-col border',
        dark ? 'border-rail-line bg-rail text-rail-ink' : 'border-line bg-surface'
      )}
    >
      <div className={cn(
        'flex h-[30px] items-center justify-between border-b px-3 font-mono text-[8px] uppercase tracking-[.1em]',
        dark ? 'border-rail-line bg-rail-active text-rail-dim' : 'border-line bg-surface-2 text-ink-3'
      )}>
        <span className='truncate'>{label}</span>
        <span>{isNumeric ? numeral : null}</span>
      </div>
      <div className='flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center'>
        {isNumeric && <p className={cn(
          'font-heading text-[48px] font-semibold leading-[43px]',
          tone === 'fail' ? 'text-fail' : dark ? 'text-rail-dim' : 'text-line-2'
        )} aria-hidden='true'>{numeral}</p>}
        <h2 id={titleId} className={cn('font-heading text-[18px] font-semibold leading-tight', dark ? 'text-rail-ink' : 'text-ink')}>{title}</h2>
        {desc && <p className={cn('max-w-[36ch] text-[11.5px] leading-[1.45]', dark ? 'text-rail-dim' : 'text-ink-2')}>{desc}</p>}
        {action && <div className='mt-2 flex flex-wrap items-center justify-center gap-2'>{action}</div>}
      </div>
    </section>
  )
}
