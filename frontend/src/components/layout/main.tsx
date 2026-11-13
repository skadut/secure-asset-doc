import { cn } from '@/lib/utils'

type MainProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  fluid?: boolean
  ref?: React.Ref<HTMLElement>
}

// Content is full width (pen: starts right after the rail, 24px padding).
// `fluid` is kept for API compatibility and exposed as data-fluid.
export function Main({ fixed, fluid, className, ...props }: MainProps) {
  return (
    <main
      data-layout={fixed ? 'fixed' : 'auto'}
      data-fluid={fluid ? '' : undefined}
      className={cn(
        'min-w-0 w-full p-4 sm:p-6',

        // If layout is fixed, make the main container flex and grow
        fixed && 'flex grow flex-col overflow-hidden',

        className
      )}
      {...props}
    />
  )
}
