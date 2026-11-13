import type { ReactNode } from 'react'

export function PageHead({
  title,
  eyebrow,
  note,
  actions,
}: {
  title: string
  eyebrow?: string
  note?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className='flex min-w-0 flex-wrap items-end justify-between gap-4'>
      <div className='min-w-0'>
        {eyebrow && <p className='mb-1 font-mono text-[7.5px] uppercase tracking-[.14em] text-ink-3'>{eyebrow}</p>}
        <h1 className='font-heading text-[21px] font-semibold leading-[1.1] tracking-[-.02em] text-ink'>{title}</h1>
      </div>
      {(note || actions) && <div className='ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 text-right'>
        {note && <div className='font-mono text-[9px] text-ink-3'>{note}</div>}
        {actions && <div className='flex flex-wrap items-center justify-end gap-2'>{actions}</div>}
      </div>}
    </header>
  )
}
