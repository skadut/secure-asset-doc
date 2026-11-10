import { Badge } from '@/components/ui/badge'

// Level N opens TLP up to index min(N, 4); level 0 opens nothing. Tokens mirror TlpBadge.
const LEVELS: Record<number, { key: string; label: string }> = {
  0: { key: 'muted', label: 'Level 0 — tanpa akses TLP' },
  1: { key: 'green', label: 'Level 1 — hingga TLP:GREEN' },
  2: { key: 'amber', label: 'Level 2 — hingga TLP:AMBER' },
  3: { key: 'amber-strict', label: 'Level 3 — hingga TLP:AMBER+STRICT' },
  4: { key: 'red', label: 'Level 4 — hingga TLP:RED' },
  5: { key: 'red', label: 'Level 5 — hingga TLP:RED; RED+STRICT perlu grant' },
}

export function LevelBadge({ level }: { level: number }) {
  const n = Math.min(Math.max(Math.trunc(level) || 0, 0), 5)
  const { key: k, label } = LEVELS[n]
  const strict = k.endsWith('-strict')
  const neutral = k === 'muted'
  return (
    <Badge
      variant='outline'
      title={label}
      className='border-transparent rounded-[4px] px-1.5 py-1 font-mono text-[11px] font-semibold tracking-[.04em]'
      style={{
        backgroundColor: neutral ? 'var(--muted)' : `var(--viz-tlp-${k})`,
        color: neutral ? 'var(--foreground)' : `var(--viz-tlp-ink-${k})`,
        boxShadow: strict ? `inset 0 0 0 2px var(--viz-tlp-ring-${k})` : undefined,
      }}
    >
      <span aria-hidden='true'>Level {n}</span>
      <span className='sr-only'>{label}</span>
    </Badge>
  )
}
