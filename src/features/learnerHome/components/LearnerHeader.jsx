/**
 * LearnerHeader — the logo row with the learner chrome bar (Progress ·
 * Theme · Alerts · Account) and, on the home page, the time-aware
 * greeting with Grade · Curriculum · Term meta.
 *
 * The chrome bar is the one the classic learner dashboard carried: four
 * labelled icon tiles beside the logo. Account is the profile entry
 * point and shows the learner's avatar inside its tile, so Profile keeps
 * an avatar affordance even though it is not in the bottom navigation.
 */
import { forwardRef, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useNotifications } from '../../../contexts/NotificationContext'
import { useTheme, THEMES } from '../../../contexts/ThemeContext'
import useHideOnScroll from '../../../hooks/useHideOnScroll'
import { NotificationCenter } from '../../notifications'
import CharacterAvatar from '../../../components/profile/CharacterAvatar'
import LearnerIcon from './LearnerIcon'
import LearnerProfileSheet from './LearnerProfileSheet'
import { getGreeting, firstNameOf } from '../lib/learnerHomeCore'

/** One labelled tile in the chrome bar. */
const ChromeTile = forwardRef(function ChromeTile(
  { as: As = 'button', icon, label, badge, children, ...rest },
  ref,
) {
  return (
    <As ref={ref} className="lhx-chrome-btn" {...(As === 'button' ? { type: 'button' } : {})} {...rest}>
      <span className="lhx-chrome-tile">
        {children || <LearnerIcon name={icon} size={20} />}
        {badge ? <span className="lhx-chrome-count" aria-hidden="true">{badge}</span> : null}
      </span>
      <span className="lhx-chrome-label">{label}</span>
    </As>
  )
})

/**
 * Reading-theme picker. Same themes and the same setTheme call the classic
 * dashboard's selector used — only the chrome is rebuilt in .lhx idiom.
 */
function ThemeTile() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = THEMES.find((t) => t.id === theme) || THEMES[0]

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <ChromeTile
        icon="theme"
        label="Theme"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Change theme, current theme is ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
      />
      {open && (
        <div className="lhx-menu" role="menu" aria-label="Theme options">
          <p className="lhx-menu-title">Theme</p>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === t.id}
              className="lhx-menu-item"
              onClick={() => { setTheme(t.id); setOpen(false) }}
            >
              {/* Self-previewing: the swatch declares the palette it offers
                  (the `.reading-swatch` alias in index.css), so the "Aa" is
                  drawn in that theme's real text colour on its real page
                  background instead of a colour repeated here. */}
              <span
                className="reading-swatch lhx-menu-swatch"
                data-reading-theme={t.id}
                aria-hidden="true"
              >
                Aa
              </span>
              {t.label}
              {theme === t.id && (
                <span className="lhx-menu-check" aria-hidden="true"><Check size={16} strokeWidth={2.5} /></span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LearnerHeader({ activeTerm, showGreeting = true }) {
  const { userProfile } = useAuth()
  // The app-wide notification feed — one listener in NotificationProvider,
  // shared by every shell. Reading it here adds no Firestore work.
  const { unreadCount, open: alertsOpen, setOpen: setAlertsOpen } = useNotifications()
  const [sheetOpen, setSheetOpen] = useState(false)
  const accountRef = useRef(null)
  // LinkedIn-style auto-hide, same hook the glass Navbar uses: the chrome
  // bar folds away while the learner scrolls down into the page and glides
  // back the moment they scroll up. Kept pinned while an overlay anchored
  // to it (alerts, account sheet) is open so it can't slide out from under
  // its own dialog.
  const scrolledHidden = useHideOnScroll()
  const topbarHidden = scrolledHidden && !alertsOpen && !sheetOpen

  const firstName = firstNameOf(userProfile?.displayName)
  const greeting = getGreeting(new Date().getHours())
  const meta = [
    userProfile?.grade ? `Grade ${userProfile.grade}` : null,
    'CBC',
    activeTerm ? `Term ${activeTerm}` : null,
  ].filter(Boolean)

  return (
    <header className="lhx-header">
      <div className={`lhx-topbar ${topbarHidden ? 'lhx-topbar-hidden' : ''}`}>
        <div className="lhx-header-row">
          <Link to="/dashboard" className="lhx-logo" aria-label="ZedExams home">
            <img src="/zedexams-logo.webp" alt="ZedExams" height="30" />
          </Link>
          <nav className="lhx-chrome" aria-label="Account and settings">
            <ChromeTile as={Link} to="/my-results" icon="progress" label="Progress" />
            <ThemeTile />
            <ChromeTile
              icon="notification"
              label="Alerts"
              badge={unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : null}
              onClick={() => setAlertsOpen(true)}
              aria-label={unreadCount > 0 ? `Alerts, ${unreadCount} unread` : 'Alerts'}
              aria-haspopup="dialog"
            />
            <ChromeTile
              ref={accountRef}
              label="Account"
              onClick={() => setSheetOpen(true)}
              aria-label={`Account menu for ${userProfile?.displayName || 'your account'}`}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
            >
              <span className="lhx-chrome-avatar">
                {userProfile?.avatarCharacter ? (
                  <CharacterAvatar characterId={userProfile.avatarCharacter} className="w-full h-full" />
                ) : (
                  <span aria-hidden="true">{(firstName || 'Z').charAt(0).toUpperCase()}</span>
                )}
              </span>
            </ChromeTile>
          </nav>
        </div>
      </div>
      {showGreeting && (
        <div>
          <h1 className="lhx-greeting">
            {greeting}{firstName ? `, ${firstName}!` : '!'}
          </h1>
          {meta.length > 0 && (
            <p className="lhx-header-meta">
              {meta.map((m, i) => (
                <span key={m}>
                  {i > 0 && <span className="lhx-dot" aria-hidden="true">·</span>}
                  {m}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      {alertsOpen && <NotificationCenter />}
      <LearnerProfileSheet open={sheetOpen} onClose={() => setSheetOpen(false)} returnFocusRef={accountRef} />
    </header>
  )
}
