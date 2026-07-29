/**
 * src/utils/pastPaperQuizStatus.js
 *
 * The one place that answers "does this past paper have a quiz learners can
 * take?" — for the admin list, the Past Paper Studio, the archive hub, and
 * the learner-facing viewer.
 *
 * Why a module rather than `Boolean(paper.quizId)` at each call site: the
 * Quiz step of the Studio is optional (a paper can be published now and get
 * its quiz later), so a paper carries an explicit `quizStatus` field —
 * 'pending' | 'attached'. Papers published BEFORE that field existed don't
 * have it, so every read has to fall back to the old signal. Spreading that
 * fallback across six surfaces is how one of them ends up linking a learner
 * into a quiz that isn't there.
 *
 * Two rules the derivation enforces, both fail-closed:
 *   - An unrecognised `quizStatus` is ignored, never trusted. It falls back
 *     to the `quizId` signal rather than being treated as attached.
 *   - `quizStatus: 'attached'` with NO `quizId` reads as PENDING. The status
 *     field alone is not a quiz; the id is what the learner routes on, and
 *     "attached" without one would render a Start Quiz button that leads
 *     nowhere. Absence of a link is never reported as a working one.
 *
 * Pure module — no Firebase, no React, no DOM — so the node tests import it
 * directly and the mirror in `functions/pastPapersIndexHelpers.js` (which is
 * CommonJS and cannot import this) can be checked against it.
 */

export const QUIZ_STATUSES = {
  PENDING: 'pending',
  ATTACHED: 'attached',
}

/**
 * Learner + admin copy for the optional-quiz states. Declared here so the
 * viewer, the hub, the Studio and the admin list all print the same words —
 * a "coming soon" that reads differently on two screens is two features.
 */
export const QUIZ_PENDING_COPY = {
  /** Learner-facing placeholder where the quiz launcher normally sits. */
  learnerHeading: 'Quiz coming soon',
  learnerBody: 'practice questions for this paper are being prepared.',
  /** Admin list badge on a paper whose quiz hasn't been attached yet. */
  adminBadge: 'Quiz pending',
  /** Admin row action that deep-links back into the Studio's Quiz step. */
  adminAction: 'Add quiz',
  /** Studio step 3 — the secondary action beside the quiz authoring tools. */
  skipAction: 'Skip for now — add the quiz later',
  /** Studio step 4 — informational (not error) notice when publishing bare. */
  publishNotice:
    'No quiz attached yet. This paper will be published and visible to learners now, '
    + 'with a "Quiz coming soon" note. You can add the quiz any time from All papers.',
}

/** The learner-facing one-liner, assembled from the two halves above. */
export const LEARNER_QUIZ_PENDING_TEXT =
  `${QUIZ_PENDING_COPY.learnerHeading} — ${QUIZ_PENDING_COPY.learnerBody}`

/**
 * Coerce a written `quizStatus` onto the canonical vocabulary. Anything
 * unrecognised (including null/undefined) comes back undefined so callers can
 * tell "not stated" apart from "stated as pending" — the write path uses this
 * to avoid persisting a junk value, and `derivePaperQuizStatus` uses it to
 * decide whether to fall back.
 */
export function normalizeQuizStatus(value) {
  if (typeof value !== 'string') return undefined
  const v = value.trim().toLowerCase()
  if (v === QUIZ_STATUSES.PENDING) return QUIZ_STATUSES.PENDING
  if (v === QUIZ_STATUSES.ATTACHED) return QUIZ_STATUSES.ATTACHED
  return undefined
}

/** True when `quizId` is a usable Firestore document id. */
function hasUsableQuizId(paper) {
  return typeof paper?.quizId === 'string' && paper.quizId.trim().length > 0
}

/**
 * The paper's quiz status — 'pending' or 'attached'. Never throws, never
 * returns anything else; a null/undefined paper reads as pending.
 */
export function derivePaperQuizStatus(paper) {
  if (!paper || typeof paper !== 'object') return QUIZ_STATUSES.PENDING
  const stated = normalizeQuizStatus(paper.quizStatus)
  // 'attached' is only honoured when there is something to attach TO.
  if (stated === QUIZ_STATUSES.ATTACHED) {
    return hasUsableQuizId(paper) ? QUIZ_STATUSES.ATTACHED : QUIZ_STATUSES.PENDING
  }
  if (stated === QUIZ_STATUSES.PENDING) return QUIZ_STATUSES.PENDING
  // Pre-optional-quiz papers (and papers written with a junk status): the
  // presence of a quizId is the only signal available.
  return hasUsableQuizId(paper) ? QUIZ_STATUSES.ATTACHED : QUIZ_STATUSES.PENDING
}

/** True when learners can be routed into this paper's quiz. */
export function paperQuizIsAttached(paper) {
  return derivePaperQuizStatus(paper) === QUIZ_STATUSES.ATTACHED
}

/** True when the paper is live but its quiz hasn't been authored yet. */
export function paperQuizIsPending(paper) {
  return derivePaperQuizStatus(paper) === QUIZ_STATUSES.PENDING
}

/** How many papers in a list are still waiting on a quiz. */
export function countPendingQuizPapers(papers) {
  if (!Array.isArray(papers)) return 0
  return papers.reduce((n, p) => (paperQuizIsPending(p) ? n + 1 : n), 0)
}

/**
 * The single field patch that attaches a quiz to a paper — quizId and
 * quizStatus together, in ONE write. Deliberately a function rather than two
 * `updatePaper` calls: a two-step write leaves a window where the paper says
 * 'attached' with no id (or carries an id the learner UI won't route to), and
 * this platform has a history of stale-tab read-modify-write races.
 * `pendingQuizId` is cleared in the same patch — see `pastPapers.js`.
 */
export function attachQuizFields(quizId) {
  const id = typeof quizId === 'string' ? quizId.trim() : ''
  if (!id) throw new Error('attachQuizFields requires a quiz id')
  return {
    quizId: id,
    quizStatus: QUIZ_STATUSES.ATTACHED,
    pendingQuizId: null,
  }
}

/**
 * The field patch for publishing (or saving) a paper whose quiz is skipped.
 * `quizId` is explicitly nulled so no learner surface — including any that
 * still reads the raw field — can route into a quiz with no questions in it.
 * The draft's authoring quiz is remembered in `pendingQuizId` instead, so
 * re-entering the Studio picks up the same quiz rather than orphaning it and
 * creating a second one.
 */
export function pendingQuizFields(draftQuizId = null) {
  const id = typeof draftQuizId === 'string' && draftQuizId.trim() ? draftQuizId.trim() : null
  return {
    quizId: null,
    quizStatus: QUIZ_STATUSES.PENDING,
    pendingQuizId: id,
  }
}

/**
 * The quiz a Studio session should keep authoring for this paper: the
 * attached one when there is one, otherwise the draft quiz parked on a
 * pending paper. Returns null when neither exists (the Studio then mints one).
 */
export function resolveStudioQuizId(paper) {
  if (!paper || typeof paper !== 'object') return null
  if (hasUsableQuizId(paper)) return paper.quizId.trim()
  if (typeof paper.pendingQuizId === 'string' && paper.pendingQuizId.trim()) {
    return paper.pendingQuizId.trim()
  }
  return null
}
