import { useState, useRef, useEffect } from 'react'
import { useTheme, THEMES } from '../../contexts/ThemeContext'

/**
 * ThemeSelector button
 *
 * Props:
 *   compact  — hide label text, show only swatch (default false)
 *   onDark   — use white text styling for placement on dark/gradient headers (default false)
 */
export default function ThemeSelector({ compact = false, onDark = false }) {
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

  const current = THEMES.find(t => t.id === theme) || THEMES[0]

  const triggerClass = onDark
    ? 'bg-white/20 hover:bg-white/30 border-white/30 text-white'
    : 'theme-bg-subtle hover:theme-card border theme-border theme-text'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Change theme"
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg font-bold text-sm transition-all min-h-0 border ${triggerClass}`}
      >
        <span
          className="w-4 h-4 rounded-full flex-shrink-0 border-2"
          style={{
            backgroundColor: current.swatch,
            borderColor: onDark ? 'rgba(255,255,255,0.5)' : 'var(--border)',
          }}
        />
        {!compact && (
          <span className="hidden sm:inline text-xs">{current.label}</span>
        )}
        <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-44 theme-card rounded-2xl shadow-xl border theme-border z-50 overflow-hidden animate-scale-in">
          <p className="px-3 pt-2.5 pb-1 text-xs font-black theme-text-muted uppercase tracking-wider">Theme</p>
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => { setTheme(t.id); setOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-bold transition-colors min-h-0 text-left ${
                theme === t.id
                  ? 'theme-accent-bg theme-accent-text'
                  : 'theme-text hover:theme-bg-subtle'
              }`}
            >
              <span
                className="w-5 h-5 rounded-full border-2 flex-shrink-0"
                style={{
                  backgroundColor: t.swatch,
                  borderColor: theme === t.id ? 'currentColor' : 'var(--border)',
                }}
              />
              {t.label}
              {theme === t.id && <span className="ml-auto text-xs">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
