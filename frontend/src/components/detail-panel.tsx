import { cn } from '@/lib/utils'

const WIDTH_CLASS = {
  380: 'min-[1200px]:w-[380px]',
  340: 'min-[1200px]:w-[340px]',
  300: 'min-[1200px]:w-[300px]',
} as const

type DetailPanelProps = {
  children: React.ReactNode
  width?: keyof typeof WIDTH_CLASS
  // Change to replay the enter animation on selection.
  itemKey?: string | number
  className?: string
}

export function DetailPanel({
  children,
  width = 380,
  itemKey,
  className,
}: DetailPanelProps) {
  return (
    <aside
      className={cn(
        'w-full shrink-0 rounded-lg border bg-card',
        // Sticky and capped height only in side-by-side layout; stacked below 1200px.
        'min-[1200px]:sticky min-[1200px]:top-6 min-[1200px]:max-h-[calc(100vh-3rem)]',
        'overflow-y-auto',
        WIDTH_CLASS[width],
        className
      )}
    >
      <div key={itemKey} className='detail-panel-enter p-4'>
        {children}
      </div>
    </aside>
  )
}
