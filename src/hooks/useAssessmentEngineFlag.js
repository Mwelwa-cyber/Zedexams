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
 * **`resolved` is not decoration.** `settings/global` arrives over a snapshot,
 * so for the first frames of a cold load the flags are the context's defaults —
 * which resolve, correctly and fail-closed, to the old runner. Mounting on that
 * answer and then re-mounting when the real document lands would swap the
 * runner out from under a learner who may already have answered something, and
 * an answer held in the old runner's state does not survive into the new one.
 * Gate the mount on `resolved` and pay a skeleton frame instead.
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
import { useMemo } from 'react'
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
  const { currentUser } = useAuth()
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

  return useMemo(() => {
    const decision = resolveEngineDecision({
      featureFlags,
      runner,
      uid,
      // The same id the free-preview counter keys on, so one visitor is one
      // visitor to both.
      visitorId: resolveVisitorId(uid),
    })
    // `live` travels with the decision so §7.2's telemetry can tell a client
    // that is off because of the flag from one that is off because its read
    // died. Those look identical in an event stream otherwise, and only one of
    // them is worth investigating.
    return { ...decision, resolved: loaded === true, live: live !== false }
  }, [featureFlags, runner, uid, loaded, live])
}

export default useAssessmentEngineFlag
