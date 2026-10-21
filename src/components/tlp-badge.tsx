import { Badge } from '@/components/ui/badge'
import type { Tlp } from '@/data/grc'

const tlpColors: Record<Tlp, string> = {
  CLEAR: '#FFFFFF',
  GREEN: '#33FF00',
  AMBER: '#FFC000',
  'AMBER+STRICT': '#FFC000',
  RED: '#FF2B2B',
}

export function TlpBadge({ tlp }: { tlp: Tlp }) {
  return (
    <Badge
      variant='outline'
      aria-label={`Traffic Light Protocol: ${tlp}`}
      className='border-black bg-black font-medium'
      style={{ color: tlpColors[tlp] }}
    >
      TLP:{tlp}
    </Badge>
  )
}
