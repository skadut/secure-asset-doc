import { useId, type ReactNode } from 'react'

export function ErrorState({
  code,
  title,
  desc,
  action,
}: {
  code: string
  title: string
  desc?: ReactNode
  action?: ReactNode
}) {
  const titleId = useId()
  return (
    <section className='mx-auto flex min-h-[429px] w-full max-w-[408px] flex-col border border-line bg-surface' role='alert' aria-labelledby={titleId}>
      <div className='flex h-[30px] items-center border-b border-line bg-surface-2 px-3 font-mono text-[8.5px] uppercase tracking-[.08em] text-ink-2'>{code}</div>
      <div className='flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center'>
        <h2 id={titleId} className='font-sans text-[15px] font-semibold leading-tight text-ink'>{title}</h2>
        {desc && <p className='max-w-[36ch] text-[11.5px] leading-[1.45] text-ink-2'>{desc}</p>}
        {action && <div className='mt-1'>{action}</div>}
      </div>
    </section>
  )
}
