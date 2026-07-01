/**
 * objectConfidence — the single source of truth for how an import confidence
 * score (0-1) maps onto the review screen's three-tier auto-approve policy.
 *
 * The AI Paper Reconstruction System scores every reconstructed object
 * (question, table, diagram, passage) so a teacher only has to touch the ones
 * that are genuinely uncertain. The spec's policy is:
 *
 *   > 0.95           → auto      (safe to auto-approve; nothing to check)
 *   0.80 .. 0.95     → review    (highlight for a quick look)
 *   < 0.80           → approve   (require the teacher to confirm)
 *
 * Kept as a tiny, dependency-free pure module so both the client (review model
 * + screen) and any node test import the SAME thresholds — a policy change is a
 * one-line edit here, not a hunt across three files. Node-testable under plain
 * `node` (see objectConfidence.test.js).
 */

// The two cut points. Deliberately exported so tests + UI copy can reference the
// exact numbers rather than hard-coding 0.95 / 0.8 in several places.
export const AUTO_APPROVE_MIN = 0.95
export const REVIEW_MIN = 0.8

export const CONFIDENCE_BANDS = Object.freeze({
  AUTO: 'auto',
  REVIEW: 'review',
  APPROVE: 'approve',
})

// Coerce to a numeric score, treating null/undefined/'' as "unknown" (NaN)
// rather than 0 — `Number(null)` is 0, which would wrongly read as a very low
// (but known) confidence. Unknown must stay unknown.
function toScore(value) {
  if (value == null || value === '') return NaN
  return Number(value)
}

/**
 * Map a confidence score to its band. An unknown / non-finite score is treated
 * as 'review' — never 'auto'. The spec is explicit that the system must never
 * silently auto-approve something it isn't sure about, so the absence of a
 * score means "have a human glance at it", not "assume it's fine".
 *
 * @param {number|null|undefined} confidence 0-1
 * @returns {'auto'|'review'|'approve'}
 */
export function bandFor(confidence) {
  const c = toScore(confidence)
  if (!Number.isFinite(c)) return CONFIDENCE_BANDS.REVIEW
  if (c >= AUTO_APPROVE_MIN) return CONFIDENCE_BANDS.AUTO
  if (c >= REVIEW_MIN) return CONFIDENCE_BANDS.REVIEW
  return CONFIDENCE_BANDS.APPROVE
}

/** True only when the score is high enough to auto-approve without a human. */
export function isAutoApprovable(confidence) {
  return bandFor(confidence) === CONFIDENCE_BANDS.AUTO
}

/** A confidence low enough that the teacher MUST confirm before it's accepted. */
export function requiresApproval(confidence) {
  return bandFor(confidence) === CONFIDENCE_BANDS.APPROVE
}

/**
 * Human label for a band — used by the review screen's chips. Kept here so the
 * wording stays consistent with the policy it describes.
 */
export function bandLabel(band) {
  switch (band) {
    case CONFIDENCE_BANDS.AUTO:
      return 'Auto-approved'
    case CONFIDENCE_BANDS.APPROVE:
      return 'Needs approval'
    case CONFIDENCE_BANDS.REVIEW:
    default:
      return 'Review'
  }
}

/**
 * Lower a confidence score by a multiplicative penalty, clamped to [0, 1].
 * Used to fold a cross-model disagreement (e.g. the assist model saw more
 * questions than the primary extracted) into a score so a divergent batch drops
 * out of the auto-approve band rather than being trusted on one model's word.
 *
 * @param {number} confidence  0-1
 * @param {number} penalty     0-1 fraction to subtract proportionally
 *                             (0 = no change, 1 = down to 0)
 */
export function penalise(confidence, penalty) {
  const c = toScore(confidence)
  const p = Number(penalty)
  // Leave an unknown score unknown — echo back the original value verbatim so
  // callers that stored null/undefined keep it.
  if (!Number.isFinite(c)) return confidence
  if (!Number.isFinite(p) || p <= 0) return c
  return Math.max(0, Math.min(1, c * (1 - Math.min(1, p))))
}
