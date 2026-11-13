const swatch: Record<string, string> = {
  CLEAR: 'bg-tlp-clear',
  GREEN: 'bg-tlp-green',
  AMBER: 'bg-tlp-amber',
  'AMBER+STRICT': 'bg-tlp-amber-strict',
  RED: 'bg-tlp-red',
  'RED+STRICT': 'bg-tlp-red-strict',
}

export function TlpMark({ tlp, compact = false }: { tlp: string; compact?: boolean }) {
  const label = tlp.toUpperCase()
  return (
    <span className='inline-flex items-center gap-[5px] whitespace-nowrap font-mono text-[9px] font-medium leading-none text-ink-2' aria-label={`TLP:${label}`}>
      <i aria-hidden='true' className={`size-2 shrink-0 ${swatch[label] ?? 'bg-ink-3'}`} />
      {!compact && <span aria-hidden='true'>TLP:{label}</span>}
    </span>
  )
}
