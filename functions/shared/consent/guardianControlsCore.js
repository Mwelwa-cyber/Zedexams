/**
 * guardianControlsCore — what a guardian has switched OFF for their child.
 *
 * ⚠️ SHARED WITH THE FRONTEND, for the same reason as guardianConsentCore:
 * the toggle a guardian flips in the Guardian Zone and the refusal the Cloud
 * Function issues have to be the same rule. Plain ESM, no React/DOM/Firebase
 * (test:shared-consent-neutral scans this directory).
 *
 * ── Controls NARROW. They never widen. ───────────────────────────────────
 *
 * Consent decides what the account may do at all; controls are a second,
 * smaller filter a guardian applies on top. That ordering is the whole safety
 * property, and it is enforced structurally: `narrowCapabilities` only ever
 * REMOVES entries from the list it is handed. There is no code path in this
 * module that adds a capability, so a forged or corrupted controls object is
 * incapable of unlocking anything — the worst it can do is switch something
 * off, which is the failure a guardian would want.
 *
 * That is why the absent case is "allowed" rather than "blocked". A guardian
 * who has never opened the zone has narrowed nothing, and reading a missing
 * document as a set of denials would take Ask Zed away from every learner
 * whose parent approved them before this feature existed — a repeat of the
 * migration mistake guardianConsentCore documents at length.
 *
 * ── The PIN, and why the arithmetic gate is not the lock ─────────────────
 *
 * The Guardian Zone opens behind a "what is 7 × 8" gate. That is friction, not
 * authentication: a twelve-year-old can multiply. So the arithmetic gate
 * guards the READ side only, and every WRITE — every control a guardian
 * changes — is verified against a PIN whose setup code is emailed to the
 * guardian address the consent flow already verified. The child never sees
 * that inbox, which is the only asymmetry available to us inside an app the
 * child is holding.
 *
 * The lockout below matters more than it looks: a 4-digit PIN falls to a
 * patient guesser in an evening, and the guesser here is sitting next to the
 * device with unlimited time. Five attempts, then fifteen minutes.
 */

// The controls a guardian can set. Named for the capability each one narrows
// rather than for the row in the UI, so a new switch has to say which existing
// capability it takes away rather than inventing a private permission model.
export const GUARDIAN_CONTROL = Object.freeze({
  // Ask Zed — narrows CAPABILITY.AI_CHAT.
  ASK_ZED: 'askZed',
  // Live challenges — narrows CAPABILITY.SOCIAL.
  CHALLENGES: 'challenges',
  // Minutes of study per day. Advisory: it is a nudge the child's app shows,
  // NOT a capability, because a server that hard-stopped a child mid-question
  // at minute 90 would lose their answer to enforce a preference.
  DAILY_LIMIT_MINUTES: 'dailyLimitMinutes',
})

// Offered on the picker. `null` is "no limit" and is the default.
export const DAILY_LIMIT_OPTIONS = Object.freeze([null, 30, 60, 90, 120, 180])

// PIN shape. Four to six digits: long enough that the lockout below makes
// guessing impractical, short enough that a parent will actually set one.
const PIN_RE = /^\d{4,6}$/

// Rejected outright — the four PINs a guessing child tries first, and any PIN
// that is one repeated digit. Refusing them at the point of choosing is worth
// more than any amount of rate limiting after the fact.
const TRIVIAL_PINS = Object.freeze(['0000', '1111', '1234', '000000', '111111', '123456', '123123'])

export const PIN_MAX_ATTEMPTS = 5
export const PIN_LOCKOUT_MS = 15 * 60 * 1000
// How long a setup code emailed to the guardian stays usable.
export const SETUP_CODE_TTL_MS = 15 * 60 * 1000

/**
 * Coerce whatever is stored (or posted) into the exact controls shape.
 *
 * Every unreadable field resolves to "not narrowed" for the reason in the
 * header: absent controls are absence of a decision, not a decision to block.
 *
 * @param {unknown} raw
 * @return {{askZed: boolean, challenges: boolean, dailyLimitMinutes: number|null}}
 */
export function normalizeGuardianControls(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    // `=== false` rather than truthiness: only an explicit false is a denial,
    // so a missing field, a null, or a string cannot silently switch a
    // capability off.
    askZed: src.askZed !== false,
    challenges: src.challenges !== false,
    dailyLimitMinutes: normalizeDailyLimit(src.dailyLimitMinutes),
  }
}

function normalizeDailyLimit(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  // Snap to an offered option rather than storing an arbitrary number: the
  // picker is the only writer, and a stored 47 would render as no selection.
  return DAILY_LIMIT_OPTIONS.includes(rounded) ? rounded : null
}

/** True when the guardian has switched at least one thing off. */
export function hasGuardianRestrictions(controls) {
  const c = normalizeGuardianControls(controls)
  return c.askZed === false || c.challenges === false
}

/**
 * Remove the capabilities the guardian has switched off.
 *
 * @param {string[]} capabilities  The consent decision's list.
 * @param {unknown} controls       The stored controls, in any state.
 * @param {object} [map]           capability-key mapping, injected by
 *   guardianConsentCore so this module does not import it back (a cycle).
 * @return {string[]} A subset of `capabilities`. Never a superset.
 */
export function narrowCapabilities(capabilities, controls, map = {}) {
  const list = Array.isArray(capabilities) ? capabilities : []
  const c = normalizeGuardianControls(controls)
  const denied = new Set()
  if (c.askZed === false && map.aiChat) denied.add(map.aiChat)
  if (c.challenges === false && map.social) denied.add(map.social)
  if (denied.size === 0) return list
  // Filtering the INPUT list is what makes widening impossible: the result is
  // always a subset, whatever the controls object claims.
  return Object.freeze(list.filter((cap) => !denied.has(cap)))
}

/** A PIN a guardian is allowed to choose. */
export function isWellFormedGuardianPin(pin) {
  const value = typeof pin === 'string' ? pin.trim() : ''
  if (!PIN_RE.test(value)) return false
  if (TRIVIAL_PINS.includes(value)) return false
  // One repeated digit — 5555, 888888.
  if (new Set(value).size === 1) return false
  return true
}

/** The 6-digit code emailed to the guardian to authorise the first PIN. */
export function isWellFormedSetupCode(code) {
  return /^\d{6}$/.test(typeof code === 'string' ? code.trim() : '')
}

/**
 * Whether a PIN attempt may proceed, and what the record becomes afterwards.
 *
 * Pure so the lockout can be tested without a clock or a database, and so the
 * server and the UI count the same way — a UI that showed "2 tries left" while
 * the server had already locked would read as a bug in the app rather than as
 * the protection working.
 *
 * @param {object|null} record  {attempts, lockedUntil} as stored.
 * @param {number} now          epoch ms.
 * @return {{allowed: boolean, retryInMs: number, attempts: number}}
 */
export function guardianPinAttemptState(record, now = Date.now()) {
  const attempts = Number(record?.attempts) > 0 ? Math.floor(Number(record.attempts)) : 0
  const lockedUntil = Number(record?.lockedUntil) > 0 ? Number(record.lockedUntil) : 0
  if (lockedUntil > now) {
    return { allowed: false, retryInMs: lockedUntil - now, attempts }
  }
  // The lock has expired: the counter goes with it, or the next single wrong
  // digit would re-lock immediately and the window would never actually open.
  return { allowed: true, retryInMs: 0, attempts: lockedUntil > 0 ? 0 : attempts }
}

/**
 * The record to store after a wrong PIN.
 *
 * @param {object|null} record
 * @param {number} now
 * @return {{attempts: number, lockedUntil: number}}
 */
export function guardianPinFailure(record, now = Date.now()) {
  const { attempts } = guardianPinAttemptState(record, now)
  const next = attempts + 1
  return {
    attempts: next,
    lockedUntil: next >= PIN_MAX_ATTEMPTS ? now + PIN_LOCKOUT_MS : 0,
  }
}

/** The record to store after a correct PIN — the counter is cleared. */
export function guardianPinSuccess() {
  return { attempts: 0, lockedUntil: 0 }
}

/**
 * Whether an emailed setup code is still usable.
 *
 * @param {object|null} record  {expiresAt, used}
 * @param {number} now
 * @return {{ok: boolean, reason: string}}
 */
export function setupCodeState(record, now = Date.now()) {
  if (!record || typeof record !== 'object') return { ok: false, reason: 'unknown' }
  if (record.used === true) return { ok: false, reason: 'used' }
  const expiresAt = Number(record.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { ok: false, reason: 'expired' }
  return { ok: true, reason: 'valid' }
}
