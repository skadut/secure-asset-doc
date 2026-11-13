import { useId, type ReactNode } from 'react'

// Pen kU9Kv state 6: icon in a 30px 1px-bordered square, Saira 18px title. Header bar is opt-in.
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
      role='status'
      aria-live='polite'
      className='mx-auto flex min-h-[240px] w-full max-w-[408px] flex-col border border-line bg-surface'
      aria-labelledby={titleId}
    >
      {(filterVariant || headerLabel) && (
        <div className='flex h-[30px] shrink-0 items-center justify-between gap-3 border-b border-line px-3 font-mono'>
          <span className='truncate text-[8.5px] tracking-[1px] text-ink-3'>
            {filterVariant ? 'KOSONG · FILTER' : headerLabel}
          </span>
          <span className='text-[9px] font-medium text-ink-2'>
            {filterVariant ? 'EMPTY' : headerValue}
          </span>
        </div>
      )}
      <div className='flex flex-1 flex-col items-center justify-center gap-[10px] p-[22px] text-center whitespace-normal'>
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
          <p className='w-full max-w-[250px] text-[12px] leading-4 text-ink-3'>
            {stateDesc}
          </p>
        )}
        {action && (
          <div className='flex flex-wrap items-center justify-center gap-2'>
            {action}
          </div>
        )}
      </div>
    </section>
  )
}
