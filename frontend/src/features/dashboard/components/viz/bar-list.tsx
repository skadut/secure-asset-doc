import { useState, type ReactNode } from 'react'
import { ChartTip } from './chart-tip'

type BarSegment = { name: string; value: number; color: string; edge?: string }

type BarRow = {
  key: string
  label: ReactNode
  ariaLabel: string
  tooltipTitle: string
  tooltipBody: string
  total: number
  segments?: BarSegment[]
}

type BarListProps = { rows: BarRow[]; labelWidth: number; max?: number }

export function BarList({ rows, labelWidth, max }: BarListProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0)
  const effectiveMax = (max ?? maxTotal) || 1

  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {rows.map((row) => {
        const width = row.total === 0 ? 0 : (row.total / effectiveMax) * 100
        const segments = (row.segments ?? []).filter((s) => s.value !== 0)

        return (
          <li key={row.key} style={{ position: 'relative' }}>
            {/* TODO(drill-down): segment click filter route is unverified; no navigation until confirmed. */}
            <button
              type='button'
              aria-label={row.ariaLabel}
              className='viz-focus'
              onMouseEnter={() => setActiveKey(row.key)}
              onMouseLeave={() => setActiveKey(null)}
              onFocus={() => setActiveKey(row.key)}
              onBlur={() => setActiveKey(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: `minmax(64px, min(${labelWidth}px, 46%)) minmax(0, 1fr) 28px`,
                rowGap: 0,
                columnGap: 8,
                height: 30,
                alignItems: 'center',
                width: '100%',
                background: 'transparent',
                border: 0,
                padding: 0,
                textAlign: 'left',
                cursor: 'default',
                font: 'inherit',
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  color: 'var(--text-2)',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.label}
              </span>

              <div
                style={{
                  height: 16,
                  width: `${width}%`,
                  display: 'flex',
                  gap: 2,
                  minWidth: 0,
                }}
              >
                {segments.length > 0 ? (
                  segments.map((s) => (
                    <div
                      key={s.name}
                      style={{
                        flex: `${s.value} 1 0`,
                        minWidth: 0,
                        height: '100%',
                        background: s.color,
                        borderRadius: 3,
                        boxShadow: s.edge
                          ? `inset 0 0 0 1px ${s.edge}`
                          : 'none',
                      }}
                    />
                  ))
                ) : (
                  <div
                    style={{
                      background: 'var(--chart-1)',
                      borderRadius: 4,
                      width: '100%',
                      height: '100%',
                    }}
                  />
                )}
              </div>

              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  width: 28,
                  textAlign: 'right',
                }}
              >
                {row.total}
              </span>
            </button>

            {activeKey === row.key && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: labelWidth,
                  marginBottom: 4,
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              >
                <ChartTip title={row.tooltipTitle} body={row.tooltipBody} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
