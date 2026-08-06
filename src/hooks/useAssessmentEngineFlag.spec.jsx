/**
 * The binding — the half `flags.test.js` cannot see.
 *
 * The resolver is asserted under plain node against inputs handed to it. What
 * is left is whether the hook hands it the RIGHT inputs, and that is where the
 * interesting failures live: a hook that read a different visitor id, or that
 * kept a stale answer after the settings snapshot changed, would pass every
 * pure test in the suite while making the rollback toggle do nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ENGINE_FLAG_KEY } from '../engines/assessment-engine/flags.js'
import { useAssessmentEngineFlag } from './useAssessmentEngineFlag.js'

// Stable mock objects: a fresh object per call re-renders forever.
const platform = { settings: { featureFlags: {} }, loaded: true, live: true }
const auth = { currentUser: null }
vi.mock('../contexts/PlatformSettingsContext', () => ({ usePlatformSettings: () => platform }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }))

const setFlags = (config) => { platform.settings = { featureFlags: { [ENGINE_FLAG_KEY]: config } } }

beforeEach(() => {
  window.localStorage.clear()
  platform.settings = { featureFlags: {} }
  platform.loaded = true
  platform.live = true
  auth.currentUser = null
})

describe('useAssessmentEngineFlag', () => {
  it('is off by default — an empty settings document serves the old runner', () => {
    const { result } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(false)
    expect(result.current.source).toBe('runner-off')
    expect(result.current.runner).toBe('pastPaperQuiz')
  })

  it('turns on for a runner that is switched on and fully rolled out', () => {
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    const { result } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(true)
    expect(result.current.source).toBe('rollout-all')
  })

  it('leaves the other runners alone', () => {
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    expect(renderHook(() => useAssessmentEngineFlag('quiz')).result.current.engine).toBe(false)
    expect(renderHook(() => useAssessmentEngineFlag('game')).result.current.engine).toBe(false)
  })

  it('buckets on the SAME id the free-preview counter keys on', () => {
    // The whole reason the id moved into its own module. If the hook minted
    // its own, a visitor would be one person to the paywall and a different
    // person to the rollout — and nothing would ever say so.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 })
    renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(window.localStorage.getItem('zedexams:anonId')).toMatch(/^anon-/)
  })

  it('gives an anonymous visitor the same answer across renders', () => {
    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 })
    const first = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz')).result.current.engine
    for (let i = 0; i < 5; i += 1) {
      expect(renderHook(() => useAssessmentEngineFlag('pastPaperQuiz')).result.current.engine).toBe(first)
    }
  })

  it('buckets a signed-in visitor on their UID, not on the device', () => {
    // Decisive in both directions: at 50%, `learner-3` buckets to 10 (in) and
    // `learner-1` to 72 (out), while the seeded device id buckets the other
    // way each time. A hook that passed the device id would answer backwards
    // twice — and the account would get one runner on their phone and the
    // other on the family laptop, which is the version of this bug nobody
    // reports because it does not look like a bug.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 })

    window.localStorage.setItem('zedexams:anonId', 'anon-device-2') // bucket 87 — out
    auth.currentUser = { uid: 'learner-3' } // bucket 10 — in
    expect(renderHook(() => useAssessmentEngineFlag('pastPaperQuiz')).result.current.engine).toBe(true)

    window.localStorage.setItem('zedexams:anonId', 'anon-device-1') // bucket 6 — in
    auth.currentUser = { uid: 'learner-1' } // bucket 72 — out
    expect(renderHook(() => useAssessmentEngineFlag('pastPaperQuiz')).result.current.engine).toBe(false)
  })

  it('prefers the uid over the device id once signed in', () => {
    // Asserted through the allow-list, which only ever matches a uid: if the
    // hook passed the anon id as `uid`, this would not fire.
    auth.currentUser = { uid: 'staff-1' }
    setFlags({ pastPaperQuiz: true, rolloutUids: ['staff-1'] })
    const { result } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(true)
    expect(result.current.source).toBe('rollout-uid')
  })

  it('follows the live settings document — this IS the rollback', () => {
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(true)
    // What an admin flipping the toggle looks like from in here: a new
    // featureFlags object arrives on the snapshot.
    setFlags({ pastPaperQuiz: false, rolloutPercent: 100 })
    rerender()
    expect(result.current.engine).toBe(false)
    expect(result.current.source).toBe('runner-off')
  })

  it('reports whether the decision is final, and is fail-closed until it is', () => {
    // A cold load answers "old runner" before the snapshot arrives. That answer
    // is correct and must not be mounted on: `resolved` is how a consumer
    // avoids swapping the runner out from under a learner mid-question.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    platform.loaded = false
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.resolved).toBe(false)
    platform.loaded = true
    rerender()
    expect(result.current.resolved).toBe(true)
  })

  it('fails closed once the settings read has DIED', () => {
    // The rollback's safety argument is that flipping a runner off reverts
    // every client within seconds. Firestore never resumes a listener after
    // `onError`, so a client that kept its last snapshot would hold an enabled
    // rollout until it reloaded — unreachable by the toggle, silently, on
    // exactly the client already having a bad time.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(true)

    platform.live = false
    rerender()
    expect(result.current.engine).toBe(false)
    expect(result.current.source).toBe('runner-off')
    // Reported, not merely acted on: a client that lost its read and one the
    // flag legitimately excluded look identical in an event stream otherwise.
    expect(result.current.live).toBe(false)
  })

  it('reports a live read as live', () => {
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    expect(renderHook(() => useAssessmentEngineFlag('pastPaperQuiz')).result.current.live).toBe(true)
  })

  it('a runner name that does not exist is off, not a crash', () => {
    setFlags({ dailyQuiz: true, rolloutPercent: 100 })
    const { result } = renderHook(() => useAssessmentEngineFlag('dailyQuiz'))
    expect(result.current.engine).toBe(false)
    expect(result.current.source).toBe('unknown-runner')
  })
})
