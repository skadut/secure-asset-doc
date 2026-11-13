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
  headerLabel,
  headerValue,
  showNumeral,
  icon,
  footer,
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
}) {
  const titleId = useId()
  const [parsedNumeral, ...rest] = code.split(' · ')
  const isNumeric = /^\d{3}$/.test(parsedNumeral)
  const wantNumeral = showNumeral ?? (isNumeric && !icon)
  const numeral = wantNumeral ? parsedNumeral || code : null
  const label = headerLabel ?? (isNumeric ? rest.join(' · ') || code : code)
  const value = headerValue ?? (isNumeric ? parsedNumeral : '')
  const dark = tone === 'dark'
  return (
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
          'flex h-[30px] items-center justify-between border-b px-3 font-mono text-[7.5px] tracking-[.1em] uppercase',
          dark
            ? 'border-rail-line bg-rail-active text-rail-dim'
            : 'border-line bg-surface-2 text-ink-3'
        )}
      >
        <span className='truncate'>{label}</span>
        <span>{value}</span>
      </div>
      <div className='flex flex-1 flex-col items-center justify-center gap-[10px] px-[22px] py-8 text-center'>
        {icon && (
          <div
            aria-hidden='true'
            className={cn(
              'flex size-[30px] items-center justify-center border border-line text-ink-3 [&_svg]:size-[14px]',
              tone === 'fail' && 'border-fail',
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
              'w-full max-w-[250px] text-[10.5px] leading-4',
              dark ? 'text-rail-dim' : 'text-ink-3'
            )}
          >
            {desc}
          </p>
        )}
        {action && (
          <div className='mt-2 flex flex-wrap items-center justify-center gap-2'>
            {action}
          </div>
        )}
        {footer && (
          <p className='mt-1 font-mono text-[7px] text-ink-3'>{footer}</p>
        )}
      </div>
    </section>
  )
}
