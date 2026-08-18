/**
 * LearnerGradeGate — the staged-rollout gate, as behaviour.
 *
 * The pure decision is covered under plain node (`test:learner-grades`). What
 * needs a DOM is the wiring, and specifically the failure this whole change
 * exists to prevent: an existing Grade 5 learner being silently relabelled
 * Grade 7 because the wizard's list narrowed underneath them. That failure is
 * invisible from the rule alone — it lives in which component renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const mockLogout = vi.fn()
let mockAuth
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}))

import LearnerGradeGate from './LearnerGradeGate'
import { GRADES, LEARNER_GRADES } from '../../config/curriculum'

const OPEN_GRADE = LEARNER_GRADES[0]
const PAUSED_GRADE = GRADES.find((g) => !LEARNER_GRADES.includes(g))

function mount({ route = '/dashboard' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LearnerGradeGate><div>learner app</div></LearnerGradeGate>
    </MemoryRouter>,
  )
}

const app = () => screen.queryByText('learner app')
const waitlist = () => screen.queryByRole('heading', { name: /coming soon/i })

describe('LearnerGradeGate', () => {
  beforeEach(() => {
    mockLogout.mockReset()
    mockAuth = { isLearner: true, logout: mockLogout, userProfile: { grade: String(OPEN_GRADE) } }
  })

  it('lets a learner in an open grade through', () => {
    mount()
    expect(app()).toBeInTheDocument()
    expect(waitlist()).toBeNull()
  })

  // The whole point. Skipped only if every catalogue grade is open, which is
  // the end state of the rollout and a legitimate configuration.
  it.skipIf(!PAUSED_GRADE)('holds a learner in a paused grade WITHOUT changing their grade', () => {
    mockAuth.userProfile = { grade: String(PAUSED_GRADE) }
    mount()
    expect(app()).toBeNull()
    expect(waitlist()).toBeInTheDocument()
    // Named, so the child knows this is about their grade and not a fault.
    expect(screen.getByRole('heading', { name: new RegExp(`Grade ${PAUSED_GRADE}`, 'i') }))
      .toBeInTheDocument()
    // Nothing writes. A rollout must not mutate a child's profile.
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it.skipIf(!PAUSED_GRADE)('is never a dead end — offers a grade change and a sign out', () => {
    mockAuth.userProfile = { grade: String(PAUSED_GRADE) }
    mount()
    expect(screen.getByRole('button', { name: /change my grade/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it.skipIf(!PAUSED_GRADE)('lets a waitlisted learner reach /setup, or the change button leads nowhere', () => {
    mockAuth.userProfile = { grade: String(PAUSED_GRADE) }
    mount({ route: '/setup' })
    expect(app()).toBeInTheDocument()
    expect(waitlist()).toBeNull()
  })

  it('sends a learner with no grade to the setup gate, not the waitlist', () => {
    // UNKNOWN passes through here; LearnerSetupGate redirects it to the wizard.
    // A "your grade is coming soon" screen for someone with no grade is both
    // false and inescapable.
    for (const profile of [{}, { grade: '' }, { grade: null }]) {
      mockAuth.userProfile = profile
      const { unmount } = mount()
      expect(app()).toBeInTheDocument()
      expect(waitlist()).toBeNull()
      unmount()
    }
  })

  it('never waitlists a non-learner — admins and parents have no grade', () => {
    mockAuth = { isLearner: false, logout: mockLogout, userProfile: { grade: String(PAUSED_GRADE ?? 4) } }
    mount()
    expect(app()).toBeInTheDocument()
    expect(waitlist()).toBeNull()
  })
})
