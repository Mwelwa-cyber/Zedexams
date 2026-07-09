/**
 * Re-import diff + merge for quiz sections.
 *
 * When a teacher re-uploads a corrected DOCX into an existing quiz, the
 * naive behaviour ("replace everything") obliterates every manual edit
 * they made after the first import (clearer wording, hand-typed answer
 * key, etc.). This module computes the diff between the editor's current
 * sections[] and the freshly-imported sections[] keyed by each
 * question's sourceQuestionNumber, then offers a merge that preserves
 * manual edits on questions that didn't change in the new file.
 *
 * Matching is OCCURRENCE-SCOPED: papers that restart numbering per
 * section legitimately contain two "Q1"s, so the Nth existing question
 * bearing a number pairs with the Nth incoming question bearing that
 * number — a bare number→section map would collapse to last-wins and
 * overwrite Section A with Section B's content.
 *
 * Answer preservation: scanned imports always arrive with a BLANK
 * correctAnswer (question papers print no key), so a blank incoming
 * answer/explanation is never treated as a change and never overwrites
 * the answer the teacher already set — otherwise the recommended
 * "re-import to catch missing questions" flow wiped the whole answer key.
 *
 * Passages are matched by content signature (title + first sub-question,
 * reusing documentQuizReconcile's sectionSignature): a matched passage
 * keeps the teacher's existing copy and gains only NEW child questions
 * (so a re-import can recover a missing comprehension question); an
 * unmatched passage appends.
 */

import { richTextToPlainText } from './quizRichText.js'
import { sectionSignature, matchScore } from '../components/quiz/documentQuizReconcile.js'

/**
 * Normalise a value to a stable string we can compare across imports.
 * Handles Tiptap JSON, JSON-stringified Tiptap docs, and plain strings.
 * Whitespace is collapsed so trivial paragraph reflow doesn't register
 * as a change.
 */
function normaliseField(value) {
  if (value == null) return ''
  if (typeof value === 'object') {
    try {
      return richTextToPlainText(value).replace(/\s+/g, ' ').trim()
    } catch {
      return ''
    }
  }
  return String(value).replace(/\s+/g, ' ').trim()
}

function optionsEqual(a, b) {
  const left = Array.isArray(a) ? a.map(normaliseField) : []
  const right = Array.isArray(b) ? b.map(normaliseField) : []
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

/**
 * True when the imported question differs from the existing one on any
 * field a teacher would care about. Runtime-only state (localId, _id,
 * imageUploading, etc.) is excluded.
 */
export function isQuestionChanged(existing, incoming) {
  if (!existing || !incoming) return Boolean(existing) !== Boolean(incoming)
  if (normaliseField(existing.text) !== normaliseField(incoming.text)) return true
  if (!optionsEqual(existing.options, incoming.options)) return true
  // A BLANK incoming answer/explanation is not a change: scanned imports never
  // carry a key, so "teacher set '2', re-import brings ''" must not flag the
  // question as changed (that path used to wipe every set answer on merge).
  const incomingAnswer = String(incoming.correctAnswer ?? '')
  if (incomingAnswer !== '' && String(existing.correctAnswer ?? '') !== incomingAnswer) return true
  const incomingExplanation = normaliseField(incoming.explanation)
  if (incomingExplanation !== '' && normaliseField(existing.explanation) !== incomingExplanation) return true
  if ((existing.marks || 1) !== (incoming.marks || 1)) return true
  if (normaliseField(existing.diagramText) !== normaliseField(incoming.diagramText)) return true
  if (normaliseField(existing.sharedInstruction) !== normaliseField(incoming.sharedInstruction)) return true
  if (String(existing.type || 'mcq') !== String(incoming.type || 'mcq')) return true
  return false
}

function sourceNumber(section) {
  if (!section || section.kind === 'passage') return null
  const raw = section.question?.sourceQuestionNumber
  if (raw === null || raw === undefined || raw === '') return null
  return String(raw)
}

/**
 * Index standalone sections by an OCCURRENCE-SCOPED number key: the Nth
 * section bearing printed number K gets key "K#N". Papers that restart
 * numbering per section carry the same printed number more than once, and a
 * bare-number map collapses them last-wins — Section A's questions would be
 * diffed/merged against Section B's content and destroyed. Occurrence pairing
 * matches first-with-first in document order instead.
 */
function indexByOccurrence(sections = []) {
  const counts = new Map()
  const byKey = new Map()
  const passages = []
  sections.forEach((section) => {
    if (section?.kind === 'passage') {
      passages.push(section)
      return
    }
    const num = sourceNumber(section)
    if (!num) return
    const occurrence = counts.get(num) || 0
    counts.set(num, occurrence + 1)
    byKey.set(`${num}#${occurrence}`, section)
  })
  return { byKey, passages }
}

// Carry a teacher's existing MCQ answer onto the re-imported question SAFELY.
// MCQ answers are stored as an option INDEX, so if the re-import changed the
// option text or order, blindly copying the old index would mark a different
// choice correct. So: unchanged options → keep the index; options changed but
// the correct option's TEXT still exists → remap to its new index; the correct
// option is gone → clear the answer and flag it for review rather than leave a
// silently-wrong one. Non-index answers (short-answer/essay/fill store a
// string) have no options to shift, so they carry over as-is. Returns the
// patch to apply to the merged question ({ correctAnswer, requiresReview?,
// reviewNote? }). Pure + exported for tests.
export function remapPreservedAnswer(existing = {}, incoming = {}) {
  const answer = existing.correctAnswer
  // String answer (written-response types) — options don't apply.
  if (!Number.isInteger(answer)) return { correctAnswer: answer }
  const existingOpts = Array.isArray(existing.options) ? existing.options : []
  const incomingOpts = Array.isArray(incoming.options) ? incoming.options : []
  // Options unchanged → the stored index still points at the same option.
  if (optionsEqual(existingOpts, incomingOpts)) return { correctAnswer: answer }
  // Options changed → follow the correct option by its TEXT to its new slot.
  const correctText = normaliseField(existingOpts[answer])
  if (correctText) {
    const newIndex = incomingOpts.findIndex((opt) => normaliseField(opt) === correctText)
    if (newIndex >= 0) return { correctAnswer: newIndex }
  }
  // The correct option no longer exists — don't guess. Clear + flag.
  return {
    correctAnswer: '',
    requiresReview: true,
    reviewNote: 'Options changed on re-import and the saved answer no longer matched an option — please set the correct answer.',
  }
}

// Blank-answer preservation for the merge: take the incoming question's
// content, but keep the existing answer/explanation when the incoming one is
// blank (scanned re-imports never carry a key — replacing would wipe the
// teacher's completed answer key). The answer is remapped, not blindly copied,
// so a changed option list can't silently mark the wrong choice correct.
function mergeQuestionPreservingAnswers(existingQuestion, incomingQuestion) {
  const incoming = incomingQuestion || {}
  const existing = existingQuestion || {}
  const next = { ...incoming }
  if (String(incoming.correctAnswer ?? '') === '' && String(existing.correctAnswer ?? '') !== '') {
    const mapped = remapPreservedAnswer(existing, incoming)
    next.correctAnswer = mapped.correctAnswer
    if (mapped.requiresReview) next.requiresReview = true
    if (mapped.reviewNote) {
      next.reviewNotes = [...new Set([...(Array.isArray(next.reviewNotes) ? next.reviewNotes : []), mapped.reviewNote])]
    }
  }
  if (normaliseField(incoming.explanation) === '' && normaliseField(existing.explanation) !== '') {
    next.explanation = existing.explanation
  }
  return next
}

// Key a passage child question for the union step: printed number when known,
// else its normalised stem.
function passageChildKey(question) {
  const n = Number(question?.sourceQuestionNumber)
  if (Number.isInteger(n) && n > 0) return `#${n}`
  return normaliseField(question?.text).toLowerCase()
}

// Two passages are the same printed passage when their content signatures
// match exactly or closely (OCR drift re-reads a title slightly differently).
const PASSAGE_MATCH_THRESHOLD = 0.6
function passagesMatch(sigA, sigB) {
  if (!sigA || !sigB) return false
  return sigA === sigB || matchScore(sigA, sigB) >= PASSAGE_MATCH_THRESHOLD
}

/**
 * Merge an incoming passage's child questions into the existing passage:
 *   - a child the existing passage already has (matched by printed number,
 *     else stem) is UPDATED to the re-imported content — so a re-import that
 *     corrects a comprehension question's OCR text/options is applied — while
 *     preserving the teacher's identity fields and answer (remapped, never
 *     blindly copied, exactly like standalone questions);
 *   - a genuinely NEW child (a question the first import missed and a re-import
 *     recovered) is appended at the end.
 * Returns the existing section untouched when nothing changed or was added.
 */
function unionPassageChildren(existingSection, incomingSection) {
  const existingQuestions = existingSection.passage?.questions || []
  const incomingQuestions = incomingSection.passage?.questions || []
  const incomingByKey = new Map()
  incomingQuestions.forEach((q) => {
    const key = passageChildKey(q)
    if (key && !incomingByKey.has(key)) incomingByKey.set(key, q)
  })

  let changed = false
  const updated = existingQuestions.map((existingChild) => {
    const key = passageChildKey(existingChild)
    const incomingChild = key ? incomingByKey.get(key) : null
    if (!incomingChild) return existingChild
    if (!isQuestionChanged(existingChild, incomingChild)) return existingChild
    changed = true
    // Take the re-imported content, keep the child's identity + a safely
    // remapped answer (same rules as the standalone merge below).
    return {
      ...mergeQuestionPreservingAnswers(existingChild, incomingChild),
      _id: existingChild._id,
      localId: existingChild.localId,
      partId: existingChild.partId ?? incomingChild.partId ?? null,
      topic: existingChild.topic || incomingChild.topic || '',
    }
  })

  const have = new Set(existingQuestions.map(passageChildKey).filter(Boolean))
  const additions = incomingQuestions.filter((q) => {
    const key = passageChildKey(q)
    return key && !have.has(key)
  })

  if (!changed && !additions.length) return existingSection
  return {
    ...existingSection,
    passage: {
      ...existingSection.passage,
      questions: [...updated, ...additions],
    },
  }
}

/**
 * Compute the diff between two sets of quiz sections, matching standalone
 * questions by sourceQuestionNumber. Comprehension passages flow through
 * as a separate bucket so callers can preserve them verbatim.
 *
 * Returns:
 *   added     — sections in `incoming` whose sourceQuestionNumber isn't
 *               in `existing`
 *   changed   — { sourceQuestionNumber, before, after } for matched
 *               sections that differ on any compared field
 *   unchanged — sections that matched and are identical
 *   removed   — sections in `existing` whose sourceQuestionNumber isn't
 *               in `incoming`
 *   existingPassages / incomingPassages — passage sections preserved
 *                                          unchanged for the merge step
 */
export function diffImportedSections(existing = [], incoming = []) {
  const { byKey: existingByKey, passages: existingPassages } = indexByOccurrence(existing)
  const { byKey: incomingByKey, passages: incomingPassages } = indexByOccurrence(incoming)

  const added = []
  const changed = []
  const unchanged = []
  const removed = []

  // Walk incoming in its order so the UI shows them grouped naturally.
  incomingByKey.forEach((incomingSection, key) => {
    if (existingByKey.has(key)) {
      const existingSection = existingByKey.get(key)
      if (isQuestionChanged(existingSection.question, incomingSection.question)) {
        changed.push({
          sourceQuestionNumber: key.slice(0, key.indexOf('#')),
          before: existingSection,
          after: incomingSection,
        })
      } else {
        unchanged.push(existingSection)
      }
    } else {
      added.push(incomingSection)
    }
  })

  existingByKey.forEach((existingSection, key) => {
    if (!incomingByKey.has(key)) {
      removed.push(existingSection)
    }
  })

  return {
    added,
    changed,
    unchanged,
    removed,
    existingPassages,
    incomingPassages,
  }
}

/**
 * Merge existing sections with the incoming import, keyed by
 * sourceQuestionNumber. Behaviour:
 *
 *   - Matched & unchanged    → keep the existing record (with its
 *                              _id / localId / manual edits intact)
 *   - Matched & changed      → replace WITH the incoming question text /
 *                              options / etc., but keep the existing
 *                              _id / localId / partId so the Firestore
 *                              record updates in place rather than
 *                              creating a new doc and deleting the old
 *   - In existing only       → keep verbatim (the teacher's manual
 *                              addition that the new docx doesn't carry)
 *   - In incoming only       → append at the end
 *   - Passages               → existing passages kept as-is; incoming
 *                              passages appended after them
 *
 * This is the "Update matched + add new" path the modal exposes.
 * "Replace all" goes through the existing replace flow, not this helper.
 */
export function mergeImportedSections(existing = [], incoming = []) {
  const { byKey: incomingByKey } = indexByOccurrence(incoming)
  // Incoming passages, with signatures, so an existing passage can claim its
  // re-imported counterpart (each incoming passage matches at most once).
  const incomingPassageInfo = incoming
    .filter((section) => section?.kind === 'passage')
    .map((section) => ({ section, signature: sectionSignature(section), used: false }))

  const usedKeys = new Set()
  const merged = []

  // Occurrence counter for the existing walk — pairs the Nth existing
  // question numbered K with the Nth incoming question numbered K.
  const existingCounts = new Map()

  // Walk existing in its current order so any reordering the teacher
  // applied is preserved on top of the merge.
  existing.forEach((section) => {
    if (section?.kind === 'passage') {
      // A re-imported copy of this passage? Keep the teacher's copy and union
      // in only the child questions the re-import newly recovered — never
      // append the whole passage again (that doubled every passage).
      const signature = sectionSignature(section)
      const match = signature
        ? incomingPassageInfo.find((p) => !p.used && passagesMatch(p.signature, signature))
        : null
      if (match) {
        match.used = true
        merged.push(unionPassageChildren(section, match.section))
      } else {
        merged.push(section)
      }
      return
    }
    const num = sourceNumber(section)
    const occurrence = num ? (existingCounts.get(num) || 0) : 0
    if (num) existingCounts.set(num, occurrence + 1)
    const key = num ? `${num}#${occurrence}` : null
    if (key && incomingByKey.has(key)) {
      const incomingSection = incomingByKey.get(key)
      // Take the incoming content but preserve identity fields so the
      // Firestore record updates in place. The teacher's manual fields
      // that the importer doesn't set (topic, partId) carry over, and a
      // blank incoming answer/explanation never overwrites a set one.
      merged.push({
        ...incomingSection,
        id: section.id,
        question: {
          ...mergeQuestionPreservingAnswers(section.question, incomingSection.question),
          _id: section.question?._id,
          localId: section.question?.localId,
          partId: section.question?.partId ?? incomingSection.question?.partId ?? null,
          topic: section.question?.topic || incomingSection.question?.topic || '',
        },
      })
      usedKeys.add(key)
    } else {
      merged.push(section)
    }
  })

  // Append incoming-only standalones and genuinely NEW passages (ones no
  // existing passage claimed above).
  const incomingCounts = new Map()
  incoming.forEach((section) => {
    if (section?.kind === 'passage') {
      const info = incomingPassageInfo.find((p) => p.section === section)
      if (info && !info.used) merged.push(section)
      return
    }
    const num = sourceNumber(section)
    const occurrence = num ? (incomingCounts.get(num) || 0) : 0
    if (num) incomingCounts.set(num, occurrence + 1)
    const key = num ? `${num}#${occurrence}` : null
    if (key && usedKeys.has(key)) return
    merged.push(section)
  })

  return merged
}
