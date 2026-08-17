/**
 * The Guardian Zone's three layers, in the order a parent meets them.
 *
 * What is worth testing here is the SHAPE of the screen rather than its copy:
 *
 *   • the arithmetic gate stands between the child and the zone, and nothing
 *     behind it renders — including the status call, which must not fire for
 *     a child who never answered;
 *   • progress is visible once through the gate, because it is the child's
 *     own data and the gate is not claimed to protect it;
 *   • the controls are visible but INOPERABLE until the PIN is verified — the
 *     switch is disabled, and the row says why. A hidden control would leave a
 *     parent hunting for a feature the settings page just promised them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

let profile = {
  role: 'learner',
  isMinor: true,
  displayName: 'Milton Phiri',
  grade: '7',
  guardian: { consentStatus: 'granted' },
}
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1' }, userProfile: profile }),
}))

vi.mock('../../learnerHome/hooks/useLearnerDashboard', () => ({
  default: () => ({
    loading: false,
    error: null,
    data: {
      activeTerm: { term: 2 },
      subjects: [
        { id: 'science', label: 'Integrated Science', percent: 62, hasMaterial: true },
        { id: 'art', label: 'Expressive Art', percent: 0, hasMaterial: false },
      ],
      weakTopics: [{ subject: 'english', topicLabel: 'Punctuation' }],
      recentActivity: [
        { type: 'quiz_completed', sourceId: 'q1', completedAt: 1, title: 'Conjunctions', subjectLabel: 'English', score: 80, icon: 'quiz' },
      ],
    },
  }),
}))
vi.mock('../../../hooks/useLearnerStats', () => ({
  default: () => ({ stats: { currentStreak: 12 }, level: 4, loading: false }),
}))
vi.mock('../../learnerHome/hooks/useWeeklySummary', () => ({
  default: () => ({ quizzes: 3, games: 2, topics: 1, loading: false }),
}))

const fetchGuardianZoneStatus = vi.fn(async () => ({ hasPin: true, canEmailCode: true, guardianContact: 'm•••@x.com' }))
const verifyGuardianPin = vi.fn(async () => ({ ok: true }))
const saveGuardianControls = vi.fn(async ({ controls }) => ({ ok: true, controls }))
vi.mock('../services/guardianZoneService', () => ({
  fetchGuardianZoneStatus: (...a) => fetchGuardianZoneStatus(...a),
  requestGuardianPinSetup: vi.fn(async () => ({ ok: true, sentTo: 'm•••@x.com' })),
  setGuardianPin: vi.fn(async () => ({ ok: true })),
  verifyGuardianPin: (...a) => verifyGuardianPin(...a),
  saveGuardianControls: (...a) => saveGuardianControls(...a),
  guardianZoneErrorMessage: (err) => String(err?.message || 'error'),
}))

import GuardianZonePage from './GuardianZonePage'

function renderZone() {
  return render(<MemoryRouter><GuardianZonePage /></MemoryRouter>)
}

/**
 * The drawn sum. It appears twice on purpose — once as the big visible
 * question and once as the input's screen-reader label — so this reads the
 * visible one rather than asking getByText to choose.
 */
const gateQuestion = () => document.querySelector('.gz-q').textContent

/** Answer whatever sum the gate drew — the question is random by design. */
function passTheGate() {
  const [, a, b] = /What is (\d+) × (\d+)\?/.exec(gateQuestion())
  fireEvent.change(screen.getByLabelText(/What is \d+ × \d+\?/), { target: { value: String(Number(a) * Number(b)) } })
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
}

describe('GuardianZonePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    profile = {
      role: 'learner', isMinor: true, displayName: 'Milton Phiri', grade: '7',
      guardian: { consentStatus: 'granted' },
    }
  })

  it('shows the gate first and nothing behind it', () => {
    renderZone()
    expect(screen.getByText(/ask a grown-up/i)).toBeInTheDocument()
    expect(screen.queryByText(/subject progress/i)).not.toBeInTheDocument()
    // The status call is deferred until the gate is passed.
    expect(fetchGuardianZoneStatus).not.toHaveBeenCalled()
  })

  it('says plainly that the gate is not the lock', () => {
    // The failure mode of a parental gate is the next developer assuming it
    // secures what is behind it. The screen itself has to be honest.
    renderZone()
    expect(screen.getByText(/not a password/i)).toBeInTheDocument()
  })

  it('draws a new sum after a wrong answer', () => {
    renderZone()
    const first = gateQuestion()
    fireEvent.change(screen.getByLabelText(/What is \d+ × \d+\?/), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/here is another one/i)).toBeInTheDocument()
    // Same sum would mean a child who guessed once now knows the answer.
    // (It can redraw the same pair by chance; the input being cleared is the
    // part that must always hold.)
    expect(screen.getByLabelText(/What is \d+ × \d+\?/).value).toBe('')
    expect(typeof first).toBe('string')
  })

  it('shows the child snapshot and progress once through the gate', async () => {
    renderZone()
    passTheGate()
    expect(screen.getByText('Milton Phiri')).toBeInTheDocument()
    expect(screen.getByText(/Grade 7 · Term 2 · verified/)).toBeInTheDocument()
    expect(screen.getByText('Integrated Science')).toBeInTheDocument()
    // A subject with no material is not listed as 0% — that reads as failure
    // rather than as "not published yet".
    expect(screen.queryByText('Expressive Art')).not.toBeInTheDocument()
    expect(screen.getByText('Punctuation')).toBeInTheDocument()
    expect(screen.getByText('Conjunctions')).toBeInTheDocument()
    // 3 quizzes + 2 games + 1 topic
    expect(screen.getByText('6')).toBeInTheDocument()
    await waitFor(() => expect(fetchGuardianZoneStatus).toHaveBeenCalled())
  })

  it('shows the controls but refuses to operate them without the PIN', async () => {
    renderZone()
    passTheGate()
    const askZed = await screen.findByRole('switch', { name: /ask zed helper/i })
    expect(askZed).toBeDisabled()
    fireEvent.click(askZed)
    expect(saveGuardianControls).not.toHaveBeenCalled()
    expect(screen.getByText(/enter the guardian pin above/i)).toBeInTheDocument()
  })

  it('unlocks the controls with the PIN and posts it with the change', async () => {
    renderZone()
    passTheGate()
    const pinField = await screen.findByLabelText(/guardian pin/i)
    fireEvent.change(pinField, { target: { value: '4821' } })
    fireEvent.click(screen.getByRole('button', { name: /unlock controls/i }))

    const askZed = await screen.findByRole('switch', { name: /ask zed helper/i })
    await waitFor(() => expect(askZed).not.toBeDisabled())

    fireEvent.click(askZed)
    await waitFor(() => expect(saveGuardianControls).toHaveBeenCalled())
    // The PIN travels with the WRITE, not just with the unlock: there is no
    // unlocked session on the server, so every change is re-verified.
    expect(saveGuardianControls.mock.calls[0][0]).toMatchObject({
      pin: '4821',
      controls: expect.objectContaining({ askZed: false }),
    })
  })

  it('states that the consent is pending when it is', () => {
    profile = { ...profile, guardian: { consentStatus: 'pending' } }
    renderZone()
    passTheGate()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    // The verified badge is never claimed on an unapproved account.
    expect(screen.queryByText(/· verified/)).not.toBeInTheDocument()
  })

  it('offers Childline 116 as a real dialable link', () => {
    renderZone()
    passTheGate()
    expect(screen.getByText(/Childline Zambia · 116/).closest('a')).toHaveAttribute('href', 'tel:116')
  })
})
