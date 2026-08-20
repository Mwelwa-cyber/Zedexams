// functions/shared/guardian/guardianLinkCore.js
//
// ⚠️ SHARED WITH THE FRONTEND. The guardian↔learner LINK: what one is,
// what states its consent can be in, and the two answers everything else
// derives from a set of them — is this learner approved, and what are
// they allowed to do.
//
// It lives here for the reason functions/shared/README.md gives: what
// this module decides is whether a child's account is in limited mode
// and whether a second adult can loosen a first adult's restriction. A
// rule that lives only in the browser is not a rule. The server reads it
// in consentGuard and the guardian callables; the parent app and the
// learner's Guardian panel reach it through src/utils/guardianLink.js,
// so the sentence on the child's screen and the refusal from the API
// cannot disagree.
//
// Plain ESM: no React, no DOM, no Firebase. Tested under plain node by
// scripts/test-guardian-link.mjs.
//
// ── Consent lives on the LINK, not on the learner ───────────────────
//
// `users/{uid}.guardian.consentStatus` — the field guardianConsentCore
// reads — records ONE guardian's decision on the account. That was right
// while a child could only ever have named one adult, and it stops being
// right the moment two can link: withdrawal by one guardian would clear
// the field the other one's approval is stored in, and "which adult
// approved what" has nowhere to live at all.
//
// So a link carries its own consent, and the learner's state is DERIVED:
// approved if at least one link is approved. That single choice is what
// makes multi-guardian, withdrawal and the audit trail fall out instead
// of each needing its own special case.
//
// The account-level field is NOT deleted and is still honoured — see
// resolveLinkConsent's `accountStatus` argument. Every learner who
// approved through the email flow before links existed has consent
// recorded only there, and reading them as un-approved would put the
// live learner base into limited mode on the deploy that shipped this.
//
// ── Most restrictive wins, over APPROVED links only ─────────────────
//
// Two guardians who disagree resolve to the stricter answer. A guardian
// who has not approved — or who has withdrawn — expresses no view at
// all: counting a pending link's untouched defaults would let a stranger
// who typed a family code impose a restriction before anybody said they
// were the child's parent, and counting a withdrawn one would leave an
// ex-guardian's rules running after their access ended.

/* ── Vocabulary ─────────────────────────────────────────────────── */

/**
 * The three states a link's consent can be in. There is deliberately no
 * `denied`: a guardian who says "this is not my child" is refusing the
 * LINK, which deletes it, and is not the same event as an approved
 * guardian later changing their mind (`withdrawn`), which must stay on
 * the record because it is the thing the child is owed an explanation
 * for.
 */
export const LINK_CONSENT = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  WITHDRAWN: 'withdrawn',
})

const KNOWN_CONSENT = Object.freeze(Object.values(LINK_CONSENT))

/**
 * How the link came to exist. Recorded because the two doors carry
 * different evidence — an email link proves control of a named inbox, a
 * family code proves the child read a code off their own screen — and a
 * regulator asking "how do you know a guardian approved this" needs the
 * answer per link, not per product.
 */
export const LINK_METHOD = Object.freeze({
  EMAIL_LINK: 'email_link',
  FAMILY_CODE: 'family_code',
})

const KNOWN_METHODS = Object.freeze(Object.values(LINK_METHOD))

/**
 * The permissions a guardian sets over a linked child.
 *
 * `challenges` and `leaderboard` are three-valued booleans —
 * `true` (allowed), `false` (turned off), `null` (no guardian has
 * expressed a view). Only `false` is a restriction, for the reason
 * guardianControlsCore gives: collapsing null onto a default would make
 * every guardian who never opened the screen look like they had decided,
 * and a later change to that default would silently rewrite decisions
 * parents believe they made.
 *
 * `dailyMinutes` is a number or null, where null is "no limit set".
 */
export const LINK_PERMISSION_KEYS = Object.freeze([
  'challenges',
  'leaderboard',
  'dailyMinutes',
])

/**
 * The subset that is a yes/no. `dailyMinutes` is a quantity and resolves
 * by a different rule (smallest wins), so every place that folds the
 * booleans iterates THIS list rather than filtering the full one at each
 * call site and eventually forgetting to.
 */
export const BOOLEAN_PERMISSION_KEYS = Object.freeze([
  'challenges',
  'leaderboard',
])

/** A link nobody has expressed any view through. */
export const NO_PERMISSIONS = Object.freeze({
  challenges: null,
  leaderboard: null,
  dailyMinutes: null,
})

/** True when `state` is a consent state this build understands. */
export function isLinkConsentState(state) {
  return KNOWN_CONSENT.includes(state)
}

/** True when `method` is a linking method this build understands. */
export function isLinkMethod(method) {
  return KNOWN_METHODS.includes(method)
}

/* ── Reading a stored link ──────────────────────────────────────── */

/**
 * Normalise a stored `parentLinks` document into the link shape the rest
 * of this module works in.
 *
 * Anything unrecognised in `consent.state` reads as `pending`, NEVER as
 * approved: a state from a future build, a typo, or a value a tampered
 * write put there is not evidence that an adult clicked approve. And a
 * link with no `consent` object at all also reads as pending — see
 * `resolveLinkConsent` for why that does not lock out the links that
 * predate this file.
 *
 * @param {object} doc  a parentLinks document (or its fields)
 * @returns {{parentUid: string|null, learnerUid: string|null,
 *            state: string, method: string|null,
 *            permissions: object, hasConsentRecord: boolean}}
 */
export function normalizeLink(doc) {
  const src = doc && typeof doc === 'object' ? doc : {}
  const consent = src.consent && typeof src.consent === 'object' ? src.consent : null

  const rawState = consent ? consent.state : undefined
  const state = isLinkConsentState(rawState) ? rawState : LINK_CONSENT.PENDING

  const rawMethod = consent ? consent.method : undefined

  return {
    parentUid: typeof src.parentUid === 'string' && src.parentUid ? src.parentUid : null,
    learnerUid: typeof src.learnerUid === 'string' && src.learnerUid ? src.learnerUid : null,
    state,
    method: isLinkMethod(rawMethod) ? rawMethod : null,
    permissions: readLinkPermissions(src),
    // Whether this link states its own consent at all. The caller needs
    // to tell "an adult has not decided yet" from "this link was written
    // before consent moved onto links", because only the first is
    // evidence of anything.
    hasConsentRecord: Boolean(consent) && isLinkConsentState(rawState),
  }
}

/**
 * Read the permissions off a stored link into the three-valued shape.
 * Anything that is not a boolean reads as `null`; `dailyMinutes` accepts
 * only a finite non-negative number and rounds down, so a fractional or
 * negative value written by an older client cannot become a limit
 * nobody set.
 */
export function readLinkPermissions(doc) {
  const src = doc && typeof doc === 'object' && doc.permissions && typeof doc.permissions === 'object'
    ? doc.permissions
    : {}
  const minutes = Number(src.dailyMinutes)
  return {
    challenges: typeof src.challenges === 'boolean' ? src.challenges : null,
    leaderboard: typeof src.leaderboard === 'boolean' ? src.leaderboard : null,
    dailyMinutes: Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : null,
  }
}

/* ── Two flags, one question ─────────────────────────────────────── */

/**
 * `status` is the CONFIRMATION flag and it is not ours.
 *
 * functions/familyPortalCore.js owns it: a redeemed family code writes
 * `status: 'pending'`, the child's confirmation flips it to `'active'`,
 * and declining writes `'declined'`. That flow is live and this module
 * does not second-guess it.
 *
 * `consent.state` is OURS, and it answers what `status` cannot: WHICH
 * adult decided, WHEN, and — the one that matters — whether an approved
 * guardian later WITHDREW. `status` has no withdrawn value, and adding
 * one would have meant rewriting the confirmation flow to carry a
 * distinction it was never asked to make.
 *
 * ── Why both are read, and in this order ────────────────────────────
 *
 * A link authorises something only if BOTH agree. That is fail-closed on
 * purpose, and it is not merely tidy — reading only `consent.state`
 * reintroduces a real hole. A link written by the family-code flow
 * carries `status: 'pending'` and NO `consent` object at all, so a
 * consent-only reading falls into the migration grace below and returns
 * APPROVED for a stranger the child has not confirmed. That is precisely
 * the case the confirmation step exists to refuse, so the two graces are
 * kept from composing into a grant.
 *
 * The rule that resolves it is the one already written for `consent`:
 * THE GRACE IS FOR SILENCE, NOT FOR A RECORDED ANSWER. `status:
 * 'pending'` is a recorded answer. It just happens to be recorded in the
 * other field.
 */

/** The `status` values familyPortalCore writes. Anything else is not active. */
export const LINK_STATUS = Object.freeze({
  ACTIVE: 'active',
  PENDING: 'pending',
  DECLINED: 'declined',
})

/**
 * Has the CHILD confirmed this link? Mirrors familyPortalCore.isLinkActive,
 * including its grandfathering of links written before `status` existed.
 *
 * Deliberately duplicated rather than imported: this package may not
 * import from functions/ (it is shared with the browser, and
 * familyPortalCore is CommonJS server code). `test:guardian-link` pins
 * the two against each other so the copy cannot drift.
 */
export function linkStatusIsActive(link) {
  const src = link && typeof link === 'object' ? link : null
  if (!src) return false
  if (src.status === undefined || src.status === null) return true
  return src.status === LINK_STATUS.ACTIVE
}

/**
 * The one state a caller should render or branch on: this link's own
 * answer, folding both flags.
 *
 * Returns a LINK_CONSENT value. `withdrawn` outranks everything, because
 * an adult who ended the relationship is not "pending" and must never be
 * shown as waiting on the child.
 */
export function readLinkState(link) {
  const l = normalizeLink(link)
  if (l.hasConsentRecord && l.state === LINK_CONSENT.WITHDRAWN) return LINK_CONSENT.WITHDRAWN
  if (!linkStatusIsActive(link)) return LINK_CONSENT.PENDING
  if (l.hasConsentRecord) return l.state
  return LINK_CONSENT.APPROVED
}

/**
 * THE MIGRATION EXCEPTION, stated rather than hidden.
 *
 * A link written before consent moved onto links has no `consent` object
 * — and, if it predates the confirmation step too, no `status` either.
 * The strict reading makes both pending, which is correct in the abstract
 * and wrong as a product answer on the deploy that ships it: every parent
 * already using the portal opens it to "you are not linked to this
 * child". Nobody can fix that — the code that made the link is spent.
 *
 * So a link SILENT in both fields is treated as approved while
 * `enforceMigration` is false. The flag is the honest form of this: the
 * permissive state is temporary, visible, and switched off deliberately
 * once `npm run backfill:link-consent` has stamped the fleet.
 *
 * A link that speaks in EITHER field is never covered.
 */
export function linkIsApproved(link, opts = {}) {
  const {enforceMigration = false} = opts
  const l = normalizeLink(link)

  // The child has not confirmed (or has declined). Nothing else matters.
  if (!linkStatusIsActive(link)) return false

  if (l.state === LINK_CONSENT.APPROVED) return true
  if (l.hasConsentRecord) return false      // pending or withdrawn: a recorded answer
  return !enforceMigration                   // silent: the grace, or not
}

/* ── The two derivations ────────────────────────────────────────── */

/**
 * Is this learner's account approved, and by what?
 *
 * @param {Array<object>} links  every parentLinks doc naming this learner
 * @param {object} [opts]
 * @param {string} [opts.accountStatus]  `users/{uid}.guardian.consentStatus`,
 *   the pre-links record of a guardian's decision.
 * @returns {{approved: boolean, state: string, source: string,
 *            approvedBy: string[], pending: number, withdrawn: number}}
 *
 * `approved` is true if ANY link is approved. It is a disjunction rather
 * than a conjunction because each link is one adult's own decision about
 * their own relationship to the child: a second parent who has not got
 * round to clicking approve is not a second parent objecting, and
 * treating them as one would let anybody who typed a family code put a
 * child into limited mode.
 *
 * ── The legacy path, stated rather than hidden ──────────────────────
 *
 * `accountStatus === 'granted'` approves the learner even with no
 * approved link. Every learner who went through the email consent flow
 * before this module existed has their guardian's decision recorded ONLY
 * there. Ignoring it would put the entire approved learner base into
 * limited mode on one deploy — losing the leaderboard and challenges for
 * children whose parents already said yes, with no action available to
 * them but to ask their parent to do it again.
 *
 * It is reported as `source: 'account'` so a caller can tell a derived
 * approval from a real one, and so the backfill can find the accounts
 * still resting on it.
 *
 * Every other account status — including `denied` — is left to
 * guardianConsentCore, which owns suspension. This function answers one
 * question and does not quietly acquire a second.
 */
export function resolveLinkConsent(links, opts = {}) {
  const {enforceMigration = false} = opts
  const raw = (Array.isArray(links) ? links : []).filter((l) => normalizeLink(l).parentUid)
  const rows = raw.map(normalizeLink)

  const approvedBy = raw
    .filter((l) => linkIsApproved(l, {enforceMigration}))
    .map((l) => normalizeLink(l).parentUid)
    .sort()

  // A legacy link is counted as approved but NOT as pending: it is not
  // waiting on anybody, and reporting it as pending would put "waiting
  // for your grown-up" on the screen of a child whose grown-up is
  // already there.
  // Tallied from the FOLDED state, so an unconfirmed link counts as
  // pending even though its silence in `consent` would otherwise read as
  // legacy — which is what puts "waiting for your grown-up" on the
  // child's screen for a code somebody just redeemed.
  const folded = raw.map(readLinkState)
  const pending = folded.filter((st) => st === LINK_CONSENT.PENDING).length
  const withdrawn = folded.filter((st) => st === LINK_CONSENT.WITHDRAWN).length
  const legacy = raw.filter((l) => !normalizeLink(l).hasConsentRecord && linkStatusIsActive(l)).length

  if (approvedBy.length > 0) {
    return {
      approved: true,
      state: LINK_CONSENT.APPROVED,
      // 'legacy' when the ONLY thing approving this learner is a link
      // that predates consent-on-links. That is what the backfill looks
      // for, and what tells an operator whether the migration flag is
      // yet safe to flip.
      source: raw.some((l) => normalizeLink(l).state === LINK_CONSENT.APPROVED) ? 'link' : 'legacy',
      approvedBy,
      pending,
      withdrawn,
      legacy,
    }
  }

  if (opts.accountStatus === 'granted') {
    return {
      approved: true,
      state: LINK_CONSENT.APPROVED,
      source: 'account',
      approvedBy: [],
      pending,
      withdrawn,
      legacy,
    }
  }

  // No approval anywhere. `withdrawn` is reported distinctly from
  // `pending` because the child is owed a different sentence: one says
  // "we are waiting for your grown-up", the other says "your grown-up
  // turned this off", and showing the first when the second is true is a
  // small lie the child will eventually catch us in.
  return {
    approved: false,
    state: withdrawn > 0 && pending === 0 ? LINK_CONSENT.WITHDRAWN : LINK_CONSENT.PENDING,
    source: 'none',
    approvedBy: [],
    pending,
    withdrawn,
    legacy,
  }
}

/**
 * Fold every approved guardian's permissions into the one answer that
 * governs the child. MOST RESTRICTIVE WINS.
 *
 * @param {Array<object>} links  every parentLinks doc naming this learner
 * @returns {{challenges: boolean|null, leaderboard: boolean|null,
 *            dailyMinutes: number|null}}
 *
 * For the three booleans: one `false` anywhere wins. Otherwise `true` if
 * any approved guardian said yes, else `null` (nobody has decided). Note
 * the asymmetry — `false` beats `true` beats `null` — which is what
 * "most restrictive" means when one parent has an opinion and the other
 * has not looked.
 *
 * For `dailyMinutes`: the smallest stated limit wins, and a guardian who
 * set none does not count as having set infinity. Zero is a real limit
 * ("not today"), which is why the comparison cannot use falsiness.
 *
 * Only APPROVED links contribute. A pending link belongs to somebody who
 * has not yet said they are this child's guardian; a withdrawn one to
 * somebody who no longer is. Neither gets to set the rules.
 */
export function resolveLinkPermissions(links, opts = {}) {
  const {enforceMigration = false} = opts
  const approved = (Array.isArray(links) ? links : [])
    .filter((l) => linkIsApproved(l, {enforceMigration}))
    .map(normalizeLink)
    .filter((l) => l.parentUid)

  const out = {challenges: null, leaderboard: null, dailyMinutes: null}
  if (approved.length === 0) return out

  for (const key of BOOLEAN_PERMISSION_KEYS) {
    let value = null
    for (const link of approved) {
      const v = link.permissions[key]
      if (v === false) { value = false; break }
      if (v === true) value = true
    }
    out[key] = value
  }

  let minutes = null
  for (const link of approved) {
    const v = link.permissions.dailyMinutes
    if (v == null) continue
    if (minutes == null || v < minutes) minutes = v
  }
  out.dailyMinutes = minutes

  return out
}

/**
 * The effective answer for one permission: may the child use it?
 *
 * `learnerChoice` is the child's own preference. A guardian's `false`
 * always wins; a guardian's `true` does NOT override a child who
 * switched it off themselves — a parent permitting something is not a
 * parent requiring it. (Same rule as guardianControlsCore.isAllowed,
 * deliberately, so the two surfaces answer alike.)
 */
export function isPermitted(links, key, learnerChoice = true) {
  // `dailyMinutes` is a quantity, not a yes/no, and a caller asking this
  // function about it has asked the wrong question — answering `true`
  // would read as "no time limit applies". It is refused by name rather
  // than falling through the boolean branch.
  if (!BOOLEAN_PERMISSION_KEYS.includes(key)) return true
  if (resolveLinkPermissions(links)[key] === false) return false
  return learnerChoice !== false
}

/* ── Identity ───────────────────────────────────────────────────── */

/**
 * Deterministic link id, so redeeming the same code twice — or two doors
 * resolving to the same pair — is idempotent rather than a duplicate.
 * Matches the id familyPortalCore has always minted, because the
 * existing collection is full of them.
 */
export function linkId(parentUid, learnerUid) {
  return `${parentUid}_${learnerUid}`
}

/**
 * Canonical key for a guardian's email address.
 *
 * THIS IS THE CONVERGENCE POINT between the two doors. A child who names
 * `Mum@Example.com ` in the email flow and a parent who later signs up
 * as `mum@example.com` are one person, and the whole design rests on
 * them ending on one guardian account rather than two.
 *
 * Lowercased and trimmed, and nothing more. Gmail's dot-and-plus
 * folding is deliberately NOT applied: it is a Gmail policy, not an
 * email one, and folding `m.banda@` onto `mbanda@` on a provider that
 * treats them as different people would attach a child to a stranger.
 * Returns null for anything that is not shaped like an address, so a
 * caller can never build a claim key out of a blank string and have
 * every blank match every other.
 */
export function guardianEmailKey(email) {
  if (typeof email !== 'string') return null
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

/* ── Copy ───────────────────────────────────────────────────────── */

/** Human label for a consent state, for the child's panel and the audit trail. */
export function describeConsentState(state) {
  if (state === LINK_CONSENT.APPROVED) return 'Approved'
  if (state === LINK_CONSENT.WITHDRAWN) return 'Withdrawn'
  if (state === LINK_CONSENT.PENDING) return 'Waiting for approval'
  return 'Unknown'
}

/** Human label for how a link was made. */
export function describeLinkMethod(method) {
  if (method === LINK_METHOD.EMAIL_LINK) return 'Approved by email'
  if (method === LINK_METHOD.FAMILY_CODE) return 'Linked with a family code'
  return 'Linked'
}

/* ── What a guardian can see, in the child's own words ──────────────── */

/**
 * ── SETTLED DECISION: a guardian sees TOPICS, never a child's own words ──
 *
 * Written for the Ask Zed assistant, which has since been removed. It is
 * kept because the reasoning governs any future surface a child types into,
 * and because the copy below still promises it.
 *
 * The three options considered were (a) topics only, (b) topics plus
 * transcripts released when a distress or safety classifier fires, and
 * (c) full transcripts. This build is (a), and the choice is recorded
 * here — beside the copy that promises it — rather than in a document
 * that can drift away from the code.
 *
 * (c) is out on its own terms: a fifteen-year-old asking an honest
 * question deserves some room, and a tutor a child believes is being
 * read is a tutor they stop asking honest questions of.
 *
 * (b) is the one that looks obviously right and is not, and the reason
 * is specific to how safety already works here. `learnerSafetyCore`
 * intercepts distress and secrecy messages BEFORE the model, and answers
 * them with a fixed reply naming a trusted adult and Childline 116. That
 * route is deliberately not routed through the guardian — because in the
 * cases it exists for, the guardian may be the person the child is
 * disclosing. Releasing a flagged transcript to a guardian would take
 * the single message a child was most careful about and forward it to
 * the one adult who must not necessarily see it. It would also make the
 * flag itself dangerous to trip, which is how a child learns not to.
 *
 * So a safety flag routes to Childline and to human review, and never
 * automatically to a guardian. What a guardian gets is the same thing
 * they get everywhere else on this screen: what their child is WORKING
 * ON. If a future build wants transcript release, it needs a reviewed
 * escalation path with a human in it — not a permission bit.
 *
 * Whatever is decided, the child's screen and /child-safety must say it
 * in plain words. That is what `cannot` below is for.
 */

/**
 * ONE declaration of what a linked guardian can and cannot see.
 *
 * It lives in the shared core, beside the rules that decide access,
 * because three surfaces make this promise to three different audiences
 * and they must make the same one: the CHILD's Guardian screen, the
 * public /child-safety page a parent reads before signing up, and the
 * email a guardian gets when a child confirms them. Written out
 * separately in three files, they would drift — and the direction they
 * drift is always toward the version that was easiest to write, which is
 * the vaguest one.
 *
 * Phrased for a nine-year-old, in the second person, because the child's
 * screen is the hardest audience and copy that works there works in the
 * other two. A child being looked after should know it, and should be
 * able to READ what it means.
 *
 * `cannot` is not padding. "They do not see your password" is the single
 * thing children ask about most, and a list of what an adult CAN see,
 * with no boundary on it, reads as "everything".
 */
export const GUARDIAN_VISIBILITY = Object.freeze({
  can: Object.freeze([
    'How you are doing in each subject',
    'Your streak and how often you practise',
    'Your weekly report',
    'Which topics you find hard',
  ]),
  cannot: Object.freeze([
    'Your password',
    'Anything you type into the app, word for word',
    'Anything you do outside ZedExams',
  ]),
})

/**
 * What a guardian can switch on and off, named for the child.
 *
 * Keyed to LINK_PERMISSION_KEYS so a permission cannot be added to the
 * link record without the child's screen gaining a sentence for it — the
 * failure mode otherwise is a control that silently governs a child who
 * was never told it existed.
 */
export const GUARDIAN_CONTROL_COPY = Object.freeze({
  challenges: 'Whether you can play live challenges',
  leaderboard: 'Whether your name shows on the leaderboard',
  dailyMinutes: 'How long you can study each day',
})
