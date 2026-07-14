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
// After payment the record flips to status 'paid' so the originating studio
// can show a "pick up where you left off" card. That card is only fresh for
// a short window — a paid record older than this is treated as expired.
const PAID_TTL_MS = 15 * 60 * 1000

/**
 * @param {object} action
 * @param {string} action.sourceRoute  path (+search) to return to
 * @param {string} [action.uid]       owner — the continuation card refuses
 *                                    a record left by a different account
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

function readRaw() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const action = JSON.parse(raw)
    return action?.sourceRoute ? action : null
  } catch {
    return null
  }
}

function isExpired(action, now = Date.now()) {
  if (!Number.isFinite(action.savedAt) || now - action.savedAt > TTL_MS) return true
  if (action.status === 'paid' && (!Number.isFinite(action.paidAt) || now - action.paidAt > PAID_TTL_MS)) return true
  return false
}

function readValid() {
  const action = readRaw()
  return action && !isExpired(action) ? action : null
}

/** Current pending action (fresh + valid) without clearing it. */
export function peekPremiumAction() {
  return readValid()
}

/**
 * Stamp the pending action as paid (a verified payment completed). The
 * record survives so the originating studio can show the continuation card;
 * that card — not the checkout — consumes it.
 */
export function markPremiumActionPaid() {
  const action = readValid()
  if (!action) return null
  const paid = { ...action, status: 'paid', paidAt: Date.now() }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(paid))
  } catch {
    /* ignore */
  }
  return paid
}

/**
 * Expiry-aware read for the continuation card: distinguishes "no record"
 * (nothing to say) from "record exists but is stale" (show the expired
 * message once, then clear). Never auto-executes anything either way.
 * @returns {{action: object, expired: boolean}|null}
 */
export function readPremiumActionState() {
  const action = readRaw()
  if (!action) return null
  return { action, expired: isExpired(action) }
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
