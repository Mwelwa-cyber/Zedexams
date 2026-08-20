/**
 * Server-side marking, and the shape a marked paper travels in.
 *
 * ⚠️ SHARED WITH THE FRONTEND — but asymmetrically, and the asymmetry is the
 * design. §5.2: "submitAttempt marks server-side and returns the full marked
 * paper with explanations. The client never marks an exam." So for an EXAM
 * this module runs in the Cloud Function and the browser only READS its
 * output. For PRACTICE the browser runs it directly, because §5.4 ships the
 * whole question — practice has no score to protect.
 *
 * Both call the same functions, which is what makes "the exam and the practice
 * results screen are the same screen" true rather than aspirational.
 *
 * Plain ESM, no Firebase — the handler passes documents in and writes the
 * result out. That is also what makes every case here testable without an
 * emulator: an expired submission, a question voided since the attempt began,
 * a paper whose key changed mid-attempt.
 */

import { correctIndexOf } from './answerKey.js'
import { applyExplanationGate } from './explanationGate.js'

/**
 * What a client may see about a question DURING an exam.
 *
 * §5.1: "For exam it returns questions with `answer`, `why` and `distractors`
 * stripped. The client physically cannot show the answer early."
 *
 * The list is a denylist of key-bearing fields rather than an allowlist of
 * safe ones, and that is a deliberate trade: an allowlist would silently drop
 * a legitimate new field (a diagram, a passage, an image position) and the
 * failure would be a question a learner cannot answer. A denylist's failure
 * mode is a new key-bearing field being forgotten — so `EXAM_STRIPPED_FIELDS`
 * is asserted against the answer-key resolver's own list of shapes in
 * `paperQuizCore.test.js`: a resolver that learns a sixth shape fails the test
 * until this list learns it too.
 */
export const EXAM_STRIPPED_FIELDS = Object.freeze([
  // Every shape `isCorrectChoice` reads.
  'correctAnswer',
  'correctAnswerIndex',
  'correctIndex',
  // The coaching prose and its links — an exam shows nothing until submit.
  'why',
  'distractors',
  'example',
  'explanation',
  'explanationJSON',
  'noteRef',
  'gameSlug',
])

/**
 * Strip a question for an exam.
 *
 * Option-level `isCorrect` is the fifth answer shape and it lives INSIDE the
 * options array, so a top-level field list cannot reach it — the options are
 * rebuilt. An object option keeps its text, image and diagram (a learner has
 * to be able to answer) and loses only the flag saying which one is right.
 */
export function stripForExam(question) {
  if (!question || typeof question !== 'object') return question
  const out = { ...question }
  EXAM_STRIPPED_FIELDS.forEach((f) => { delete out[f] })
  if (Array.isArray(question.options)) {
    out.options = question.options.map((o) => {
      if (o === null || typeof o !== 'object') return o
      const copy = { ...o }
      delete copy.isCorrect
      return copy
    })
  }
  return out
}

/**
 * Strip a question for PRACTICE.
 *
 * The key stays — practice reveals it the moment the learner taps, and works
 * offline, which it can only do if it already holds the answer. The
 * explanation gate still applies: an unapproved draft never travels, on either
 * mode.
 */
export function forPractice(question) {
  return applyExplanationGate(question)
}

/**
 * Mark one submission.
 *
 * @param {object} args
 * @param {Array}  args.questions  the FULL questions, in paper order, as
 *   stored — never the stripped copies the client was given.
 * @param {object} args.answers    questionId -> option index, as submitted
 * @param {Array}  [args.voidedQuestionIds]  questions withdrawn since the
 *   attempt started. They are marked CORRECT for everyone rather than dropped:
 *   dropping one changes the denominator, so two learners who sat the same
 *   paper an hour apart would be ranked out of different totals.
 * @returns {{rows, right, total, percent, blanks, bySection, weakTopics}}
 */
export function markSubmission({ questions = [], answers = {}, voidedQuestionIds = [] } = {}) {
  const voided = new Set((Array.isArray(voidedQuestionIds) ? voidedQuestionIds : []).map(String))
  const rows = (Array.isArray(questions) ? questions : []).map((q, i) => {
    const id = String(q?.id ?? i)
    const raw = answers?.[id]
    // A submitted index that is not an integer, or points off the end of the
    // options, is read as BLANK rather than as an answer. It is the shape a
    // hand-built payload takes, and treating it as an answer would let a
    // client submit `{"q1": true}` and be marked on it.
    const options = Array.isArray(q?.options) ? q.options : []
    const selectedIndex = Number.isInteger(raw) && raw >= 0 && raw < options.length ? raw : null
    const correctIndex = correctIndexOf(q)
    const isVoid = voided.has(id)
    return {
      questionId: id,
      order: i,
      n: Number.isInteger(q?.n) && q.n > 0 ? q.n : i + 1,
      selectedIndex,
      correctIndex,
      blank: selectedIndex == null,
      correct: isVoid || (selectedIndex != null && correctIndex != null && selectedIndex === correctIndex),
      voided: isVoid,
      section: typeof q?.section === 'string' ? q.section : '',
      // null when the paper DECLARES no part — not the array index. Falling
      // back to `i` made every question its own part, so a paper that names no
      // sections rendered a breakdown of sixty one-question sections instead
      // of one honest "The paper, 24/60".
      part: Number.isFinite(Number(q?.part)) ? Number(q.part) : null,
      topic: typeof q?.topic === 'string' ? q.topic : '',
      topicId: (typeof q?.topicId === 'string' && q.topicId) || (typeof q?.topic === 'string' ? q.topic : ''),
    }
  })

  const right = rows.filter((r) => r.correct).length
  const total = rows.length
  return {
    rows,
    right,
    total,
    blanks: rows.filter((r) => r.blank).length,
    percent: total > 0 ? Math.round((right / total) * 100) : 0,
    bySection: sectionRollup(rows),
    weakTopics: weakTopicRollup(rows),
  }
}

/** §4.2's `bySection`. Paper order, one row per named section. */
export function sectionRollup(rows = []) {
  const order = []
  const map = new Map()
  rows.forEach((r) => {
    const key = r.section || (r.part != null ? `Part ${r.part}` : 'The paper')
    if (!map.has(key)) {
      map.set(key, { part: r.part, name: key, right: 0, total: 0 })
      order.push(key)
    }
    const s = map.get(key)
    s.total += 1
    if (r.correct) s.right += 1
  })
  return order.map((k) => map.get(k))
}

/**
 * §4.2's `weakTopics`. Ranked by marks lost; BLANKS COUNT, because skipping
 * every question on one topic is the clearest evidence there is about that
 * topic, and that learner is exactly who the list is for.
 */
export function weakTopicRollup(rows = []) {
  const map = new Map()
  rows.filter((r) => !r.correct).forEach((r) => {
    if (!r.topicId) return
    if (!map.has(r.topicId)) map.set(r.topicId, { topicId: r.topicId, missed: 0, questions: [] })
    const t = map.get(r.topicId)
    t.missed += 1
    t.questions.push(r.n)
  })
  return [...map.values()].sort((a, b) => b.missed - a.missed || a.topicId.localeCompare(b.topicId))
}

/**
 * Topic-mastery increments (§4.3), for BOTH modes.
 *
 * Returns one entry per topic touched, with how many were SEEN and how many
 * were WRONG, so the caller can apply them with `FieldValue.increment` in one
 * batch rather than a read-modify-write per question.
 *
 * A blank counts as seen and wrong — the learner met the topic and did not
 * answer it, and a mastery figure that only counts attempted questions reports
 * a learner who skips their weak topics as having no weak topics.
 */
export function topicStatUpdates(rows = [], meta = {}) {
  const map = new Map()
  rows.forEach((r) => {
    if (!r.topicId || r.voided) return
    if (!map.has(r.topicId)) {
      map.set(r.topicId, {
        topicId: r.topicId,
        topic: r.topic || r.topicId,
        section: r.section || '',
        subject: meta?.subject || '',
        grade: meta?.grade ?? null,
        seen: 0,
        wrong: 0,
      })
    }
    const t = map.get(r.topicId)
    t.seen += 1
    if (!r.correct) t.wrong += 1
  })
  return [...map.values()]
}

/**
 * `submitted` or `expired` (§5.3).
 *
 * A submission arriving after `expiresAt + graceSeconds` is stored `expired`
 * and SCORED ON WHAT ARRIVED. It is never refused and never zeroed: a slow
 * phone must not lose a paper, and the learner did the work.
 */
export function submissionStatus({ expiresAtMs, receivedAtMs, graceSeconds = 20 }) {
  // `expiresAtMs == null` is PRACTICE, which has no clock and can never be
  // late. Tested for explicitly rather than leaning on Number(): `Number(null)`
  // is 0, which is finite, so a null expiry read as "expired at the epoch" and
  // marked every practice submission `expired`.
  if (expiresAtMs === null || expiresAtMs === undefined) return 'submitted'
  const expires = Number(expiresAtMs)
  const at = Number(receivedAtMs)
  if (!Number.isFinite(expires) || expires <= 0 || !Number.isFinite(at)) return 'submitted'
  return at > expires + graceSeconds * 1000 ? 'expired' : 'submitted'
}

/**
 * Answers that arrived for questions not on this paper are DROPPED, silently
 * and before marking. Not an error: a paper edited mid-attempt (a question
 * removed by an admin) produces exactly this, and refusing the whole
 * submission would punish the learner for an editorial act.
 */
export function pruneAnswers(answers = {}, questions = []) {
  const known = new Set((Array.isArray(questions) ? questions : []).map((q) => String(q?.id)))
  const out = {}
  Object.keys(answers || {}).forEach((k) => {
    if (known.has(String(k))) out[String(k)] = answers[k]
  })
  return out
}
