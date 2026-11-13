import type { ReactNode } from 'react'

const dot: Record<'pass' | 'warn' | 'fail' | 'erase' | 'ink', string> = {
  pass: 'bg-pass',
  warn: 'bg-warn',
  fail: 'bg-fail',
  erase: 'bg-erase',
  ink: 'bg-ink-3',
}

// Pen: 6px dot, mono 9px. Props unchanged.
export function StatusDot({
  tone,
  children,
}: {
  tone: 'pass' | 'warn' | 'fail' | 'erase' | 'ink'
  children: ReactNode
}) {
  return (
    <span className='inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[9px] leading-none text-ink-2'>
      <i aria-hidden='true' className={`size-1.5 shrink-0 rounded-full ${dot[tone]}`} />
      <span>{children}</span>
    </span>
  )
}
