// Appearance adapted from Uiverse.io Radio-buttons/Admin12121_cold-bobcat-20 (see THIRD_PARTY_NOTICES.md). Native radios keep state and arrow-key behaviour.
import { useId } from 'react'
import './coverage-segment.css'

export type CoverageOption = 'all' | 'covered' | 'partial' | 'gap'

const OPTIONS: { value: CoverageOption; label: string }[] = [
  { value: 'all', label: 'All coverage' },
  { value: 'covered', label: 'Covered' },
  { value: 'partial', label: 'Partial' },
  { value: 'gap', label: 'Gap' },
]

export function CoverageSegment({
  value,
  onChange,
  counts,
}: {
  value: CoverageOption
  onChange: (value: CoverageOption) => void
  counts: Record<CoverageOption, number>
}) {
  const name = useId()
  return (
    <fieldset className='ui-segment'>
      <legend className='text-sm font-medium'>Coverage</legend>
      <div className='ui-segment-grid'>
        {OPTIONS.map((option) => (
          <label key={option.value} className='ui-segment-option'>
            <input
              type='radio'
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              {option.label} {counts[option.value]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
