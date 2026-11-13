import type { ReactNode } from 'react'

// Pen chip: 1px tone border, mono 9px uppercase, tinted text. Props unchanged.
export function Chip({
  children,
  tone = 'line',
}: {
  children: ReactNode
  tone?: 'line' | 'pass' | 'warn' | 'fail' | 'erase'
}) {
  const colors = {
    line: 'border-line text-ink-3',
    pass: 'border-pass text-pass',
    warn: 'border-warn text-warn',
    fail: 'border-fail text-fail',
    erase: 'border-erase text-erase',
  }[tone]
  return (
    <span
      className={`inline-flex items-center border px-2 py-[3px] font-mono text-[9px] leading-[1.3] tracking-[.06em] uppercase ${colors}`}
    >
      {children}
    </span>
  )
}
