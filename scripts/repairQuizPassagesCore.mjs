/**
 * repairQuizPassagesCore — pure, dependency-free logic for the quiz repair
 * tool (scripts/repair-quiz-passages-and-counts.mjs).
 *
 * Kept free of firebase-admin so it runs under a bare `node` test — same split
 * as functions/quizSummary/buildSummary.js vs its trigger wiring.
 *
 * The problem it solves: a quiz doc carries several DENORMALISED fields that the
 * admin Content Library reads directly instead of counting the authoritative
 * data at render time —
 *   - questionCount  → the "N Q" on the card
 *   - reviewCount    → the "N to review" badge
 *   - passageCount   → passage total
 *   - passages[]     → the embedded comprehension / stimulus blocks
 * The real questions live in the quizzes/{id}/questions subcollection; the real
 * passage↔question link is question.passageId → passage.id. When the cached
 * fields drift out of sync with the subcollection (e.g. an autosave fired while
 * the subcollection had failed to load), a paper that still has all its
 * questions shows "0 Q" and its passages look lost.
 *
 * This module recomputes the cached fields FROM the subcollection and rebuilds
 * any passage a question still references but the parent doc has dropped. It is
 * strictly additive: it never removes a question, a passage, or any other field
 * — it only fixes counts and restores missing/blank passage blocks.
 */

const IMPORTED_MODE = 'imported_document'
const DEFAULT_PASSAGE_KIND = 'comprehension'

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Does this question still carry a "needs review" flag? Mirrors the editor's
 * computeReviewCount (EditQuizV2) — a truthy requiresReview.
 */
function questionNeedsReview(question) {
  return Boolean(question && question.requiresReview)
}

/**
 * Pull any inline passage text a question is carrying. Some import paths stored
 * the reading passage ON the question (question.passage / question.passageJSON,
 * see src/editor/schema/question.js) as well as on the parent passages[]. When
 * passages[] was lost we can recover the text from here.
 *
 * Returns { text, textJSON } where either may be '' / null when absent. Never
 * throws; treats non-string/object shapes as absent.
 */
export function extractInlinePassage(question) {
  const text =
    (isNonEmptyString(question?.passageText) && question.passageText) ||
    (isNonEmptyString(question?.passage) && question.passage) ||
    ''
  const rawJson = question?.passageJSON
  const textJSON =
    rawJson && typeof rawJson === 'object' && rawJson.type === 'doc' ? rawJson : null
  return { text, textJSON }
}

/**
 * Recompute the denormalised count fields from the authoritative questions
 * subcollection. Returns only the fields whose value the caller may want to
 * write; does not mutate its inputs.
 *
 * reviewCount matches the app's computeReviewCount semantics: it is only
 * meaningful for imported_document quizzes, so for any other mode we leave the
 * existing value untouched (recompute === current) rather than forcing 0 and
 * surprising a hand-authored quiz.
 */
export function recomputeCounts(quizData = {}, questions = [], mergedPassages) {
  const list = Array.isArray(questions) ? questions : []
  const questionCount = list.length
  const totalMarks = list.reduce((sum, q) => sum + toFiniteNumber(q?.marks, 1), 0)
  const passageCount = Array.isArray(mergedPassages)
    ? mergedPassages.length
    : toFiniteNumber(quizData?.passageCount, 0)

  const isImported = quizData?.mode === IMPORTED_MODE
  const reviewCount = isImported
    ? list.filter(questionNeedsReview).length
    : toFiniteNumber(quizData?.reviewCount, 0)

  return { questionCount, totalMarks, passageCount, reviewCount }
}

/**
 * Rebuild the passages[] array so every passage a question still references
 * exists, and any existing passage whose text was blanked is refilled from a
 * child question's inline copy where one survives.
 *
 * Strictly additive:
 *   - Existing passages are preserved verbatim; the ONLY mutation to an existing
 *     passage is filling a BLANK passageText/instructions/title from inline
 *     question data (never overwriting non-empty text).
 *   - A passage referenced by a question but missing from passages[] is
 *     recreated (recovered: true) with any inline text we can find, else an
 *     empty stub so the questions stay grouped instead of orphaned.
 *   - A passage with no surviving linked questions is kept, not dropped.
 *
 * Returns { passages, report } where report[] describes each recovered/refilled
 * passage so the runner can print an honest account of what was and wasn't
 * recoverable.
 */
export function rebuildPassages(existingPassages = [], questions = []) {
  const report = []
  const existing = (Array.isArray(existingPassages) ? existingPassages : [])
    .filter(p => p && typeof p === 'object' && isNonEmptyString(p.id))
  const byId = new Map(existing.map(p => [p.id, { ...p }]))

  // Group questions by the passage they reference, preserving order.
  const questionsByPassage = new Map()
  for (const q of Array.isArray(questions) ? questions : []) {
    const pid = q?.passageId
    if (!isNonEmptyString(pid)) continue
    if (!questionsByPassage.has(pid)) questionsByPassage.set(pid, [])
    questionsByPassage.get(pid).push(q)
  }

  // Pick the best inline text among a passage's linked questions.
  const inlineFor = (linked) => {
    for (const q of linked) {
      const inline = extractInlinePassage(q)
      if (inline.text || inline.textJSON) return inline
    }
    return { text: '', textJSON: null }
  }

  // 1. Refill blank text on EXISTING passages from inline question copies.
  for (const [pid, passage] of byId) {
    const linked = questionsByPassage.get(pid) || []
    if (!isNonEmptyString(passage.passageText) && !isNonEmptyString(passage.imageUrl)) {
      const inline = inlineFor(linked)
      if (inline.text) {
        passage.passageText = inline.text
        report.push({ id: pid, action: 'refilled-text', textRecovered: true })
      }
    }
  }

  // 2. Recreate passages a question references but the doc has dropped.
  let recoveredOrder = existing.reduce(
    (max, p) => Math.max(max, toFiniteNumber(p.order, 0)),
    0,
  )
  for (const [pid, linked] of questionsByPassage) {
    if (byId.has(pid)) continue
    recoveredOrder += 1
    const inline = inlineFor(linked)
    const minOrder = linked.reduce(
      (min, q) => Math.min(min, toFiniteNumber(q?.order, Number.MAX_SAFE_INTEGER)),
      Number.MAX_SAFE_INTEGER,
    )
    const passage = {
      id: pid,
      title: '',
      instructions: '',
      passageText: inline.text || '',
      imageUrl: '',
      passageKind: DEFAULT_PASSAGE_KIND,
      manualMarks: null,
      order: Number.isFinite(minOrder) && minOrder !== Number.MAX_SAFE_INTEGER
        ? minOrder
        : recoveredOrder,
      // Provenance so an admin can tell a recovered block from an original one.
      recovered: true,
    }
    byId.set(pid, passage)
    report.push({
      id: pid,
      action: 'recreated',
      textRecovered: Boolean(inline.text),
      linkedQuestions: linked.length,
    })
  }

  const passages = [...byId.values()].sort(
    (a, b) => toFiniteNumber(a.order, 0) - toFiniteNumber(b.order, 0),
  )
  return { passages, report }
}

/**
 * Plan the full repair for one quiz. Returns:
 *   { changed, updates, passageReport, before, after }
 * where `updates` is the minimal patch to write to the parent quiz doc (only
 * fields that actually changed), and `changed` is false when the doc is already
 * consistent. Never deletes anything; `updates` only ever adds/refreshes fields.
 */
export function planQuizRepair(quizData = {}, questions = []) {
  const { passages, report: passageReport } = rebuildPassages(
    quizData.passages || [],
    questions,
  )
  const counts = recomputeCounts(quizData, questions, passages)

  const before = {
    questionCount: toFiniteNumber(quizData.questionCount, 0),
    totalMarks: toFiniteNumber(quizData.totalMarks, 0),
    reviewCount: toFiniteNumber(quizData.reviewCount, 0),
    passageCount: Array.isArray(quizData.passages) ? quizData.passages.length : 0,
  }

  const updates = {}
  if (counts.questionCount !== before.questionCount) updates.questionCount = counts.questionCount
  if (counts.totalMarks !== before.totalMarks) updates.totalMarks = counts.totalMarks
  if (counts.reviewCount !== before.reviewCount) updates.reviewCount = counts.reviewCount

  // Only write passages when a block was recovered or refilled — otherwise we'd
  // rewrite the array for no reason (and risk re-serialising it needlessly).
  const passagesChanged = passageReport.length > 0
  if (passagesChanged) {
    updates.passages = passages
    updates.passageCount = passages.length
  } else if (counts.passageCount !== before.passageCount) {
    updates.passageCount = counts.passageCount
  }

  const changed = Object.keys(updates).length > 0
  return {
    changed,
    updates,
    passageReport,
    before,
    after: {
      questionCount: counts.questionCount,
      totalMarks: counts.totalMarks,
      reviewCount: counts.reviewCount,
      passageCount: passages.length,
    },
  }
}
