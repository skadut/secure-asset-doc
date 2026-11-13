const LEVEL_RAMP: Record<number, { bg: string; ink: string; label: string }> = {
  0: { bg: '#a3aba2', ink: '#ffffff', label: 'Level 0' },
  1: { bg: '#8ec3dd', ink: '#0f1411', label: 'Level 1' },
  2: { bg: '#4a9ad0', ink: '#0f1411', label: 'Level 2' },
  3: { bg: '#2d6fb8', ink: '#ffffff', label: 'Level 3' },
  4: { bg: '#3d4ba8', ink: '#ffffff', label: 'Level 4' },
  5: { bg: '#1e1f66', ink: '#ffffff', label: 'Level 5' },
}

export function LevelBadge({ level }: { level: number }) {
  const n = Math.min(5, Math.max(1, Math.trunc(level) || 1))
  const meta = LEVEL_RAMP[n] ?? LEVEL_RAMP[1]

  return (
    <span
      className='inline-flex shrink-0 items-center gap-[5px] rounded border border-line bg-surface p-[1px] pr-[6px]'
      aria-label={`Access level ${n} of 5`}
    >
      <span
        aria-hidden='true'
        className='flex h-4 w-[22px] items-center justify-center rounded-l-[3px] font-mono text-[9px] font-semibold tracking-[0.18px]'
        style={{ backgroundColor: meta.bg, color: meta.ink }}
      >
        L{n}
      </span>
      <span aria-hidden='true' className='flex items-center gap-[1.5px]'>
        {Array.from({ length: 5 }, (_, i) => (
          <i
            key={i}
            className='h-2 w-[3px] rounded-[1px]'
            style={{
              backgroundColor: i < n ? meta.bg : 'var(--sunken, #dddfd9)',
            }}
          />
        ))}
      </span>
    </span>
  )
}
