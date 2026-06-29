import { useState } from 'react'
import { Sprout } from '../../../ui/icons'

/**
 * Environment options — value is the short name stored in state and passed to
 * onToggle; label is the full display name shown to the user; emoji is a
 * decorative glyph for the premium toggle card.
 */
const ENVIRONMENTS = [
  {
    value: 'Natural',
    label: 'Natural Environment',
    description: 'Outdoors, field trips, community',
    emoji: '🌳',
  },
  {
    value: 'Artificial',
    label: 'Artificial Environment',
    description: 'Classroom, lab, workshop',
    emoji: '🏫',
  },
  {
    value: 'Technological',
    label: 'Technological Environment',
    description: 'Computer, TV, projector',
    emoji: '💻',
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
          <Sprout size={15} className="text-[#a99e8b]" aria-hidden="true" />
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
        <div className="lps-section-enter px-4 pb-4 space-y-2.5">
          {ENVIRONMENTS.map(({ value, label, description, emoji }) => {
            const id = `lef-${value.toLowerCase()}`
            const checked = learningEnvironments.includes(value)

            return (
              <label
                key={value}
                className={[
                  'lps-lift flex cursor-pointer select-none items-center gap-3 rounded-xl border px-3 py-2.5 transition-all',
                  checked
                    ? 'border-blue-500 bg-blue-50 lps-card-glow'
                    : 'border-[#e0d7c8] bg-white hover:border-[#cfc3ae] hover:bg-[#f9f5ef]',
                ].join(' ')}
              >
                <span
                  className={[
                    'grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-[18px] leading-none',
                    checked ? 'bg-blue-100' : 'bg-[#f5efe1]',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[#3d3529]">{label}</span>
                  <span className="block text-[11px] text-[#a39d8e]">{description}</span>
                </span>
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(value)}
                  className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-[#d9cfbe] text-blue-600 focus:ring-blue-400"
                  disabled={disabled}
                />
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
