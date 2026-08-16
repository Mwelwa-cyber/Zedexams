/**
 * entitlements — the single gating service.
 *
 * Every lock, quota, chip and unlock sheet in the app reads from here.
 * Nothing else may decide gating: an inline `if (!isPremium)` in a component
 * carries its own copy of the limit, its own words and its own idea of
 * whether it may interrupt, and four of those is how a product ends up with
 * four different sentences for one lock.
 *
 * Two rules override everything this service does, and both are enforced by
 * tests rather than by convention:
 *
 *   1. No gate ever interrupts work in progress. Locks live at boundaries —
 *      the end of a set, the end of a session, a tapped padlock. The
 *      blocked-context list in `interruptionBudget` is the mechanism.
 *   2. Feedback on work already done is never charged for. Marking, wrong
 *      answers and weak-topic advice for questions the learner has answered
 *      are free on every plan, permanently. `AUTO_MARKING` exists for papers
 *      beyond the free set and must never be placed in front of a free set's
 *      own results.
 */

export { FEATURE_GATES, GATE_IDS, TIER, MOMENT_OF_WIN_EVENTS, FREE_PAPERS_PER_WEEK, getGate, gateQuota, interpolate, resolveGateCopy } from './gates'
export { AGE_BAND, GRACE_DAYS, PLAN_STATUS, formatResetDate, isGateLocked, nextMonthlyReset, nextWeeklyReset, planChipLabel, planChipTone, quotaLeft, resolveAgeBand, resolvePlanState } from './planState'
export { LIMITS, SUPPRESSION, BLOCKED_CONTEXTS, applyDismissal, decideCanRequestGuardian, decideCanShow, interruptionBudget, isBlockedContext, onSuppressed } from './interruptionBudget'
export { activeContexts, useActivity } from './activity'
export { DEFAULT_FREE_TO_QUESTION, METER_LEAD_QUESTIONS, freeSetDisclosure, isWithinFreeSet, meterLabel, resolveFreeSet, shouldShowMeter, validateFreeSetConfig } from './freeSet'
export { hasOpenedThisWeek, papersOpenedThisWeek, recordPaperOpen, readLedger, resetLedger, weekKey } from './quotaLedger'
export { unlockSheet } from './unlockSheet'
export { UNLOCK_ROUTE, resolveUnlockRoute, useUnlockFlow } from './useUnlockFlow'
export { useEntitlements } from './useEntitlements'
export { buildGuardianMessage, priceComesLast, MESSAGE_BLOCK_ORDER } from '../../../functions/shared/guardian/guardianMessageCore.js'
