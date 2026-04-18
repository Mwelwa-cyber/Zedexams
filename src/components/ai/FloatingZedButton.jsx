import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

/**
 * FloatingZedButton — persistent "Ask Zed" bubble in the bottom-right
 * corner of every eligible learner page.
 *
 * Why it exists: the /study route was hidden behind a single nav entry and
 * most learners never found it. A floating bubble is the universal pattern
 * (Intercom, ChatGPT mobile, every support widget) — small footprint,
 * always reachable, doesn't replace any existing UI.
 *
 * Visibility rules
 *   Shown on    — learner home, lessons, quizzes list, papers, results, profile, etc.
 *   Hidden on   — /login, /register (pre-auth)
 *                /study           (we're already on it)
 *                /quiz/:id        (quiz runner — don't break the learner's focus)
 *                /admin/*         (internal tool, different audience)
 *                /teacher/*       (same)
 *
 * Position handles the mobile bottom-nav safe-area inset (the learner
 * GradeHub has a fixed bottom nav at `bottom: 0`); we sit above it by
 * adding extra padding so the button doesn't overlap the tab bar.
 */

const HIDDEN_PATTERNS = [
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/study(\/|$)/,
  /^\/quiz\/[^/]+/,          // quiz runner, not the listing

]

export default function FloatingZedButton() {
  const location = useLocation()
  const { currentUser, userProfile } = useAuth()

  // Pre-auth users never see it.
  if (!currentUser || !userProfile) return null

  // Route-based suppression.
  if (HIDDEN_PATTERNS.some(re => re.test(location.pathname))) return null

  // Learner dashboards render a fixed mobile bottom nav; lift the button
  // above it on small screens. Desktop has more breathing room.
  const isLearnerHome = location.pathname === '/dashboard' || location.pathname === '/'

  return (
    <Link
      to="/study"
      aria-label="Ask Zed, the study assistant"
      className={[
        'fixed z-40 right-4 sm:right-6',
        isLearnerHome ? 'bottom-20 md:bottom-6' : 'bottom-4 md:bottom-6',
        'inline-flex items-center gap-2',
        'theme-accent-fill theme-on-accent',
        'rounded-full shadow-elev-lg shadow-elev-inner-hl',
        'px-4 py-3 md:py-3.5 font-black text-sm',
        'transition-all duration-base ease-spring',
        'hover:-translate-y-0.5 hover:shadow-elev-xl',
        'active:scale-95',
        // Subtle attention cue: a slow pulse ring behind the bubble
        'group relative',
      ].join(' ')}
      data-floating-zed="true"
    >
      {/* Pulsing halo — only runs when the button is not being hovered */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full opacity-40 group-hover:opacity-0 transition-opacity duration-base"
        style={{
          background: 'var(--accent)',
          animation: 'pulse-green 2.4s ease-in-out infinite',
        }}
      />

      {/* ZedExams logo chip */}
      <span
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-full overflow-hidden p-0.5"
        style={{
          background: 'rgba(255,255,255,0.92)',
          boxShadow: '0 0 12px rgba(212, 175, 55, 0.35)',
        }}
      >
        <img
          src="/zedexams-logo.png?v=4"
          alt=""
          aria-hidden="true"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </span>
      <span className="relative hidden sm:inline">Ask Zed</span>
      {/* Short label on mobile where horizontal room is tight */}
      <span className="relative sm:hidden">Zed</span>
    </Link>
  )
}
