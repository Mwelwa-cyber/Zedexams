import { useState, useRef, useEffect } from 'react'
import { useTheme, THEMES } from '../../contexts/ThemeContext'

/**
 * ThemeSelector button
 *
 * Props:
 *   compact  — hide label text, show only swatch (default false)
 *   onDark   — use white text styling for placement on dark/gradient headers (default false)
 *   quizStyle — use the round palette button styling from the quiz screen (default false)
 *
 * Accessibility:
 *   - Trigger has aria-label, aria-expanded, aria-haspopup
 *   - Dropdown has role="menu"; each option has role="menuitem" + aria-label
 *   - CSS tooltip (group-hover) on desktop; text label on mobile
 */
export default function ThemeSelector({ compact = false, onDark = false, quizStyle = false }) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close on Escape
  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape' && open) setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const current = THEMES.find(t => t.id === theme) || THEMES[0]

  const triggerClass = quizStyle
    ? 'theme-accent-fill theme-on-accent border-transparent shadow-md hover:opacity-90'
    : onDark
    ? 'bg-white/20 hover:bg-white/30 border-white/30 text-white'
    : 'theme-bg-subtle hover:theme-card border theme-border theme-text'

  return (
    /* group/tt enables the CSS tooltip via group-hover/tt */
    <div className="group/tt relative flex flex-col items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`Change theme, current theme is ${current.label}`}
        aria-expanded={open}
        aria-haspopup="true"
        title="Change theme"
        className={`flex items-center justify-center gap-1.5 font-bold text-sm transition-all min-h-0 border ${
          quizStyle ? 'w-9 h-9 rounded-full p-0 text-base' : 'px-2 py-1.5 rounded-lg'
        } ${triggerClass}`}
      >
        {quizStyle ? (
          <span aria-hidden="true">🎨</span>
        ) : (
          <span
            aria-hidden="true"
            className="w-4 h-4 rounded-full flex-shrink-0 border-2"
            style={{
              backgroundColor: current.swatch,
              borderColor: onDark ? 'rgba(255,255,255,0.5)' : 'var(--border)',
            }}
          />
        )}
        {!compact && !quizStyle && (
          <span className="hidden sm:inline text-xs">{current.label}</span>
        )}
        {!quizStyle && (
          <svg aria-hidden="true" className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* CSS tooltip — desktop hover/focus only (hidden on touch via sm:block) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800/95 px-2 py-1 text-[11px] font-bold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100 sm:block"
      >
        Change theme
      </span>

      {/* Mobile text label — visible only on small screens where hover doesn't exist */}
      <span aria-hidden="true" className="mt-0.5 text-[9px] font-bold leading-none theme-text-muted sm:hidden">
        Theme
      </span>

      {open && (
        <div
          role="menu"
          aria-label="Theme options"
          className="absolute right-0 top-full mt-2 w-44 theme-card rounded-2xl shadow-xl border theme-border z-50 overflow-hidden animate-scale-in"
        >
          <p className="px-3 pt-2.5 pb-1 text-xs font-black theme-text-muted uppercase tracking-wider" aria-hidden="true">
            Theme
          </p>
          {THEMES.map(t => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              aria-label={`${t.label} theme${theme === t.id ? ' (current)' : ''}`}
              onClick={() => { setTheme(t.id); setOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-bold transition-colors min-h-0 text-left ${
                theme === t.id
                  ? 'theme-accent-bg theme-accent-text'
                  : 'theme-text hover:theme-bg-subtle'
              }`}
            >
              <span
                aria-hidden="true"
                className="w-5 h-5 rounded-full border-2 flex-shrink-0"
                style={{
                  backgroundColor: t.swatch,
                  borderColor: theme === t.id ? 'currentColor' : 'var(--border)',
                }}
              />
              {t.label}
              {theme === t.id && <span className="ml-auto text-xs" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
