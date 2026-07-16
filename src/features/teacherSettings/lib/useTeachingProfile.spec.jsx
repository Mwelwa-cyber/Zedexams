import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { useTeachingProfile } from './useTeachingProfile'

// ── Service mocks ─────────────────────────────────────────────────────────────
// The hook loads profile + assignments once, best-effort. We resolve stable
// (referentially unchanging) data so any identity churn the test observes comes
// from the hook's own derivations, not from new mock return values.
const STABLE_PROFILE = { calendarId: 'moe-2026', academicYear: 2026 }
const STABLE_ASSIGNMENTS = [{ id: 'a1', isActive: true, grade: 'G4', subject: 'science' }]

vi.mock('../../../utils/teachingProfileService', () => ({
  getTeachingProfile: vi.fn(() => Promise.resolve(STABLE_PROFILE)),
  listAssignments: vi.fn(() => Promise.resolve(STABLE_ASSIGNMENTS)),
}))

vi.mock('../../../utils/teacherLibraryService', () => ({
  hasGenerationOfTool: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ currentUser: { uid: 'uid-1' }, userProfile: { school: 'X' } })),
}))

// Capture the hook's return + a forced re-render trigger.
let captured
let forceRerender

function Harness() {
  const [, setTick] = useState(0)
  forceRerender = () => setTick((n) => n + 1)
  captured = useTeachingProfile()
  return null
}

describe('useTeachingProfile — derived-value identity stability (render-loop guard)', () => {
  beforeEach(() => {
    captured = undefined
    forceRerender = undefined
  })

  it('returns the SAME context object reference across renders when the profile is unchanged', async () => {
    render(<Harness />)
    // Let the async load settle so `profile` state is populated.
    await waitFor(() => expect(captured.loading).toBe(false))

    const contextBefore = captured.context
    const profileBefore = captured.profile
    expect(contextBefore).toBeTruthy()

    // Force several re-renders with no state change to the underlying profile.
    for (let i = 0; i < 5; i++) {
      act(() => forceRerender())
    }

    // Memoisation must keep the identities stable — an unstable `context` fed the
    // production "Maximum update depth exceeded" loop in useActiveAssignmentContext.
    expect(captured.context).toBe(contextBefore)
    expect(captured.profile).toBe(profileBefore)
  })
})
