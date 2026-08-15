import { useRef } from 'react'
import { THEMES } from '../../../contexts/ThemeContext'

/**
 * The reading-theme picker's options: one self-previewing swatch per theme.
 *
 * Each swatch draws "Aa" in the theme's real text colour on the theme's real
 * page background, with a rule in the theme's real accent — the three values
 * a learner is actually choosing between. The colours are not passed in and
 * are not written here: the preview carries `class="reading-swatch"
 * data-reading-theme="<id>"`, which src/index.css declares as an alias on that
 * palette's own token block, so `var(--bg)` / `var(--text)` / `var(--accent)`
 * inside it resolve exactly as they do on a real page in that theme. A second
 * copy of the hex values would go stale invisibly — a swatch showing the wrong
 * colour still looks like a working control.
 *
 * Same ARIA radiogroup contract as the workspace ThemeCards (roving tabindex,
 * arrows move AND select): this is one single-choice control, not four tab
 * stops. Selecting applies instantly, so the page behind IS the confirmation.
 */
export default function ReadingThemeSwatches({ value, onChange, label = 'Reading theme' }) {
  const refs = useRef([])
  const checkedIdx = Math.max(0, THEMES.findIndex((t) => t.id === value))

  const onKeyDown = (e, idx) => {
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % THEMES.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + THEMES.length) % THEMES.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = THEMES.length - 1
    if (next == null) return
    e.preventDefault()
    onChange(THEMES[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div className="rth-swatches" role="radiogroup" aria-label={label}>
      {THEMES.map((t, i) => {
        const on = t.id === value
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === checkedIdx ? 0 : -1}
            className={`rth-swatch${on ? ' rth-swatch--on' : ''}`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span
              className="reading-swatch rth-swatch__preview"
              data-reading-theme={t.id}
              aria-hidden="true"
            >
              <span className="rth-swatch__aa">Aa</span>
              <span className="rth-swatch__rule" />
            </span>
            <span className="rth-swatch__name">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}
