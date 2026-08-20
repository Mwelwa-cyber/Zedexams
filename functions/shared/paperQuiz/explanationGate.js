/**
 * §4.1's hard rule, enforced on BOTH sides.
 *
 * "If `explanationStatus !== 'approved'`, the coaching panel renders the
 * correct answer and nothing else. An unreviewed AI sentence never explains an
 * exam answer to a child."
 *
 * ⚠️ SHARED WITH THE FRONTEND, and the reason it is shared rather than a
 * browser rule is the important half: `submitAttempt` returns the marked paper
 * WITH explanations (§5.2), and practice ships the whole question (§5.4). Both
 * of those are server-shaped payloads. If the gate lived only in the coaching
 * component, an unapproved draft would still travel down the wire on every
 * exam submission and every practice load — sitting in a network response on a
 * child's device, one devtools tab and one careless future component away from
 * being rendered.
 *
 * So the server STRIPS rather than trusting the client to hide, and it strips
 * using this module — the same predicate the panel asks. A question that fails
 * the gate arrives with no prose in it at all.
 *
 * Plain ESM. No React / DOM / Firebase.
 */

export const EXPLANATION_STATUS = Object.freeze({
  MISSING: 'missing',
  AI_DRAFT: 'ai_draft',
  APPROVED: 'approved',
})

/** Every value the field may hold — the rules enum and the studio read this. */
export const EXPLANATION_STATUSES = Object.freeze([
  EXPLANATION_STATUS.MISSING,
  EXPLANATION_STATUS.AI_DRAFT,
  EXPLANATION_STATUS.APPROVED,
])

/** The fields the gate governs. Adding a prose field means adding it here. */
export const COACHING_FIELDS = Object.freeze(['why', 'distractors', 'example'])

/**
 * Read the status off a question. Fails CLOSED, twice over: an unrecognised
 * value reads as `missing`, and a question with no field at all reads as
 * `missing` rather than approved — so every question authored before this
 * pipeline existed shows its answer and no prose, which is the safe half of
 * the rule. A paper does not become explained by the field being absent.
 */
export function explanationStatus(question) {
  const raw = question?.explanationStatus
  return EXPLANATION_STATUSES.includes(raw) ? raw : EXPLANATION_STATUS.MISSING
}

/** True only for a human-approved explanation. */
export function mayShowProse(question) {
  return explanationStatus(question) === EXPLANATION_STATUS.APPROVED
}

/**
 * A copy of `question` with every coaching field removed unless the gate
 * passed. Used by the server before a question goes over the wire, and safe to
 * apply twice.
 *
 * `noteRef` and `gameSlug` are NOT stripped: they are curriculum links chosen
 * by an author, not generated prose, and a learner sent to the tenses note is
 * being sent to material that has already been reviewed on its own terms.
 */
export function applyExplanationGate(question) {
  if (!question || typeof question !== 'object') return question
  if (mayShowProse(question)) return question
  const out = { ...question }
  COACHING_FIELDS.forEach((f) => { delete out[f] })
  return out
}

/**
 * How much of a paper carries approved prose. Shown to ADMINS in the studio;
 * learners never see it (§6) — an unexplained question simply shows its
 * answer, and a learner told "this paper is 40% explained" learns only that
 * they may have drawn the bad 60%.
 */
export function explanationCoverage(questions) {
  const list = Array.isArray(questions) ? questions : []
  if (list.length === 0) return { approved: 0, drafted: 0, missing: 0, total: 0, coverage: 0 }
  let approved = 0
  let drafted = 0
  list.forEach((q) => {
    const s = explanationStatus(q)
    if (s === EXPLANATION_STATUS.APPROVED) approved += 1
    else if (s === EXPLANATION_STATUS.AI_DRAFT) drafted += 1
  })
  return {
    approved,
    drafted,
    missing: list.length - approved - drafted,
    total: list.length,
    coverage: approved / list.length,
  }
}
