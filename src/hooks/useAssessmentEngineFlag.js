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
 * @returns {{runner: string, engine: boolean, source: string, resolved: boolean}}
 *   `source` is §7.2's `flagSource` telemetry dimension — pass it through to
 *   `assessment_engine_path` rather than re-deriving why.
 */
export function useAssessmentEngineFlag(runner) {
  const { settings, loaded } = usePlatformSettings()
  const { currentUser } = useAuth()
  const uid = currentUser?.uid ?? null
  const featureFlags = settings?.featureFlags

  return useMemo(() => {
    const decision = resolveEngineDecision({
      featureFlags,
      runner,
      uid,
      // The same id the free-preview counter keys on, so one visitor is one
      // visitor to both.
      visitorId: resolveVisitorId(uid),
    })
    return { ...decision, resolved: loaded === true }
  }, [featureFlags, runner, uid, loaded])
}

export default useAssessmentEngineFlag
