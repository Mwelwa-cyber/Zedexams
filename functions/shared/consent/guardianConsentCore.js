/**
 * guardianConsentCore — the one definition of "may this learner do this yet".
 *
 * ⚠️ SHARED WITH THE FRONTEND. Same rule as functions/shared/assessment: the
 * React app and the Cloud Functions both import this module, so the banner a
 * learner sees and the guard that refuses their API call cannot disagree.
 * Plain ESM, no React/DOM/Firebase imports (test:shared-consent-neutral).
 *
 * ── Why a state machine and not a boolean ────────────────────────────────
 *
 * "Has a guardian approved" looks like a yes/no, but there are five states and
 * they behave differently:
 *
 *   unknown   — no guardian record at all. Every learner account created
 *               before this flow existed is in this state, which is why it
 *               cannot simply mean "blocked": that would lock out the entire
 *               live learner base on the deploy that introduced the check.
 *   pending   — a guardian was named, a link was sent, nobody has clicked it.
 *   granted   — a guardian clicked approve. Full learner experience.
 *   denied    — a guardian clicked "this wasn't me". The account is suspended
 *               and scheduled for deletion; this is NOT the same as pending.
 *   expired   — the link's 7 days elapsed with no decision. Behaves like
 *               pending but tells the learner to resend rather than wait.
 *
 * ── Adults are not learners with a birthday ──────────────────────────────
 *
 * `isMinor` is computed once, at signup, from the declared date of birth, and
 * stored. It is deliberately NOT recomputed from a stored DOB on every read:
 * a 17-year-old with a granted consent does not silently lose their guardian
 * record on their eighteenth birthday, and more importantly the gate cannot
 * flip open for someone whose DOB was mistyped years ago. Ageing out is a
 * deliberate, auditable action, not a side effect of the clock.
 *
 * ── Fail-closed, with one deliberate exception ───────────────────────────
 *
 * Every unknown or malformed input resolves to the RESTRICTED capability set.
 * The single exception is `unknown` during the migration window, and it is
 * explicit, flagged, and dated — see resolveLearnerAccess.
 */

import {normalizeGuardianControls, narrowCapabilities} from './guardianControlsCore.js'

// The full vocabulary. Anything outside this set is treated as `pending`,
// because a status nobody has defined is not evidence of approval.
export const CONSENT_STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  PENDING: 'pending',
  GRANTED: 'granted',
  DENIED: 'denied',
  EXPIRED: 'expired',
})

const KNOWN_STATUSES = Object.freeze(Object.values(CONSENT_STATUS))

// Roles this gate does not apply to. An allow-list rather than "anything that
// isn't 'learner'", so a profile with a missing or misspelled role is refused
// instead of being waved through as an adult.
const NON_LEARNER_ROLES = Object.freeze(['teacher', 'parent', 'admin', 'superAdmin'])

// Under this age at signup, a guardian must approve the account. Zambia's
// Data Protection Act requires guardian consent for processing a child's
// personal data, and Play's Families policy expects the same routing; 18 is
// the age of majority in Zambia, so it is the one number both point at.
export const GUARDIAN_CONSENT_AGE = 18

// Capabilities a learner account can hold. Named for what they gate rather
// than for the screens that use them, so a new screen has to say which
// existing capability it needs rather than inventing a sixth state.
export const CAPABILITY = Object.freeze({
  // Reading published material: lessons, past papers, practice quizzes.
  // Never gated — a child browsing a syllabus is what the app is for, and
  // withholding it while a parent finds their email helps nobody.
  BROWSE: 'browse',
  // Ask Zed. Gated: it is an AI surface a child can converse with, and it is
  // the thing a Families reviewer will test first.
  AI_CHAT: 'aiChat',
  // Joining a class or live quiz room — surfaces where a learner's name
  // becomes visible to other people.
  SOCIAL: 'social',
  // Appearing on a public leaderboard.
  LEADERBOARD: 'leaderboard',
  // Spending money.
  PURCHASE: 'purchase',
})

const FULL_CAPABILITIES = Object.freeze([
  CAPABILITY.BROWSE,
  CAPABILITY.AI_CHAT,
  CAPABILITY.SOCIAL,
  CAPABILITY.LEADERBOARD,
  CAPABILITY.PURCHASE,
])

// Limited mode. Browsing survives; everything that talks, shares, or spends
// does not.
const LIMITED_CAPABILITIES = Object.freeze([CAPABILITY.BROWSE])

// A denied account keeps nothing. It is suspended pending deletion, and
// leaving it able to browse would make "deactivated" a lie to the guardian
// who clicked the button.
const NO_CAPABILITIES = Object.freeze([])

/**
 * Normalise the status found ON AN EXISTING guardian record.
 *
 * Everything unrecognised — a non-string, a typo, a status from a future
 * version of this flow — resolves to `pending`, NOT to `unknown`. The
 * distinction is load-bearing: `unknown` is the migration state and it is
 * deliberately permissive, so letting a garbage value reach it would turn any
 * corrupt guardian record into a full-access account. `unknown` is reserved
 * for the one thing it means — no guardian record exists at all — and is
 * produced by the caller, never here.
 */
function normalizeStatus(value) {
  if (typeof value !== 'string') return CONSENT_STATUS.PENDING
  const v = value.trim()
  if (v === CONSENT_STATUS.UNKNOWN) return CONSENT_STATUS.PENDING
  return KNOWN_STATUSES.includes(v) ? v : CONSENT_STATUS.PENDING
}

/**
 * Age in whole years on `asOf`, from an ISO `YYYY-MM-DD` date of birth.
 * Returns null for anything unparseable — callers must treat null as "no
 * declared age", never as zero (which would read as a newborn and, in a
 * comparison against 18, as a child; that happens to fail safe here, but
 * relying on that coincidence is how the next caller gets it backwards).
 */
export function ageInYears(dobIso, asOf = new Date()) {
  if (typeof dobIso !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobIso.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // Round-trip through Date to reject impossible calendar dates (31 Feb).
  const dob = new Date(Date.UTC(year, month - 1, day))
  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) return null

  const now = asOf instanceof Date ? asOf : new Date(asOf)
  if (Number.isNaN(now.getTime())) return null
  if (dob.getTime() > now.getTime()) return null // future DOB is not an age

  let age = now.getUTCFullYear() - year
  const beforeBirthday =
    now.getUTCMonth() < month - 1 ||
    (now.getUTCMonth() === month - 1 && now.getUTCDate() < day)
  if (beforeBirthday) age -= 1
  return age
}

/**
 * Does this declared date of birth put the signer-up under the consent age?
 *
 * Returns `true` for an unparseable or absent DOB. That is not a bug: the
 * only way to reach this function without a valid date is a tampered or
 * broken client, and the safe reading of "we don't know how old you are" in a
 * product built for nine-year-olds is "assume a child".
 */
export function requiresGuardianConsent(dobIso, asOf = new Date()) {
  const age = ageInYears(dobIso, asOf)
  if (age === null) return true
  return age < GUARDIAN_CONSENT_AGE
}

/**
 * Resolve what a user may currently do.
 *
 * @param {object} user  The users/{uid} document (or the fields from it).
 * @param {object} [opts]
 * @param {boolean} [opts.enforceMigration]  Whether `unknown` — an account
 *   predating this flow — is restricted. Defaults to FALSE. See below.
 * @return {{status: string, isMinor: boolean, limited: boolean,
 *           capabilities: string[], reason: string}}
 */
export function resolveLearnerAccess(user, opts = {}) {
  const decision = resolveConsentDecision(user, opts)

  // ── The guardian's own layer, applied last ─────────────────────────────
  //
  // Consent answers "may this account do this at all"; the Guardian Zone's
  // switches answer "and does this child's parent want it". The second is
  // applied AFTER the first and can only ever remove — see
  // guardianControlsCore. Running it in the other order, or letting it
  // produce a list the consent decision did not already contain, would make a
  // guardian's preference capable of overriding the consent gate itself.
  //
  // Only a learner's own controls are read. A `guardianControls` field that
  // appeared on a teacher or admin document is ignored rather than obeyed,
  // because nothing legitimate writes one there.
  const role = typeof user?.role === 'string' ? user.role.trim() : ''
  if (role !== 'learner') return decision

  const controls = normalizeGuardianControls(user?.guardianControls)
  const capabilities = narrowCapabilities(decision.capabilities, controls, {
    aiChat: CAPABILITY.AI_CHAT,
    social: CAPABILITY.SOCIAL,
  })
  return {
    ...decision,
    capabilities,
    controls,
    // What the CHILD's app shows as "your guardian turned this off", which is
    // a different message from "your guardian hasn't approved you yet".
    restrictedByGuardian: capabilities.length < decision.capabilities.length,
  }
}

function resolveConsentDecision(user, opts = {}) {
  const {enforceMigration = false} = opts

  // A user we cannot read is not an adult. `resolveLearnerAccess(undefined)`
  // happens for real — a profile read that failed, a document still being
  // repaired by bootstrapMissingProfile — and answering "full access" there
  // would make every transient Firestore hiccup an open door. Browsing only,
  // which is what a signed-out visitor already gets.
  if (!user || typeof user !== 'object') {
    return {
      status: CONSENT_STATUS.PENDING,
      isMinor: true,
      limited: true,
      capabilities: LIMITED_CAPABILITIES,
      reason: 'no-profile',
    }
  }

  const role = typeof user.role === 'string' ? user.role.trim() : ''

  // Non-learners are out of scope entirely. A teacher is an adult with their
  // own account; a parent's access is governed by the link to their child.
  // The check is an ALLOW-LIST: a document with no role, or a role nobody has
  // classified, must not fall through to "not a learner, therefore fine".
  if (role !== 'learner') {
    if (NON_LEARNER_ROLES.includes(role)) {
      return {
        status: CONSENT_STATUS.GRANTED,
        isMinor: false,
        limited: false,
        capabilities: FULL_CAPABILITIES,
        reason: 'not-a-learner',
      }
    }
    return {
      status: CONSENT_STATUS.PENDING,
      isMinor: true,
      limited: true,
      capabilities: LIMITED_CAPABILITIES,
      reason: 'unknown-role',
    }
  }

  const guardian = user?.guardian && typeof user.guardian === 'object' ? user.guardian : null
  const status = guardian ? normalizeStatus(guardian.consentStatus) : CONSENT_STATUS.UNKNOWN

  // An adult learner declared 18+ at signup. No guardian is required and none
  // was collected, so `unknown` here means "not applicable", not "not yet".
  if (user?.isMinor === false) {
    return {
      status: CONSENT_STATUS.GRANTED,
      isMinor: false,
      limited: false,
      capabilities: FULL_CAPABILITIES,
      reason: 'adult-learner',
    }
  }

  if (status === CONSENT_STATUS.GRANTED) {
    return {
      status,
      isMinor: true,
      limited: false,
      capabilities: FULL_CAPABILITIES,
      reason: 'guardian-approved',
    }
  }

  if (status === CONSENT_STATUS.DENIED) {
    return {
      status,
      isMinor: true,
      limited: true,
      capabilities: NO_CAPABILITIES,
      reason: 'guardian-denied',
    }
  }

  if (status === CONSENT_STATUS.UNKNOWN) {
    // THE MIGRATION EXCEPTION, stated rather than hidden.
    //
    // Every learner account created before this flow shipped has no guardian
    // record. Restricting them on day one would take Ask Zed, classes and
    // leaderboards away from the entire existing user base in a single deploy
    // — before a single guardian has been asked, and with no way for a
    // learner to fix it except to wait on an email their parent may never
    // receive. So the default is to let them through while the migration
    // prompt collects guardian contacts, and the owner flips
    // `enforceMigration` on once the fleet has actually moved (spec §5:
    // "don't submit the Play declarations until active learners are through").
    //
    // The flag is the honest form of this: the permissive state is temporary,
    // visible, and switched off deliberately rather than forgotten.
    if (!enforceMigration) {
      return {
        status,
        isMinor: true,
        limited: false,
        capabilities: FULL_CAPABILITIES,
        reason: 'migration-grace',
      }
    }
    return {
      status,
      isMinor: true,
      limited: true,
      capabilities: LIMITED_CAPABILITIES,
      reason: 'migration-required',
    }
  }

  // pending / expired / anything unrecognised.
  return {
    status,
    isMinor: true,
    limited: true,
    capabilities: LIMITED_CAPABILITIES,
    reason: status === CONSENT_STATUS.EXPIRED ? 'consent-expired' : 'consent-pending',
  }
}

/**
 * The single predicate every gate should call.
 *
 * Deliberately takes the capability rather than the screen name, so adding a
 * screen means choosing an existing capability — and a screen that fits none
 * of them is a signal to think, not to add a boolean.
 */
export function canLearnerUse(capability, user, opts = {}) {
  const access = resolveLearnerAccess(user, opts)
  return access.capabilities.includes(capability)
}

/**
 * Whether a consent request document is still usable.
 * Separated from the handler so expiry and single-use are testable without
 * Firestore, and so both the confirm page and any cleanup job agree.
 */
export function consentTokenState(record, now = new Date()) {
  if (!record || typeof record !== 'object') return 'invalid'
  if (record.used === true) return 'used'
  const expiresAt = record.expiresAt instanceof Date ?
    record.expiresAt :
    (typeof record.expiresAt?.toDate === 'function' ? record.expiresAt.toDate() : null)
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return 'invalid'
  if (expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'valid'
}

export const FULL_CAPABILITY_SET = FULL_CAPABILITIES
export const LIMITED_CAPABILITY_SET = LIMITED_CAPABILITIES
