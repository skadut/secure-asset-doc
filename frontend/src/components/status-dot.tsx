import type { ReactNode } from 'react'

const dot: Record<'pass' | 'warn' | 'fail' | 'erase' | 'ink', string> = {
  pass: 'bg-pass',
  warn: 'bg-warn',
  fail: 'bg-fail',
  erase: 'bg-erase',
  ink: 'bg-ink-3',
}

export function StatusDot({
  tone,
  children,
}: {
  tone: 'pass' | 'warn' | 'fail' | 'erase' | 'ink'
  children: ReactNode
}) {
  return (
    <span className='inline-flex items-center gap-[5px] whitespace-nowrap font-mono text-[9px] leading-none text-ink-2'>
      <i aria-hidden='true' className={`size-[5px] shrink-0 rounded-full ${dot[tone]}`} />
      <span>{children}</span>
    </span>
  )
}
