import { useRef } from 'react'
import { Check } from 'lucide-react'

/**
 * Workspace-theme picker: one card per theme, each showing the theme's own
 * accent as a colour dot.
 *
 * Same ARIA radiogroup contract as OptionCards (roving tabindex, arrow keys
 * move AND select) rather than a looser list of buttons, because this is a
 * single-choice control and a keyboard user should reach it once and cycle,
 * not tab through four separate stops.
 *
 * Selecting applies immediately — there is no Save button, so the preview
 * IS the confirmation. That is why each card is drawn in the palette it
 * represents (see `.tset-theme-card` in teacherSettings.css): the dot alone
 * tells you the accent, but the card tells you what the page will look like
 * before you commit to it.
 */
export default function ThemeCards({ value, onChange, options, label }) {
  const refs = useRef([])
  const checkedIdx = Math.max(0, options.findIndex((o) => o.id === value))

  const onKeyDown = (e, idx) => {
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % options.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + options.length) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    if (next == null) return
    e.preventDefault()
    onChange(options[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div className="tset-themes" role="radiogroup" aria-label={label}>
      {options.map((opt, i) => {
        const on = opt.id === value
        return (
          <button
            key={opt.id}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === checkedIdx ? 0 : -1}
            /* Each card previews its OWN theme, so it sets that theme's
               attribute on itself. Same tokens, same cascade — no per-theme
               CSS and no duplicated palette in JS. */
            data-theme={opt.id}
            className={`tset-theme-card${on ? ' tset-theme-card--on' : ''}`}
            onClick={() => onChange(opt.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="tset-theme-card__top">
              <span className="tset-theme-card__dot" aria-hidden="true" />
              <span className="tset-theme-card__name">{opt.label}</span>
              {on && <Check className="tset-theme-card__check" size={16} aria-hidden="true" />}
            </span>
            {opt.hint && <span className="tset-theme-card__hint">{opt.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
