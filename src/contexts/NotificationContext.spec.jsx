/**
 * NotificationContext — account isolation across a session switch.
 *
 * Zambian households commonly share one handset between siblings, so "the
 * account changed while a read was in flight" is ordinary here, not an edge
 * case. This context had no spec at all while carrying two async reads that
 * resolve into shared state.
 *
 * The live onSnapshot listener IS torn down correctly on a uid change. What was
 * not covered is the pair of reads that outlive it:
 *   • the debounced unread COUNT (a 500ms timer whose callback closes over uid)
 *   • loadMore, which resolves with notification BODIES
 * clearTimeout only helps while a timer is pending; once fired, nothing recalls
 * the callback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.mock('../firebase/config', () => ({ db: {}, auth: {} }))
vi.mock('../services/notifications/fcm', () => ({ onForegroundMessage: () => () => {} }))
vi.mock('../shared/components/Toast', () => ({ useToast: () => vi.fn() }))

let mockUid
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
}))

// The live listener is not what this spec is about; keep it inert.
const unsubscribe = vi.fn()

// Resolve the aggregation by hand so a switch can be staged mid-flight.
let pendingCount
const getCountFromServer = vi.fn(() => new Promise((resolve) => { pendingCount = resolve }))

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ path: path.join('/') }),
  query: (ref) => ref,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  startAfter: () => ({}),
  onSnapshot: () => unsubscribe,
  getDocs: vi.fn(async () => ({ docs: [], size: 0 })),
  getCountFromServer: (...args) => getCountFromServer(...args),
  doc: () => ({}),
  writeBatch: () => ({ update: vi.fn(), commit: vi.fn() }),
  serverTimestamp: () => ({}),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
}))

const { NotificationProvider, useNotifications } = await import('./NotificationContext')

function UnreadProbe() {
  const { unreadCount } = useNotifications()
  return <span data-testid="unread">{unreadCount}</span>
}

const renderAt = (uid) => {
  mockUid = uid
  return render(<NotificationProvider><UnreadProbe /></NotificationProvider>)
}

describe('NotificationContext — account isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getCountFromServer.mockClear()
    pendingCount = undefined
    mockUid = 'child-a'
  })
  afterEach(() => { vi.useRealTimers() })

  it('counts unread for the signed-in account', async () => {
    renderAt('child-a')
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(getCountFromServer).toHaveBeenCalled()
    const [ref] = getCountFromServer.mock.calls[0]
    expect(ref.path).toContain('child-a')

    await act(async () => { pendingCount({ data: () => ({ count: 7 }) }) })
    expect(screen.getByTestId('unread').textContent).toBe('7')
  })

  // Pins EXISTING behaviour rather than the new guard: when uid changes the
  // effect re-runs and its cleanup clears the still-pending timer, so this
  // passes with or without the uid check. Kept because that cleanup is the
  // first line of defence and deleting it should fail something — but it is
  // not what makes the in-flight case below safe.
  it('does not issue a departed account\'s count query when the timer is still pending', async () => {
    const { rerender } = renderAt('child-a')
    // The switch happens BEFORE the debounce fires.
    mockUid = 'child-b'
    rerender(<NotificationProvider><UnreadProbe /></NotificationProvider>)
    await act(async () => { vi.advanceTimersByTime(600) })

    for (const [ref] of getCountFromServer.mock.calls) {
      expect(ref.path).not.toContain('child-a')
    }
  })

  it('never writes an in-flight count into the session that replaced it', async () => {
    const { rerender } = renderAt('child-a')
    // Let child-a's timer FIRE, so the query is genuinely in flight.
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(getCountFromServer).toHaveBeenCalled()

    // Now the handset changes hands, and only then does child-a's count land.
    mockUid = 'child-b'
    rerender(<NotificationProvider><UnreadProbe /></NotificationProvider>)
    await act(async () => { pendingCount({ data: () => ({ count: 99 }) }) })

    // child-a's 99 unread must not surface in child-b's session.
    expect(screen.getByTestId('unread').textContent).not.toBe('99')
  })
})
