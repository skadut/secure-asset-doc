import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function CardPanel({
  title,
  meta,
  actions,
  children,
  className,
  stacked = false,
}: {
  title?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  // Opt-in pen header: sentence-case bold title with the mono meta line under it.
  stacked?: boolean
}) {
  const hasHeader = title || meta || actions
  return (
    <section className={cn('min-w-0 border border-line bg-surface', className)}>
      {hasHeader && (
        <header className='flex min-h-[40px] min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5'>
          <div
            className={
              stacked
                ? 'flex min-w-0 flex-col gap-1'
                : 'flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1'
            }
          >
            {title && (
              <h2
                className={
                  stacked
                    ? 'text-sm leading-snug font-semibold text-ink'
                    : 'font-mono text-[9px] leading-[1.3] font-medium tracking-[.08em] text-ink uppercase'
                }
              >
                {title}
              </h2>
            )}
            {meta && (
              <span
                className={
                  stacked
                    ? 'font-mono text-[9px] leading-[1.3] text-ink-3'
                    : 'font-mono text-[8.5px] leading-[1.3] tracking-[.06em] text-ink-3 uppercase'
                }
              >
                {meta}
              </span>
            )}
          </div>
          {actions && (
            <div className='ml-auto flex flex-wrap items-center justify-end gap-2'>
              {actions}
            </div>
          )}
        </header>
      )}
      {children}
    </section>
  )
}
