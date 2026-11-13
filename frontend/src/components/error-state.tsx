import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Frame from pen kU9Kv. `code` is "NNN · LABEL"; the leading number renders as the large Saira numeral.
// tone: 'neutral' (default), 'fail' (423 lock), 'dark' (403 on near-black card).
// page: centre the card in the viewport (standalone error routes).
export function ErrorState({
  code,
  title,
  desc,
  action,
  tone = 'neutral',
  headerLabel,
  headerValue,
  showNumeral,
  icon,
  footer,
  page = false,
}: {
  code: string
  title: string
  desc?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'fail' | 'dark'
  headerLabel?: string
  headerValue?: string
  showNumeral?: boolean
  icon?: ReactNode
  footer?: ReactNode
  page?: boolean
}) {
  const titleId = useId()
  const [parsedNumeral, ...rest] = code.split(' · ')
  const isNumeric = /^\d{3}$/.test(parsedNumeral)
  const wantNumeral = showNumeral ?? (isNumeric && !icon)
  const numeral = wantNumeral ? parsedNumeral || code : null
  const label = headerLabel ?? (isNumeric ? rest.join(' · ') || code : code)
  const value = headerValue ?? (isNumeric ? parsedNumeral : '')
  const dark = tone === 'dark'
  const card = (
    <section
      role='alert'
      aria-labelledby={titleId}
      data-tone={tone}
      className={cn(
        'mx-auto flex min-h-[429px] w-full max-w-[408px] flex-col border',
        dark
          ? 'border-rail-line bg-rail text-rail-ink'
          : 'border-line bg-surface'
      )}
    >
      <div
        className={cn(
          'flex h-[30px] shrink-0 items-center justify-between gap-3 border-b px-3 font-mono',
          dark ? 'border-rail-line' : 'border-line'
        )}
      >
        <span
          className={cn(
            'truncate text-[8.5px] tracking-[1px]',
            dark ? 'text-rail-dim' : 'text-ink-3'
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            'text-[9px] font-medium',
            dark ? 'text-rail-ink' : 'text-ink-2'
          )}
        >
          {value}
        </span>
      </div>
      <div className='flex flex-1 flex-col items-center justify-center gap-[10px] p-[22px] text-center'>
        {icon && (
          <div
            aria-hidden='true'
            className={cn(
              'flex size-[30px] items-center justify-center border [&_svg]:size-[14px]',
              tone === 'fail'
                ? 'border-fail text-fail'
                : 'border-line text-ink-3',
              dark && 'border-rail-line text-rail-dim'
            )}
          >
            {icon}
          </div>
        )}
        {numeral && (
          <p
            className={cn(
              'font-heading text-[48px] leading-[43px] font-semibold',
              tone === 'fail'
                ? 'text-fail'
                : dark
                  ? 'text-rail-line'
                  : 'text-line-2'
            )}
            aria-hidden='true'
          >
            {numeral}
          </p>
        )}
        <h2
          id={titleId}
          className={cn(
            'font-heading leading-tight font-semibold',
            icon ? 'text-[18px]' : 'text-[19px]',
            dark ? 'text-rail-ink' : 'text-ink'
          )}
        >
          {title}
        </h2>
        {desc && (
          <p
            className={cn(
              'w-full max-w-[250px] text-[12px] leading-4',
              dark ? 'text-rail-dim' : 'text-ink-3'
            )}
          >
            {desc}
          </p>
        )}
        {action && (
          <div className='flex flex-wrap items-center justify-center gap-2'>
            {action}
          </div>
        )}
        {footer && (
          <p
            className={cn(
              'font-mono text-[8px] tracking-[.6px]',
              tone === 'fail' ? 'text-ink-3' : 'text-line-2'
            )}
          >
            {footer}
          </p>
        )}
      </div>
    </section>
  )
  if (!page) return card
  return (
    <div className='flex min-h-svh w-full items-center justify-center p-4'>
      {card}
    </div>
  )
}
