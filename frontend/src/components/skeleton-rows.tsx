// Pen skeleton: grey bars sized like real rows so nothing shifts on load. Props unchanged.
export function SkeletonRows({
  rows = 4,
  cols = 4,
  headerLabel,
  headerValue,
  note,
}: {
  rows?: number
  cols?: number
  /** Opt-in pen header bar, e.g. 'MEMUAT · TABEL'. */
  headerLabel?: string
  headerValue?: string
  note?: string
}) {
  const pen = Boolean(headerLabel)
  const rowCount = Math.max(0, Math.min(20, Math.trunc(pen ? 6 : rows)))
  const colCount = Math.max(1, Math.min(12, Math.trunc(pen ? 3 : cols)))
  return (
    <div
      className='w-full border-y border-line'
      role='status'
      aria-label='Loading rows'
    >
      {pen && (
        <div className='flex h-[29.5px] items-center justify-between border-b border-line bg-surface-2 px-3 font-mono text-[7.5px] tracking-[1px] text-ink-3 uppercase'>
          <span>{headerLabel}</span>
          <span>{headerValue}</span>
        </div>
      )}
      {Array.from({ length: rowCount }, (_, row) => (
        <div
          key={row}
          className={`grid ${pen ? 'h-[37.5px]' : 'min-h-[42px]'} items-center gap-3 border-b border-line px-3 last:border-b-0`}
          style={{
            gridTemplateColumns: pen
              ? '70px minmax(0, 1fr) 54px'
              : `repeat(${colCount}, minmax(0, 1fr))`,
          }}
        >
          {pen ? (
            <>
              <span
                aria-hidden='true'
                className='h-2 animate-pulse bg-sunken motion-reduce:animate-none'
              />
              <span
                aria-hidden='true'
                className='h-2 animate-pulse bg-sunken motion-reduce:animate-none'
              />
              <span
                aria-hidden='true'
                className='h-2 animate-pulse bg-sunken motion-reduce:animate-none'
              />
            </>
          ) : (
            Array.from({ length: colCount }, (_, col) => (
              <span
                key={col}
                aria-hidden='true'
                className='h-2.5 max-w-full animate-pulse border border-line bg-surface-2 motion-reduce:animate-none'
                style={{ width: `${58 + ((row * 17 + col * 13) % 37)}%` }}
              />
            ))
          )}
        </div>
      ))}
      {note && <p className='px-3 py-2.5 text-[10px] text-ink-3'>{note}</p>}
      <span className='sr-only'>Loading</span>
    </div>
  )
}
