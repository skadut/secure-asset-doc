// Pen skeleton: grey bars sized like real rows so nothing shifts on load. Props unchanged.
export function SkeletonRows({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  const rowCount = Math.max(0, Math.min(20, Math.trunc(rows)))
  const colCount = Math.max(1, Math.min(12, Math.trunc(cols)))
  return (
    <div className='w-full border-y border-line' role='status' aria-label='Loading rows'>
      {Array.from({ length: rowCount }, (_, row) => (
        <div key={row} className='grid min-h-[42px] items-center gap-3 border-b border-line px-3 last:border-b-0' style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
          {Array.from({ length: colCount }, (_, col) => <span key={col} aria-hidden='true' className='h-2.5 max-w-full animate-pulse border border-line bg-surface-2 motion-reduce:animate-none' style={{ width: `${58 + ((row * 17 + col * 13) % 37)}%` }} />)}
        </div>
      ))}
      <span className='sr-only'>Loading</span>
    </div>
  )
}
