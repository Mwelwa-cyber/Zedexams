/**
 * Regression tests for the teacher-facing failure copy in teacherTools.js.
 *
 * Root cause this pins: withTimeout() threw a message containing our deploy
 * checklist ("Client-side timeout: … 'firebase functions:list' … ANTHROPIC_API_KEY
 * secret is set …") and messageFromError() had no branch for `client-timeout`,
 * so it fell through to `return detail` and rendered that verbatim to teachers.
 * The ordinary Firebase callable timeout surfaced as the bare code string
 * "deadline-exceeded". On Zambian mobile data both are the normal failure mode,
 * not an edge case.
 *
 * Second defect pinned here: every fallback said "lesson plan" regardless of
 * studio, so the Worksheet studio told teachers "Please sign in to generate a
 * lesson plan."
 *
 * These drive the REAL exported generators (not a private helper) so the whole
 * callable → withTimeout → messageFromError path is covered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// One shared mock per callable name, so a test can decide how a given
// generator fails. httpsCallable runs at module load for ~14 callables, which
// is before the spec body — hence vi.hoisted.
const callables = vi.hoisted(() => ({}))
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: (_fns, name) => {
    callables[name] = callables[name] || vi.fn()
    return (...args) => callables[name](...args)
  },
}))
vi.mock('../firebase/config', () => ({
  default: {},
  auth: { currentUser: { uid: 'teacher-1' } },
  getAppCheckToken: vi.fn().mockResolvedValue(null),
}))
vi.mock('./runtime', () => ({
  apiUrl: (p) => `https://example.test${p}`,
  isNativePlatform: () => false,
}))

import { generateNotes, generateWorksheet, generateSchemeOfWork } from './teacherTools'

function reject(name, error) {
  callables[name].mockRejectedValue(error)
}

function fbError(code, message) {
  const err = new Error(message ?? code)
  err.code = code
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  // Silence the diagnostic console.error the timeout path now emits for us.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('teacherTools — timeout copy never leaks developer instructions', () => {
  it('a callable deadline-exceeded reads as friendly copy, not the bare code', async () => {
    reject('generateNotes', fbError('functions/deadline-exceeded', 'deadline-exceeded'))

    const res = await generateNotes({ grade: '4', subject: 'Mathematics' })

    expect(res.ok).toBe(false)
    expect(res.error).not.toBe('deadline-exceeded')
    expect(res.error).toMatch(/longer than usual/i)
  })

  it('the client-side timeout message carries no deploy checklist', async () => {
    vi.useFakeTimers()
    try {
      // Never resolves → withTimeout's own timer fires.
      callables.generateNotes.mockReturnValue(new Promise(() => {}))
      const pending = generateNotes({ grade: '4', subject: 'Mathematics' })
      await vi.advanceTimersByTimeAsync(140_000)
      const res = await pending

      expect(res.ok).toBe(false)
      expect(res.error).not.toMatch(/firebase functions:list/i)
      expect(res.error).not.toMatch(/ANTHROPIC_API_KEY/)
      expect(res.error).not.toMatch(/Cloud Function/i)
      expect(res.error).not.toMatch(/teacher\/admin/i)
      expect(res.error).toMatch(/longer than usual/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an offline/unavailable failure is mapped, not echoed raw', async () => {
    reject('generateWorksheet', fbError('functions/unavailable', 'UNAVAILABLE: connection error'))

    const res = await generateWorksheet({ grade: '4', subject: 'Mathematics' })

    expect(res.ok).toBe(false)
    expect(res.error).not.toMatch(/UNAVAILABLE/)
  })
})

describe('teacherTools — failure copy names the tool the teacher is using', () => {
  it('the worksheet studio never says "lesson plan"', async () => {
    reject('generateWorksheet', fbError('functions/unauthenticated'))

    const res = await generateWorksheet({ grade: '4', subject: 'Mathematics' })

    expect(res.error).toBe('Please sign in to generate a worksheet.')
    expect(res.error).not.toMatch(/lesson plan/i)
  })

  it('the scheme studio names the scheme of work', async () => {
    reject('generateSchemeOfWork', fbError('functions/unauthenticated'))

    const res = await generateSchemeOfWork({ grade: '4', subject: 'Mathematics', term: 1 })

    expect(res.error).toBe('Please sign in to generate a scheme of work.')
  })

  it('an unclassifiable failure falls back to the tool-specific sentence', async () => {
    // No recognisable code and no message → friendlyMessage can't classify it,
    // so our own fallback sentence is used, named for THIS tool.
    reject('generateSchemeOfWork', new Error(''))

    const res = await generateSchemeOfWork({ grade: '4', subject: 'Mathematics', term: 1 })

    expect(res.error).toBe(
      'The scheme of work generator is unavailable right now. Please try again.',
    )
  })
})
