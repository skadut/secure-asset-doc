import type { ReactNode } from 'react'

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
  return <span className={`inline-flex items-center border px-1.5 py-0.5 font-mono text-[9px] uppercase leading-[1.4] tracking-[.04em] ${colors}`}>{children}</span>
}
