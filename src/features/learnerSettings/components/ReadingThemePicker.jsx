import { useEffect, useId, useRef, useState } from 'react'
import { Palette } from 'lucide-react'
import { useTheme } from '../../../contexts/ThemeContext'
import { capture } from '../../../utils/analytics'
import ReadingThemeSwatches from './ReadingThemeSwatches'

/**
 * The reading-theme control, placed where the themes actually apply: the
 * learner note reader and the quiz runner.
 *
 * It used to live only in Settings → Appearance on the teacher side, which is
 * the one surface it does NOT colour. It writes through the same
 * `examprep:theme` key every learner view already reads, and it deliberately
 * does not depend on auth: it works signed-in, signed-out, and on a shared
 * school device where the "account" is whoever sat down last.
 *
 * The choice does reach the account when there is one, but that happens a
 * layer down (setTheme → the persister <ReadingThemeSync> registers), not
 * here — which is what keeps this component mountable with no AuthProvider
 * above it.
 *
 * `surface` is recorded on the analytics event so we can tell a reader who
 * changes theme mid-note from a learner who changes it mid-quiz — different
 * moments, likely different reasons.
 */
export default function ReadingThemePicker({ surface, className = '', align = 'right' }) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const panelId = useId()

  // Close on outside click and on Escape, so it behaves like every other
  // popover in the app rather than a panel that has to be dismissed by
  // picking something.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (next) => {
    if (next === theme) { setOpen(false); return }
    // Fired here rather than in ThemeContext on purpose: this is the only
    // place a THEME CHOICE happens. The provider also resolves a theme on
    // every page load and migrates retired ids on first read, and neither of
    // those is a decision anyone made.
    capture('reading_theme_selected', {
      theme: next,
      previous_theme: theme,
      surface,
    })
    setTheme(next)
    setOpen(false)
  }

  return (
    <div className={`rth ${className}`} ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label="Reading theme"
        title="Reading theme"
        className="rth-trigger"
      >
        {/* A palette rather than an "Aa": both surfaces already carry an "Aa"
            button for text size and typeface, and two identical glyphs side by
            side would make the pair unreadable at a glance. */}
        <Palette size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Reading theme"
          className={`rth-popover rth-popover--${align}`}
        >
          <p className="rth-popover__title">Reading theme</p>
          <ReadingThemeSwatches value={theme} onChange={choose} />
          <p className="rth-popover__note">
            Saved to your account when you&apos;re signed in — pick what&apos;s
            comfortable for your eyes.
          </p>
        </div>
      )}
    </div>
  )
}
