import { useState } from 'react'

/**
 * Environment options — value is the short name stored in state and passed to
 * onToggle; label is the full display name shown to the user.
 */
const ENVIRONMENTS = [
  {
    value: 'Natural',
    label: 'Natural Environment',
    description: 'Outdoors, field trips, community',
  },
  {
    value: 'Artificial',
    label: 'Artificial Environment',
    description: 'Classroom, lab, workshop',
  },
  {
    value: 'Technological',
    label: 'Technological Environment',
    description: 'Computer, TV, projector',
  },
]

/**
 * LearningEnvironmentForm — collapsible sidebar section for selecting the
 * learning environment type(s) for a lesson plan.
 *
 * Props:
 *   learningEnvironments: string[]         — currently selected environment values
 *   onToggle: (environment: string) => void — add if absent, remove if present
 *   disabled: boolean
 */
export function LearningEnvironmentForm({ learningEnvironments, onToggle, disabled }) {
  const [open, setOpen] = useState(true)

  const hasSome = learningEnvironments.length > 0

  return (
    <div
      className={[
        'border-b border-[#e5ddd0]',
        disabled ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
    >
      {/* Section header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          {/* Status dot */}
          <span
            className={[
              'inline-block h-2 w-2 rounded-full flex-shrink-0',
              hasSome ? 'bg-green-500' : 'bg-[#c9c0b0]',
            ].join(' ')}
            aria-hidden="true"
          />
          Learning Environment
        </span>

        {/* Chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={[
            'text-[#a39d8e] transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {ENVIRONMENTS.map(({ value, label, description }) => {
            const id = `lef-${value.toLowerCase()}`
            const checked = learningEnvironments.includes(value)

            return (
              <div key={value} className="flex items-start gap-2.5">
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(value)}
                  className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-[#d9cfbe] text-blue-500 focus:ring-blue-400"
                  disabled={disabled}
                />
                <label htmlFor={id} className="cursor-pointer select-none">
                  <span className="block text-[13px] font-medium text-[#3d3529]">{label}</span>
                  <span className="block text-[11px] text-[#a39d8e]">{description}</span>
                </label>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
