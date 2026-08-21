/**
 * Spelling Ride, as a learner meets it.
 *
 * WHAT THIS SUITE CAN AND CANNOT SEE. The road is a canvas and jsdom has no 2D
 * context at all, so the renderer is mocked and nothing here asserts a pixel.
 * That is the right split rather than a limitation worked around: the pacing,
 * the three-lane invariant, the distractors and the repetition are properties
 * of `spellingRideCore`, which `test:spelling-ride` drives directly under plain
 * node and over a full nine-town ride. What is left for jsdom is the part only
 * a DOM can answer — what a learner is offered, what they are told, and what
 * the buttons do.
 *
 * The speech module is mocked with spies rather than left real, because the
 * assertions that matter are about WHEN a word is spoken (on presentation, on
 * the speaker button, and as a word-then-letters correction after a miss) and
 * jsdom's absence of `speechSynthesis` would make all three vacuously true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'learner-1', displayName: 'Chanda' },
    userProfile: { grade: 7 },
  }),
}))
vi.mock('../services/gamesService', () => ({
  saveScore: vi.fn(async () => ({ ok: true, id: 'score-1' })),
  reportGameStart: vi.fn(),
  readRoundBaseline: vi.fn(async () => ({})),
  readRoundOutcome: vi.fn(async () => ({ levelChange: null, personalBest: null })),
}))
vi.mock('../../../utils/gameBadgesService', () => ({
  evaluateAndAwardGameBadges: vi.fn(async () => ({ newlyEarned: [] })),
}))
vi.mock('../../../utils/dailyChallengeService', () => ({
  getTodaysChallenge: vi.fn(async () => ({ game: null })),
  recordDailyPlay: vi.fn(async () => ({ isDaily: false })),
}))
vi.mock('../lib/gameSounds', () => ({
  playCorrect: vi.fn(), playWrong: vi.fn(), playWin: vi.fn(), primeSounds: vi.fn(),
  haptic: vi.fn(), isMuted: vi.fn(() => false), toggleMute: vi.fn(() => true),
}))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../services/spellingContentService', () => ({ listApprovedWords: vi.fn(async () => []) }))
vi.mock('../services/spellingSentenceService', () => ({ listApprovedSentences: vi.fn(async () => []) }))

const speech = vi.hoisted(() => ({
  speakWord: vi.fn(),
  speakSentence: vi.fn(() => true),
  speakWordThenLetters: vi.fn(() => true),
  primeSpeech: vi.fn(),
  stopSpeech: vi.fn(),
  speechAvailable: vi.fn(() => true),
  // Warming is the ride's latency fix, not its behaviour: the doubles resolve
  // so the `.then()` chains that follow them run, and the ride is asserted on
  // what it SAYS, which is `speakWord`'s business either way.
  warmWord: vi.fn(async () => true),
  warmWords: vi.fn(async () => {}),
}))
vi.mock('../lib/spellingSpeech', () => speech)

// jsdom's <canvas> has no 2D context, so the renderer is a spy double. Its
// shape is pinned here on purpose: if the engine starts calling something the
// double does not have, this fails rather than the game failing on a phone.
const renderer = vi.hoisted(() => ({
  resize: vi.fn(),
  setNight: vi.fn(),
  draw: vi.fn(),
  burst: vi.fn(),
  stepParticles: vi.fn(),
  geometry: { width: 390, height: 700, riderY: 560, vanishY: 264, roadTopY: 300, resolveY: 550 },
  LANE_SPARK: { good: '#0f0', bad: '#f00', gold: '#fc0' },
}))
vi.mock('../lib/spellingRideRender', () => ({ createRideRenderer: vi.fn(() => renderer) }))

let store = null
vi.mock('../services/spellingProgressService', () => ({
  loadSpellingProgress: vi.fn(async () => ({
    progress: store || { stars: {}, pool: {}, rideBests: {}, stagesPlayed: 0, settledRuns: [], resume: null, updatedAtMs: 0 },
    synced: true,
  })),
  saveSpellingProgress: vi.fn(async (_id, progress) => { store = progress; return true }),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const { default: SpellingRideGame } = await import('./SpellingRideGame')

const GAME = {
  id: 'english_spelling_ride_g7',
  title: 'Spelling Ride',
  subject: 'english',
  grade: 7,
  type: 'spelling_ride',
  wordPack: 'grade7-spelling',
  questions: [],
}

function mount() {
  return render(<MemoryRouter><SpellingRideGame game={GAME} /></MemoryRouter>)
}

async function reachMenu() {
  mount()
  await screen.findByText('Pick a mode')
}

beforeEach(() => {
  store = null
  navigate.mockClear()
  Object.values(speech).forEach((fn) => fn.mockClear())
  window.localStorage.clear()
})

describe('the menu', () => {
  it('offers all three modes and all three speeds', async () => {
    await reachMenu()
    for (const name of ['Spell It', 'Dictation', 'Word Choice']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    for (const name of ['Easy', 'Medium', 'Hard']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument()
    }
  })

  it('starts with the voice ON, because a silent spelling game is a matching puzzle', async () => {
    await reachMenu()
    expect(screen.getByRole('button', { name: /Voice on/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('turning the voice off stops whatever is being said, and says what changes', async () => {
    await reachMenu()
    fireEvent.click(screen.getByRole('button', { name: /Voice on/ }))
    const off = await screen.findByRole('button', { name: /Voice off/ })
    expect(off).toHaveAttribute('aria-pressed', 'false')
    expect(speech.stopSpeech).toHaveBeenCalled()
    // The learner is told Dictation still works — the mode must not become
    // unplayable, only harder.
    expect(off).toHaveTextContent(/Dictation still shows each word/)
  })

  it('remembers the mode and speed for next time', async () => {
    const first = mount()
    await screen.findByText('Pick a mode')
    fireEvent.click(screen.getByText('Dictation'))
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }))
    first.unmount()

    mount()
    await screen.findByText('Pick a mode')
    expect(screen.getByRole('button', { name: /Hard/ })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('the ride', () => {
  async function startRiding() {
    await reachMenu()
    fireEvent.click(screen.getByRole('button', { name: /START RIDING/ }))
    await screen.findByRole('button', { name: 'End the ride' })
  }

  it('primes speech inside the tap that starts it, or iOS never speaks at all', async () => {
    await startRiding()
    expect(speech.primeSpeech).toHaveBeenCalled()
  })

  it('shows five bike parts and a speaker the learner can reach at any time', async () => {
    await startRiding()
    expect(screen.getByLabelText('5 of 5 bike parts left')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hear it again' })).toBeInTheDocument()
  })

  it('the road is drawn into a canvas the learner can tap to pick a lane', async () => {
    await startRiding()
    const canvas = screen.getByLabelText(/Tap the left, middle or right/)
    expect(canvas.tagName).toBe('CANVAS')
    expect(renderer.resize).toHaveBeenCalled()
  })

  it('speaks the word as it comes up, and again on the speaker button', async () => {
    await startRiding()
    await waitFor(() => expect(speech.speakWord).toHaveBeenCalled())
    speech.speakWord.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Hear it again' }))
    expect(speech.speakWord).toHaveBeenCalled()
  })

  it('ending the ride goes to the results, never back to a blank screen', async () => {
    await startRiding()
    fireEvent.click(screen.getByRole('button', { name: 'End the ride' }))
    await screen.findByText(/Ride finished|New best score/)
    expect(screen.getByRole('button', { name: /RIDE AGAIN/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /See the word report/ })).toBeInTheDocument()
  })

  it('the report is reachable from the results and offers a CSV', async () => {
    await startRiding()
    fireEvent.click(screen.getByRole('button', { name: 'End the ride' }))
    fireEvent.click(await screen.findByRole('button', { name: /See the word report/ }))
    expect(await screen.findByText('Needs work')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download this report/ })).toBeInTheDocument()
    // A ride ended before a single letter was answered has nothing to report,
    // and says so warmly rather than rendering an empty list.
    expect(screen.getByText(/Nothing missed on this ride/)).toBeInTheDocument()
  })

  it('leaving the game stops the voice rather than talking over the next screen', async () => {
    await reachMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Back to games' }))
    expect(speech.stopSpeech).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/games')
  })
})
