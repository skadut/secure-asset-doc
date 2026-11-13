import { CircleCheck, TriangleAlert } from 'lucide-react'

export function StatTile({
  label,
  value,
  of,
  meter,
  state,
  note,
  loading,
}: {
  label: string
  value: number | string
  of?: number
  meter?: boolean
  state?: { tone: 'pass' | 'fail'; text: string }
  note?: string
  loading?: boolean
}) {
  const ratio =
    of !== undefined && of > 0
      ? Math.min(Math.max(Number(value) / of, 0), 1)
      : 0
  const toneColor = state?.tone === 'fail' ? 'var(--fail)' : 'var(--pass)'
  const StateIcon = state?.tone === 'fail' ? TriangleAlert : CircleCheck

  return (
    <div
      className='viz-animate flex min-w-0 flex-col'
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line-subtle)',
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        minHeight: 108,
        gap: 8,
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{label}</div>

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        {loading ? (
          <span
            aria-hidden='true'
            className='viz-skeleton'
            style={{
              display: 'block',
              width: 64,
              height: 28,
              background: 'var(--skeleton)',
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 28,
              fontWeight: 600,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-heading)',
            }}
          >
            {value}
          </span>
        )}
        {of !== undefined && !loading && (
          <span style={{ fontSize: 14, color: 'var(--text-2)' }}>of {of}</span>
        )}
      </div>

      {meter &&
        of !== undefined &&
        (loading ? (
          <span
            aria-hidden='true'
            className='viz-skeleton'
            style={{
              display: 'block',
              width: '100%',
              height: 4,
              borderRadius: 2,
              background: 'var(--skeleton)',
            }}
          />
        ) : (
          <div
            role='img'
            aria-label={`${value} of ${of}`}
            style={{
              height: 4,
              borderRadius: 2,
              background: 'var(--bg-sunken)',
            }}
          >
            <div
              style={{
                width: `${ratio * 100}%`,
                height: '100%',
                borderRadius: 2,
                background: 'var(--chart-1)',
              }}
            />
          </div>
        ))}

      {state && !loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: toneColor,
          }}
        >
          <StateIcon
            size={14}
            aria-hidden='true'
            style={{ color: toneColor }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: toneColor }}>
            {state.text}
          </span>
        </div>
      )}

      {note && !loading && (
        <p style={{ fontSize: 14, color: 'var(--text-2)' }}>{note}</p>
      )}
    </div>
  )
}
