/**
 * What a question is worth, what a section is worth, and what the paper is
 * worth — computed once, from one rule.
 *
 * ## Why the total kept disagreeing with itself
 *
 * A mark total appears in five places on a finished paper: the cover line
 * ("Total marks: ___"), each section heading ("Section A — 25 marks"), beside
 * every question, on the marking key, and on the Save button. Each of those was
 * summing the questions it happened to have in scope, so a paper whose sections
 * were built at different times could print 25 in the heading, 24 beside the
 * questions and 40 on the cover — all three arithmetically correct, over
 * different sets.
 *
 * So the marks are a MODEL, derived once from the questions and the sections'
 * marking rules, and every one of those five places reads the same field of it.
 *
 * ## Uniform sections, and why a stored per-question mark still wins
 *
 * A 25-question multiple-choice section is "one mark each", and asking a teacher
 * to type 1 twenty-five times is how a section ends up with a 2 in it by
 * accident. So a section may declare `marksMode: 'uniform'` with
 * `marksPerQuestion`, and every question in it is worth that.
 *
 * The exception is deliberate: a question with `marksLocked` keeps its own mark
 * even in a uniform section. Without it, switching a section to uniform silently
 * rewrites a mark the teacher set on purpose, and the only evidence is the total
 * moving.
 *
 * ## Conflicts are reported, never resolved
 *
 * A paper may carry a `totalMarks` a teacher typed, and sections may carry a
 * declared `marks`. When those disagree with the computed sum, this module says
 * so and the export gate refuses. It does not pick a winner: silently believing
 * the computed sum would print a paper whose cover says something the teacher
 * never intended, and silently believing the declared one would print a paper
 * whose questions do not add up to it.
 */

/** Multiple choice is one mark unless something says otherwise. */
export const DEFAULT_MCQ_MARKS = 1
/** Anything else defaults to one mark too; the studio has always done this. */
export const DEFAULT_QUESTION_MARKS = 1

export const MARKS_MODES = Object.freeze(['uniform', 'individual'])
export const DEFAULT_MARKS_MODE = 'individual'

export const MARKS_ISSUES = Object.freeze({
  SECTION_TOTAL_CONFLICT: 'marks-section-conflict',
  PAPER_TOTAL_CONFLICT: 'marks-paper-conflict',
  ZERO_MARK_QUESTION: 'marks-zero-question',
  NO_MARKS: 'marks-none',
})

export function normalizeMarksMode(value) {
  const v = String(value || '').trim().toLowerCase()
  return MARKS_MODES.includes(v) ? v : DEFAULT_MARKS_MODE
}

/** A mark value that can be printed: a non-negative number, halves allowed. */
export function normalizeMarks(value, fallback = null) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  // Half marks are real on a Zambian marking key; thirds are not.
  return Math.round(n * 2) / 2
}

/**
 * The section a question belongs to, from the paper's parts.
 * Exported because the marks model, the choice-count resolver and the validation
 * report all need the same lookup and they must agree on it.
 */
export function sectionOfQuestion(question, parts = []) {
  const partId = question?.partId || null
  if (!partId) return null
  return (Array.isArray(parts) ? parts : []).find((p) => p?.id === partId) || null
}

/**
 * What one question is worth.
 *
 * Order: a locked per-question mark, then the section's uniform rule, then the
 * question's own mark, then the type default. Sub-parts are handled by the
 * caller (`assessmentPaperLayout` sums them) because a question with sub-parts
 * owns no mark of its own by construction.
 */
export function resolveQuestionMarks(question = {}, section = null, { defaultMarks = null } = {}) {
  const own = normalizeMarks(question.marks, null)
  const mode = normalizeMarksMode(section?.marksMode)
  if (mode === 'uniform' && !question.marksLocked) {
    const uniform = normalizeMarks(section?.marksPerQuestion, null)
    if (uniform != null) return uniform
  }
  if (own != null) return own
  if (defaultMarks != null) return defaultMarks
  const type = String(question.type || 'mcq').toLowerCase()
  return type === 'mcq' || type === 'tf' ? DEFAULT_MCQ_MARKS : DEFAULT_QUESTION_MARKS
}

/** Should the mark be printed beside this question? */
export function showMarksFor(section = null, assessment = null) {
  if (section && typeof section.showMarks === 'boolean') return section.showMarks
  if (assessment && typeof assessment.showQuestionMarks === 'boolean') return assessment.showQuestionMarks
  return true
}

/**
 * Build the marks model for a paper.
 *
 * @param {object} assessment the paper (parts, declared totals, display flags)
 * @param {Array}  questions  the flat ordered question list
 * @returns {{
 *   questions: Array<{id, number, marks, showMarks, partId}>,
 *   sections: Array<{id, title, marks, declaredMarks, questionCount, showMarks}>,
 *   ungrouped: {marks, questionCount},
 *   totalMarks: number,
 *   declaredTotal: number|null,
 *   issues: Array,
 *   conflicted: boolean
 * }}
 */
export function computeMarksModel(assessment = {}, questions = []) {
  const parts = Array.isArray(assessment.parts) ? assessment.parts : []
  const list = Array.isArray(questions) ? questions : []
  const bySection = new Map(parts.map((p) => [p.id, { marks: 0, count: 0 }]))
  const ungrouped = { marks: 0, count: 0 }

  const resolved = list.map((question, index) => {
    const section = sectionOfQuestion(question, parts)
    // A question with sub-parts is worth the sum of its parts, and the studio
    // already stores that on `marks`; recomputing it here would need the
    // sub-part normaliser and would be a second answer to the same question.
    const marks = resolveQuestionMarks(question, section)
    const bucket = section ? bySection.get(section.id) : ungrouped
    if (bucket) {
      bucket.marks += marks
      bucket.count += 1
    }
    return {
      id: question?.localId ?? question?.id ?? `q-${index}`,
      number: index + 1,
      marks,
      showMarks: showMarksFor(section, assessment),
      partId: section?.id ?? null,
    }
  })

  const issues = []
  const sections = parts.map((part) => {
    const bucket = bySection.get(part.id) || { marks: 0, count: 0 }
    const declared = normalizeMarks(part.marks ?? part.declaredMarks, null)
    if (declared != null && bucket.count > 0 && declared !== bucket.marks) {
      issues.push({
        code: MARKS_ISSUES.SECTION_TOTAL_CONFLICT,
        severity: 'error',
        sectionId: part.id,
        message: `Section ${part.title || part.id} is set to ${declared} marks but its questions add up to ${bucket.marks}.`,
      })
    }
    return {
      id: part.id,
      title: part.title || '',
      marks: bucket.marks,
      declaredMarks: declared,
      questionCount: bucket.count,
      showMarks: showMarksFor(part, assessment),
      marksMode: normalizeMarksMode(part.marksMode),
      marksPerQuestion: normalizeMarks(part.marksPerQuestion, null),
    }
  })

  const totalMarks = resolved.reduce((sum, q) => sum + q.marks, 0)
  const declaredTotal = normalizeMarks(assessment.declaredTotalMarks, null)
  if (declaredTotal != null && list.length > 0 && declaredTotal !== totalMarks) {
    issues.push({
      code: MARKS_ISSUES.PAPER_TOTAL_CONFLICT,
      severity: 'error',
      message: `The paper is set to ${declaredTotal} total marks but its questions add up to ${totalMarks}.`,
    })
  }

  if (list.length > 0 && totalMarks === 0) {
    issues.push({
      code: MARKS_ISSUES.NO_MARKS,
      severity: 'error',
      message: 'Every question on this paper is worth 0 marks.',
    })
  } else {
    for (const q of resolved) {
      if (q.marks === 0) {
        issues.push({
          code: MARKS_ISSUES.ZERO_MARK_QUESTION,
          severity: 'warning',
          questionNumber: q.number,
          message: `Question ${q.number} is worth 0 marks.`,
        })
      }
    }
  }

  return {
    questions: resolved,
    sections,
    ungrouped: { marks: ungrouped.marks, questionCount: ungrouped.count },
    totalMarks,
    declaredTotal,
    issues,
    conflicted: issues.some((i) => i.severity === 'error'
      && (i.code === MARKS_ISSUES.SECTION_TOTAL_CONFLICT || i.code === MARKS_ISSUES.PAPER_TOTAL_CONFLICT)),
  }
}

/** "25 marks" / "1 mark" — the one place the paper pluralises a mark count. */
export function marksLabel(marks) {
  const n = normalizeMarks(marks, 0)
  const shown = Number.isInteger(n) ? String(n) : String(n)
  return `${shown} mark${n === 1 ? '' : 's'}`
}
