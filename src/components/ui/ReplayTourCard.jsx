/**
 * ReplayTourCard — re-trigger any first-session tour the user has
 * already dismissed (audit A8 PR 4).
 *
 * The four onboarding overlays in the app each persist a "seen"
 * flag in localStorage. This card lists every tour relevant to the
 * current user's role with a "Replay" button that:
 *   1. Removes the localStorage key
 *   2. Navigates to the surface the tour lives on, where the
 *      <OnboardingOverlay /> mount notices the missing key on next
 *      render and shows the tour again.
 *
 * Why navigate instead of reload: reload incurs an extra network
 * round-trip on a phone the learner is already using inside the
 * SPA. A push-state navigation is instant and unmount/remounts the
 * surface the same way a reload would.
 *
 * Role-aware:
 *   - Learners see Dashboard / Quizzes / Lessons / Games tours.
 *   - Teachers / admins see the Teacher tour.
 *   - Everyone with a Capacitor wrapper still sees their relevant
 *     tours — localStorage is the same surface there.
 */

import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

const LEARNER_TOURS = [
  {
    id: 'dashboard',
    title: 'Dashboard tour',
    description: 'Pick your grade, take quizzes, change theme, earn badges.',
    storageKey: 'examprep:onboarded',
    path: '/dashboard',
    icon: '🎓',
  },
  {
    id: 'quizzes',
    title: 'Quizzes tour',
    description: 'How filters, daily attempts, and "Ask Zed" work.',
    storageKey: 'zedexams:quizzes-onboarded',
    path: '/quizzes',
    icon: '✏️',
  },
  {
    id: 'lessons',
    title: 'Lessons tour',
    description: 'How to read teacher notes and what unlocks with Premium.',
    storageKey: 'zedexams:lessons-onboarded',
    path: '/lessons',
    icon: '📖',
  },
  {
    id: 'games',
    title: 'Games tour',
    description: 'Daily challenge, badges, and the global leaderboard.',
    storageKey: 'zedexams:games-onboarded',
    path: '/games',
    icon: '🎮',
  },
]

const TEACHER_TOURS = [
  {
    id: 'teacher',
    title: 'Teacher dashboard tour',
    description: 'AI generators, classes, learner analytics — the four-step intro.',
    storageKey: 'zedexams:teacher-onboarded',
    path: '/teacher',
    icon: '🧑‍🏫',
  },
]

function clearTourKey(key) {
  try { localStorage.removeItem(key) } catch { /* private mode */ }
}

function TourRow({ tour, onReplay }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg theme-bg-subtle flex items-center justify-center text-base">
        <span aria-hidden="true">{tour.icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="theme-text font-bold text-sm truncate">{tour.title}</p>
        <p className="theme-text-muted text-xs leading-snug truncate">{tour.description}</p>
      </div>
      <button
        type="button"
        onClick={() => onReplay(tour)}
        className="text-xs font-bold theme-accent-text hover:underline flex-shrink-0"
      >
        Replay
      </button>
    </li>
  )
}

export default function ReplayTourCard() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const role = userProfile?.role

  // Pick the relevant tour list per role. Admins get teacher tours
  // since they have a teacher-style operating surface too. Mixed-role
  // accounts are rare; keeping it simple beats trying to be clever.
  const tours = role === 'teacher' || role === 'admin'
    ? TEACHER_TOURS
    : LEARNER_TOURS

  function handleReplay(tour) {
    clearTourKey(tour.storageKey)
    navigate(tour.path)
  }

  return (
    <section className="theme-card border theme-border rounded-radius-md p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="theme-text font-black text-sm flex items-center gap-2">
            <span aria-hidden="true">🧭</span>
            Replay a welcome tour
          </p>
          <p className="theme-text-muted text-xs mt-0.5 max-w-prose">
            Dismissed too fast? Pick a tour below to see it again.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-current/10">
        {tours.map((t) => (
          <TourRow key={t.id} tour={t} onReplay={handleReplay} />
        ))}
      </ul>
    </section>
  )
}
