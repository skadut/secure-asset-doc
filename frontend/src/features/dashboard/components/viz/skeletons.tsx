const BAR_WIDTHS = [72, 46, 88, 34, 60, 22, 52, 40, 66, 30]

export function BarSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden='true'>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 30,
          }}
        >
          <div
            className='viz-skeleton'
            style={{
              width: 48 + (i % 3) * 18,
              height: 10,
              background: 'var(--skeleton)',
            }}
          />
          <div style={{ flex: 1 }}>
            <div
              className='viz-skeleton'
              style={{
                width: `${BAR_WIDTHS[i % 10]}%`,
                height: 16,
                borderRadius: 4,
                background: 'var(--skeleton)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ColumnSkeleton({ count = 33 }: { count?: number }) {
  return (
    <div
      aria-hidden='true'
      style={{
        display: 'flex',
        gap: 2,
        height: 160,
        alignItems: 'flex-end',
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className='viz-skeleton'
          style={{
            flex: '1 1 0',
            minWidth: 0,
            height: `${14 + ((i * 37) % 62)}%`,
            borderRadius: '3px 3px 0 0',
            background: 'var(--skeleton)',
          }}
        />
      ))}
    </div>
  )
}
