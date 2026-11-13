import { useId, type ReactNode } from 'react'

// Pen: icon in a 30px 1px-bordered square, Saira 18px title. Header bar is opt-in.
export function EmptyState({
  title,
  desc,
  icon,
  action,
  headerLabel,
  headerValue,
  filterVariant = false,
}: {
  title: string
  desc?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  /** Opt-in pen header bar, e.g. 'KOSONG · FILTER'. */
  headerLabel?: string
  headerValue?: string
  /** Opt-in exact filter-empty copy and pen header. */
  filterVariant?: boolean
}) {
  const titleId = useId()
  const stateTitle = filterVariant ? 'Tidak ada yang cocok' : title
  const stateDesc = filterVariant
    ? 'Ubah kata kunci atau pilih TLP lain. Dokumen di luar akses Anda memang tidak ditampilkan.'
    : desc
  return (
    <section
      className='mx-auto flex min-h-[240px] w-full max-w-[408px] flex-col border border-line bg-surface'
      aria-labelledby={titleId}
    >
      {(filterVariant || headerLabel) && (
        <div className='flex h-[29.5px] items-center justify-between border-b border-line bg-surface-2 px-3 font-mono text-[7.5px] tracking-[1px] text-ink-3 uppercase'>
          <span className='truncate'>
            {filterVariant ? 'KOSONG · FILTER' : headerLabel}
          </span>
          <span>{filterVariant ? 'EMPTY' : headerValue}</span>
        </div>
      )}
      <div className='flex flex-1 flex-col items-center justify-center gap-[10px] px-[22px] py-8 text-center'>
        {icon && (
          <div
            aria-hidden='true'
            className='flex size-[30px] items-center justify-center border border-line text-ink-3 [&_svg]:size-[14px]'
          >
            {icon}
          </div>
        )}
        <h2
          id={titleId}
          className='font-heading text-[18px] leading-tight font-semibold text-ink'
        >
          {stateTitle}
        </h2>
        {stateDesc && (
          <p className='w-full max-w-[250px] text-[10.5px] leading-4 text-ink-3'>
            {stateDesc}
          </p>
        )}
        {action && (
          <div className='mt-2 flex flex-wrap items-center justify-center gap-2'>
            {action}
          </div>
        )}
      </div>
    </section>
  )
}
