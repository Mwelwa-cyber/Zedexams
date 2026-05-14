/**
 * Segmented control for the two assignment modes.
 *
 * Built as buttons (not radios) so the visual treatment is a clean
 * segmented pill that scales from phone to desktop. Keyboard support:
 *   - Tab cycles in
 *   - Arrow keys switch between segments
 *   - Space / Enter activates (default button behaviour)
 *
 * Designed to be parent-controlled — the wizard owns the active value.
 */

import { useRef } from 'react'

const MODES = [
  {
    id: 'automatic',
    label: 'Automatic',
    description: 'Assign by grade / subject in one tap.',
    icon: '⚡',
  },
  {
    id: 'manual',
    label: 'Manual',
    description: 'Pick specific classes or learners.',
    icon: '🎯',
  },
]

export default function AssignmentModePicker({ value = 'automatic', onChange, className = '' }) {
  const refs = useRef([])

  function handleKeyDown(event, index) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + direction + MODES.length) % MODES.length
    const nextMode = MODES[nextIndex]
    onChange?.(nextMode.id)
    requestAnimationFrame(() => refs.current[nextIndex]?.focus())
  }

  return (
    <div
      role="tablist"
      aria-label="Assignment mode"
      className={`grid grid-cols-2 gap-2 rounded-2xl theme-bg-subtle p-1 ${className}`}
    >
      {MODES.map((mode, index) => {
        const active = mode.id === value
        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={active}
            ref={(el) => { refs.current[index] = el }}
            onClick={() => onChange?.(mode.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={[
              'flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-black transition-all duration-fast',
              'min-h-[48px] sm:min-h-0', // touch target on phones
              active
                ? 'theme-accent-fill theme-on-accent shadow-elev-sm'
                : 'theme-text-muted hover:theme-text hover:bg-white/40',
            ].join(' ')}
          >
            <span aria-hidden="true" className="text-base">{mode.icon}</span>
            <span>{mode.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export { MODES as ASSIGNMENT_MODES }
