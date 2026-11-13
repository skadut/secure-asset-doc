import { useId } from 'react'

export type CoverageOption = 'all' | 'covered' | 'partial' | 'gap'

const OPTIONS: { value: CoverageOption; label: string; dot?: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'covered', label: 'Covered', dot: 'bg-pass' },
  { value: 'partial', label: 'Partial', dot: 'bg-warn' },
  { value: 'gap', label: 'Gap', dot: 'bg-fail' },
]

// Native radios keep state and arrow-key behaviour; the label stretches the radio for the hit area.
export function CoverageSegment({
  value,
  onChange,
}: {
  value: CoverageOption
  onChange: (value: CoverageOption) => void
}) {
  const name = useId()
  return (
    <fieldset className='flex min-w-0 flex-wrap items-center gap-1 border-0 p-0'>
      <legend className='sr-only'>Coverage</legend>
      {OPTIONS.map((option) => {
        const active = value === option.value
        return (
          <label
            key={option.value}
            className={`relative inline-flex h-8 cursor-pointer items-center gap-1.5 border px-2.5 font-mono text-[10px] transition-colors select-none before:absolute before:-inset-x-0 before:-inset-y-1.5 before:content-[''] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink motion-safe:duration-150 ${active ? 'border-ink bg-surface-2 text-ink' : 'border-line bg-surface text-ink-2 hover:bg-surface-2'}`}
          >
            <input
              type='radio'
              name={name}
              value={option.value}
              checked={active}
              onChange={() => onChange(option.value)}
              className='absolute inset-0 m-0 size-full cursor-pointer opacity-0'
            />
            {option.dot && (
              <i
                aria-hidden='true'
                className={`size-[5px] rounded-full ${option.dot}`}
              />
            )}
            {option.label}
          </label>
        )
      })}
    </fieldset>
  )
}
