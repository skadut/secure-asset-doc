import { Badge } from '@/components/ui/badge'
import type { Tlp } from '@/data/grc'

const tokenKey: Record<Tlp, string> = {
  CLEAR: 'clear',
  GREEN: 'green',
  AMBER: 'amber',
  'AMBER+STRICT': 'amber-strict',
  RED: 'red',
  'RED+STRICT': 'red-strict',
}

export function TlpBadge({ tlp }: { tlp: Tlp }) {
  const k = tokenKey[tlp]
  const strict = tlp.endsWith('+STRICT')
  return (
    <Badge
      variant='outline'
      className='border-transparent rounded-[4px] px-1.5 py-1 font-mono text-[11px] font-semibold tracking-[.04em]'
      style={{
        backgroundColor: `var(--viz-tlp-${k})`,
        color: `var(--viz-tlp-ink-${k})`,
        boxShadow: strict ? `inset 0 0 0 2px var(--viz-tlp-ring-${k})` : undefined,
      }}
    >
      TLP:{tlp}
    </Badge>
  )
}
