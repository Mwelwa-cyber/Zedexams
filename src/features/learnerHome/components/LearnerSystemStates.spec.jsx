/**
 * PROMPT 10b system states — the shell's connectivity chrome and the
 * layout's error boundary. What needs a DOM here is the promises:
 * the offline badge appears only when the browser is actually offline,
 * the "Back online" toast fires only on a real offline→online
 * transition (being online is not news), and a page that crashes shows
 * the prototype's error card INSIDE the chrome — navigation still
 * mounted, Try again and Go to Home both live.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
// The shell reads the profile for one thing only — telling the tab bar who it
// is drawing for, so a teacher on the public /papers route is not offered a
// Home tab that refuses them. A signed-out visitor is the neutral case for
// every assertion in this file, and gets the full four tabs.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, userProfile: null }),
}))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../utils/swRecovery', () => ({
  isChunkLoadError: () => false,
  recoverFromChunkError: vi.fn(),
}))

import LearnerShell from './LearnerShell'
import LearnerLayout from './LearnerLayout'

function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

function goOffline() {
  setNavigatorOnline(false)
  fireEvent(window, new Event('offline'))
}

function goOnline() {
  setNavigatorOnline(true)
  fireEvent(window, new Event('online'))
}

beforeEach(() => setNavigatorOnline(true))
afterEach(() => setNavigatorOnline(true))

function mountShell() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <LearnerShell><div>PAGE</div></LearnerShell>
    </MemoryRouter>,
  )
}

describe('LearnerShell connectivity states', () => {
  it('shows the offline badge only while actually offline', () => {
    mountShell()
    expect(screen.queryByText(/You’re offline/)).toBeNull()
    act(() => goOffline())
    expect(screen.getByText(/You’re offline/)).toBeInTheDocument()
    act(() => goOnline())
    expect(screen.queryByText(/You’re offline/)).toBeNull()
  })

  it('toasts "Back online" only after a real offline→online transition', () => {
    vi.useFakeTimers()
    try {
      mountShell()
      // Being online on mount is the normal state, not news.
      expect(screen.queryByText(/Back online/)).toBeNull()
      act(() => goOffline())
      expect(screen.queryByText(/Back online/)).toBeNull()
      act(() => goOnline())
      expect(screen.getByText(/Back online/)).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(4500))
      expect(screen.queryByText(/Back online/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('LearnerLayout error boundary', () => {
  let shouldThrow

  function Bomb() {
    if (shouldThrow) throw new Error('boom')
    return <div>RECOVERED PAGE</div>
  }

  function mountWithBomb() {
    return render(
      <MemoryRouter initialEntries={['/quizzes']}>
        <Routes>
          <Route element={<LearnerLayout />}>
            <Route path="/quizzes" element={<Bomb />} />
            <Route path="/dashboard" element={<div>HOME PAGE</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  }

  beforeEach(() => {
    shouldThrow = true
    // The boundary logs the caught error; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('shows the error card inside the chrome, navigation still mounted', () => {
    mountWithBomb()
    expect(screen.getByText('Oops — something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/your progress is safe/)).toBeInTheDocument()
    // The 4-tab navigation survives the crash.
    expect(screen.getByRole('link', { name: /Home/ })).toBeInTheDocument()
  })

  it('Try again re-renders the page', () => {
    mountWithBomb()
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(screen.getByText('RECOVERED PAGE')).toBeInTheDocument()
  })

  it('Go to Home leaves the broken page and recovers', () => {
    mountWithBomb()
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }))
    expect(screen.getByText('HOME PAGE')).toBeInTheDocument()
    expect(screen.queryByText('Oops — something went wrong')).toBeNull()
  })
})
