/**
 * LearnerHeader — the prototype glass topbar: logo on the left; Night
 * toggle, streak pill, the alerts bell and the avatar on the right. On
 * Home it also renders the "Hi, {name}! 👋" greeting with the
 * Grade · Term chip.
 *
 * The bar is frosted glass that STAYS while the page scrolls under it
 * (see the sticky note on the markup below) — so the blur has moving
 * content to work on, which is the only thing that makes glass glass.
 *
 * The exam countdown is no longer a chip here: prototype v7 puts it
 * back as the coral card directly under this greeting
 * (ExamCountdownCard), which can name the next paper as well as count
 * the days.
 *
 * The Grade · Term chip is a BUTTON: it states where the school year has
 * actually got to (the calendar's answer, holiday included) and opens the
 * School Calendar. It is the "small thing" the calendar hangs off — a term
 * printed with nowhere to check it is exactly how "Term 1" sat on this
 * screen through an August holiday without anyone being able to see why.
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
import { firstNameOf } from '../lib/learnerHomeCore'
import { gradeTermChip } from '../../../utils/learnerCalendar'

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

export default function LearnerHeader({ activeTerm, calendar = null, showGreeting = true, streak = null }) {
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
  // The calendar answers when it can; `activeTerm` — the term the app is
  // actually scoped to — is the fallback for the dates the calendar has no
  // data for, so the chip never empties out to a bare grade.
  const gradeChip = gradeTermChip(userProfile?.grade, calendar, activeTerm)

  return (
    /*
      This <header> is the page banner and it stays exactly where it was —
      wrapping the bar AND the greeting, which is what makes "the greeting
      is in the header" true for a screen reader and for the spec that
      asserts it. What changed is that `.lhx-header` is now
      `display: contents` (learnerTheme.css), so the element generates no
      BOX: a sticky child can only travel inside its parent's box, and this
      one's box was barely taller than the greeting, so the bar came
      unstuck and scrolled away about seventy pixels in. With the box gone
      the bar sticks to `.lhx-page` and has the whole page to ride over —
      which is the difference between frosted chrome and a pale strip that
      leaves before any content reaches it. `useHideOnScroll` above has
      always described a bar that folds on the way down and returns on the
      first scroll up; neither could happen to a bar already off screen.
    */
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
          {gradeChip && (
            <div className="lhx-header-meta lhx-chip-row">
              <button
                type="button"
                className="lhx-term-chip"
                onClick={() => { capture('school_calendar_opened', { from: 'home_chip' }); navigate('/school-calendar') }}
                aria-label={`${gradeChip.replace(/🎓\s*/, '')} — open the school calendar`}
              >
                <span className="lhx-term-chip-text">{gradeChip}</span>
                <span className="lhx-term-chip-caret" aria-hidden="true">›</span>
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  )
}
