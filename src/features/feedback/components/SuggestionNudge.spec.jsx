import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { useAuth } from '../../../contexts/AuthContext'
import SuggestionNudge from './SuggestionNudge.jsx'

// Mock auth so the nudge has a uid to key its cooldown on, and stub the dialog
// (it pulls in firebase) — we only care about the nudge's show/dismiss logic.
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('./FeedbackDialog', () => ({
  default: ({ open }) => (open ? <div data-testid="feedback-dialog" /> : null),
}))

const SHOW_DELAY_MS = 6000
const STORAGE_KEY = 'zedexams:suggest-nudge:teacher-1'

function setAuth(uid) {
  useAuth.mockReturnValue({ currentUser: uid ? { uid } : null })
}

describe('SuggestionNudge', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    setAuth('teacher-1')
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('stays hidden until the show delay elapses, then appears', () => {
    render(<SuggestionNudge source="teacher-dashboard" />)
    expect(screen.queryByText(/have an idea or a request/i)).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(SHOW_DELAY_MS) })
    expect(screen.getByText(/have an idea or a request/i)).toBeInTheDocument()
  })

  it('hides and remembers the dismissal so it is quiet within the cooldown', () => {
    const { unmount } = render(<SuggestionNudge source="teacher-dashboard" />)
    act(() => { vi.advanceTimersByTime(SHOW_DELAY_MS) })
    fireEvent.click(screen.getByLabelText(/dismiss/i))
    expect(screen.queryByText(/have an idea or a request/i)).not.toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy()

    // Re-mounting within the cooldown window: never shows again.
    unmount()
    render(<SuggestionNudge source="teacher-dashboard" />)
    act(() => { vi.advanceTimersByTime(SHOW_DELAY_MS) })
    expect(screen.queryByText(/have an idea or a request/i)).not.toBeInTheDocument()
  })

  it('opens the dialog from the Suggest button and remembers it', () => {
    render(<SuggestionNudge source="teacher-dashboard" />)
    act(() => { vi.advanceTimersByTime(SHOW_DELAY_MS) })
    fireEvent.click(screen.getByRole('button', { name: /suggest/i }))
    expect(screen.getByTestId('feedback-dialog')).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy()
  })

  it('does nothing without a signed-in user', () => {
    setAuth(null)
    render(<SuggestionNudge source="teacher-dashboard" />)
    act(() => { vi.advanceTimersByTime(SHOW_DELAY_MS) })
    expect(screen.queryByText(/have an idea or a request/i)).not.toBeInTheDocument()
  })
})
