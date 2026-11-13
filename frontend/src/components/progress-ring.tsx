export function ProgressRing({
  value,
  size = 40,
  label,
}: {
  value: number
  size?: number
  label?: string
}) {
  const percentage = Math.max(
    0,
    Math.min(100, Number.isFinite(value) ? value : 0)
  )
  const radius = 16
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - percentage / 100)
  const tone = percentage >= 80 ? 'pass' : percentage >= 50 ? 'warn' : 'fail'
  return (
    <span className='inline-flex items-center gap-2'>
      <svg
        aria-hidden='true'
        width={size}
        height={size}
        viewBox='0 0 36 36'
        className='-rotate-90'
      >
        <circle
          cx='18'
          cy='18'
          r={radius}
          fill='none'
          stroke='var(--line)'
          strokeWidth='3'
        />
        <circle
          cx='18'
          cy='18'
          r={radius}
          fill='none'
          stroke={`var(--${tone})`}
          strokeWidth='3'
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap='butt'
        />
      </svg>
      <span className='sr-only'>
        {label ? `${label}: ` : ''}
        {Math.round(percentage)}%
      </span>
      {label && (
        <span aria-hidden='true' className='font-mono text-[10.5px] text-ink-2'>
          {label}
        </span>
      )}
    </span>
  )
}
