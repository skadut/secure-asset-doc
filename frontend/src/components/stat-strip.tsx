export function StatStrip({
  items,
}: {
  items: { label: string; value: string | number; sub?: string; tone?: 'pass' | 'warn' | 'fail' | 'ink' }[]
}) {
  const toneClass = { pass: 'text-pass', warn: 'text-warn', fail: 'text-fail', ink: 'text-ink' } as const
  return (
    <div className='grid min-w-0 grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-5' role='group' aria-label='Statistics'>
      {items.map(({ label, value, sub, tone = 'ink' }) => (
        <div key={label} className='flex min-w-0 flex-col gap-0.5 bg-surface px-3.5 py-2'>
          <span className='truncate font-mono text-[7px] uppercase leading-[1.2] tracking-[.09em] text-ink-3'>{label}</span>
          <strong className={`font-heading text-[19px] font-semibold leading-none tabular-nums ${toneClass[tone]}`}>{value}</strong>
          {sub && <span className='truncate font-mono text-[8px] leading-[1.3] text-ink-3'>{sub}</span>}
        </div>
      ))}
    </div>
  )
}
