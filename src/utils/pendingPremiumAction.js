// pendingPremiumAction — remembers what a teacher was doing when a paywall
// interrupted them, so a successful payment can put them straight back.
//
// Written by PaywallHost the moment a contextual upgrade pop-up shows
// (sourceRoute + the blocked tool/feature), cleared when the pop-up is
// dismissed without upgrading, and consumed by the checkout's
// "Continue to my work" button after a verified payment.
//
// Same pattern as utils/studioHandoff.js: sessionStorage (per-tab — an
// upgrade started in this tab returns THIS tab's work), a TTL so a stale
// interruption can't teleport the teacher somewhere surprising an hour
// later, and read-and-clear semantics on consume. All storage access is
// try/caught: Safari private mode must degrade to "no memory", never throw.
//
// Deliberately NOT stored: form values or document content — studio drafts
// already persist via useStudioInputDraft/useAssessmentDraft, and duplicating
// them here would rot. This module only remembers WHERE to go back to.

const KEY = 'zedexams:pending-premium-action'
const TTL_MS = 30 * 60 * 1000

/**
 * @param {object} action
 * @param {string} action.sourceRoute  path (+search) to return to
 * @param {string} [action.reason]    paywall reason that interrupted them
 * @param {string} [action.tool]      blocked tool key (e.g. 'lesson_plan')
 * @param {string} [action.feature]   human feature label
 */
export function rememberPremiumAction(action) {
  if (!action?.sourceRoute) return
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...action, savedAt: Date.now() }))
  } catch {
    /* storage unavailable — degrade silently */
  }
}

function readValid() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const action = JSON.parse(raw)
    if (!action?.sourceRoute) return null
    if (!Number.isFinite(action.savedAt) || Date.now() - action.savedAt > TTL_MS) return null
    return action
  } catch {
    return null
  }
}

/** Current pending action (fresh + valid) without clearing it. */
export function peekPremiumAction() {
  return readValid()
}

/** Read-and-clear: the action is honoured exactly once. */
export function consumePremiumAction() {
  const action = readValid()
  clearPremiumAction()
  return action
}

export function clearPremiumAction() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
