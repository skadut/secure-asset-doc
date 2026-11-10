import { useState } from 'react'
import { ChartTip } from './chart-tip'

type ColumnItem = {
  key: string
  label: string
  value: number
  axisLabel?: string
}

type ColumnChartProps = { items: ColumnItem[]; height?: number; unit?: string }

const Y_WIDTH = 28

// Smallest 1/2/5 x 10^n step that keeps the axis at 4 intervals or fewer.
function niceStep(max: number) {
  for (let p = 1; ; p *= 10) {
    for (const m of [1, 2, 5]) {
      if (Math.ceil(max / (m * p)) <= 4) return m * p
    }
  }
}

export function ColumnChart({
  items,
  height = 160,
  unit = 'versions',
}: ColumnChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const max = items.reduce((m, it) => Math.max(m, it.value), 0)
  const step = max === 0 ? 1 : niceStep(max)
  const yMax = Math.max(step, Math.ceil(max / step) * step)
  const ticks = Array.from(
    { length: Math.round(yMax / step) + 1 },
    (_, i) => i * step
  )
  const pct = (v: number) => `${(v / yMax) * 100}%`

  return (
    <div style={{ position: 'relative', width: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div
          style={{
            position: 'relative',
            width: Y_WIDTH,
            height,
            flexShrink: 0,
          }}
        >
          {ticks.map((t) => (
            <span
              key={t}
              style={{
                position: 'absolute',
                left: 0,
                right: 4,
                bottom: pct(t),
                transform: 'translateY(50%)',
                fontSize: 11,
                lineHeight: '11px',
                color: 'var(--text-2)',
                textAlign: 'right',
                whiteSpace: 'nowrap',
              }}
            >
              {t}
            </span>
          ))}
        </div>

        <div
          style={{
            position: 'relative',
            flex: '1 1 0',
            minWidth: 0,
            height,
          }}
        >
          {ticks
            .filter((t) => t > 0)
            .map((t) => (
              <div
                key={t}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: pct(t),
                  height: 1,
                  background: 'var(--viz-grid)',
                }}
              />
            ))}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 1,
              background: 'var(--line-strong)',
            }}
          />

          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              gap: 2,
              alignItems: 'stretch',
            }}
          >
            {items.map((item, i) => (
              // TODO(drill-down): segment click filter route is unverified; no navigation until confirmed.
              <button
                key={item.key}
                type='button'
                aria-label={`${item.label}: ${item.value} ${unit}`}
                className='viz-focus'
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex(null)}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  height: '100%',
                  position: 'relative',
                  padding: 0,
                  border: 0,
                  background:
                    activeIndex === i ? 'var(--surface-active)' : 'transparent',
                  cursor: 'default',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: (item.value / yMax) * height,
                    borderRadius: '3px 3px 0 0',
                    background: 'var(--chart-1)',
                  }}
                />
              </button>
            ))}
          </div>

          {items.map((item, i) =>
            activeIndex === i ? (
              <div
                key={item.key}
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  marginBottom: 4,
                  zIndex: 10,
                  pointerEvents: 'none',
                  ...(i > items.length / 2 ? { right: 0 } : { left: 0 }),
                }}
              >
                <ChartTip title={item.label} body={`${item.value} ${unit}`} />
              </div>
            ) : null
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 2,
          marginLeft: Y_WIDTH,
          height: 16,
        }}
      >
        {items.map((item) => (
          <div
            key={item.key}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            {item.axisLabel && (
              <span
                style={{
                  fontSize: 11,
                  lineHeight: '16px',
                  color: 'var(--text-2)',
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}
              >
                {item.axisLabel}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
