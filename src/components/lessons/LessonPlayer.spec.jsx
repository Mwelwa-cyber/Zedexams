/**
 * Behaviour tests for LessonPlayer read-aloud (Web Speech API).
 *
 * The "Read Aloud" button used to only toast "coming soon"; it now narrates
 * the active slide via SpeechSynthesis. These cover the wiring: it speaks the
 * slide text and flips to "Stop", stops on a second press, cancels when the
 * learner navigates away, and degrades gracefully where speech is unsupported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const mockGetLessonById = vi.fn()
vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({ getLessonById: mockGetLessonById }),
}))

// AuthContext initialises Firebase at import time; stub it. The player only
// reads currentUser.uid to scope its saved-progress localStorage key.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1' } }),
}))

const mockToastInfo = vi.fn()
vi.mock('../ui/Toast', () => ({ useToast: () => ({ info: mockToastInfo, error: vi.fn(), success: vi.fn() }) }))

// Heavy / unrelated leaves.
vi.mock('./SlideRenderer', () => ({ default: () => null }))
vi.mock('./LessonCompleteScreen', () => ({ default: () => null }))
vi.mock('./PowerPointViewerPlayer', () => ({ default: () => null }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ lessonId: 'lesson-1' }) }
})

import LessonPlayer from './LessonPlayer'

const LESSON = {
  title: 'Fractions', grade: 5, subject: 'Mathematics', topic: 'Fractions',
  slides: [
    { type: 'text', title: 'Intro', body: 'A fraction is a part of a whole.' },
    { type: 'text', title: 'More', body: 'Halves and quarters.' },
  ],
}

let speak, cancel

function installSpeech() {
  speak = vi.fn()
  cancel = vi.fn()
  window.speechSynthesis = { speak, cancel }
  global.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text }
  }
}

async function renderPlayer() {
  render(<MemoryRouter><LessonPlayer /></MemoryRouter>)
  // Wait for the async lesson load to resolve into the player toolbar.
  return screen.findByRole('button', { name: /Read Aloud/i })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockGetLessonById.mockResolvedValue(LESSON)
  installSpeech()
})

afterEach(() => {
  delete window.speechSynthesis
  delete global.SpeechSynthesisUtterance
})

describe('LessonPlayer — read aloud', () => {
  it('narrates the active slide and flips the button to "Stop"', async () => {
    const btn = await renderPlayer()
    fireEvent.click(btn)
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0][0].text).toContain('Intro')
    expect(speak.mock.calls[0][0].text).toContain('A fraction is a part of a whole')
    expect(await screen.findByRole('button', { name: /Stop/i })).toBeInTheDocument()
  })

  it('stops narration on a second press', async () => {
    const btn = await renderPlayer()
    fireEvent.click(btn)
    const stopBtn = await screen.findByRole('button', { name: /Stop/i })
    fireEvent.click(stopBtn)
    expect(cancel).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /Read Aloud/i })).toBeInTheDocument()
  })

  it('stops narration when the learner navigates to another slide', async () => {
    const btn = await renderPlayer()
    fireEvent.click(btn)
    await screen.findByRole('button', { name: /Stop/i })
    cancel.mockClear()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(cancel).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /Read Aloud/i })).toBeInTheDocument()
  })

  it('degrades gracefully when SpeechSynthesis is unavailable', async () => {
    delete window.speechSynthesis
    const btn = await renderPlayer()
    fireEvent.click(btn)
    expect(mockToastInfo).toHaveBeenCalledWith('Read-aloud is not supported on this browser.')
  })
})

describe('LessonPlayer — resume progress', () => {
  const KEY = 'examprep:lesson:progress:lesson-1:learner-1'

  it('resumes at the saved slide instead of restarting at slide 1', async () => {
    localStorage.setItem(KEY, JSON.stringify({ index: 1, complete: false }))
    render(<MemoryRouter><LessonPlayer /></MemoryRouter>)
    // Counter reads "2 / N" — the learner picks up where they left off.
    expect(await screen.findByText(/^2 \/ \d+$/)).toBeInTheDocument()
  })

  it('starts a fresh lesson at slide 1 when no progress is saved', async () => {
    render(<MemoryRouter><LessonPlayer /></MemoryRouter>)
    expect(await screen.findByText(/^1 \/ \d+$/)).toBeInTheDocument()
  })

  it('persists the current slide as the learner advances', async () => {
    render(<MemoryRouter><LessonPlayer /></MemoryRouter>)
    await screen.findByText(/^1 \/ \d+$/)
    // The counter reaching the DOM does NOT mean the ArrowRight listener is
    // attached: it is registered in a passive effect, which React flushes
    // after the commit that findByText observes. Firing the key into that gap
    // dropped it outright — no listener, no navigation, index stays 0 — which
    // is the "expected +0 to be 1" this test failed with on ~25% of runs.
    // The first progress write is the proof we can actually observe: it
    // happens in the commit AFTER the one that attaches the listener (the
    // write is gated on `hydrated`, set by an earlier effect), so a saved key
    // means that earlier commit's effects have run and the listener is live.
    await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull())
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
      expect(saved.index).toBe(1)
    })
  })
})
