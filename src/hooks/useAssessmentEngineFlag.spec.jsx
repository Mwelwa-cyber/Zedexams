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
const auth = { currentUser: null, loading: false, authSettled: true }
vi.mock('../contexts/PlatformSettingsContext', () => ({ usePlatformSettings: () => platform }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }))

const setFlags = (config) => { platform.settings = { featureFlags: { [ENGINE_FLAG_KEY]: config } } }

beforeEach(() => {
  window.localStorage.clear()
  platform.settings = { featureFlags: {} }
  platform.loaded = true
  platform.live = true
  auth.currentUser = null
  auth.loading = false
  auth.authSettled = true
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
    expect(result.current.latched).toBe(false)
  })

  // ── The latch: an upgrade waits, a rollback does not ───────────────────────

  it('a ramp-up does NOT move a learner already on the old runner', () => {
    // The failure: 10% → 25% includes this visitor, the documented conditional
    // render unmounts the runner they are answering in, and the answers held in
    // its state do not survive into the replacement.
    window.localStorage.setItem('zedexams:anonId', 'anon-device-2') // bucket 87
    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 })
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(false)

    setFlags({ pastPaperQuiz: true, rolloutPercent: 90 }) // 87 < 90 — now included
    rerender()
    expect(result.current.engine).toBe(false)
    // The flags DO say yes; the hook is holding the runner it started on, and
    // says so rather than pretending the flags disagree.
    expect(result.current.source).toBe('rollout-bucket')
    expect(result.current.latched).toBe(true)
  })

  it('a rollback moves them AT ONCE, latch or no latch', () => {
    // §7.3: flip the flag off without discussion. A latch that spared the
    // learners already mid-attempt would leave the failure running for exactly
    // the population the rollback exists for.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(true)

    setFlags({ pastPaperQuiz: false, rolloutPercent: 100 })
    rerender()
    expect(result.current.engine).toBe(false)
  })

  it('a rollback is not undone by turning the flag back on', () => {
    // Re-enabling after an incident must not drag every learner mid-attempt
    // back onto the engine. They finish where they are; the next mount decides
    // afresh.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    setFlags({ pastPaperQuiz: false, rolloutPercent: 100 })
    rerender()
    expect(result.current.engine).toBe(false)
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    rerender()
    expect(result.current.engine).toBe(false)
    expect(result.current.latched).toBe(true)
  })

  it('a fresh mount decides afresh — the latch is per attempt, not per device', () => {
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    const first = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    setFlags({ pastPaperQuiz: false, rolloutPercent: 100 })
    first.rerender()
    expect(first.result.current.engine).toBe(false)

    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    expect(renderHook(() => useAssessmentEngineFlag('pastPaperQuiz')).result.current.engine).toBe(true)
  })

  it('nothing is latched before the decision is final', () => {
    // Latching the pre-resolution answer would freeze every learner onto the
    // old runner permanently — the flag would appear to do nothing at all.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    platform.loaded = false
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.resolved).toBe(false)
    platform.loaded = true
    rerender()
    expect(result.current.resolved).toBe(true)
    expect(result.current.engine).toBe(true)
  })

  it('switching runner re-decides rather than carrying the other one over', () => {
    setFlags({ pastPaperQuiz: false, quiz: true, rolloutPercent: 100 })
    const { result, rerender } = renderHook(({ r }) => useAssessmentEngineFlag(r), {
      initialProps: { r: 'pastPaperQuiz' },
    })
    expect(result.current.engine).toBe(false)
    rerender({ r: 'quiz' })
    expect(result.current.engine).toBe(true)
  })

  // ── Auth is the second input, and it can arrive last ───────────────────────

  it('is NOT resolved while auth is still restoring', () => {
    // The race: settings arrive from Firestore's IndexedDB cache while Firebase
    // is still restoring the auth session, so `currentUser` is null for a
    // returning learner. Marking that final would tell the consumer to mount on
    // an ANONYMOUS-id decision, and the uid then lands in a different bucket.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 })
    auth.loading = true
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.resolved).toBe(false)

    auth.loading = false
    auth.currentUser = { uid: 'learner-3' } // bucket 10 — inside 50%
    rerender()
    expect(result.current.resolved).toBe(true)
    expect(result.current.engine).toBe(true)
  })

  it('the WATCHDOG WINDOW serves the old card and holds the visit there', () => {
    // The state Codex found, and it is reachable rather than theoretical:
    // `AuthContext`'s restoration watchdog clears `loading` after 5s (30s with
    // a session hint) WITHOUT an auth event, so a returning learner on a slow
    // cold start is `loading === false` with `currentUser === null`.
    //
    // RE-DECIDED on #2151 (Codex r3733319245). The first version of this test
    // demanded the late uid answer be "correctable" — i.e. the card SWAPS to
    // the engine when auth finally settles. That contradicts the latch's own
    // asymmetry ("an UPGRADE waits; nobody needs to be moved onto the engine
    // mid-question"): the old runner is a correct experience that most
    // visitors get by design, while a mid-question swap unmounts the card and
    // loses the learner's in-progress answer. So the watchdog window serves
    // the old card, COMMITS that answer for the visit, and the late uid — even
    // one inside the ramp — finishes the visit where it started. `latched`
    // reports the hold, so telemetry can count how often the window bites.
    window.localStorage.setItem('zedexams:anonId', 'anon-device-2') // bucket 87 — out
    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 })
    auth.loading = false        // the watchdog gave up…
    auth.authSettled = false    // …but Firebase has still said nothing
    auth.currentUser = null

    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    // The page may mount — a public, crawled route that never resolves is worse
    // than one showing the old runner.
    expect(result.current.resolved).toBe(true)
    expect(result.current.engine).toBe(false)

    // Firebase finally speaks with a uid the ramp INCLUDES — and the visit
    // stays where it mounted. The next visit gets the engine from its first
    // frame.
    auth.authSettled = true
    auth.currentUser = { uid: 'learner-3' } // bucket 10 — in
    rerender()
    expect(result.current.engine).toBe(false)
    expect(result.current.latched).toBe(true)
  })

  it('a FULL rollout serves the engine through the watchdog window — no identity, no hold', () => {
    // Codex P2 on #2152 (r3733390985): at rolloutPercent 100 the decision is
    // identity-free — no late uid can overturn it, so there is no swap the
    // hold could be protecting against. Excluding every slow restoration from
    // a full rollout would bifurcate the fleet for no protection.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    auth.loading = false
    auth.authSettled = false   // the watchdog window
    auth.currentUser = null
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.resolved).toBe(true)
    expect(result.current.engine).toBe(true)
    expect(result.current.latched).toBe(false)

    // Settlement changes nothing — the answer was never identity-dependent.
    auth.authSettled = true
    auth.currentUser = { uid: 'learner-3' }
    rerender()
    expect(result.current.engine).toBe(true)
  })

  it('a ramp-down during the watchdog window commits — settlement cannot remount the engine', () => {
    // Codex P2 on #2153 (r3733460764): a full rollout mounts the engine in the
    // watchdog window and commits engine:true; ramping down to a partial
    // percentage mid-window forces the old card (mandated, at once) — but the
    // stale true commitment survived, and settlement into the partial ramp
    // read it back and REMOUNTED the engine: engine → old → engine, two
    // swaps. The hold must commit false OVER the stale true, making the
    // ramp-down the only swap.
    window.localStorage.setItem('zedexams:anonId', 'anon-device-2') // bucket 87 — out
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    auth.loading = false
    auth.authSettled = false
    auth.currentUser = null
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(true)          // stable, serves through the window

    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 }) // ramp down mid-window
    rerender()
    expect(result.current.engine).toBe(false)         // the one mandated swap

    auth.authSettled = true
    auth.currentUser = { uid: 'learner-3' }           // bucket 10 — inside the 50% ramp
    rerender()
    expect(result.current.engine).toBe(false)         // …and it stays down
    expect(result.current.latched).toBe(true)
  })

  it('`final` says when telemetry may record: settled or identity-free, never provisional', () => {
    // Codex P2 on #2153 (r3733460759): a once-only event captured in the
    // watchdog window under a partial rollout records a provisional `latched`
    // that settlement can invert either way.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 })
    window.localStorage.setItem('zedexams:anonId', 'anon-device-2')
    auth.loading = false
    auth.authSettled = false
    auth.currentUser = null
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.resolved).toBe(true)
    expect(result.current.final).toBe(false)          // identity-dependent + unsettled

    auth.authSettled = true
    rerender()
    expect(result.current.final).toBe(true)           // settled

    setFlags({ pastPaperQuiz: true, rolloutPercent: 100 })
    auth.authSettled = false
    rerender()
    expect(result.current.final).toBe(true)           // identity-free, settlement irrelevant
  })

  it('a staff pilot makes the percentage provisional: the window holds and telemetry waits', () => {
    // Codex P2 on #2154 (r3733581237), in the exact configuration a ramp runs
    // under: a percentage plus a staff allow-list. The watchdog window's
    // rollout-all/rollout-zero answer is one auth event away from being
    // overturned by the allow-list, so it must NOT be final — the old card
    // serves, and the once-only event waits for settlement to record the
    // truthful source (rollout-uid) instead of misattributing the percentage.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 100, rolloutUids: ['staff-1'] })
    auth.loading = false
    auth.authSettled = false   // the watchdog window
    auth.currentUser = null
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.resolved).toBe(true)
    expect(result.current.engine).toBe(false)   // held — the answer can still move
    expect(result.current.final).toBe(false)    // …so nothing records yet

    // The staff uid settles: entitled either way, but the visit mounted the
    // old card, so it finishes there (the upgrade waits) — and the event that
    // now fires carries the TRUE source and the hold.
    auth.authSettled = true
    auth.currentUser = { uid: 'staff-1' }
    rerender()
    expect(result.current.final).toBe(true)
    expect(result.current.engine).toBe(false)
    expect(result.current.latched).toBe(true)
    expect(result.current.source).toBe('rollout-uid')
  })

  it('once auth has genuinely settled, the latch is back in force', () => {
    // The other half: the fix must not disable the latch, only delay it until
    // the inputs are real.
    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 })
    window.localStorage.setItem('zedexams:anonId', 'anon-device-2') // bucket 87 — out
    auth.authSettled = true
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(false)

    setFlags({ pastPaperQuiz: true, rolloutPercent: 90 }) // a ramp now includes them
    rerender()
    expect(result.current.engine).toBe(false)
    expect(result.current.latched).toBe(true)
  })

  it('the answer that lands is the UID answer, not the one auth had not supplied yet', () => {
    // Decisive: the device buckets out of the ramp and the account buckets in.
    // A hook that resolved before auth would commit the anonymous answer and
    // latch the learner onto the old runner for the whole attempt.
    window.localStorage.setItem('zedexams:anonId', 'anon-device-2') // bucket 87 — out
    setFlags({ pastPaperQuiz: true, rolloutPercent: 50 })
    auth.loading = true
    const { result, rerender } = renderHook(() => useAssessmentEngineFlag('pastPaperQuiz'))
    expect(result.current.engine).toBe(false)
    expect(result.current.resolved).toBe(false)

    auth.loading = false
    auth.currentUser = { uid: 'learner-3' } // bucket 10 — in
    rerender()
    expect(result.current.engine).toBe(true)
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
