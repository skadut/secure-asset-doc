import { Component, useId, useState, type ReactNode } from 'react'
import { CircleCheck, Clock, Pencil, TriangleAlert } from 'lucide-react'

type LegendItem = {
  label: string
  color: string
  icon?: 'pass' | 'warn' | 'fail' | 'draft'
}

type ChartTable = {
  columns: string[]
  rows: (string | number)[][]
}

type DistributionChartProps = {
  title: string
  caption: string
  legend?: LegendItem[]
  state: 'ready' | 'loading' | 'error'
  isEmpty?: boolean
  emptyMessage?: string
  table: ChartTable
  onRetry?: () => void
  loadingSkeleton?: ReactNode
  children: ReactNode
}

const LEGEND_ICONS = {
  pass: { Icon: CircleCheck, color: 'var(--pass)' },
  warn: { Icon: Clock, color: 'var(--warn)' },
  fail: { Icon: TriangleAlert, color: 'var(--fail)' },
  draft: { Icon: Pencil, color: 'var(--chart-4)' },
}

function ChartErrorBox({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        background: 'var(--bg-sunken)',
        padding: '12px 14px',
        borderRadius: '6px',
      }}
    >
      <TriangleAlert
        aria-hidden='true'
        size={16}
        style={{ color: 'var(--fail)', flexShrink: 0 }}
      />
      <div>
        <div style={{ fontSize: '15px', fontWeight: 600 }}>
          {"This chart couldn't load."}
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text-2)' }}>
          The rest of the overview is unaffected.
        </div>
        <button
          type='button'
          className='viz-focus'
          onClick={onRetry}
          style={{
            marginTop: '8px',
            fontSize: '14px',
            fontWeight: 600,
            padding: '4px 10px',
            border: '1px solid var(--line-strong)',
            borderRadius: '6px',
            background: 'var(--card)',
            color: 'var(--text-2)',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    </div>
  )
}

type BoundaryProps = {
  resetKey: number
  fallback: ReactNode
  children: ReactNode
}

export class ChartErrorBoundary extends Component<
  BoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: true } {
    return { hasError: true }
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

export function DistributionChart({
  title,
  caption,
  legend,
  state,
  isEmpty,
  emptyMessage,
  table,
  onRetry,
  loadingSkeleton,
  children,
}: DistributionChartProps) {
  const [open, setOpen] = useState(false)
  const tableId = useId()
  const [resetKey, setResetKey] = useState(0)

  const retry = () => {
    setResetKey((k) => k + 1)
    onRetry?.()
  }

  const tableEl = (
    <table id={tableId} style={{ borderCollapse: 'collapse', width: '100%' }}>
      <caption className='sr-only'>{title}</caption>
      <thead>
        <tr>
          {table.columns.map((col) => (
            <th
              key={col}
              scope='col'
              style={{
                fontSize: '14px',
                fontWeight: 600,
                textAlign: 'left',
                padding: '6px 8px',
                borderBottom: '1px solid var(--line-subtle)',
                whiteSpace: 'nowrap',
              }}
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td
                key={j}
                style={{
                  fontSize: '14px',
                  fontVariantNumeric: 'tabular-nums',
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--line-subtle)',
                  textAlign: typeof cell === 'number' ? 'right' : undefined,
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div
      className='viz-animate'
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line-subtle)',
        borderRadius: 'var(--radius)',
        padding: '16px 16px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px',
          minWidth: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
              fontWeight: 600,
            }}
          >
            {title}
          </h3>
          <div style={{ fontSize: '14px', color: 'var(--text-2)' }}>
            {caption}
          </div>
        </div>
        <button
          type='button'
          aria-pressed={open}
          aria-controls={state === 'ready' ? tableId : undefined}
          onClick={() => setOpen((o) => !o)}
          className='viz-focus bg-transparent hover:bg-[var(--surface-active)]'
          style={{
            fontSize: '14px',
            fontWeight: 600,
            padding: '4px 8px',
            border: '1px solid var(--line-subtle)',
            borderRadius: '6px',
            color: 'var(--text-2)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {open ? 'Hide table' : 'Table'}
        </button>
      </div>

      {state === 'loading' && loadingSkeleton}

      {state === 'error' && <ChartErrorBox onRetry={retry} />}

      {state === 'ready' && (
        <>
          {legend && legend.length >= 2 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px 16px',
                fontSize: '14px',
              }}
            >
              {legend.map((item) => {
                const entry = item.icon ? LEGEND_ICONS[item.icon] : null
                return (
                  <div
                    key={item.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span
                      aria-hidden='true'
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '2px',
                        background: item.color,
                        flexShrink: 0,
                      }}
                    />
                    {entry && (
                      <entry.Icon
                        aria-hidden='true'
                        size={13}
                        strokeWidth={2.2}
                        style={{ color: entry.color, flexShrink: 0 }}
                      />
                    )}
                    <span style={{ color: 'var(--text-2)' }}>{item.label}</span>
                  </div>
                )
              })}
            </div>
          )}

          {isEmpty && emptyMessage && (
            <div
              style={{
                background: 'var(--bg-sunken)',
                fontSize: '14px',
                color: 'var(--text-2)',
                padding: '8px 10px',
                borderRadius: '6px',
              }}
            >
              {emptyMessage}
            </div>
          )}

          <ChartErrorBoundary
            resetKey={resetKey}
            fallback={<ChartErrorBox onRetry={retry} />}
          >
            {children}
          </ChartErrorBoundary>

          {open ? (
            <div
              className='overflow-x-auto rounded-md border'
              style={{ borderColor: 'var(--line-subtle)' }}
            >
              {tableEl}
            </div>
          ) : (
            <div className='sr-only'>{tableEl}</div>
          )}
        </>
      )}
    </div>
  )
}
