import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { StrictMode, useRef } from 'react'
import { useActiveAssignmentContext } from './useActiveAssignmentContext'

// ── Mocks ─────────────────────────────────────────────────────────────────────
// The whole point of this regression test is to reproduce the production
// condition that crashed the Lesson Plan Studio: useTeachingProfile handing back
// a FRESH `context` object identity on every render while an active assignment
// exists. Before the fix, useActiveAssignmentContext's effect depended on the
// whole `tp.context` object and its async resolution wrote a brand-new `seed`
// object every run — so each render invalidated the effect, the effect wrote new
// state, and the write forced the next render: "Maximum update depth exceeded".

const ACTIVE_ASSIGNMENT = {
  id: 'a1',
  isActive: true,
  grade: 'G4',
  subject: 'science',
  curriculumType: 'cbc',
  className: '4 Blue',
}

// A fresh context object on EVERY call — mirrors the real resolveTeachingContext,
// which builds a new object literal each time. The values are stable; only the
// object identity churns.
function freshContext() {
  return { status: 'ok', weekBeginning: '2026-07-13', termClose: '2026-12-04' }
}

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ currentUser: { uid: 'uid-1' } })),
}))

vi.mock('../../teacherSettings/lib/useTeachingProfile', () => ({
  useTeachingProfile: vi.fn(() => ({
    loading: false,
    assignments: [ACTIVE_ASSIGNMENT],
    context: freshContext(), // ← new identity every render (the production trigger)
    effectiveDefaultId: 'a1',
  })),
}))

vi.mock('../../../shared/utils/curriculumDataService.js', () => ({
  getSubjectsForGrade: vi.fn(() => Promise.resolve(['science'])),
}))

let captured
let renderCount = 0

function Harness() {
  const counter = useRef(0)
  counter.current += 1
  renderCount = counter.current
  captured = useActiveAssignmentContext()
  return null
}

describe('useActiveAssignmentContext — render-loop regression', () => {
  beforeEach(() => {
    captured = undefined
    renderCount = 0
    vi.clearAllMocks()
  })

  it('settles to a stable seed even when the teaching-profile context identity churns every render', async () => {
    // If the loop regressed, render() itself throws "Maximum update depth
    // exceeded" — so a clean render + settled seed is the assertion.
    expect(() => render(<Harness />)).not.toThrow()

    await waitFor(() => expect(captured.seed).toBeTruthy())

    expect(captured.seed).toMatchObject({
      grade: 'Grade 4',
      subject: 'science',
      curriculumMode: 'cbc',
    })

    // Bounded render count proves the effect is no longer self-perpetuating.
    // (A loop would have blown past React's ~25-render cap before this line.)
    const settledRenders = renderCount
    expect(settledRenders).toBeLessThan(15)

    // The resolved seed keeps a STABLE reference once settled: a further async
    // tick (e.g. a context tick) that resolves an equivalent seed must NOT mint a
    // new object, or the parent's `[assignmentContext.seed]` effect would refire.
    const seedRef = captured.seed
    await act(async () => { await Promise.resolve() })
    expect(captured.seed).toBe(seedRef)
  })

  it('remains stable under React StrictMode (double-invoked effects)', async () => {
    let strictCaptured
    function StrictHarness() {
      strictCaptured = useActiveAssignmentContext()
      return null
    }

    expect(() =>
      render(
        <StrictMode>
          <StrictHarness />
        </StrictMode>,
      ),
    ).not.toThrow()

    await waitFor(() => expect(strictCaptured.seed).toBeTruthy())
    expect(strictCaptured.seed).toMatchObject({ grade: 'Grade 4', curriculumMode: 'cbc' })
  })
})
