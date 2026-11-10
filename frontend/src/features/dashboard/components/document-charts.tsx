import type { ReactNode } from 'react'
import { documents, TODAY, type Tlp } from '@/data/grc'
import { Clock, TriangleAlert } from 'lucide-react'
import { TlpBadge } from '@/components/tlp-badge'
import {
  documentTileStats,
  documentTypeRows,
  reviewScheduleRows,
  tlpRows,
  tlpStatusRows,
  versionMonthRows,
} from '../viz-data'
import { BarList } from './viz/bar-list'
import { ColumnChart } from './viz/column-chart'
import { DistributionChart } from './viz/distribution-chart'
import { StatTile } from './viz/stat-tile'

const NO_DOCS = 'No documents are visible to your role.'

const TLP_TOKEN: Record<Tlp, string> = {
  CLEAR: 'clear',
  GREEN: 'green',
  AMBER: 'amber',
  'AMBER+STRICT': 'amber-strict',
  RED: 'red',
  'RED+STRICT': 'red-strict',
}

// AMBER bars get the 1px light-theme edge so they reach 3:1 against the card.
const TLP_EDGE: Partial<Record<Tlp, string>> = {
  AMBER: 'var(--viz-amber-edge)',
}

const STATUS_SERIES = [
  { key: 'approved', label: 'Approved', color: 'var(--pass)', icon: 'pass' },
  { key: 'inReview', label: 'In review', color: 'var(--warn)', icon: 'warn' },
  { key: 'draft', label: 'Draft', color: 'var(--chart-4)', icon: 'draft' },
  { key: 'expired', label: 'Expired', color: 'var(--fail)', icon: 'fail' },
] as const

const reviewColor = (key: string) =>
  key === 'overdue'
    ? 'var(--fail)'
    : key === 'd0_30'
      ? 'var(--warn)'
      : 'var(--chart-4)'

// StatTile has no colour prop. The value span inherits colour, so the wrapper sets it.
function Tile({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <div className='min-w-0' style={{ color }}>
      {children}
    </div>
  )
}

export function DocumentCharts() {
  const total = documents.length
  const tiles = documentTileStats(documents, TODAY)
  const tlp = tlpRows(documents)
  const status = tlpStatusRows(documents)
  const review = reviewScheduleRows(documents, TODAY)
  const types = documentTypeRows(documents)
  const months = versionMonthRows(documents)
  const isEmpty = total === 0
  const firstMonth = months[0]?.month
  const lastMonth = months[months.length - 1]?.month

  return (
    <div className='min-w-0 space-y-4'>
      <div className='grid min-w-0 grid-cols-2 gap-3 min-[700px]:grid-cols-4'>
        <Tile>
          <StatTile label='Total documents' value={tiles.total} />
        </Tile>
        <Tile>
          <StatTile label='Total versions' value={tiles.versions} />
        </Tile>
        <Tile>
          <StatTile
            label='Current documents'
            value={tiles.current}
            of={tiles.total}
            meter
            note={`Approved, next review on or after ${TODAY}`}
          />
        </Tile>
        <Tile color={tiles.overdue > 0 ? 'var(--fail)' : undefined}>
          <StatTile
            label='Reviews overdue'
            value={tiles.overdue}
            state={
              tiles.overdue > 0
                ? { tone: 'fail', text: 'Past next review date' }
                : { tone: 'pass', text: 'None overdue' }
            }
          />
        </Tile>
      </div>

      {/* Order: 3 cols TLP, Status, Review, Type, Versions. 2 cols TLP, Review, Status, Type, Versions. */}
      <div className='grid min-w-0 grid-flow-row-dense grid-cols-1 gap-4 min-[700px]:grid-cols-2 min-[1200px]:grid-cols-3'>
        <div className='min-w-0'>
          <DistributionChart
            title='Documents by TLP'
            caption={`${total} documents · TLP 2.0 marking`}
            state='ready'
            isEmpty={isEmpty}
            emptyMessage={`${NO_DOCS} Every TLP marking still shows 0.`}
            table={{
              columns: ['TLP', 'Documents'],
              rows: tlp.map((row) => [row.label, row.value]),
            }}
          >
            <BarList
              labelWidth={136}
              rows={tlp.map((row) => ({
                key: row.key,
                label: <TlpBadge tlp={row.key} />,
                ariaLabel: `${row.label}: ${row.value} documents`,
                tooltipTitle: row.label,
                tooltipBody: `${row.value} documents`,
                total: row.value,
                segments: [
                  {
                    name: row.label,
                    value: row.value,
                    color: `var(--viz-tlp-${TLP_TOKEN[row.key]})`,
                    edge: TLP_EDGE[row.key],
                  },
                ],
              }))}
            />
          </DistributionChart>
        </div>

        <div className='min-w-0 min-[700px]:order-2 min-[700px]:col-span-2 min-[1200px]:order-1'>
          <DistributionChart
            title='Document status by TLP'
            caption={`Status within each TLP marking · ${total} documents`}
            state='ready'
            legend={STATUS_SERIES.map((s) => ({
              label: s.label,
              color: s.color,
              icon: s.icon,
            }))}
            isEmpty={isEmpty}
            emptyMessage={`${NO_DOCS} Every TLP marking still shows 0.`}
            table={{
              columns: [
                'TLP',
                'Approved',
                'In review',
                'Draft',
                'Expired',
                'Total',
              ],
              rows: status.map((row) => [
                row.label,
                row.approved,
                row.inReview,
                row.draft,
                row.expired,
                row.total,
              ]),
            }}
          >
            <BarList
              labelWidth={136}
              rows={status.map((row) => {
                const summary = `Approved ${row.approved}, In review ${row.inReview}, Draft ${row.draft}, Expired ${row.expired}`
                return {
                  key: row.key,
                  label: <TlpBadge tlp={row.key} />,
                  ariaLabel: `${row.label}: ${row.total} documents. ${summary}`,
                  tooltipTitle: row.label,
                  tooltipBody: summary,
                  total: row.total,
                  segments: STATUS_SERIES.map((s) => ({
                    name: s.label,
                    value: row[s.key],
                    color: s.color,
                  })),
                }
              })}
            />
          </DistributionChart>
        </div>

        <div className='min-w-0 min-[700px]:order-1 min-[1200px]:order-2'>
          <DistributionChart
            title='Review schedule'
            caption={`Days from ${TODAY} to next review`}
            state='ready'
            isEmpty={isEmpty}
            emptyMessage={`${NO_DOCS} Every bucket still shows 0.`}
            table={{
              columns: ['Next review', 'Documents'],
              rows: review.map((row) => [row.label, row.value]),
            }}
          >
            <BarList
              labelWidth={104}
              rows={review.map((row) => {
                const color = reviewColor(row.key)
                const Icon =
                  row.key === 'overdue'
                    ? TriangleAlert
                    : row.key === 'd0_30'
                      ? Clock
                      : null
                return {
                  key: row.key,
                  label: (
                    <span className='inline-flex items-center gap-1.5'>
                      {Icon && (
                        <Icon
                          aria-hidden='true'
                          size={13}
                          strokeWidth={2.2}
                          style={{ color, flexShrink: 0 }}
                        />
                      )}
                      {row.label}
                    </span>
                  ),
                  ariaLabel: `${row.label}: ${row.value} documents`,
                  tooltipTitle: `Next review: ${row.label}`,
                  tooltipBody: `${row.value} documents`,
                  total: row.value,
                  segments: [{ name: row.label, value: row.value, color }],
                }
              })}
            />
          </DistributionChart>
        </div>

        <div className='min-w-0 min-[700px]:order-3 min-[700px]:col-span-2'>
          <DistributionChart
            title='Documents by type'
            caption={`${types.length} document types`}
            state='ready'
            isEmpty={isEmpty}
            emptyMessage={`${NO_DOCS} Every type still shows 0.`}
            table={{
              columns: ['Type', 'Documents'],
              rows: types.map((row) => [row.label, row.value]),
            }}
          >
            <BarList
              labelWidth={150}
              rows={types.map((row) => ({
                key: row.label,
                label: row.label,
                ariaLabel: `${row.label}: ${row.value} documents`,
                tooltipTitle: row.label,
                tooltipBody: `${row.value} documents`,
                total: row.value,
              }))}
            />
          </DistributionChart>
        </div>

        <div className='min-w-0 min-[700px]:order-4 min-[700px]:col-span-2 min-[1200px]:col-span-3'>
          <DistributionChart
            title='Version activity by month'
            caption={`${tiles.versions} versions${firstMonth ? ` · ${firstMonth} to ${lastMonth}` : ''}`}
            state='ready'
            isEmpty={isEmpty}
            emptyMessage={`${NO_DOCS} Every month still shows 0.`}
            table={{
              columns: ['Month', 'Versions'],
              rows: months.map((row) => [row.month, row.value]),
            }}
          >
            <ColumnChart
              unit='versions'
              items={months.map((row, i) => ({
                key: row.month,
                label: row.month,
                value: row.value,
                axisLabel:
                  i === 0 ||
                  i === months.length - 1 ||
                  row.month.endsWith('-01')
                    ? row.month
                    : undefined,
              }))}
            />
          </DistributionChart>
        </div>
      </div>
    </div>
  )
}
