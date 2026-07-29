/**
 * learnerStatus — the enrolment-status vocabulary of one learner on a class
 * list, in ONE place.
 *
 * Pure module (no React / Firebase / DOM) so the node suite imports it
 * directly, and so the schema, the table, the mobile cards, the attendance
 * eligibility check and the printed register all read the same words.
 *
 * Two ideas are deliberately kept apart, because the product rules treat them
 * as separate filters (§4: "Filter by status" AND "Filter by needs review"):
 *
 *   status       — where the learner stands in the school. Exactly one value.
 *   needsReview  — a flag saying "a human has not confirmed this record yet".
 *                  It is set by an import (OCR extraction, a pasted line with
 *                  no admission number) and cleared when a teacher confirms.
 *                  A learner can be Active AND need review; that is the normal
 *                  state of a freshly captured class list.
 *
 * The badge a teacher sees folds the two back together (a record needing
 * review reads "Needs review"), but the stored data does not, so clearing the
 * flag never has to guess what the enrolment status used to be.
 *
 * HISTORY IS NEVER DELETED. Every status below except `active` means the
 * learner has left the class in some way, and each one keeps the learner on
 * historical registers with N/A after their leaving date (§9, §18). None of
 * them is a delete.
 */

/**
 * @typedef {'active'|'transferred'|'withdrawn'|'graduated'|'deceased'} LearnerStatus
 */

export const LEARNER_STATUSES = [
  {
    value: 'active',
    label: 'Active',
    description: 'Enrolled and expected in class.',
    // Whether the learner appears on the register for dates inside their
    // enrolment window. Every status stays visible on PAST dates — this only
    // governs whether new days expect a mark.
    marksNewDays: true,
    // Only an authorised administrator may set this (§4).
    adminOnly: false,
    tone: 'positive',
  },
  {
    value: 'transferred',
    label: 'Transferred',
    description: 'Moved to another class or school. Past attendance is kept.',
    marksNewDays: false,
    adminOnly: false,
    tone: 'warning',
  },
  {
    value: 'withdrawn',
    label: 'Withdrawn',
    description: 'Left the school. Past attendance is kept.',
    marksNewDays: false,
    adminOnly: false,
    tone: 'neutral',
  },
  {
    value: 'graduated',
    label: 'Graduated',
    description: 'Completed this level and moved on. Past attendance is kept.',
    marksNewDays: false,
    adminOnly: false,
    tone: 'neutral',
  },
  {
    value: 'deceased',
    label: 'Deceased',
    description: 'Recorded by an authorised administrator only.',
    marksNewDays: false,
    adminOnly: true,
    tone: 'neutral',
  },
]

export const LEARNER_STATUS_VALUES = LEARNER_STATUSES.map((s) => s.value)

const BY_VALUE = Object.fromEntries(LEARNER_STATUSES.map((s) => [s.value, s]))

/**
 * Statuses this repo stored before the vocabulary was widened, and the value
 * they are now. `inactive` was the single catch-all for "no longer in the
 * class"; the closest true statement about such a record is that the learner
 * withdrew, so that is what it reads as. Accepted in BOTH directions — a
 * register saved under the old value opens without a migration, and the next
 * write quietly retires it. No production document is rewritten in place.
 */
export const LEGACY_LEARNER_STATUSES = { inactive: 'withdrawn' }

/** The canonical stored value for a status, accepting the retired spellings. */
export function normalizeLearnerStatus(status) {
  const key = status == null ? '' : String(status).trim().toLowerCase()
  const mapped = LEGACY_LEARNER_STATUSES[key] || key
  return BY_VALUE[mapped] ? mapped : 'active'
}

export function learnerStatusMeta(status) {
  return BY_VALUE[normalizeLearnerStatus(status)]
}

export function learnerStatusLabel(status) {
  return learnerStatusMeta(status).label
}

/** Whether a status may be set by this actor. Only `deceased` is restricted. */
export function canSetLearnerStatus(status, { isAdmin = false } = {}) {
  const meta = BY_VALUE[normalizeLearnerStatus(status)]
  return meta.adminOnly ? Boolean(isAdmin) : true
}

/** Statuses offered in a picker for this actor. */
export function selectableLearnerStatuses({ isAdmin = false } = {}) {
  return LEARNER_STATUSES.filter((s) => !s.adminOnly || isAdmin)
}

/**
 * Whether a learner is counted in the class's "active learners" headline and
 * expected to be marked on NEW register days.
 */
export function isActiveLearner(learner) {
  return normalizeLearnerStatus(learner?.status) === 'active'
}

// ── review flag ──────────────────────────────────────────────────

/**
 * Why a record was flagged for review. These are the reasons an import can
 * produce; each is a plain statement of what is missing or uncertain, never a
 * claim that the extraction is wrong.
 */
export const REVIEW_REASONS = {
  low_confidence: 'The scan of this name was unclear.',
  missing_admission_number: 'Admission number missing.',
  missing_name: 'Learner name missing.',
  missing_gender: 'Gender missing.',
  possible_duplicate: 'Possible duplicate of another learner.',
  unparsed_row: 'This row could not be read as a learner.',
  manual_flag: 'Flagged for review by a teacher.',
}

export function reviewReasonText(reason) {
  return REVIEW_REASONS[reason] || 'Needs checking.'
}

/**
 * The badge shown against a learner. The review flag wins over the enrolment
 * status, because an unconfirmed record is the thing a teacher must act on —
 * but `status` is untouched underneath, so confirming the record restores the
 * real badge without a lookup.
 */
export function learnerBadge(learner) {
  if (learner?.needsReview) {
    return { key: 'needs_review', label: 'Needs review', tone: 'warning' }
  }
  const meta = learnerStatusMeta(learner?.status)
  return { key: meta.value, label: meta.label, tone: meta.tone }
}
