/**
 * LearnerSetupGate — who gets sent to the setup wizard, and (mostly) who does
 * not. Every case here is one where redirecting would be a bug rather than a
 * feature: an existing learner, a still-loading profile, a parent, an admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

let mockAuth
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

import LearnerSetupGate from './LearnerSetupGate'

function mount(at = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/dashboard" element={<LearnerSetupGate><div>HOME</div></LearnerSetupGate>} />
        <Route path="/setup" element={<LearnerSetupGate><div>WIZARD</div></LearnerSetupGate>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockAuth = { userProfile: { role: 'learner', grade: '' }, isLearner: true, authReady: true }
})

describe('LearnerSetupGate', () => {
  it('sends a learner with no grade to the wizard', () => {
    mount()
    expect(screen.getByText('WIZARD')).toBeInTheDocument()
  })

  it('leaves an existing learner alone', () => {
    // The reason the test is on the grade and not on a completion flag: every
    // learner who predates the wizard looks exactly like this.
    mockAuth.userProfile = { role: 'learner', grade: '7' }
    mount()
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })

  it('does not bounce a learner whose profile is still loading', () => {
    // A one-frame redirect to /setup on every cold start would be the result.
    mockAuth.userProfile = null
    mount()
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })

  it('does not bounce anyone before Firebase has emitted', () => {
    // `isLearner` is false while auth is unresolved, so today this falls
    // through by accident. Pinned so a future rewrite of the role flags cannot
    // turn a cold start into a redirect to /setup for a learner who already
    // has a grade.
    mockAuth = { userProfile: null, isLearner: false, authReady: false }
    mount()
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })

  it('leaves non-learners alone — they have no grade of their own', () => {
    for (const role of ['parent', 'admin', 'teacher']) {
      mockAuth = { userProfile: { role, grade: '' }, isLearner: false, authReady: true }
      const { unmount } = mount()
      expect(screen.getByText('HOME')).toBeInTheDocument()
      unmount()
    }
  })

  it('a grade the catalogue cannot serve still counts as needing setup', () => {
    mockAuth.userProfile = { role: 'learner', grade: '11' }
    mount()
    expect(screen.getByText('WIZARD')).toBeInTheDocument()
  })

  it('never redirects /setup to itself', () => {
    mount('/setup')
    expect(screen.getByText('WIZARD')).toBeInTheDocument()
  })
})
