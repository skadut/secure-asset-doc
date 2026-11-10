import type { ReactNode } from 'react'
import { CircleCheck, Clock, Minus, Pencil, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Asset, Criticality, Document } from '@/data/grc'

// Severity levels follow FIPS 199 impact levels and NIST SP 800-30 qualitative risk levels; red/amber/green is common convention, not a NIST-prescribed palette.
// Criticality uses red/yellow/gray by user decision: High --fail, Medium --warn, Low --chart-4.
type Tone = 'pass' | 'warn' | 'fail' | 'draft' | 'neutral'

const toneIcon: Record<Tone, LucideIcon> = {
  pass: CircleCheck,
  warn: Clock,
  fail: TriangleAlert,
  draft: Pencil,
  neutral: Minus,
}

const toneColor: Record<Tone, string> = {
  pass: 'var(--pass)',
  warn: 'var(--warn)',
  fail: 'var(--fail)',
  draft: 'var(--chart-4)',
  neutral: 'var(--chart-4)',
}

function StateBadge({ tone, children, icon, color: colorOverride }: { tone: Tone; children: ReactNode; icon?: LucideIcon; color?: string }) {
  const Icon = icon ?? toneIcon[tone]
  const color = colorOverride ?? toneColor[tone]
  return (
    <Badge
      variant='outline'
      className='gap-1.5 border-transparent px-2 py-1 font-medium text-foreground [&>svg]:size-[13px]'
      style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, var(--card))` }}
    >
      <Icon aria-hidden='true' strokeWidth={2.2} style={{ color }} />
      {children}
    </Badge>
  )
}

const docStatus: Record<Document['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'draft' },
  'in review': { label: 'In review', tone: 'warn' },
  approved: { label: 'Approved', tone: 'pass' },
  expired: { label: 'Expired', tone: 'fail' },
}

const coverageLabel = {
  covered: { label: 'Covered', tone: 'pass' },
  partial: { label: 'Partial', tone: 'warn' },
  gap: { label: 'Gap', tone: 'fail' },
} as const satisfies Record<string, { label: string; tone: Tone }>

const criticalityLabel: Record<Criticality, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const criticalityColor: Record<Criticality, string> = {
  high: 'var(--fail)',
  medium: 'var(--warn)',
  low: 'var(--chart-4)',
}

const criticalityIcon: Record<Criticality, LucideIcon> = { high: TriangleAlert, medium: Clock, low: Minus }
const criticalityTone: Record<Criticality, Tone> = { high: 'fail', medium: 'warn', low: 'neutral' }

const assetStatus: Record<Asset['status'], { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'pass' },
  maintenance: { label: 'Maintenance', tone: 'warn' },
  retired: { label: 'Retired', tone: 'neutral' },
}

export function DocStatusBadge({ status }: { status: Document['status'] }) {
  const { label, tone } = docStatus[status]
  return <StateBadge tone={tone}>{label}</StateBadge>
}

export function CoverageBadge({ coverage }: { coverage: keyof typeof coverageLabel }) {
  const { label, tone } = coverageLabel[coverage]
  return <StateBadge tone={tone}>{label}</StateBadge>
}

export function CriticalityBadge({ criticality }: { criticality: Criticality }) {
  return <StateBadge tone={criticalityTone[criticality]} icon={criticalityIcon[criticality]} color={criticalityColor[criticality]}>{criticalityLabel[criticality]}</StateBadge>
}

export function AssetStatusBadge({ status }: { status: Asset['status'] }) {
  const { label, tone } = assetStatus[status]
  return <StateBadge tone={tone}>{label}</StateBadge>
}

export function ReviewStatusBadge({ days, date }: { days: number; date?: string }) {
  const overdue = days < 0
  const dueSoon = days >= 0 && days <= 30
  const label = overdue ? 'Overdue' : dueSoon ? (days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`) : date
  return <StateBadge tone={overdue ? 'fail' : dueSoon ? 'warn' : 'neutral'}>{label}</StateBadge>
}

export function FileTypeBadge({ type }: { type: 'PDF' | 'Excel' | 'None' }) {
  if (type === 'None') return <span>None</span>
  return <Badge variant='outline' className='border-border bg-muted text-foreground'>{type}</Badge>
}
