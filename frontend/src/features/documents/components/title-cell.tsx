import { Link } from '@tanstack/react-router'
import { SealedTitle } from '@/components/sealed-title'
import { isSealedTitle } from '@/components/sealed-title-helpers'
import { TlpMark } from '@/components/tlp-mark'
import { type DocRow } from './documents-columns'

const TITLE =
  'min-w-0 text-[13px] leading-[1.3] font-normal break-words text-ink'

export function TitleCell({ doc }: { doc: DocRow }) {
  return (
    <span className='flex min-w-0 flex-col gap-1'>
      {isSealedTitle(doc.title) ? (
        <SealedTitle title={doc.title} className={TITLE} />
      ) : (
        <Link
          to='/documents/$documentId'
          params={{ documentId: doc.id }}
          className={`${TITLE} focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)]`}
        >
          <SealedTitle title={doc.title} className={TITLE} />
        </Link>
      )}
      <TlpMark tlp={doc.tlp} />
    </span>
  )
}
