const swatch: Record<string, string> = {
  CLEAR: 'bg-tlp-clear',
  GREEN: 'bg-tlp-green',
  AMBER: 'bg-tlp-amber',
  'AMBER+STRICT': 'bg-tlp-amber-strict',
  RED: 'bg-tlp-red',
  'RED+STRICT': 'bg-tlp-red-strict',
}

// Pen: square swatch (no radius), mono 9px label. Props unchanged.
export function TlpMark({
  tlp,
  compact = false,
}: {
  tlp: string
  compact?: boolean
}) {
  const label = tlp.toUpperCase()
  return (
    <span
      className='inline-flex items-center gap-1.5 font-mono text-[10.5px] leading-none font-medium whitespace-nowrap text-ink-2'
      aria-label={`TLP:${label}`}
    >
      <i
        aria-hidden='true'
        className={`size-2 shrink-0 ${swatch[label] ?? 'bg-ink-3'}`}
      />
      {!compact && <span aria-hidden='true'>TLP:{label}</span>}
    </span>
  )
}
