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
        {eyebrow && (
          <p className='mb-2 font-mono text-[11.5px] tracking-[.14em] text-ink-3 uppercase'>
            {eyebrow}
          </p>
        )}
        <h1 className='font-heading text-[28px] leading-[1.05] font-semibold tracking-[-.02em] text-ink sm:text-[38px]'>
          {title}
        </h1>
      </div>
      {(note || actions) && (
        <div className='ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3 text-right'>
          {note && (
            <div className='font-mono text-[10.5px] tracking-[.08em] text-ink-3'>
              {note}
            </div>
          )}
          {actions && (
            <div className='flex flex-wrap items-center justify-end gap-2'>
              {actions}
            </div>
          )}
        </div>
      )}
    </header>
  )
}
