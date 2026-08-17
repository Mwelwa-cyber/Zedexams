/**
 * DuelLive — the live race's promises: only raw answer indexes ever
 * leave the client (the server grades), the search can always be
 * cancelled (leaving the queue), the result shows the SERVER's scores,
 * and a signed-out or guardian-blocked visitor gets a refusal that
 * names why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../lib/gameSounds', () => ({
  playCorrect: vi.fn(), playWrong: vi.fn(), playWin: vi.fn(), primeSounds: vi.fn(),
}))

let mockUser
let mockProfile
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: mockUser, userProfile: mockProfile }),
}))

const svc = {
  cancel: vi.fn(),
  matchUnsub: vi.fn(),
  onMatched: null,
  onMatchChange: null,
  submitted: null,
  submitResponse: { done: true },
}
vi.mock('../services/duelService', () => ({
  joinQueue: ({ onMatched }) => { svc.onMatched = onMatched; return svc.cancel },
  watchMatch: (id, onChange) => { svc.onMatchChange = onChange; return svc.matchUnsub },
  submitAnswers: (matchId, answers) => {
    svc.submitted = { matchId, answers }
    return Promise.resolve(svc.submitResponse)
  },
}))

import DuelLive from './DuelLive'

const MATCH = {
  id: 'm1',
  players: ['me', 'them'],
  names: { me: 'Mulenga', them: 'Chipo' },
  state: 'active',
  scores: {},
  questions: [
    { question: '6 × 7 = ?', options: ['42', '36'], answer: '42' },
    { question: '8 × 5 = ?', options: ['30', '40'], answer: '40' },
  ],
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/games/duel/live']}>
      <Routes>
        <Route path="/games/duel/live" element={<DuelLive />} />
        <Route path="/games" element={<div>GAMES HUB</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useRealTimers()
  mockUser = { uid: 'me' }
  mockProfile = { displayName: 'Mulenga M', grade: 7, role: 'learner' }
  svc.cancel.mockClear()
  svc.matchUnsub.mockClear()
  svc.onMatched = null
  svc.onMatchChange = null
  svc.submitted = null
  svc.submitResponse = { done: true }
})

async function raceToEnd() {
  vi.useFakeTimers()
  mount()
  act(() => { svc.onMatched('m1') })
  act(() => { svc.onMatchChange(MATCH) })
  // VS countdown: 3 → 2 → 1 → GO → race. Each tick schedules the next
  // inside the state update, so the clock advances one step per act().
  for (let i = 0; i < 5; i += 1) act(() => { vi.advanceTimersByTime(1000) })
  expect(screen.getByText('6 × 7 = ?')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /42/ }))
  act(() => { vi.advanceTimersByTime(700) })
  fireEvent.click(screen.getByRole('button', { name: /30/ }))
  await act(async () => { vi.advanceTimersByTime(700); await Promise.resolve() })
  vi.useRealTimers()
}

describe('DuelLive', () => {
  it('invites sign-in instead of a queue nobody can join', () => {
    mockUser = null
    mount()
    expect(screen.getByText(/Sign in to race another learner/)).toBeInTheDocument()
  })

  it('cancelling the search leaves the queue', () => {
    mount()
    expect(screen.getByText('Finding an opponent…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(svc.cancel).toHaveBeenCalled()
    expect(screen.getByText('GAMES HUB')).toBeInTheDocument()
  })

  it('a match shows the VS screen with first names from the match doc', () => {
    mount()
    act(() => { svc.onMatched('m1') })
    act(() => { svc.onMatchChange(MATCH) })
    expect(screen.getByText('Chipo')).toBeInTheDocument()
    expect(screen.getByText(/server keeps score/)).toBeInTheDocument()
  })

  it('submits RAW answer indexes — never a score', async () => {
    await raceToEnd()
    expect(svc.submitted).toEqual({ matchId: 'm1', answers: [0, 0] })
    const sent = JSON.stringify(svc.submitted)
    expect(sent).not.toMatch(/score/i)
  })

  it('finishing first waits for the opponent instead of inventing their bar', async () => {
    svc.submitResponse = { done: false }
    await raceToEnd()
    expect(screen.getByText(/Chipo is still racing/)).toBeInTheDocument()
  })

  it('the result shows the SERVER’s graded scores and verdict', async () => {
    await raceToEnd()
    act(() => {
      svc.onMatchChange({
        ...MATCH,
        state: 'done',
        scores: { me: 10, them: 20 },
        winner: 'them',
        draw: false,
      })
    })
    await waitFor(() => expect(screen.getByText('Chipo takes it!')).toBeInTheDocument())
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
  })
})
