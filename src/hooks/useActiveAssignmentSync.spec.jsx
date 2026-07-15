import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { ActiveAssignmentSync } from './useActiveAssignmentSync'
import { REMOTE_ACTIVE_ASSIGNMENT_EVENT } from '../utils/activeAssignmentSyncCore'

// Firestore fully mocked: onSnapshot hands us its callback so tests can fire
// profile snapshots; getDoc serves the assignment doc. No firebase/config
// import ever reaches jsdom.
const fb = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  getDoc: vi.fn(),
  doc: vi.fn((_db, ...path) => ({ path: path.join('/') })),
  unsubscribe: vi.fn(),
  fireSnapshot: null, // set by the onSnapshot mock
  auth: { currentUser: { uid: 'u1' }, isTeacher: true },
}))
vi.mock('firebase/firestore', () => ({
  doc: fb.doc,
  getDoc: fb.getDoc,
  onSnapshot: fb.onSnapshot,
}))
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => fb.auth }))

const PREP_KEY = 'zedexams:prep-assignment:u1'
const SEED_KEY = 'zedexams:active-seed:u1'

function profileSnap(activeAssignmentId) {
  return { exists: () => true, data: () => ({ activeAssignmentId }) }
}
function assignmentSnap(data) {
  return data
    ? { exists: () => true, id: 'x', data: () => data }
    : { exists: () => false, id: 'x', data: () => undefined }
}

describe('ActiveAssignmentSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    fb.auth = { currentUser: { uid: 'u1' }, isTeacher: true }
    fb.onSnapshot.mockImplementation((_ref, next) => {
      fb.fireSnapshot = next
      return fb.unsubscribe
    })
  })

  it('adopts a valid remote change: local caches update and the notice event fires', async () => {
    localStorage.setItem(PREP_KEY, 'a1')
    fb.getDoc.mockResolvedValue(assignmentSnap({ grade: 'G5', subject: 'mathematics', curriculumType: 'cbc', isActive: true }))
    const events = []
    const onEvent = (e) => events.push(e.detail)
    window.addEventListener(REMOTE_ACTIVE_ASSIGNMENT_EVENT, onEvent)
    try {
      render(<ActiveAssignmentSync />)
      expect(fb.onSnapshot).toHaveBeenCalledTimes(1)
      act(() => { fb.fireSnapshot(profileSnap('a2')) })
      await waitFor(() => expect(localStorage.getItem(PREP_KEY)).toBe('a2'))
      // Validated against the real assignment doc (owner-scoped path).
      expect(fb.getDoc).toHaveBeenCalledTimes(1)
      expect(fb.doc).toHaveBeenCalledWith({}, 'teacherProfiles', 'u1', 'teachingAssignments', 'a2')
      // The studio seed mirrors the adopted assignment.
      expect(JSON.parse(localStorage.getItem(SEED_KEY))).toEqual({ curriculum: 'cbc', grade: 'G5', subject: 'mathematics' })
      // Same-tab notice event carries the seed — studios notify, never mutate.
      expect(events).toEqual([{ uid: 'u1', seed: { curriculum: 'cbc', grade: 'G5', subject: 'mathematics' } }])
    } finally {
      window.removeEventListener(REMOTE_ACTIVE_ASSIGNMENT_EVENT, onEvent)
    }
  })

  it("stays silent on this device's own echo (remote id equals the local pick)", async () => {
    localStorage.setItem(PREP_KEY, 'a1')
    render(<ActiveAssignmentSync />)
    act(() => { fb.fireSnapshot(profileSnap('a1')) })
    // No validation read, no cache change.
    await act(async () => {})
    expect(fb.getDoc).not.toHaveBeenCalled()
    expect(localStorage.getItem(PREP_KEY)).toBe('a1')
  })

  it('never adopts a dangling or deactivated assignment reference', async () => {
    localStorage.setItem(PREP_KEY, 'a1')
    fb.getDoc.mockResolvedValue(assignmentSnap({ grade: 'G5', subject: 'mathematics', isActive: false }))
    render(<ActiveAssignmentSync />)
    act(() => { fb.fireSnapshot(profileSnap('a2')) })
    await waitFor(() => expect(fb.getDoc).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(localStorage.getItem(PREP_KEY)).toBe('a1')
    expect(localStorage.getItem(SEED_KEY)).toBeNull()
  })

  it('a failed validation read leaves local state untouched (offline-safe)', async () => {
    localStorage.setItem(PREP_KEY, 'a1')
    fb.getDoc.mockRejectedValue(new Error('offline'))
    render(<ActiveAssignmentSync />)
    act(() => { fb.fireSnapshot(profileSnap('a2')) })
    await waitFor(() => expect(fb.getDoc).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(localStorage.getItem(PREP_KEY)).toBe('a1')
  })

  it('unsubscribes on unmount (sign-out cleanup path)', () => {
    const { unmount } = render(<ActiveAssignmentSync />)
    expect(fb.onSnapshot).toHaveBeenCalledTimes(1)
    unmount()
    expect(fb.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not subscribe at all for non-teachers or signed-out users', () => {
    fb.auth = { currentUser: { uid: 'u1' }, isTeacher: false }
    const { unmount } = render(<ActiveAssignmentSync />)
    unmount()
    fb.auth = { currentUser: null, isTeacher: false }
    render(<ActiveAssignmentSync />)
    expect(fb.onSnapshot).not.toHaveBeenCalled()
  })
})
