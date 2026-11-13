import { useState, type ElementType } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isSealedTitle, maskTitle } from './sealed-title-helpers'

export function SealedTitle({
  title,
  className,
  as: Tag = 'span',
  showToggle = true,
}: {
  title: string
  className?: string
  as?: ElementType
  showToggle?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  if (!isSealedTitle(title)) return <Tag className={className}>{title}</Tag>
  if (!showToggle)
    return (
      <Tag className={className}>
        <span className='break-words'>{maskTitle(title)}</span>
      </Tag>
    )

  const Icon = revealed ? EyeOff : Eye
  return (
    <Tag
      className={cn(
        'inline-flex min-w-0 flex-wrap items-baseline gap-1.5',
        className
      )}
    >
      <span
        className={
          revealed ? 'font-mono text-[11.5px] break-all' : 'break-words'
        }
      >
        {revealed ? title : maskTitle(title)}
      </span>
      <button
        type='button'
        aria-label={
          revealed ? 'Sembunyikan token mentah' : 'Tampilkan token mentah'
        }
        aria-pressed={revealed}
        onClick={() => setRevealed((value) => !value)}
        className="relative inline-flex shrink-0 items-center text-current opacity-60 before:absolute before:-inset-3 before:content-[''] hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      >
        <Icon aria-hidden='true' className='size-[13px]' />
      </button>
    </Tag>
  )
}
