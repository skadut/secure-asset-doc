import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Eye, EyeOff } from 'lucide-react'
import { TlpMark } from '@/components/tlp-mark'
import { type DocRow } from './documents-columns'

export function TitleCell({ doc }: { doc: DocRow }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = expanded ? EyeOff : Eye
  return (
    <span className='flex min-w-0 items-start gap-1.5'>
      <button
        type='button'
        aria-label={
          expanded ? 'Sembunyikan judul lengkap' : 'Tampilkan judul lengkap'
        }
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className='-ms-1 mt-px inline-flex size-5 flex-none items-center justify-center text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)]'
      >
        <Icon className='size-3.5' aria-hidden='true' />
      </button>
      <span className='flex min-w-0 flex-col gap-1'>
        <Link
          to='/documents/$documentId'
          params={{ documentId: doc.id }}
          title={doc.title}
          className={`min-w-0 text-[13px] leading-[1.3] font-normal text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)] ${expanded ? 'break-words' : 'line-clamp-2'}`}
        >
          {doc.title}
        </Link>
        <TlpMark tlp={doc.tlp} />
      </span>
    </span>
  )
}
