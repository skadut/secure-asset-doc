import { SealedTitle } from '@/components/sealed-title'
import { TlpMark } from '@/components/tlp-mark'
import { type DocRow } from './documents-columns'

// Plain text per pen 03: a click on the title selects the row (detail panel);
// the ID cell keeps the link to the full detail page.
export function TitleCell({ doc }: { doc: DocRow }) {
  return (
    <span className='flex min-w-0 flex-col gap-1'>
      <SealedTitle
        title={doc.title}
        className='min-w-0 text-[13px] leading-[1.3] font-normal break-words text-ink'
      />
      <TlpMark tlp={doc.tlp} />
    </span>
  )
}
