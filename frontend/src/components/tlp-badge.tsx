import type { Tlp } from '@/data/grc'
import { TlpMark } from '@/components/tlp-mark'

export function TlpBadge({ tlp }: { tlp: Tlp }) {
  return <TlpMark tlp={tlp} />
}
