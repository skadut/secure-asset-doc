import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function CardPanel({
  title,
  meta,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const hasHeader = title || meta || actions
  return (
    <section className={cn('min-w-0 border border-line bg-surface', className)}>
      {hasHeader && <header className='flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3.5 py-2.5'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          {title && <h2 className='font-mono text-[8.5px] font-medium uppercase leading-[1.3] tracking-[.08em] text-ink'>{title}</h2>}
          {meta && <span className='font-mono text-[8.5px] leading-[1.3] text-ink-3'>{meta}</span>}
        </div>
        {actions && <div className='ml-auto flex flex-wrap items-center justify-end gap-2'>{actions}</div>}
      </header>}
      {children}
    </section>
  )
}
