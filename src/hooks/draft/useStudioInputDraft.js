/**
 * useStudioInputDraft — convenience wrapper over useDraftManager for the AI
 * generator studios that all share the same `{ form, curr }` input shape and a
 * StudioCurriculumSelector. It wires the feature-flag gate, a stable per-studio
 * draft id, and the restore path (including re-seeding the curriculum selector,
 * which reads its seed once on mount) so a studio only has to:
 *
 *   const draft = useStudioInputDraft({
 *     descriptor: worksheetInputDescriptor,
 *     uid: currentUser?.uid,
 *     form, setForm, curr, setCurr,
 *     onReseedSelector: (curr) => { setSelectorSeed(curr); bumpSelectorKey() },
 *   })
 *
 * then render <DraftRecoveryPrompt {...draft} /> + <DraftStatusIndicator … />
 * and call draft.clear() once the generated output is saved.
 *
 * Rollout: on by default, with a platform kill-switch — an admin can set
 * settings/global featureFlags.universalDrafts === false to disable it
 * instantly (no redeploy) if anything misbehaves.
 */

import { useDraftManager } from './useDraftManager.js'
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext.jsx'

export function useStudioInputDraft({
  descriptor,
  uid,
  form,
  setForm,
  curr,
  setCurr,
  onReseedSelector,
  ...rest
}) {
  const { featureFlags } = usePlatformSettings().settings
  return useDraftManager({
    studioId: descriptor.studioId,
    uid,
    draftId: `${descriptor.studioId}-current`,
    descriptor,
    state: { form, curr },
    enabled: Boolean(uid && featureFlags?.universalDrafts !== false),
    onRestore: (payload) => {
      if (payload?.form) setForm((f) => ({ ...f, ...payload.form }))
      if (payload?.curr) {
        setCurr(payload.curr)
        onReseedSelector?.(payload.curr)
      }
    },
    ...rest,
  })
}
