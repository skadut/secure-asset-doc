export function LevelBadge({ level }: { level: number }) {
  const n = Math.min(5, Math.max(1, Math.trunc(level) || 1))
  return (
    <span className='inline-flex items-center gap-1.5 whitespace-nowrap border border-line px-1.5 py-0.5 font-mono text-[9px] font-medium leading-none text-ink' aria-label={`Access level ${n} of 5`}>
      <b className='font-semibold text-ink'>L{n}</b>
      <span className='inline-flex items-center gap-[1.5px]' aria-hidden='true'>
        {Array.from({ length: 5 }, (_, i) => <i key={i} className={`h-2.5 w-[3px] ${i < n ? 'bg-ink' : 'bg-sunken'}`} />)}
      </span>
    </span>
  )
}
