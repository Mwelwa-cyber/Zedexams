/**
 * The paper's own arithmetic and structure, checked once, for both gates.
 *
 * ## What this adds to the existing gate
 *
 * `exportReadinessCore` already answers "is every question FINISHED". These are
 * the defects a paper can have while every question is finished:
 *
 *   - the questions are numbered 1, 2, 3, 5 — a learner reports "there is no
 *     question 4" mid-test and the invigilator has no answer;
 *   - the paper is set to A–C and question 13's correct answer is D, so the
 *     marking key marks against a choice that is not printed;
 *   - two distractors are 1/2 and 0.5, which is one choice printed twice and a
 *     learner who spots it has been handed the answer;
 *   - the cover says 40 marks and the questions add up to 38.
 *
 * Every one of those prints cleanly and is only discovered in a classroom, which
 * is exactly the class of defect a gate is for.
 *
 * ## Why it is here and not in the studio
 *
 * Because it decides whether a paper may be exported, and this package is the
 * only place that decision may be made (see `functions/shared/README.md`). The
 * studio imports it through a shim; the export callable imports it directly. One
 * implementation, so the two cannot disagree.
 *
 * Pure: no React, no DOM, no Firebase, no `src/`. Question text arrives as
 * whatever it was stored as, and nothing here parses rich text — the checks are
 * over structure and numbers, which is why they can live on both sides.
 */

import { validateChoices, resolveConfiguredChoiceCount, optionLabel } from './answerChoicesCore.js'
import { computeMarksModel } from './paperMarksCore.js'
import { canonicalizeQuestionType } from './questionTypeCore.js'

export const INTEGRITY_ISSUES = Object.freeze({
  NUMBERING_GAP: 'numbering-gap',
  NUMBERING_DUPLICATE: 'numbering-duplicate',
  MIXED_CHOICE_COUNT: 'mixed-choice-count',
})

/**
 * Question numbering continuity.
 *
 * The renderers number questions by POSITION, so a gap can only arrive from a
 * caller that numbers them itself — a stored paper whose numbers were written
 * down, an import that preserved the source paper's numbering. Checked rather
 * than assumed, because "the renderer numbers them so it cannot happen" is a
 * claim about today's renderers.
 */
export function checkNumbering(numbers = []) {
  const list = (Array.isArray(numbers) ? numbers : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
  if (list.length === 0) return []
  const issues = []
  const seen = new Set()
  for (const n of list) {
    if (seen.has(n)) {
      issues.push({
        code: INTEGRITY_ISSUES.NUMBERING_DUPLICATE,
        severity: 'error',
        questionNumber: n,
        message: `Two questions are both numbered ${n}.`,
      })
    }
    seen.add(n)
  }
  const sorted = [...seen].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > 1) {
      issues.push({
        code: INTEGRITY_ISSUES.NUMBERING_GAP,
        severity: 'error',
        questionNumber: sorted[i - 1] + 1,
        message: gap === 2
          ? `The paper jumps from question ${sorted[i - 1]} to question ${sorted[i]} — there is no question ${sorted[i - 1] + 1}.`
          : `The paper jumps from question ${sorted[i - 1]} to question ${sorted[i]}, skipping ${gap - 1} numbers.`,
      })
    }
  }
  return issues
}

/**
 * A section whose multiple-choice questions do not all offer the same number of
 * choices.
 *
 * Not an error in itself — a paper may deliberately mix — so it is reported only
 * when the section did NOT configure a count. With a count configured,
 * `validateChoices` already reports each question that disagrees with it, and
 * saying both would name the same defect twice.
 */
export function checkChoiceConsistency(groups = []) {
  const issues = []
  for (const group of groups) {
    if (group.configured != null) continue
    const counts = new Map()
    for (const entry of group.questions) {
      if (entry.type !== 'mcq') continue
      const n = entry.optionCount
      if (!n) continue
      if (!counts.has(n)) counts.set(n, [])
      counts.get(n).push(entry.number)
    }
    if (counts.size <= 1) continue
    const summary = [...counts.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([n, numbers]) => `${numbers.length} question${numbers.length === 1 ? '' : 's'} with ${n} (A–${optionLabel(n - 1)})`)
      .join(', ')
    issues.push({
      code: INTEGRITY_ISSUES.MIXED_CHOICE_COUNT,
      severity: 'warning',
      sectionId: group.id,
      message: `${group.label} mixes answer-choice counts — ${summary}. `
        + 'Set “Number of answer choices” on the section so every question matches.',
    })
  }
  return issues
}

/**
 * Every integrity issue on a paper.
 *
 * @param {object} input
 * @param {object} input.assessment the paper (parts, declared totals, settings)
 * @param {Array}  input.questions  questions in PRINTED ORDER
 * @returns {{issues: Array, blockers: Array, warnings: Array, marks: object}}
 */
export function collectPaperIntegrityIssues({ assessment = {}, questions = [] } = {}) {
  const list = Array.isArray(questions) ? questions.filter(Boolean) : []
  const parts = Array.isArray(assessment.parts) ? assessment.parts : []
  const allowPerQuestion = Boolean(assessment.allowPerQuestionChoiceCount)
  const issues = []

  // Numbering. Display order is the paper's numbering unless a question carries
  // its own — an imported paper that kept the source's numbers.
  const numbers = list.map((q, i) => (Number.isFinite(Number(q?.displayNumber)) ? Number(q.displayNumber) : i + 1))
  issues.push(...checkNumbering(numbers))

  // Choices, per question, against the count that applies to it.
  const groups = new Map()
  const groupFor = (question) => {
    const part = parts.find((p) => p?.id === question?.partId) || null
    const key = part?.id ?? '__ungrouped__'
    if (!groups.has(key)) {
      groups.set(key, {
        id: part?.id ?? null,
        label: part ? `Section ${part.title || part.id}` : 'The questions outside any section',
        configured: resolveConfiguredChoiceCount({ paper: assessment, section: part }),
        questions: [],
      })
    }
    return { part, group: groups.get(key) }
  }

  list.forEach((question, index) => {
    const type = canonicalizeQuestionType(question?.type) || 'mcq'
    if (type !== 'mcq' && type !== 'tf') return
    const { part, group } = groupFor(question)
    const options = Array.isArray(question.options) ? question.options : []
    const configured = resolveConfiguredChoiceCount({
      paper: assessment, section: part, question, allowPerQuestion, type,
    })
    group.questions.push({ number: numbers[index], type, optionCount: options.length })

    // With no configured count the paper prints what it holds, so "how many
    // choices should this have" has no answer and asking it would invent one.
    // The rest of the checks — empties, duplicates, equivalents, the correct
    // answer — apply either way, so they run against the ACTUAL count.
    const expected = configured ?? options.length
    const rendered = type === 'mcq' && configured && options.length > configured
      ? { ...question, options: options.slice(0, configured) }
      : question
    issues.push(...validateChoices(rendered, expected, { number: numbers[index], type }))
  })

  issues.push(...checkChoiceConsistency([...groups.values()]))

  // Marks.
  const marks = computeMarksModel(assessment, list)
  issues.push(...marks.issues)

  return {
    issues,
    blockers: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity !== 'error'),
    marks,
  }
}

/**
 * The blocking integrity problems as one sentence a teacher can act on.
 *
 * Returns null when there is nothing to say, so a caller can fall through to
 * `ready` — an empty list must never read as a block.
 */
export function integrityBlock(blockers = []) {
  const list = (Array.isArray(blockers) ? blockers : []).filter(Boolean)
  if (list.length === 0) return null
  const numbers = [...new Set(list.map((i) => i.questionNumber).filter((n) => Number.isFinite(n)))]
    .sort((a, b) => a - b)
  const first = list[0]
  const others = list.length - 1
  return {
    blocked: true,
    numbers,
    reason: first.code,
    message: others === 0
      ? `${first.message} Fix that, then download.`
      : `${first.message} There ${others === 1 ? 'is 1 other problem' : `are ${others} other problems`} to fix before this paper can be downloaded.`,
  }
}
