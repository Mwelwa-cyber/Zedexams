/**
 * useEntitlements — the one hook every gate in the app reads from.
 *
 * Nothing else may decide gating. That is a stronger claim than it looks: the
 * repository already had `hasPremiumAccess`, `resolveSubscriptionStatus`,
 * `useSubscription`, `useTeacherUsage` and a handful of inline `isPremium`
 * checks, each correct for its own surface and each with its own idea of what
 * "expired" means. This hook does not replace them — it composes them into the
 * single plan-state shape the new gating surfaces read, so a lock badge, a
 * chip and an unlock sheet can never disagree about whether something is
 * locked.
 *
 * ── The teacher quota is a roll-up, not a new limit ────────────────────
 *
 * `aiGenerationsThisMonth` is the SUM of the per-tool counters the server
 * already meters, against the SUM of the live plan's per-tool caps. It is a
 * display figure for the chip and the meter card. The binding limit stays
 * per-tool and stays server-side in `usageMeter.js` — inventing a second
 * aggregate cap here would give a teacher two different answers to "can I
 * generate", and the one they'd meet first would be the one nobody deployed.
 *
 * ── The learner quota is device-scoped, and says so ────────────────────
 *
 * `papersThisWeek` comes from `quotaLedger`, in localStorage. See that module
 * for why. It is the same trade the existing free-preview counter makes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useTeacherUsage, TOOL_TO_FEATURE } from '../../hooks/useTeacherUsage'
import { FEATURE_GATES, FREE_PAPERS_PER_WEEK } from './gates'
import {
  isGateLocked,
  planChipLabel,
  planChipTone,
  quotaLeft as quotaLeftOf,
  resolvePlanState,
} from './planState'
import { hasOpenedThisWeek, papersOpenedThisWeek, recordPaperOpen } from './quotaLedger'
import { resolveVisitorId } from '../../utils/visitorId'

/** Tools whose generations count toward the displayed monthly roll-up. */
const ROLLED_UP_FEATURES = Object.freeze(Object.values(TOOL_TO_FEATURE))

function rollUpTeacherUsage(usage) {
  if (!usage) return { used: 0, cap: 0 }
  let used = 0
  let cap = 0
  for (const feature of ROLLED_UP_FEATURES) {
    used += Number(usage.used?.[feature] || 0)
    cap += Number(usage.caps?.[feature] || 0)
  }
  return { used, cap }
}

export function useEntitlements(opts = {}) {
  const { currentUser, userProfile } = useAuth()
  const uid = currentUser?.uid || null
  const isTeacher = userProfile?.role === 'teacher'

  // Passing null for a learner is what keeps this from opening a Firestore
  // listener on every learner screen — see useTeacherUsage's early return.
  const { data: teacherUsage } = useTeacherUsage(isTeacher ? uid : null)

  const visitorId = useMemo(() => resolveVisitorId(uid), [uid])
  const [papersUsed, setPapersUsed] = useState(() => papersOpenedThisWeek(visitorId))

  // Re-read on visitor change and on app resume: the ledger is keyed by ISO
  // week, so a device left open across Monday 00:00 must pick up the reset
  // without a reload — otherwise the learner is told "unlocks on Monday",
  // opens the app on Monday, and is still locked.
  useEffect(() => {
    const sync = () => setPapersUsed(papersOpenedThisWeek(visitorId))
    sync()
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [visitorId])

  const planState = useMemo(() => {
    const teacherRollUp = isTeacher ? rollUpTeacherUsage(teacherUsage) : null
    return resolvePlanState(userProfile, {
      now: opts.now,
      used: {
        papersThisWeek: papersUsed,
        aiGenerationsThisMonth: teacherRollUp?.used || 0,
      },
      quotas: {
        papersThisWeek: FREE_PAPERS_PER_WEEK,
        aiGenerationsThisMonth: teacherRollUp?.cap || 0,
      },
    })
  }, [userProfile, papersUsed, teacherUsage, isTeacher, opts.now])

  const isLocked = useCallback(
    (gateId) => isGateLocked(planState, gateId, FEATURE_GATES),
    [planState],
  )

  const quotaLeft = useCallback(
    (quotaKey) => quotaLeftOf(planState, quotaKey),
    [planState],
  )

  /**
   * Record that a paper was opened, and report whether it was allowed.
   *
   * Called by the paper route on entry. A paper already opened this week is
   * always allowed and costs no slot; a new paper is allowed while the quota
   * has room. An unlocked account is always allowed and nothing is written —
   * a paying learner's opens are not anybody's business.
   */
  const openPaper = useCallback((paperId) => {
    if (planState.unlocked) return { allowed: true, counted: false }
    // Already in this week's ledger → allowed, and it costs nothing. This is
    // what makes the cap a limit on breadth rather than a penalty for going
    // back to revise a paper they already opened on Tuesday.
    if (hasOpenedThisWeek(visitorId, paperId)) return { allowed: true, counted: false }
    if (papersOpenedThisWeek(visitorId) >= FREE_PAPERS_PER_WEEK) {
      // Refused BEFORE recording. Writing the open and then refusing it would
      // spend a slot on a paper the learner never got to read.
      return { allowed: false, counted: false }
    }
    const { count, counted } = recordPaperOpen(visitorId, paperId)
    if (counted) setPapersUsed(count)
    return { allowed: true, counted }
  }, [planState.unlocked, visitorId])

  return {
    planState,
    isLocked,
    quotaLeft,
    openPaper,
    chipLabel: planChipLabel(planState),
    chipTone: planChipTone(planState),
  }
}

export default useEntitlements
