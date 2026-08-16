/**
 * freeSet — the free run of questions inside a past paper, and where it ends.
 *
 * The hardest gate in the product, because the learner is mid-task when it
 * arrives. Two rules shape everything here, and both are about WHERE the lock
 * sits rather than how big it is:
 *
 *   1. The free set ends on a SECTION BOUNDARY. "Section A, Part 1 done" is a
 *      designed unit; "you ran out at 20" is rationing. Same number of
 *      questions, and the learner reads them completely differently.
 *   2. Nothing renders at the boundary. Completing the last free question does
 *      exactly what completing the last question of any quiz does — it goes to
 *      the results screen. The gating service is not consulted mid-quiz at
 *      all; see `quiz_active` in the blocked-context list, which exists for
 *      this case.
 *
 * ── Why the paper carries the number ───────────────────────────────────
 *
 * `papers/{paperId}.freeSet = { toQuestion, sectionId }`. Hard-coding a single
 * global limit means the boundary lands mid-section on every paper whose
 * sections are not 20 long, which is most of them. A paper that declares
 * nothing falls back to the historical global limit rather than to zero,
 * because a paper seeded before this field existed must not become a paper
 * with no free questions at all.
 */

/**
 * The fallback for a paper that declares no `freeSet`. Deliberately the
 * historical constant: introducing per-paper free sets must not, on the deploy
 * that ships it, quietly shrink what every existing paper gives away.
 *
 * It lives HERE rather than in `utils/pastPaperQuiz`, which re-exports it as
 * `FREE_QUESTION_LIMIT`, for one reason: that module imports the Firebase SDK,
 * and this one is imported by the plain-node test suite. A pure module may not
 * reach a Firebase-backed one for a number.
 */
export const DEFAULT_FREE_TO_QUESTION = 30

/** The meter appears this many questions before the boundary. */
export const METER_LEAD_QUESTIONS = 2

function normalizeSections(paper) {
  const raw = Array.isArray(paper?.sections) ? paper.sections : []
  return raw
    .filter((s) => s && Number.isFinite(Number(s.to)))
    .map((s) => ({
      id: String(s.id ?? ''),
      label: typeof s.label === 'string' ? s.label : '',
      title: typeof s.title === 'string' ? s.title : '',
      from: Number.isFinite(Number(s.from)) ? Number(s.from) : null,
      to: Number(s.to),
    }))
}

/**
 * Resolve the free set for one paper.
 *
 * @param {object} paper           the paper document
 * @param {number} totalQuestions  how many questions the quiz actually has
 * @returns {{
 *   toQuestion: number, total: number, remaining: number,
 *   sectionId: string|null, sectionLabel: string, sectionTitle: string,
 *   coversWholePaper: boolean, declared: boolean,
 *   lockedSectionTitles: string[],
 * }}
 */
export function resolveFreeSet(paper, totalQuestions) {
  const total = Math.max(0, Number(totalQuestions) || 0)
  const sections = normalizeSections(paper)
  const declaredTo = Number(paper?.freeSet?.toQuestion)
  const declared = Number.isFinite(declaredTo) && declaredTo > 0

  // Clamped to the paper's real length: a `freeSet` stating 20 on a quiz that
  // only carries 12 questions must not promise 8 questions that do not exist.
  const toQuestion = Math.min(
    total || Number.MAX_SAFE_INTEGER,
    declared ? declaredTo : DEFAULT_FREE_TO_QUESTION,
  )

  const section = sections.find((s) => s.id && s.id === String(paper?.freeSet?.sectionId ?? ''))
    || sections.find((s) => s.to === toQuestion)
    || null

  const lockedSectionTitles = sections
    .filter((s) => s.to > toQuestion)
    .map((s) => s.title || s.label)
    .filter(Boolean)

  return {
    toQuestion,
    total,
    remaining: Math.max(0, total - toQuestion),
    sectionId: section?.id || null,
    sectionLabel: section?.label || '',
    sectionTitle: section?.title || '',
    coversWholePaper: total > 0 && toQuestion >= total,
    declared,
    lockedSectionTitles,
  }
}

/**
 * Is question number `n` (1-based) inside the free set?
 * Used by the runner to decide whether the next question exists for this
 * learner — never to decide whether to show anything.
 */
export function isWithinFreeSet(n, freeSet) {
  return Number(n) <= Number(freeSet?.toQuestion ?? DEFAULT_FREE_TO_QUESTION)
}

/**
 * Whether the inline meter should render at question `n` (1-based).
 *
 * From `toQuestion - 2` onward, and only when the free set does not cover the
 * whole paper. Warning about a limit the learner will never reach is noise,
 * and noise in a quiz is exactly what this design is trying to remove.
 */
export function shouldShowMeter(n, freeSet, { unlocked = false } = {}) {
  if (unlocked) return false
  if (!freeSet || freeSet.coversWholePaper) return false
  const to = Number(freeSet.toQuestion)
  if (!Number.isFinite(to) || to <= 0) return false
  return Number(n) >= to - METER_LEAD_QUESTIONS && Number(n) <= to
}

/** "2 left in your free set" — the whole of the meter's text. */
export function meterLabel(n, freeSet) {
  const left = Math.max(0, Number(freeSet?.toQuestion || 0) - Number(n || 0) + 1)
  if (left <= 0) return ''
  return `${left} left in your free set`
}

/** "Free practice — Section A, Part 1 (20 questions)" for the start screen. */
export function freeSetDisclosure(freeSet) {
  if (!freeSet || freeSet.coversWholePaper) return ''
  const unit = freeSet.sectionLabel || 'the first section'
  return `Free practice — ${unit} (${freeSet.toQuestion} question${freeSet.toQuestion === 1 ? '' : 's'})`
}

/**
 * Seed-time / build-time assertion: a declared `freeSet.toQuestion` must land
 * on a section boundary, and its `sectionId` must name that section.
 *
 * Returns an array of problem strings — empty means the paper is well-formed.
 * A returned list rather than a throw because the seeder checks a whole
 * corpus and reporting the first bad paper tells you least.
 */
export function validateFreeSetConfig(paper) {
  const problems = []
  const id = paper?.id || paper?.paperId || '(unknown paper)'
  const freeSet = paper?.freeSet
  if (!freeSet) return problems               // undeclared is legal — see the fallback

  const to = Number(freeSet.toQuestion)
  if (!Number.isFinite(to) || to <= 0) {
    problems.push(`${id}: freeSet.toQuestion must be a positive number, got ${JSON.stringify(freeSet.toQuestion)}`)
    return problems
  }

  const sections = normalizeSections(paper)
  if (!sections.length) {
    problems.push(`${id}: declares freeSet.toQuestion=${to} but has no sections to land on`)
    return problems
  }

  const boundary = sections.find((s) => s.to === to)
  if (!boundary) {
    problems.push(
      `${id}: freeSet.toQuestion=${to} is not a section boundary ` +
      `(boundaries: ${sections.map((s) => s.to).join(', ')})`,
    )
  }
  if (freeSet.sectionId && boundary && String(freeSet.sectionId) !== boundary.id) {
    problems.push(
      `${id}: freeSet.sectionId="${freeSet.sectionId}" but question ${to} ends section "${boundary.id}"`,
    )
  }
  const total = Number(paper?.totalQuestions)
  if (Number.isFinite(total) && to > total) {
    problems.push(`${id}: freeSet.toQuestion=${to} exceeds totalQuestions=${total}`)
  }
  return problems
}
