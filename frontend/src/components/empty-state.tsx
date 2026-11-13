import { useId, type ReactNode } from 'react'

// Pen: icon sits in a 1px-bordered square; title Saira 18px. Props unchanged.
export function EmptyState({
  title,
  desc,
  icon,
  action,
}: {
  title: string
  desc?: ReactNode
  icon?: ReactNode
  action?: ReactNode
}) {
  const titleId = useId()
  return (
    <section className='mx-auto flex min-h-[240px] w-full max-w-[408px] flex-col items-center justify-center gap-3 border border-line bg-surface px-6 py-8 text-center' aria-labelledby={titleId}>
      {icon && (
        <div aria-hidden='true' className='flex size-11 items-center justify-center border border-line-2 bg-surface-2 text-ink-3 [&_svg]:size-5'>
          {icon}
        </div>
      )}
      <h2 id={titleId} className='font-heading text-[18px] font-semibold leading-tight text-ink'>{title}</h2>
      {desc && <p className='max-w-[36ch] text-[11.5px] leading-[1.45] text-ink-2'>{desc}</p>}
      {action && <div className='mt-2 flex flex-wrap items-center justify-center gap-2'>{action}</div>}
    </section>
  )
}
