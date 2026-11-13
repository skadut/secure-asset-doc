import { type Document } from '@/data/grc'
import { Search } from 'lucide-react'
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
      <div className='grid min-w-0 flex-1 grid-cols-2 gap-[.67px] border-[.67px] border-line bg-line sm:grid-cols-3 xl:grid-cols-6'>
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
                'flex h-[52px] min-w-0 flex-col justify-center gap-1 border-[.67px] border-line bg-surface px-3 text-left transition-colors hover:bg-surface-active focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)]',
                tile.accent,
                active && !isAll && 'bg-surface-active',
                isAll && 'border-ink bg-ink text-bg hover:bg-ink'
              )}
            >
              <span
                className={cn(
                  'flex items-center gap-1.5 font-mono text-[8.5px] tracking-[.05em] uppercase',
                  isAll ? 'text-ink-3' : 'text-ink-2'
                )}
              >
                {isAll ? (
                  <span className='text-ink-3'>Semua versi</span>
                ) : (
                  <>
                    <TlpMark tlp={tile.value} compact />
                    <span>{tile.value}</span>
                  </>
                )}
              </span>
              <span className='flex items-baseline gap-1.5'>
                <span
                  className={cn(
                    'font-heading text-[19px] leading-none font-semibold tabular-nums',
                    isAll ? 'text-bg' : 'text-ink'
                  )}
                >
                  {versions}
                </span>
                <span
                  className={cn(
                    'font-mono text-[8.5px]',
                    isAll ? 'text-ink-3' : 'text-ink-3'
                  )}
                >
                  versi
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className='flex min-w-0 items-center gap-2'>
        <Label htmlFor='document-search' className='sr-only'>
          Cari dokumen
        </Label>
        <div className='relative min-w-0 flex-1 min-[1200px]:w-[242px] min-[1200px]:flex-none'>
          <Search
            aria-hidden='true'
            className='pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-ink-3'
          />
          <Input
            id='document-search'
            type='search'
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder='Cari ID atau judul'
            className='h-[34px] min-w-0 rounded-none border-[.67px] border-line bg-surface pr-2.5 pl-8 font-mono text-[11.5px] placeholder:text-ink-3'
          />
        </div>
        <Select
          value={level}
          onValueChange={(value) => onLevelChange(value as LevelFilter)}
        >
          <SelectTrigger
            id='document-level'
            className='h-[34px] w-[218px] rounded-none border-[.67px] border-line bg-surface px-[10.67px] font-mono text-[11.5px] text-ink-2 [&_svg]:size-3'
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
