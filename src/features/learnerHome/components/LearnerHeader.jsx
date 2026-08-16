/**
 * LearnerHeader — the prototype-v3 glass topbar: logo on the left; Night
 * toggle, streak pill, alerts and the avatar (profile entry point) on
 * the right. On Home it also renders the "Hi, {name}! 👋" greeting with
 * the Grade · Term chip.
 *
 * The old four-tile chrome bar (Progress · Theme · Alerts · Account) is
 * gone with the redesign: Progress lives in the profile sheet, and the
 * multi-theme picker is replaced by the prototype's single Night toggle.
 * The curriculum label was dropped from the meta on purpose — the old
 * header hardcoded "CBC", which is wrong for Grade 7 (frameworks:
 * ['2013']), and the prototype chip shows Grade · Term only.
 */
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useNotifications } from '../../../contexts/NotificationContext'
import { useTheme, DEFAULT_THEME } from '../../../contexts/ThemeContext'
import useHideOnScroll from '../../../hooks/useHideOnScroll'
import { NotificationCenter } from '../../notifications'
import PlanChip from '../../../shared/components/PlanChip'
import CharacterAvatar from '../../../shared/components/CharacterAvatar'
import LearnerIcon from './LearnerIcon'
import LearnerProfileSheet from './LearnerProfileSheet'
import { firstNameOf } from '../lib/learnerHomeCore'

const LAST_LIGHT_KEY = 'lhx:last-light-theme'

/**
 * Night toggle — the prototype's 🌙/☀️ pill. Rides on the existing theme
 * system (midnight IS night), so the choice persists exactly the way a
 * theme choice always has. The previously chosen light theme is
 * remembered so surfaces that still vary by light theme return to it.
 */
function NightToggle() {
  const { theme, setTheme } = useTheme()
  const night = theme === 'midnight'
  const toggle = () => {
    if (night) {
      let last = null
      try { last = window.localStorage.getItem(LAST_LIGHT_KEY) } catch { /* private mode */ }
      setTheme(last && last !== 'midnight' ? last : DEFAULT_THEME)
    } else {
      try { window.localStorage.setItem(LAST_LIGHT_KEY, theme) } catch { /* private mode */ }
      setTheme('midnight')
    }
  }
  return (
    <button
      type="button"
      className="lhx-pill"
      onClick={toggle}
      aria-pressed={night}
      aria-label={night ? 'Switch to day mode' : 'Switch to night mode'}
    >
      <span aria-hidden="true">{night ? '☀️' : '🌙'}</span>
    </button>
  )
}

export default function LearnerHeader({ activeTerm, showGreeting = true, streak = null }) {
  const { userProfile } = useAuth()
  // The app-wide notification feed — one listener in NotificationProvider,
  // shared by every shell. Reading it here adds no Firestore work.
  const { unreadCount, open: alertsOpen, setOpen: setAlertsOpen } = useNotifications()
  const [sheetOpen, setSheetOpen] = useState(false)
  const accountRef = useRef(null)
  // LinkedIn-style auto-hide. Kept pinned while an overlay anchored to it
  // (alerts, account sheet) is open so it can't slide out from under its
  // own dialog.
  const scrolledHidden = useHideOnScroll()
  const topbarHidden = scrolledHidden && !alertsOpen && !sheetOpen

  const firstName = firstNameOf(userProfile?.displayName)
  const showStreak = Number.isFinite(Number(streak)) && Number(streak) > 0
  const gradeChip = [
    userProfile?.grade ? `🎓 Grade ${userProfile.grade}` : null,
    activeTerm ? `Term ${activeTerm}` : null,
  ].filter(Boolean).join('  ·  ')

  return (
    <header className="lhx-header">
      <div className={`lhx-topbar ${topbarHidden ? 'lhx-topbar-hidden' : ''}`}>
        <Link to="/dashboard" className="lhx-logo" aria-label="ZedExams home">
          <img src="/zedexams-logo.webp" alt="ZedExams" height="30" />
        </Link>
        <div className="lhx-top-right">
          <NightToggle />
          {showStreak && (
            <span className="lhx-streak-pill" aria-label={`${streak} day streak`}>
              <span aria-hidden="true">🔥</span> {streak}
            </span>
          )}
          {/* Tier 0 — the ambient plan chip, beside the bell. Never blocks,
              never animates, never asks the interruption budget: it is the
              page, not an interruption. A meter running down motivates more
              reliably than a modal, and it makes the limit legible BEFORE it
              is hit, which is the difference between a rule and an ambush.
              It self-hides for a paid account outside grace, so the
              prototype-v3 right cluster gains nothing for a subscriber. */}
          <PlanChip />
          <button
            type="button"
            className="lhx-pill"
            onClick={() => setAlertsOpen(true)}
            aria-label={unreadCount > 0 ? `Alerts, ${unreadCount} unread` : 'Alerts'}
            aria-haspopup="dialog"
          >
            <LearnerIcon name="notification" size={19} />
            {unreadCount > 0 && (
              <span className="lhx-pill-count" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
          <button
            ref={accountRef}
            type="button"
            className="lhx-avatar-btn"
            onClick={() => setSheetOpen(true)}
            aria-label={`Account menu for ${userProfile?.displayName || 'your account'}`}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
          >
            {userProfile?.avatarCharacter ? (
              <CharacterAvatar characterId={userProfile.avatarCharacter} className="w-full h-full" />
            ) : (
              <span aria-hidden="true">{(firstName || 'Z').charAt(0).toUpperCase()}</span>
            )}
          </button>
        </div>
      </div>
      {showGreeting && (
        <div>
          <h1 className="lhx-greeting">
            Hi{firstName ? ', ' : ''}<span>{firstName ? `${firstName}!` : 'there!'}</span> 👋
          </h1>
          {gradeChip && (
            <div className="lhx-header-meta lhx-chip-row">
              <span className="lhx-chip">{gradeChip}</span>
            </div>
          )}
        </div>
      )}
      {alertsOpen && <NotificationCenter />}
      <LearnerProfileSheet open={sheetOpen} onClose={() => setSheetOpen(false)} returnFocusRef={accountRef} />
    </header>
  )
}
