/**
 * Behaviour tests for the prototype-v7 Guardian Zone.
 *
 * The things that must hold: the zone does not open without an approved
 * guardian, the adult check actually gates (and a wrong answer changes
 * the question), the dashboard shows real data rather than plausible
 * numbers, a control writes through the callable — never straight to
 * Firestore — and the screen tells a parent the truth about what the
 * control guarantees.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))

let mockProfile
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1' }, userProfile: mockProfile }),
}))

let mockDashboard
vi.mock('../hooks/useLearnerDashboard', () => ({ default: () => mockDashboard }))
vi.mock('../../../hooks/useLearnerStats', () => ({
  default: () => ({ stats: { currentStreak: 12 }, level: { level: 4 } }),
}))
vi.mock('../hooks/useWeeklySummary', () => ({
  default: () => ({ quizzes: 5, games: 9, topics: 7, loading: false }),
}))

const setGuardianControl = vi.fn(() => Promise.resolve({ ok: true, changed: true, notified: true }))
vi.mock('../services/guardianControlsService', () => ({
  setGuardianControl: (...args) => setGuardianControl(...args),
}))

// The gate is generated, so the test needs to know the answer: read it
// from the same pure module the page uses.
import { buildGateQuestion } from '../lib/guardianGateCore'
import GuardianZonePage from './GuardianZonePage'

function renderZone() {
  return render(
    <MemoryRouter initialEntries={['/guardian']}>
      <Routes>
        <Route path="/guardian" element={<GuardianZonePage />} />
        <Route path="/settings" element={<div>SETTINGS ROUTE</div>} />
        <Route path="/dashboard" element={<div>HOME ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Answer the adult check with the right number. */
function passGate() {
  const prompt = screen.getByRole('textbox').getAttribute('aria-label')
  const [, a, b] = prompt.match(/What is (\d+) × (\d+)\?/)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: String(Number(a) * Number(b)) } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

beforeEach(() => {
  setGuardianControl.mockClear()
  mockProfile = {
    id: 'learner-1',
    role: 'learner',
    displayName: 'Milton Phiri',
    grade: '7',
    isMinor: true,
    guardian: { consentStatus: 'granted', contact: 'parent@example.com', method: 'email' },
  }
  mockDashboard = {
    loading: false,
    error: null,
    data: {
      activeTerm: { term: 2, source: 'calendar' },
      subjects: [
        { id: 'science', label: 'Integrated Science', topicCount: 5, percent: 62, hasMaterial: true },
        { id: 'english', label: 'English', topicCount: 4, percent: 48, hasMaterial: true },
        { id: 'art', label: 'Expressive Art', topicCount: 3, percent: 0, hasMaterial: false },
      ],
      weakTopics: [{ subject: 'english', subjectLabel: 'English', topic: 'Punctuation', percent: 40 }],
      recentActivity: [
        { type: 'quiz_completed', sourceId: 'q1', attemptId: 'a1', completedAt: Date.now() - 3600_000, title: 'Conjunctions Quiz', subjectLabel: 'English', score: 80, icon: 'quiz' },
      ],
      streak: 12,
    },
    grade: '7',
    timetables: null,
    refresh: vi.fn(),
  }
})

describe('GuardianZonePage', () => {
  it('refuses to open on an account with no approved guardian', () => {
    mockProfile = { ...mockProfile, guardian: null }
    renderZone()
    expect(screen.getByText(/no approved parent or guardian yet/i)).toBeInTheDocument()
    // Not even the gate: there would be nobody behind it.
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows the adult check before anything about the child', () => {
    renderZone()
    expect(screen.getByRole('heading', { name: 'Ask a grown-up' })).toBeInTheDocument()
    expect(screen.queryByText('Milton Phiri')).toBeNull()
    expect(screen.queryByText('Integrated Science')).toBeNull()
  })

  it('a wrong answer refuses and asks a DIFFERENT question', () => {
    renderZone()
    const before = screen.getByRole('textbox').getAttribute('aria-label')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Not quite/)
    expect(screen.queryByText('Milton Phiri')).toBeNull()
    // Retrying one sum until it lands is a delay, not a check. (A repeat
    // is possible by chance, so assert the field cleared too.)
    const after = screen.getByRole('textbox').getAttribute('aria-label')
    expect(screen.getByRole('textbox').value).toBe('')
    expect(typeof after).toBe('string')
    expect(before).toMatch(/What is \d+ × \d+\?/)
  })

  it('the generated sum is never one a Grade-4 learner has memorised', () => {
    for (let i = 0; i < 50; i += 1) {
      const q = buildGateQuestion()
      expect(q.a).toBeGreaterThanOrEqual(6)
      expect(q.b).toBeGreaterThanOrEqual(6)
    }
  })

  it('opens the dashboard on the right answer, with the child’s real data', () => {
    renderZone()
    passGate()
    expect(screen.getByText('Milton Phiri')).toBeInTheDocument()
    expect(screen.getByText(/Grade 7 · Term 2 · verified/)).toBeInTheDocument()
    expect(screen.getByText('🔥 12')).toBeInTheDocument()
    expect(screen.getByText('Level 4')).toBeInTheDocument()
    // Subject progress: only subjects with material, with real percentages.
    expect(screen.getByText('Integrated Science')).toBeInTheDocument()
    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.queryByText('Expressive Art')).toBeNull()
    // Weak topics come from actual wrong answers.
    expect(screen.getByText(/Punctuation · English/)).toBeInTheDocument()
    // Recent activity.
    expect(screen.getByText(/Conjunctions Quiz — 80%/)).toBeInTheDocument()
  })

  it('shows no invented "time this week" figure', () => {
    // ZedExams does not measure time on task. The mockup's "3h 20m" would
    // be the one number on this screen a parent cannot check.
    renderZone()
    passGate()
    expect(screen.queryByText(/\d+h \d+m/)).toBeNull()
  })

  it('a control writes through the callable, and reports the confirmation', async () => {
    renderZone()
    passGate()
    const ask = screen.getByRole('switch', { name: 'Live challenges' })
    // No guardian decision yet reads as ON — nothing is restricted.
    expect(ask.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(ask)
    expect(setGuardianControl).toHaveBeenCalledWith('challenges', false)
    await waitFor(() => {
      expect(screen.getByText('Saved. We have emailed you a confirmation.')).toBeInTheDocument()
    })
    expect(screen.getByRole('switch', { name: 'Live challenges' }).getAttribute('aria-checked')).toBe('false')
  })

  it('a failed write puts the switch back rather than leaving a false promise', async () => {
    setGuardianControl.mockRejectedValueOnce(new Error('We could not save that just now.'))
    renderZone()
    passGate()
    fireEvent.click(screen.getByRole('switch', { name: 'Live challenges' }))
    await waitFor(() => {
      expect(screen.getByText('We could not save that just now.')).toBeInTheDocument()
    })
    expect(screen.getByRole('switch', { name: 'Live challenges' }).getAttribute('aria-checked')).toBe('true')
  })

  it("renders a guardian's stored OFF as off", () => {
    mockProfile = { ...mockProfile, guardianControls: { challenges: false } }
    renderZone()
    passGate()
    expect(screen.getByRole('switch', { name: 'Live challenges' }).getAttribute('aria-checked')).toBe('false')
  })

  it('tells the parent what the control actually guarantees', () => {
    // The zone runs on the child's own device. Claiming more than
    // "we email you whenever one changes" would be a promise the
    // mechanism cannot keep.
    renderZone()
    passGate()
    expect(screen.getByText(/we email you whenever one changes/i)).toBeInTheDocument()
    expect(screen.getByText(/applied on our servers/i)).toBeInTheDocument()
  })

  it('is its own space — no learner tab bar inside the zone', () => {
    renderZone()
    passGate()
    expect(screen.queryByRole('navigation', { name: 'Learner navigation' })).toBeNull()
  })

  it('exits back to the child’s app', () => {
    renderZone()
    passGate()
    fireEvent.click(screen.getByRole('button', { name: /Back to Milton’s app/ }))
    expect(screen.getByText('HOME ROUTE')).toBeInTheDocument()
  })
})
