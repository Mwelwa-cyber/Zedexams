/**
 * Marking a paper, and everything the results screen is derived from.
 *
 * One function produces the rows; the section bars, the "what to work on
 * next" list, the answer-review filters and the fix-up set are all projections
 * of those same rows. That is the point: a learner who reads "Spelling 3/5"
 * and then counts four wrong answers under Spelling in the review list has
 * been told two different things about one paper, and there is no way to tell
 * from either screen which one is the lie.
 *
 * ── Where the answers come from, per mode ────────────────────────────────
 *
 * EXAM: the server marks and returns rows (§5.2) — this module's `markPaper`
 * is not the authority there, it is the shape the server's answer is read INTO
 * so the two paths render identically. `fromServerRows` does that mapping.
 *
 * PRACTICE: the client has the whole question including the key (§5.4,
 * deliberate — practice has no score to protect), so `markPaper` IS the
 * marking. Practice writes no score to the exam record either way.
 *
 * Pure: node-tested, no React, no Firebase.
 */

import { correctIndexOf, optionText } from './answerKey.js'

/** A section a question belongs to, with a readable name. */
function sectionOf(question, index) {
  const name = typeof question?.section === 'string' && question.section.trim()
    ? question.section.trim()
    : (typeof question?.sectionName === 'string' && question.sectionName.trim()
      ? question.sectionName.trim()
      : '')
  const part = Number.isFinite(Number(question?.part)) ? Number(question.part) : null
  return {
    // A paper that names no sections is ONE section rather than none: the
    // breakdown card then says "the whole paper, 24/60", which is true and
    // useful, instead of rendering an empty card under a heading promising a
    // breakdown.
    key: name || (part != null ? `Part ${part}` : 'The paper'),
    name: name || (part != null ? `Part ${part}` : 'The paper'),
    part: part != null ? part : index,
  }
}

/** The topic a question teaches, and the stable id mastery is keyed on. */
function topicOf(question) {
  const label = typeof question?.topic === 'string' && question.topic.trim()
    ? question.topic.trim()
    : ''
  const id = typeof question?.topicId === 'string' && question.topicId.trim()
    ? question.topicId.trim()
    : ''
  // Falling back to the label as the id keeps a paper authored before
  // `topicId` existed contributing to mastery, which is most of them. The two
  // never collide in practice — a real topicId is dotted ("eng.g7.tense.past")
  // and a label is not — and a collision would merge two names for one idea,
  // which is the harmless direction.
  return { topicId: id || label, topic: label }
}

/**
 * The number printed on the paper for a question. Falls back to its position,
 * 1-based, because "Question 3" in the review list has to match the runner.
 */
export function printedNumber(question, index) {
  const n = Number(question?.n ?? question?.number)
  return Number.isInteger(n) && n > 0 ? n : index + 1
}

/**
 * Mark a whole paper client-side.
 *
 * @param {object} args
 * @param {Array} args.questions  in paper order
 * @param {object} args.answers   questionId -> selected option index
 * @returns {{rows: Array, right: number, total: number, percent: number,
 *   blanks: number, bySection: Array, weakTopics: Array}}
 */
export function markPaper({ questions = [], answers = {} } = {}) {
  const rows = (Array.isArray(questions) ? questions : []).map((q, i) => {
    const given = answers?.[q?.id]
    const selectedIndex = Number.isInteger(given) ? given : null
    const correctIndex = correctIndexOf(q)
    return {
      questionId: q?.id ?? String(i),
      order: i,
      n: printedNumber(q, i),
      selectedIndex,
      correctIndex,
      // A blank is never "wrong" — it is its own state, because the submit
      // sheet counts blanks and the review list filters on them, and folding
      // the two loses the one a learner can act on.
      blank: selectedIndex == null,
      correct: selectedIndex != null && correctIndex != null && selectedIndex === correctIndex,
      ...sectionOf(q, i),
      ...topicOf(q),
    }
  })
  return summarize(rows)
}

/**
 * Read the server's marked rows into the same shape.
 *
 * The server owns correctness for an exam. This never re-marks — it maps, and
 * it deliberately reads `correct` from the row rather than recomputing it from
 * `selectedIndex === correctIndex`, because a disagreement between the two
 * means the server knows something the client does not (a voided question, a
 * question edited since) and the server's verdict is the one that counts.
 */
export function fromServerRows(serverRows = []) {
  const rows = (Array.isArray(serverRows) ? serverRows : []).map((r, i) => ({
    questionId: r?.questionId ?? String(i),
    order: Number.isInteger(r?.order) ? r.order : i,
    n: Number.isInteger(r?.n) ? r.n : i + 1,
    selectedIndex: Number.isInteger(r?.selectedIndex) ? r.selectedIndex : null,
    correctIndex: Number.isInteger(r?.correctIndex) ? r.correctIndex : null,
    blank: !Number.isInteger(r?.selectedIndex),
    correct: r?.correct === true,
    key: r?.section || 'The paper',
    name: r?.section || 'The paper',
    part: Number.isFinite(Number(r?.part)) ? Number(r.part) : i,
    topicId: r?.topicId || r?.topic || '',
    topic: r?.topic || '',
  }))
  return summarize(rows)
}

/** The projections. Shared by both paths so they cannot diverge. */
function summarize(rows) {
  const right = rows.filter((r) => r.correct).length
  const total = rows.length
  const blanks = rows.filter((r) => r.blank).length

  // Sections, in the order they appear in the paper.
  const sectionOrder = []
  const sections = new Map()
  rows.forEach((r) => {
    if (!sections.has(r.key)) {
      sections.set(r.key, { key: r.key, name: r.name, part: r.part, right: 0, total: 0, missedTopics: new Map() })
      sectionOrder.push(r.key)
    }
    const s = sections.get(r.key)
    s.total += 1
    if (r.correct) s.right += 1
    else if (r.topic) s.missedTopics.set(r.topic, (s.missedTopics.get(r.topic) || 0) + 1)
  })
  const bySection = sectionOrder.map((key) => {
    const s = sections.get(key)
    const worst = [...s.missedTopics.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      key: s.key,
      name: s.name,
      part: s.part,
      right: s.right,
      total: s.total,
      percent: s.total > 0 ? Math.round((s.right / s.total) * 100) : 0,
      mostMissed: worst ? worst[0] : null,
    }
  })

  // Weak topics, ranked by marks lost. A BLANK counts: not answering a
  // question about tenses is evidence about tenses, and a learner who skipped
  // the whole of one topic is exactly who the list is for.
  const topics = new Map()
  rows.filter((r) => !r.correct).forEach((r) => {
    if (!r.topicId) return
    if (!topics.has(r.topicId)) {
      topics.set(r.topicId, { topicId: r.topicId, topic: r.topic || r.topicId, section: r.name, missed: 0, questions: [] })
    }
    const t = topics.get(r.topicId)
    t.missed += 1
    t.questions.push(r.n)
  })
  const weakTopics = [...topics.values()].sort((a, b) => (
    b.missed - a.missed || a.topic.localeCompare(b.topic)
  ))

  return {
    rows,
    right,
    total,
    blanks,
    percent: total > 0 ? Math.round((right / total) * 100) : 0,
    bySection,
    weakTopics,
  }
}

/** How a score reads in words. The results hero and the score card share it. */
export function verdictBand(percent) {
  const p = Number(percent)
  if (!Number.isFinite(p)) return 'unknown'
  if (p >= 75) return 'strong'
  if (p >= 50) return 'getting_there'
  return 'needs_work'
}

export const BAND_LABEL = Object.freeze({
  strong: 'Strong',
  getting_there: 'Getting there',
  needs_work: 'Needs work',
  unknown: '',
})

/** The section-bar colour band. Same thresholds, so a bar and a word agree. */
export function barTone(percent) {
  const band = verdictBand(percent)
  return band === 'strong' ? 'strong' : band === 'getting_there' ? 'ok' : 'weak'
}

/**
 * The answer-review filters. Counts come from the rows so a chip never offers
 * a filter that turns out to be empty.
 */
export function reviewFilters(rows = []) {
  const wrong = rows.filter((r) => !r.correct && !r.blank).length
  const blank = rows.filter((r) => r.blank).length
  const right = rows.filter((r) => r.correct).length
  return [
    { id: 'wrong', label: 'Wrong', count: wrong },
    { id: 'blank', label: 'Blank', count: blank },
    { id: 'right', label: 'Right', count: right },
    { id: 'all', label: 'All', count: rows.length },
  ]
}

/** Apply one of those filters. */
export function filterRows(rows = [], filterId = 'wrong') {
  if (filterId === 'all') return rows
  if (filterId === 'right') return rows.filter((r) => r.correct)
  if (filterId === 'blank') return rows.filter((r) => r.blank)
  return rows.filter((r) => !r.correct && !r.blank)
}

/**
 * The fix-up set: every question the learner did not get right, in paper
 * order, to be re-sat in practice mode.
 *
 * Blanks are included. A question skipped because it was hard is the clearest
 * possible signal that it needs teaching, and leaving it out would make the
 * button's count disagree with the "what to work on next" card above it.
 */
export function fixupQuestionIds(rows = []) {
  return rows.filter((r) => !r.correct).map((r) => r.questionId)
}

/** The plain text of the chosen option, for the review list. */
export function chosenText(question, row) {
  if (!row || row.blank) return ''
  const options = Array.isArray(question?.options) ? question.options : []
  return optionText(options[row.selectedIndex])
}
