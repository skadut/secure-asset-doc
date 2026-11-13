// Pen kU9Kv state 5: sunken 8px bars sized like real rows so nothing shifts on load.
export function SkeletonRows({
  rows = 4,
  cols = 4,
  headerLabel,
  headerValue,
  note,
}: {
  rows?: number
  cols?: number
  /** Opt-in pen header bar, e.g. 'MEMUAT · TABEL'. Forces the pen's 6×3 layout. */
  headerLabel?: string
  headerValue?: string
  note?: string
}) {
  const pen = Boolean(headerLabel)
  const rowCount = Math.max(0, Math.min(20, Math.trunc(pen ? 6 : rows)))
  const colCount = Math.max(1, Math.min(12, Math.trunc(pen ? 3 : cols)))
  const bar = 'h-2 animate-pulse bg-sunken motion-reduce:animate-none'
  return (
    <div className='w-full' role='status' aria-label='Memuat tabel'>
      {pen && (
        <div className='flex h-[30px] items-center justify-between gap-3 border-b border-line px-3 font-mono'>
          <span className='truncate text-[8.5px] tracking-[1px] text-ink-3'>
            {headerLabel}
          </span>
          <span className='text-[9px] font-medium text-ink-2'>
            {headerValue}
          </span>
        </div>
      )}
      {Array.from({ length: rowCount }, (_, row) => (
        <div
          key={row}
          className={`grid ${pen ? 'h-[38px]' : 'min-h-[42px]'} items-center gap-3 border-b border-line px-3`}
          style={{
            gridTemplateColumns: pen
              ? '70px minmax(0, 1fr) 54px'
              : `repeat(${colCount}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: colCount }, (_, col) => (
            <span
              key={col}
              aria-hidden='true'
              className={`${bar} max-w-full`}
              style={
                pen
                  ? undefined
                  : { width: `${58 + ((row * 17 + col * 13) % 37)}%` }
              }
            />
          ))}
        </div>
      ))}
      {note && (
        <p className='px-3 py-2.5 font-mono text-[8.5px] text-ink-3'>{note}</p>
      )}
      <span className='sr-only'>Memuat</span>
    </div>
  )
}
