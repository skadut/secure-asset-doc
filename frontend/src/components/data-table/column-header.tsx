import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretSortIcon,
  EyeNoneIcon,
} from '@radix-ui/react-icons'
import { type Column } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type DataTableColumnHeaderProps<TData, TValue> =
  React.HTMLAttributes<HTMLDivElement> & {
    column: Column<TData, TValue>
    title: string
  }

// Pen: mono 7.5px uppercase, .09em tracking, 8px chevrons, no ghost-button chrome.
const headerText =
  'font-mono text-[8.5px] uppercase tracking-[.09em] text-ink-3'
const sortButton =
  'inline-flex h-auto min-h-0 items-center gap-1 rounded-none bg-transparent p-0 font-mono text-[8.5px] font-normal uppercase tracking-[.09em] text-ink-3 shadow-none hover:bg-transparent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]'
const sortIcon = 'ms-1 size-2 shrink-0'

const sortLabel = (sorted: false | 'asc' | 'desc') =>
  sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const sorted = column.getIsSorted()
  const ariaSort = sortLabel(sorted)

  if (!column.getCanSort()) {
    return (
      <div className={cn(headerText, className)} aria-sort={ariaSort}>
        {title}
      </div>
    )
  }

  return (
    <div className={cn(headerText, className)} aria-sort={ariaSort}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' className={sortButton}>
            <span>{title}</span>
            {sorted === 'desc' ? (
              <ArrowDownIcon className={sortIcon} aria-hidden='true' />
            ) : sorted === 'asc' ? (
              <ArrowUpIcon className={sortIcon} aria-hidden='true' />
            ) : (
              <CaretSortIcon className={sortIcon} aria-hidden='true' />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
            <ArrowUpIcon className='size-3.5 text-muted-foreground/70' />
            Asc
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
            <ArrowDownIcon className='size-3.5 text-muted-foreground/70' />
            Desc
          </DropdownMenuItem>
          {column.getCanHide() && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
                <EyeNoneIcon className='size-3.5 text-muted-foreground/70' />
                Hide
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
