// useGenerationGate — the client-side pre-flight that stops a teacher from
// even entering the "Generating…" state once they've hit a cap.
//
// Why this exists: the server has always gated quotas, but the studios used
// to flip into "Generating…", round-trip the backend, and only THEN surface
// the limit error — so a capped teacher watched the first step start and
// finish before being told to pay. This hook lets each studio ask
// `ensureCanGenerate(tool)` BEFORE it does anything: if the teacher is out of
// quota (and has no purchased top-up credit), it opens the right paywall
// immediately and the studio returns without starting.
//
// A purchased top-up credit (K25, one extra generation, any tool — see
// functions/teacherTools/usageMeter.js) bypasses the block here exactly as it
// does on the server, so the gate stays in lock-step with what the backend
// will actually allow.

import { useAuth } from '../contexts/AuthContext'
import { useTeacherUsage, TOOL_TO_FEATURE, FEATURE_LABELS } from './useTeacherUsage'
import { paywall } from '../engines/payment-engine/paywall'
import { MAX_ONLY_TOOLS } from '../engines/payment-engine/teacherPlans'
import { isSuperAdmin } from '../utils/permissions'

const MAX_ONLY_FEATURES = new Set(
  MAX_ONLY_TOOLS.map((tool) => TOOL_TO_FEATURE[tool]).filter(Boolean)
)

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/**
 * @param {string} uid  current teacher's uid
 * @returns {{ ensureCanGenerate: (toolKey: string) => boolean, usage: object|null }}
 *   ensureCanGenerate returns true when the studio may proceed; when it
 *   returns false it has already shown the appropriate paywall.
 */
export function useGenerationGate(uid) {
  const { userProfile } = useAuth()
  const { data } = useTeacherUsage(uid)
  const admin = isSuperAdmin(userProfile)

  function ensureCanGenerate(toolKey) {
    // Admins are never metered; if the meter hasn't loaded yet, fall through
    // to the server gate rather than blocking a legitimate generation.
    if (admin || !data) return true

    const feature = TOOL_TO_FEATURE[toolKey] || toolKey
    const cap = Number(data.caps?.[feature] ?? 0)
    const used = Number(data.used?.[feature] ?? 0)
    const monthlyBlocked = used >= cap // cap 0 (not on plan) counts as blocked
    const dailyBlocked = Number(data.today || 0) >= Number(data.daily || 0)

    if (!monthlyBlocked && !dailyBlocked) return true

    // A purchased top-up credit covers either cap, on any tool — let it
    // through; the server consumes one credit atomically.
    if (Number(data.credits || 0) > 0) return true

    // Out of quota and no credit → open the matching paywall and stop.
    const label = FEATURE_LABELS[feature] || feature
    if (monthlyBlocked && MAX_ONLY_FEATURES.has(feature) && data.plan !== 'max') {
      paywall.show('max-feature', { feature: capitalize(label), tool: toolKey })
    } else if (monthlyBlocked && cap === 0) {
      // Feature not included on the current plan at all (e.g. schemes on Free).
      paywall.show('feature-locked', { feature: capitalize(label), tool: toolKey })
    } else if (monthlyBlocked) {
      paywall.show('monthly-limit', { feature: label, resetDays: data.resetDays, tool: toolKey })
    } else {
      paywall.show('daily-cap', { feature: label, tool: toolKey })
    }
    return false
  }

  return { ensureCanGenerate, usage: data }
}
