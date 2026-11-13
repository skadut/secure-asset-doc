import { useId, type ReactNode } from 'react'

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
      {icon && <div aria-hidden='true' className='text-ink-3 [&_svg]:size-6'>{icon}</div>}
      <h2 id={titleId} className='font-sans text-[15px] font-semibold leading-tight text-ink'>{title}</h2>
      {desc && <p className='max-w-[36ch] text-[11.5px] leading-[1.45] text-ink-2'>{desc}</p>}
      {action && <div className='mt-1'>{action}</div>}
    </section>
  )
}
