/**
 * src/components/admin/quizPaperLink.js
 *
 * Answers one question for the admin Content Library: is this quiz the one a
 * published past paper sends learners to?
 *
 * Why it exists. `/admin/content`'s Unassign action writes
 * `{ isPublished: false, quizType: null, status: 'draft' }` — and leaves
 * `publicAccess` alone. For an ordinary practice quiz that is exactly right.
 * For a quiz attached to a past paper it is a silent outage: the paper keeps
 * `quizId`, keeps advertising a Start Quiz button, and every learner who
 * presses it is refused by the Firestore rules. Not only signed-out visitors —
 * BOTH read clauses on `quizzes/{id}` require `isPublished == true` (the
 * public one via `publicAccess && isPublished`, the signed-in one directly),
 * and neither consults the subscription, so a paying learner is refused
 * exactly like an anonymous one. Only an admin or the quiz's creator can still
 * read it, which is why the admin doing the unassigning sees nothing wrong.
 *
 * Twelve papers went dark this way and stayed dark. The remedy is a warning
 * before the write, and this module is the part of it worth testing.
 *
 * Deliberately ERRS WIDE. A false positive costs one extra click on a
 * confirmation the admin can read and dismiss; a false negative is the outage
 * above, unnoticed. So a quiz that merely CLAIMS a paper link is treated as
 * linked even when no loaded paper confirms it.
 *
 * Pure — no React, no Firebase — so the plain-node test imports it directly.
 */

/** Fields a quiz may carry naming the past paper it was built for. */
const PAPER_LINK_FIELDS = ['linkedPaperId', 'sourcePastPaperId']

function trimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The paper id a quiz claims, or null. */
export function claimedPaperId(quiz) {
  if (!quiz || typeof quiz !== 'object') return null
  for (const field of PAPER_LINK_FIELDS) {
    const id = trimmedString(quiz[field])
    if (id) return id
  }
  return null
}

/**
 * Describe the link between a quiz and the past papers currently loaded.
 *
 * `papers` is whatever the Content Library has in state — possibly filtered,
 * possibly a page. That is precisely why a paper NOT being in the list is
 * never taken as proof the quiz is unlinked: the two evidence sources are
 * combined, never traded off.
 *
 * Returns:
 *   linked      — true when the quiz should not be silently unpublished
 *   confirmedBy — 'paper' when a loaded paper points AT this quiz (the
 *                 authoritative direction — that field is what the learner
 *                 routes on), 'quiz' when only the quiz claims a paper,
 *                 null when unlinked
 *   paperId / paperTitle — named when known, so the warning can say WHICH
 *                 paper breaks rather than that one does
 */
export function describeQuizPaperLink(quiz, papers = []) {
  const unlinked = { linked: false, confirmedBy: null, paperId: null, paperTitle: null }
  const quizId = trimmedString(quiz?.id)
  const list = Array.isArray(papers) ? papers : []

  // Authoritative first: the PAPER's `quizId` is the field every learner
  // surface routes on. A quiz's own `linkedPaperId` can be stale.
  if (quizId) {
    const owner = list.find((p) => trimmedString(p?.quizId) === quizId)
    if (owner) {
      return {
        linked: true,
        confirmedBy: 'paper',
        paperId: trimmedString(owner.id),
        paperTitle: trimmedString(owner.title),
      }
    }
  }

  // The quiz's own claim. Kept as a signal even with no matching paper in the
  // list, because the list may be filtered, paged, or not loaded at all.
  const claimed = claimedPaperId(quiz)
  if (claimed) {
    const named = list.find((p) => trimmedString(p?.id) === claimed)
    return {
      linked: true,
      confirmedBy: 'quiz',
      paperId: claimed,
      paperTitle: trimmedString(named?.title),
    }
  }

  return unlinked
}

/**
 * The confirmation copy. Declared here so the tests can hold it to two rules
 * a warning about this failure has to obey:
 *   - it states that the PAPER stays visible (the outage is invisible from
 *     the admin's side precisely because nothing looks removed), and
 *   - it does not describe the breakage as affecting only signed-out or only
 *     free learners. It affects every learner, paid included.
 */
export function unassignWarning(link) {
  const paper = link?.paperTitle ? `“${link.paperTitle}”` : 'a published past paper'
  const certainty = link?.confirmedBy === 'paper'
    ? `${paper} sends learners to this quiz.`
    : `This quiz was built for ${paper}.`
  return {
    title: 'This quiz is attached to a past paper',
    message: [
      certainty,
      'Unassigning it un-publishes the quiz, which is what breaks the link: the paper stays visible in the archive with its Start Quiz button, and every learner who presses it — signed in or out, free or paid — gets "Quiz not available".',
      'Publish the quiz again to restore it, or remove the quiz from the paper in the Past Paper Studio if you meant to take it down for good.',
    ].join(' '),
    confirmLabel: 'Unassign anyway',
  }
}
