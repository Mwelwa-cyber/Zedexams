/**
 * The ONE binding between the rollout flags and React.
 *
 * The decision lives in `src/engines/assessment-engine/flags.js` and is pure.
 * This supplies its three inputs — the live `settings/global` document, the
 * signed-in uid, and the device's stable visitor id — and nothing else. It
 * contains no condition of its own, deliberately: the moment a hook starts
 * deciding, there are two resolvers and §4's rule 3 is gone. `passkeyService`
 * over `passkeyRegionCore` is the same split.
 *
 * ## Using it at a cutover
 *
 *     const { engine, resolved } = useAssessmentEngineFlag('pastPaperQuiz')
 *     if (!resolved) return <Skeleton />          // see below
 *     return engine ? <EngineRunner /> : <OldRunner />
 *
 * **`resolved` is not decoration.** `settings/global` arrives over a snapshot
 * and the auth session is restored asynchronously, so for the first frames of a
 * cold load the flags are the context's defaults and `currentUser` is null even
 * for a returning learner — both resolving, correctly and fail-closed, to the
 * old runner. Mounting on that answer and then re-mounting when the real inputs
 * land would swap the runner out from under a learner who may already have
 * answered something, and an answer held in the old runner's state does not
 * survive into the new one. `resolved` waits for BOTH inputs; gate the mount on
 * it and pay a skeleton frame instead.
 *
 * **The decision is latched once resolved, in one direction only.** A ramp-up
 * never moves a learner mid-question; a rollback always does. See the latch
 * below for why those are not the same case.
 *
 * The cost is real and belongs to the consumer: `/papers/:paperId/quiz` is
 * public and crawled, so gating its first paint on a Firestore round trip is a
 * decision to make with the cutover, not one this hook should make on its
 * behalf. Both facts are here so it is made rather than inherited.
 *
 * Nothing calls this yet. It ships ahead of the first cutover on purpose: the
 * rollback path should be already-deployed, already-soaked code by the time
 * anything depends on it.
 */
import { useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePlatformSettings } from '../contexts/PlatformSettingsContext'
import { resolveVisitorId } from '../utils/visitorId'
import { resolveEngineDecision } from '../engines/assessment-engine/flags.js'

/**
 * @param {string} runner one of `ENGINE_RUNNERS` ('pastPaperQuiz' | 'quiz' | 'game')
 * @returns {{runner: string, engine: boolean, source: string, resolved: boolean, live: boolean}}
 *   `source` is §7.2's `flagSource` telemetry dimension — pass it through to
 *   `assessment_engine_path` rather than re-deriving why. `live` is false once
 *   the settings subscription has died, which forces the decision closed; send
 *   it too, or a client that lost its read is indistinguishable from one the
 *   flag legitimately excluded.
 */
export function useAssessmentEngineFlag(runner) {
  const { settings, loaded, live } = usePlatformSettings()
  const { currentUser, loading: authLoading } = useAuth()
  const uid = currentUser?.uid ?? null
  // A dead subscription means these flags are the last thing we HEARD, not the
  // current value — and Firestore never resumes a listener after `onError`. A
  // client in that state would hold an enabled rollout until it reloaded, so
  // the admin toggle could not reach it: the rollback's whole safety argument,
  // gone silently, on exactly the client that is having a bad time.
  //
  // Withholding the input is not the hook deciding. There are no current flags
  // to read, so it passes none, and the resolver reaches its own fail-closed
  // answer — the same one it gives for an unreadable settings document.
  const featureFlags = live === false ? undefined : settings?.featureFlags

  // BOTH inputs must be final, not just the settings.
  //
  // `settings/global` is world-readable and served from Firestore's IndexedDB
  // cache, while Firebase restores the auth session from IndexedDB
  // asynchronously — `AuthContext.jsx` documents that "for the first frames
  // `auth.currentUser` is null even for a returning logged-in user". Settings
  // can easily win that race. Reporting `resolved` there would mark an
  // ANONYMOUS-id decision final, the consumer would mount on it, and the uid
  // would then arrive into a different bucket.
  const resolved = loaded === true && authLoading !== true

  const decision = useMemo(() => resolveEngineDecision({
    featureFlags,
    runner,
    uid,
    // The same id the free-preview counter keys on, so one visitor is one
    // visitor to both.
    visitorId: resolveVisitorId(uid),
  }), [featureFlags, runner, uid])

  // ── The latch ──────────────────────────────────────────────────────────────
  //
  // A flag change is a live snapshot, so after `resolved` the decision keeps
  // recomputing — and a ramp from 10% to 25% would move a learner already
  // answering a question onto the other runner. The documented conditional
  // render unmounts the one they are using, and an answer held in its state
  // does not survive into the replacement.
  //
  // The rule is ASYMMETRIC, and the asymmetry is the whole design (owner
  // decision, 2026-08-06):
  //
  //   • an UPGRADE waits. Nobody needs to be moved onto the engine mid-question,
  //     and §4.2's ramp is monotonic precisely so nobody is moved OFF it either;
  //   • a ROLLBACK applies at once. §7.3 says flip the flag off without
  //     discussion, and a latch that spared the learners already mid-attempt
  //     would leave the failure running for exactly the population the rollback
  //     is for. The in-progress answers it costs them are the accepted price of
  //     an emergency, and the rollback cost is written down in the pull request
  //     rather than discovered during one.
  //
  // A render-phase state adjustment, which is React's documented way to derive
  // state from changing inputs: it settles before paint, so no frame ever
  // renders the pre-latch answer, and unlike a ref it is safe under concurrent
  // rendering.
  const [committed, setCommitted] = useState(null)
  let engine = decision.engine
  let latched = false
  if (resolved) {
    const held = committed?.runner === runner ? committed.engine : null
    // First resolved answer for this runner is a MOUNT, not a transition, so it
    // is taken as-is however it lands.
    const next = held === null ? decision.engine : (decision.engine && held)
    if (held !== next) setCommitted({ runner, engine: next })
    engine = next
    latched = next !== decision.engine
  }

  return useMemo(() => ({
    ...decision,
    engine,
    resolved,
    // `live` travels with the decision so §7.2's telemetry can tell a client
    // that is off because of the flag from one that is off because its read
    // died. Those look identical in an event stream otherwise, and only one of
    // them is worth investigating.
    live: live !== false,
    // True while this hook is holding a runner the flags no longer choose —
    // i.e. a ramp has included this visitor and they are finishing on the old
    // runner. Kept out of `source`, which is the resolver's closed vocabulary
    // and describes the FLAGS, not what a mounted component decided to do
    // about them.
    latched,
  }), [decision, engine, resolved, live, latched])
}

export default useAssessmentEngineFlag
