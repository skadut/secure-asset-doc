import { type Document } from '@/data/grc'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TlpMark } from '@/components/tlp-mark'
import { TLP_LEVELS, type LevelFilter, filterDocs } from '../helpers'

const TILES: { value: LevelFilter; accent: string }[] = [
  { value: 'ALL', accent: '' },
  { value: 'RED', accent: 'border-t-tlp-red' },
  { value: 'RED+STRICT', accent: 'border-t-tlp-red-strict' },
  { value: 'AMBER', accent: 'border-t-tlp-amber' },
  { value: 'GREEN', accent: 'border-t-tlp-green' },
  { value: 'CLEAR', accent: 'border-t-tlp-clear' },
]

type DocumentsToolbarProps = {
  docs: Document[]
  query: string
  onQueryChange: (query: string) => void
  level: LevelFilter
  onLevelChange: (level: LevelFilter) => void
}

// Tiles count versions (pen "41 versi"), not documents; filters apply before counting.
export function DocumentsToolbar({
  docs,
  query,
  onQueryChange,
  level,
  onLevelChange,
}: DocumentsToolbarProps) {
  return (
    <section
      aria-label='Filter registri dokumen'
      className='flex min-w-0 flex-col gap-2 min-[1200px]:flex-row min-[1200px]:items-stretch'
    >
      <div className='grid min-w-0 flex-1 grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 xl:grid-cols-6'>
        {TILES.map((tile) => {
          const active = level === tile.value
          const isAll = tile.value === 'ALL'
          const versions = filterDocs(docs, query, tile.value).reduce(
            (sum, doc) => sum + doc.versions.length,
            0
          )
          return (
            <button
              key={tile.value}
              type='button'
              aria-pressed={active}
              onClick={() => onLevelChange(tile.value)}
              className={cn(
                'flex min-h-[60px] min-w-0 flex-col justify-between border-t-[3px] border-t-transparent bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-active focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)]',
                tile.accent,
                active && !isAll && 'bg-surface-active',
                isAll && 'border-t-ink bg-ink text-bg hover:bg-ink'
              )}
            >
              <span className='flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>
                {isAll ? 'Semua versi' : <TlpMark tlp={tile.value} />}
              </span>
              <span className='flex items-baseline gap-1.5'>
                <span className={cn('font-heading text-[19px] font-semibold leading-none tabular-nums', isAll ? 'text-bg' : 'text-ink')}>
                  {versions}
                </span>
                <span className={cn('font-mono text-[8px]', isAll ? 'text-bg/70' : 'text-ink-3')}>versi</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className='flex min-w-0 items-center gap-2'>
        <Label htmlFor='document-search' className='sr-only'>
          Cari dokumen
        </Label>
        <Input
          id='document-search'
          type='search'
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder='Cari ID atau judul'
          className='h-9 min-w-0 flex-1 rounded-none border-line-strong bg-surface text-[11px] placeholder:text-ink-3 min-[1200px]:w-[260px] min-[1200px]:flex-none'
        />
        <Select
          value={level}
          onValueChange={(value) => onLevelChange(value as LevelFilter)}
        >
          <SelectTrigger
            id='document-level'
            className='h-9 w-44 rounded-none border-line-strong bg-surface text-[11px]'
            aria-label='Filter tingkat TLP'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='ALL'>Filter TLP: semua</SelectItem>
            {TLP_LEVELS.map((tlp) => (
              <SelectItem key={tlp} value={tlp}>
                TLP:{tlp}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}
