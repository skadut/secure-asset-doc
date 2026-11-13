import { SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSearch } from '@/context/search-provider'
import { Button } from './ui/button'

export function Search({
  className = '',
  placeholder = 'Cari',
  ...props
}: React.ComponentProps<'button'> & { placeholder?: string }) {
  const { setOpen } = useSearch()
  return (
    <Button
      {...props}
      variant='outline'
      className={cn(
        'group relative h-10 w-10 flex-none justify-center rounded-none border-line bg-surface px-0 font-mono text-[10px] font-normal tracking-wide text-ink-3 shadow-none hover:bg-surface-2 hover:text-ink sm:h-8 sm:w-auto sm:min-w-[200px] sm:justify-start sm:px-2.5 sm:pe-12',
        className
      )}
      aria-keyshortcuts='Meta+K Control+K'
      onClick={() => setOpen(true)}
    >
      <SearchIcon aria-hidden='true' size={13} className='shrink-0' />
      <span className='sr-only sm:not-sr-only sm:ms-2 sm:truncate'>{placeholder}</span>
      <kbd className='pointer-events-none absolute inset-e-2 top-1/2 hidden h-5 -translate-y-1/2 items-center gap-0.5 rounded-none border border-line bg-surface-2 px-1 font-mono text-[9px] text-ink-3 select-none sm:flex'>
        <span>⌘</span>K
      </kbd>
    </Button>
  )
}
