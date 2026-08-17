/**
 * LearnerHeader — the prototype glass topbar: logo on the left; Night
 * toggle, streak pill, the alerts bell and the avatar on the right. On
 * Home it also renders the "Hi, {name}! 👋" greeting with the
 * Grade · Term chip.
 *
 * Since prototype-v6 (step 10) the bell and the avatar NAVIGATE — to the
 * full-screen /notifications centre and to /profile — instead of opening
 * overlays; the old account sheet is gone with them. The multi-theme
 * picker remains replaced by the prototype's single Night toggle, and
 * the curriculum label stays off the meta on purpose — the old header
 * hardcoded "CBC", which is wrong for Grade 7 (frameworks: ['2013']).
 */
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useNotifications } from '../../../contexts/NotificationContext'
import { useTheme, DEFAULT_THEME } from '../../../contexts/ThemeContext'
import useHideOnScroll from '../../../hooks/useHideOnScroll'
import { capture } from '../../../utils/analytics'
import PlanChip from '../../../shared/components/PlanChip'
import CharacterAvatar from '../../../shared/components/CharacterAvatar'
import LearnerIcon from './LearnerIcon'
import ExamCountdownChip from './ExamCountdownChip'
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

export default function LearnerHeader({ activeTerm, showGreeting = true, streak = null, timetables = null }) {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  // The app-wide notification feed — one listener in NotificationProvider,
  // shared by every shell. Reading it here adds no Firestore work. Since
  // prototype-v6 the bell and avatar are NAVIGATION (full-screen
  // Notifications and Profile views), not overlays — so the topbar has no
  // anchored dialogs to keep pinned any more.
  const { unreadCount } = useNotifications()
  const topbarHidden = useHideOnScroll()

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
            onClick={() => navigate('/notifications')}
            aria-label={unreadCount > 0 ? `Alerts, ${unreadCount} unread` : 'Alerts'}
          >
            <LearnerIcon name="notification" size={19} />
            {/* Unread is a red dot (prototype-v6 .notif-dot); the count is
                surfaced to assistive tech through the label above. */}
            {unreadCount > 0 && <span className="lhx-notif-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="lhx-avatar-btn"
            onClick={() => { capture('profile_opened'); navigate('/profile') }}
            aria-label={`My profile, ${userProfile?.displayName || 'your account'}`}
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
          {(gradeChip || timetables) && (
            <div className="lhx-header-meta lhx-chip-row">
              {gradeChip && <span className="lhx-chip">{gradeChip}</span>}
              {/* The coral countdown chip — Home stays minimal, the pull
                  to the timetable rides here (prototype). */}
              {timetables && <ExamCountdownChip timetables={timetables} />}
            </div>
          )}
        </div>
      )}
    </header>
  )
}
