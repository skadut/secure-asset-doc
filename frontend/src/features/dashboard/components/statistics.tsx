import { CircleCheck, TriangleAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { criticalityColor } from '@/components/status-badge'
import { assets, csfSubcategories, documents, evidenceLinks, TODAY } from '@/data/grc'
import { assetReviewRows, assetStatusRows, criticalityRows, csfFunctionRows, sectorCriticalityRows } from '../viz-data'
import { BarList } from './viz/bar-list'
import { DistributionChart } from './viz/distribution-chart'

const chartHeight = 220

const REVIEW = {
  reviewed: { Icon: CircleCheck, color: 'var(--pass)' },
  overdue: { Icon: TriangleAlert, color: 'var(--fail)' },
}

const REVIEW_FILL = { reviewed: 'var(--pass)', overdue: 'var(--fail)' }

export function ChartCard({ title, data, children, className = '', height = chartHeight }: { title: string; data: Record<string, string | number>[]; children: React.ReactNode; className?: string; height?: number }) {
  return <Card className={`min-w-0 ${className}`}>
    <CardHeader className='pb-2'><CardTitle className='text-sm font-semibold'>{title}</CardTitle></CardHeader>
    <CardContent className='min-w-0'>
      <div className='w-full' style={{ height }}>{children}</div>
      <div className='sr-only'><table><caption>{title}</caption><thead><tr>{Object.keys(data[0] ?? {}).map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{data.map((row, index) => <tr key={index}>{Object.values(row).map((value, i) => <td key={i}>{value}</td>)}</tr>)}</tbody></table></div>
    </CardContent>
  </Card>
}

export function StatisticsCharts() {
  const sectorRows = sectorCriticalityRows(assets)
  const critRows = criticalityRows(assets)
  const statusRows = assetStatusRows(assets)
  const reviewRows = assetReviewRows(assets, TODAY)
  const csfRows = csfFunctionRows(csfSubcategories, evidenceLinks, documents, TODAY)
  const sectorTotal = sectorRows.reduce((n, row) => n + row.total, 0)

  return <section aria-label='Asset and document statistics' className='grid min-w-0 grid-cols-1 min-[700px]:grid-cols-2 min-[1200px]:grid-cols-3 gap-4' style={{ gridAutoFlow: 'row dense' }}>
    <div className='min-w-0 min-[700px]:col-span-2'>
      <DistributionChart
        title='Assets by sector and criticality'
        caption={`${sectorTotal} assets across ${sectorRows.length} sectors`}
        legend={[
          { label: 'High', color: criticalityColor.high },
          { label: 'Medium', color: criticalityColor.medium },
          { label: 'Low', color: criticalityColor.low },
        ]}
        state='ready'
        isEmpty={assets.length === 0}
        emptyMessage='No assets are visible to your role. Every sector still shows 0.'
        table={{
          columns: ['Sector', 'High', 'Medium', 'Low', 'Total'],
          rows: sectorRows.map((r) => [r.sector, r.high, r.medium, r.low, r.total]),
        }}
      >
        <BarList
          labelWidth={120}
          rows={sectorRows.map((r) => ({
            key: r.sector,
            label: r.sector,
            ariaLabel: `${r.sector}: ${r.total} assets. High ${r.high}, Medium ${r.medium}, Low ${r.low}`,
            tooltipTitle: r.sector,
            tooltipBody: `${r.total} assets`,
            total: r.total,
            segments: [
              { name: 'High', value: r.high, color: criticalityColor.high },
              { name: 'Medium', value: r.medium, color: criticalityColor.medium },
              { name: 'Low', value: r.low, color: criticalityColor.low },
            ],
          }))}
        />
      </DistributionChart>
    </div>

    <DistributionChart
      title='Assets by criticality'
      caption={`${assets.length} assets`}
      state='ready'
      isEmpty={assets.length === 0}
      emptyMessage='No assets are visible to your role. Every criticality still shows 0.'
      table={{
        columns: ['Criticality', 'Assets'],
        rows: critRows.map((r) => [r.label, r.value]),
      }}
    >
      <BarList
        labelWidth={120}
        rows={critRows.map((r) => ({
          key: r.key,
          label: r.label,
          ariaLabel: `${r.label}: ${r.value} assets`,
          tooltipTitle: `Criticality ${r.label.toLowerCase()}`,
          tooltipBody: `${r.value} assets`,
          total: r.value,
          segments: [{ name: r.label, value: r.value, color: criticalityColor[r.key] }],
        }))}
      />
    </DistributionChart>

    <DistributionChart
      title='Assets by status'
      caption={`${assets.length} assets`}
      state='ready'
      isEmpty={assets.length === 0}
      emptyMessage='No assets are visible to your role. Every status still shows 0.'
      table={{
        columns: ['Status', 'Assets'],
        rows: statusRows.map((r) => [r.label, r.value]),
      }}
    >
      <BarList
        labelWidth={120}
        rows={statusRows.map((r) => ({
          key: r.label,
          label: r.label,
          ariaLabel: `${r.label}: ${r.value} assets`,
          tooltipTitle: r.label,
          tooltipBody: `${r.value} assets`,
          total: r.value,
          segments: [{ name: r.label, value: r.value, color: 'var(--chart-1)' }],
        }))}
      />
    </DistributionChart>

    <DistributionChart
      title='Asset review status'
      caption={`Last review vs. 365 days before ${TODAY}`}
      state='ready'
      isEmpty={assets.length === 0}
      emptyMessage='No assets are visible to your role. Both categories still show 0.'
      table={{
        columns: ['Review status', 'Assets'],
        rows: reviewRows.map((r) => [r.label, r.value]),
      }}
    >
      <BarList
        labelWidth={120}
        rows={reviewRows.map((r) => {
          const key = r.key as keyof typeof REVIEW
          const { Icon, color } = REVIEW[key]
          return {
            key: r.key,
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon aria-hidden='true' size={13} strokeWidth={2.2} style={{ color, flexShrink: 0 }} />
                {r.label}
              </span>
            ),
            ariaLabel: `${r.label}: ${r.value} assets`,
            tooltipTitle: r.label,
            tooltipBody: `${r.value} assets`,
            total: r.value,
            segments: [{ name: r.label, value: r.value, color: REVIEW_FILL[key] }],
          }
        })}
      />
    </DistributionChart>

    <DistributionChart
      title='CSF 2.0 coverage by function'
      caption={`${csfSubcategories.length} subcategories · 6 functions`}
      legend={[
        { label: 'With current evidence', color: 'var(--pass)', icon: 'pass' },
        { label: 'No current evidence', color: 'var(--fail)', icon: 'fail' },
      ]}
      state='ready'
      isEmpty={csfSubcategories.length === 0}
      emptyMessage='No CSF 2.0 subcategories are visible. Every function still shows 0.'
      table={{
        columns: ['Function', 'With evidence', 'No evidence', 'Total'],
        rows: csfRows.map((r) => [r.label, r.with, r.without, r.total]),
      }}
    >
      <BarList
        labelWidth={120}
        rows={csfRows.map((r) => ({
          key: r.fn,
          label: r.label,
          ariaLabel: `${r.label}: ${r.total} subcategories. With ${r.with}, without ${r.without}`,
          tooltipTitle: r.label,
          tooltipBody: `${r.total} subcategories`,
          total: r.total,
          segments: [
            { name: 'With current evidence', value: r.with, color: 'var(--pass)' },
            { name: 'No current evidence', value: r.without, color: 'var(--fail)' },
          ],
        }))}
      />
    </DistributionChart>
  </section>
}
