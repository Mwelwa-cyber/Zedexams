// functions/shared/guardian/guardianRolesCore.js
//
// ⚠️ SHARED WITH THE FRONTEND. Who, among the guardians linked to one
// child, may do what.
//
// It lives here for the reason functions/shared/README.md gives: this
// module decides whether a person may change a child's permissions,
// approve a spend, or delete an account, and a rule that lives only in
// the browser is not a rule. The server reads it in the guardian
// callables; the parent app reaches it through
// src/utils/guardianRoles.js so the same sentence disables the button
// and refuses the call.
//
// Plain ESM: no React, no DOM, no Firebase. Tested under plain node by
// scripts/test-guardian-roles.mjs.
//
// ── Two roles, and the line between them ────────────────────────────
//
// A child can have more than one guardian — the prototype's "family
// sharing". Both see everything and both can act on the child's day to
// day (approve a request, turn Ask Zed off). What only ONE of them can
// do is the two irreversible things: move money, and destroy the
// account. That is the whole distinction, and it is drawn there because
// those are the two actions a co-guardian cannot undo for the person
// who invited them.
//
// ── Why the role is DERIVED and not merely read ─────────────────────
//
// `parentLinks` predates this file. Every link written before it has no
// `role` field at all, and there is no migration that could invent one
// safely: reading a missing role as `owner` hands billing and deletion
// to every guardian on a child who already had two, and reading it as
// `co_guardian` leaves a sole parent unable to pay. So the role is
// resolved from the SET of links for one child — the earliest link is
// the owner — which yields exactly one owner for any input, including
// the legacy shapes, and needs nothing written to be correct.
//
// An explicitly stored `role` always wins over the inference, so once a
// link records `owner` the answer stops depending on timestamps.

/** The two roles. Anything else is refused rather than mapped. */
export const GUARDIAN_ROLES = Object.freeze(['owner', 'co_guardian'])

/**
 * What each role may do. The keys are checked by name at every call
 * site, so adding a capability here without granting it anywhere is a
 * safe (refusing) default rather than an accidental grant.
 */
const CAPABILITIES = Object.freeze({
  owner: Object.freeze([
    'viewProgress',
    'approveRequests',
    'setChildControls',
    'manageBilling',
    'manageGuardians',
    'deleteChild',
  ]),
  co_guardian: Object.freeze([
    'viewProgress',
    'approveRequests',
    'setChildControls',
  ]),
})

/** Every capability this build knows about, for tests and UI copy. */
export const GUARDIAN_CAPABILITIES = Object.freeze(
  Array.from(new Set(Object.values(CAPABILITIES).flat())),
)

/** True when `role` is a role this build understands. */
export function isGuardianRole(role) {
  return GUARDIAN_ROLES.includes(role)
}

/**
 * May a guardian holding `role` do `capability`?
 *
 * FAILS CLOSED on both arguments: an unknown role and an unknown
 * capability both answer `false`. A guardian whose link carries a role
 * from a newer build than this one is treated as having none of the
 * powers, which is the direction that cannot leak money.
 */
export function can(role, capability) {
  if (!isGuardianRole(role)) return false
  return CAPABILITIES[role].includes(capability)
}

/** The capabilities of one role, as a frozen list (for rendering). */
export function capabilitiesOf(role) {
  return isGuardianRole(role) ? CAPABILITIES[role] : Object.freeze([])
}

/**
 * Millisecond value of a Firestore Timestamp, a Date, an ISO string or a
 * number. Returns `null` for anything unreadable — the caller decides
 * what an unknown time means rather than getting a silent 0, which
 * would sort as "the beginning of time" and hand that link the owner
 * role.
 */
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
 * Resolve the role of every guardian linked to ONE child.
 *
 * @param {Array<object>} links  parentLinks docs for a single learner,
 *   each `{ parentUid, role?, createdAt? }`. Order is irrelevant.
 * @returns {Map<string,string>} parentUid → role
 *
 * The rules, in order:
 *
 *   1. A link that STORES a valid role keeps it. Explicit beats derived,
 *      always — otherwise transferring ownership would be undone by the
 *      next read.
 *   2. If exactly one link stores `owner`, every other link is a
 *      co-guardian, whatever its timestamp.
 *   3. If NO link stores `owner` (the legacy case), the earliest
 *      `createdAt` becomes owner and the rest are co-guardians. Links
 *      with an unreadable `createdAt` sort last, so a missing timestamp
 *      can never take ownership from a link that has one.
 *   4. Ties — same millisecond, or every timestamp missing — break on
 *      the lexicographically smallest parentUid, so the answer is the
 *      same on every machine and every read.
 *
 * More than one stored `owner` is possible only if something wrote it,
 * and this function does NOT demote one of them: it reports what is
 * stored. The callables refuse to create that state; a repair is a
 * deliberate act, not a side effect of somebody opening the screen.
 */
export function resolveGuardianRoles(links) {
  const rows = (Array.isArray(links) ? links : [])
    .filter((l) => l && typeof l.parentUid === 'string' && l.parentUid)

  const out = new Map()
  const stored = rows.filter((l) => isGuardianRole(l.role))
  const unstored = rows.filter((l) => !isGuardianRole(l.role))

  for (const link of stored) out.set(link.parentUid, link.role)

  const hasStoredOwner = stored.some((l) => l.role === 'owner')
  if (hasStoredOwner) {
    for (const link of unstored) out.set(link.parentUid, 'co_guardian')
    return out
  }

  // Legacy: nobody's role is recorded as owner, so derive one.
  const ranked = [...unstored].sort((a, b) => {
    const am = toMillis(a.createdAt)
    const bm = toMillis(b.createdAt)
    if (am !== bm) {
      if (am == null) return 1
      if (bm == null) return -1
      return am - bm
    }
    return a.parentUid < b.parentUid ? -1 : a.parentUid > b.parentUid ? 1 : 0
  })

  ranked.forEach((link, i) => out.set(link.parentUid, i === 0 ? 'owner' : 'co_guardian'))
  return out
}

/**
 * One guardian's role over one child. Convenience over
 * `resolveGuardianRoles`, and the shape most call sites want.
 *
 * Returns `null` when `parentUid` has no link at all — which is NOT the
 * same as having a role with no powers, and callers must treat it as
 * "not this person's child" rather than as a weaker guardian.
 */
export function roleFor(links, parentUid) {
  if (!parentUid) return null
  const roles = resolveGuardianRoles(links)
  return roles.get(parentUid) || null
}

/**
 * The role a NEW link should be created with.
 *
 * The first guardian to link a child owns the account; everyone after
 * them is a co-guardian. `existingLinks` is the set already stored for
 * that learner (empty on the first redeem).
 */
export function roleForNewLink(existingLinks) {
  const rows = Array.isArray(existingLinks) ? existingLinks : []
  return rows.length === 0 ? 'owner' : 'co_guardian'
}

/** Human label for a role, for the guardians list and the audit trail. */
export function describeRole(role) {
  if (role === 'owner') return 'Owner'
  if (role === 'co_guardian') return 'Co-guardian'
  return 'Not a guardian'
}
