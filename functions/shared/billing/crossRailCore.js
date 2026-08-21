/**
 * crossRailCore — "is this household already paying somewhere else?"
 *
 * ⚠️ SHARED WITH THE FRONTEND. Imported by both `src/` and the Cloud
 * Functions. Plain ESM, no React/DOM/Firebase — see
 * functions/shared/README.md and the neutrality test beside this file.
 *
 * ── The failure this exists to prevent ──────────────────────────────
 *
 * A guardian can now pay two ways: mobile money on the web, Google Play
 * on Android. Neither rail can see the other's charge. So a parent who
 * pays on the web in the morning, opens the Android app in the evening
 * and is shown a Buy button will buy again — and both purchases are
 * legitimate, both succeed, and nothing in either system notices. They
 * have simply paid twice for one month, and will keep doing so every
 * month, because a Play subscription renews itself.
 *
 * Recovering that costs a refund, a support conversation and the trust of
 * exactly the customer who was trying hardest to pay us.
 *
 * ── Why it lives in `shared/` rather than on the server ─────────────
 *
 * The server MUST refuse a second purchase; that is the guarantee. But a
 * refusal is a bad experience if the button was there to press — and on
 * the Play rail it is worse than bad, because Google has already taken
 * the money by the time our server sees the token. So the browser needs
 * the same answer to decide whether to render a Buy button at all, and
 * the two answers have to be the same answer. One module, both callers.
 *
 * ── What counts as "already paying" ─────────────────────────────────
 *
 * A live entitlement whose provider is a REAL rail. `guardian_cascade` is
 * deliberately not one: it is the shadow of somebody else's payment, and
 * treating it as a rail would stop a parent buying for their second child
 * because their first child had been unlocked. The payer's own account is
 * checked alongside the child's for the same reason in reverse — a
 * guardian purchase credits the CHILD, so the parent's own document is
 * where their web subscription lives.
 *
 * Admin grants, comps and anything with an unrecognised provider are not
 * rails either. They are not money we would refund, and blocking a
 * purchase on one would leave a family unable to pay us at all.
 */

/** The two rails a purchase can arrive on. */
export const RAIL = Object.freeze({LENCO: 'lenco', PLAY: 'play'})

/** Human names, for copy that has to tell a parent where they already pay. */
export const RAIL_LABEL = Object.freeze({
  [RAIL.LENCO]: 'mobile money on the ZedExams website',
  [RAIL.PLAY]: 'Google Play',
})

/**
 * The rail a stored `subscriptionProvider` represents, or null when it is
 * not a rail at all.
 *
 * Unknown providers return null — fail OPEN, not closed. A provider string
 * this build does not recognise must not be able to lock a paying family
 * out of both checkouts; the server's own idempotency and the payments
 * ledger are what stop an actual double charge.
 */
export function railOfProvider(provider) {
  const value = typeof provider === 'string' ? provider.trim() : ''
  if (value === 'google_play') return RAIL.PLAY
  if (value === 'lenco') return RAIL.LENCO
  return null
}

function toMillis(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value.toMillis === 'function') {
    const ms = value.toMillis()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value.toDate === 'function') {
    const d = value.toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  const parsed = Date.parse(String(value))
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * The live rail entitlement on one user document, if any.
 *
 * @returns {{rail: string, expiresAtMs: number, planId: string|null}|null}
 */
export function activeRailFor(user, nowMs = Date.now()) {
  if (!user || typeof user !== 'object') return null
  const rail = railOfProvider(user.subscriptionProvider)
  if (!rail) return null
  const expiresAtMs = toMillis(user.subscriptionExpiry)
  if (expiresAtMs == null || expiresAtMs <= nowMs) return null
  return {rail, expiresAtMs, planId: user.subscriptionPlan || null}
}

/**
 * May a purchase be started on `rail` for this household?
 *
 * @param {object} args
 * @param {string} args.rail        the rail being attempted (RAIL.*)
 * @param {Array<{who: string, user: object}>} args.accounts
 *        the payer and, for a guardian purchase, the child being paid for
 * @param {number} [args.nowMs]
 * @returns {{allowed: boolean, reason?: string, existing?: object, who?: string}}
 *
 * Renewing on the SAME rail is always allowed — that is an ordinary
 * renewal, and the rails' own idempotency handles it (Play keys on
 * token+expiry, Lenco on its payment reference).
 */
export function decideCrossRail({rail, accounts = [], nowMs = Date.now()} = {}) {
  if (rail !== RAIL.LENCO && rail !== RAIL.PLAY) {
    // An unrecognised rail is not something to reason about; let the
    // caller's own validation refuse it.
    return {allowed: true, reason: 'unknown-rail'}
  }
  for (const entry of accounts) {
    if (!entry) continue
    const active = activeRailFor(entry.user, nowMs)
    if (!active) continue
    if (active.rail === rail) continue
    return {
      allowed: false,
      reason: 'active-on-other-rail',
      who: entry.who || 'account',
      existing: active,
    }
  }
  return {allowed: true}
}

/**
 * The sentence a parent reads when a purchase is refused for this reason.
 *
 * It names WHERE they already pay and tells them what to do about it,
 * because "you already have a subscription" to somebody who is looking at
 * a Buy button reads as a bug rather than as an explanation.
 */
export function crossRailMessage(verdict) {
  if (!verdict || verdict.allowed) return ''
  const existing = verdict.existing || {}
  if (existing.rail === RAIL.PLAY) {
    return 'This account already has an active plan billed through Google Play. ' +
      'Manage or cancel it in Google Play before paying another way — ' +
      'otherwise you would be charged twice.'
  }
  return 'This account already has an active plan paid for on the ZedExams website. ' +
    'It runs to the end of the period you paid for, so there is nothing to buy yet.'
}
