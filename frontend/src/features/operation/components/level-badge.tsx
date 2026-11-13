// Level N opens TLP up to index min(N, 4); level 0 opens nothing. Tokens mirror TlpBadge.
const LEVELS: Record<number, { key: string; label: string }> = {
  0: { key: 'muted', label: 'Level 0: tanpa akses TLP' },
  1: { key: 'green', label: 'Level 1: hingga TLP:GREEN' },
  2: { key: 'amber', label: 'Level 2: hingga TLP:AMBER' },
  3: { key: 'amber-strict', label: 'Level 3: hingga TLP:AMBER+STRICT' },
  4: { key: 'red', label: 'Level 4: hingga TLP:RED' },
  5: { key: 'red', label: 'Level 5: hingga TLP:RED. RED+STRICT perlu grant' },
}

export function LevelBadge({ level }: { level: number }) {
  const n = Math.min(Math.max(Math.trunc(level) || 0, 0), 5)
  const { key: k, label } = LEVELS[n]
  const strict = k.endsWith('-strict')
  const neutral = k === 'muted'
  const bg = neutral ? 'var(--muted)' : `var(--viz-tlp-${k})`
  const ink = neutral ? 'var(--foreground)' : `var(--viz-tlp-ink-${k})`
  return (
    <span
      title={label}
      className='inline-flex shrink-0 items-stretch font-mono text-[10px] font-semibold leading-none'
      style={{ boxShadow: strict ? `inset 0 0 0 1px var(--viz-tlp-ring-${k})` : undefined }}
    >
      <span
        aria-hidden='true'
        className='flex items-center px-1.5 py-1 tracking-[.04em]'
        style={{ backgroundColor: bg, color: ink }}
      >
        L{n}
      </span>
      <span aria-hidden='true' className='flex items-end gap-px border border-line bg-surface px-1 py-1'>
        {[1, 2, 3, 4, 5].map((i) => (
          <i
            key={i}
            className='w-[2px] bg-ink-3'
            style={{ height: `${3 + i * 1.5}px`, opacity: i <= n ? 1 : 0.25 }}
          />
        ))}
      </span>
      <span className='sr-only'>{label}</span>
    </span>
  )
}
