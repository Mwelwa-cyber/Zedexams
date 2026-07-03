import { useRef } from 'react'

// Segmented option cards (e.g. lesson-plan style Simple / Standard /
// Detailed). Full ARIA radiogroup contract: roving tabindex (only the
// selected card is tabbable) and arrow keys move + select, so keyboard users
// aren't locked out of the group.
export default function OptionCards({ value, onChange, options, columns = 3, label, disabled = false }) {
  const refs = useRef([])
  const checkedIdx = Math.max(0, options.findIndex((o) => o.value === value))

  const onKeyDown = (e, idx) => {
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % options.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + options.length) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    if (next == null) return
    e.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      className={`tset-options${columns === 2 ? ' tset-options--two' : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((opt, i) => {
        const on = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === checkedIdx ? 0 : -1}
            disabled={disabled}
            className={`tset-option${on ? ' tset-option--on' : ''}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <p className="tset-option__title">{opt.title}</p>
            {opt.hint && <p className="tset-option__hint">{opt.hint}</p>}
          </button>
        )
      })}
    </div>
  )
}
