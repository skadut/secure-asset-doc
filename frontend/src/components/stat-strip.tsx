const toneClass = { pass: 'text-pass', warn: 'text-warn', fail: 'text-fail', ink: 'text-ink' } as const

// Optional spark: real daily series only. Omit the prop when no real series exists.
function Spark({ values, tone }: { values: number[]; tone: keyof typeof toneClass }) {
  const width = 72
  const height = 22
  const pad = 3
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const x = (index: number) => values.length > 1 ? (index * (width - pad * 2)) / (values.length - 1) + pad : width / 2
  const y = (value: number) => max === min ? height / 2 : height - pad - ((value - min) / span) * (height - pad * 2)
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ')
  const lastIndex = values.length - 1
  return <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden='true' className={`shrink-0 overflow-visible ${toneClass[tone]}`}>
    <polyline points={points} fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinejoin='round' strokeLinecap='round' />
    <circle cx={x(lastIndex)} cy={y(values[lastIndex])} r='2' fill='currentColor' />
  </svg>
}

// Pen q05HuM stat cells: mono label, Saira 26px value, mono sub. Props unchanged except optional spark.
export function StatStrip({
  items,
}: {
  items: { label: string; value: string | number; sub?: string; tone?: 'pass' | 'warn' | 'fail' | 'ink'; spark?: number[] }[]
}) {
  return (
    <div className='grid min-w-0 grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-5' role='group' aria-label='Statistics'>
      {items.map(({ label, value, sub, tone = 'ink', spark }) => (
        <div key={label} className='flex min-w-0 flex-col gap-1.5 bg-surface px-4 py-3'>
          <span className='truncate font-mono text-[7.5px] uppercase leading-[1.2] tracking-[.12em] text-ink-3'>{label}</span>
          <div className='flex min-w-0 items-end justify-between gap-2'>
            <strong className={`font-heading text-[26px] font-semibold leading-none tabular-nums ${toneClass[tone]}`}>{value}</strong>
            {spark && spark.length > 1 && <Spark values={spark} tone={tone} />}
          </div>
          {sub && <span className='truncate font-mono text-[8.5px] leading-[1.3] text-ink-3'>{sub}</span>}
        </div>
      ))}
    </div>
  )
}
