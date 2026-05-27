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
 * Comprehension passages are intentionally out of scope for now —
 * matching them robustly across re-imports needs more signal than a
 * single sourceQuestionNumber, and they're rare in past-paper imports.
 * Passages flow through merge unchanged: existing passages stay, new
 * passages append.
 */

import { richTextToPlainText } from './quizRichText.js'

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
  if (String(existing.correctAnswer ?? '') !== String(incoming.correctAnswer ?? '')) return true
  if (normaliseField(existing.explanation) !== normaliseField(incoming.explanation)) return true
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
  const existingByNumber = new Map()
  const existingPassages = []
  existing.forEach((section) => {
    if (section?.kind === 'passage') {
      existingPassages.push(section)
      return
    }
    const num = sourceNumber(section)
    if (num) existingByNumber.set(num, section)
  })

  const incomingByNumber = new Map()
  const incomingPassages = []
  incoming.forEach((section) => {
    if (section?.kind === 'passage') {
      incomingPassages.push(section)
      return
    }
    const num = sourceNumber(section)
    if (num) incomingByNumber.set(num, section)
  })

  const added = []
  const changed = []
  const unchanged = []
  const removed = []

  // Walk incoming in its order so the UI shows them grouped naturally.
  incomingByNumber.forEach((incomingSection, num) => {
    if (existingByNumber.has(num)) {
      const existingSection = existingByNumber.get(num)
      if (isQuestionChanged(existingSection.question, incomingSection.question)) {
        changed.push({
          sourceQuestionNumber: num,
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

  existingByNumber.forEach((existingSection, num) => {
    if (!incomingByNumber.has(num)) {
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
  const incomingByNumber = new Map()
  const incomingPassages = []
  incoming.forEach((section) => {
    if (section?.kind === 'passage') {
      incomingPassages.push(section)
      return
    }
    const num = sourceNumber(section)
    if (num) incomingByNumber.set(num, section)
  })

  const usedNumbers = new Set()
  const merged = []

  // Walk existing in its current order so any reordering the teacher
  // applied is preserved on top of the merge.
  existing.forEach((section) => {
    if (section?.kind === 'passage') {
      merged.push(section)
      return
    }
    const num = sourceNumber(section)
    if (num && incomingByNumber.has(num)) {
      const incomingSection = incomingByNumber.get(num)
      // Take the incoming content but preserve identity fields so the
      // Firestore record updates in place. The teacher's manual fields
      // that the importer doesn't set (topic, partId) carry over.
      merged.push({
        ...incomingSection,
        id: section.id,
        question: {
          ...incomingSection.question,
          _id: section.question?._id,
          localId: section.question?.localId,
          partId: section.question?.partId ?? incomingSection.question?.partId ?? null,
          topic: section.question?.topic || incomingSection.question?.topic || '',
        },
      })
      usedNumbers.add(num)
    } else {
      merged.push(section)
    }
  })

  // Append incoming-only standalones (and any passages from the new
  // import after the existing passages already in `merged`).
  incoming.forEach((section) => {
    if (section?.kind === 'passage') {
      // Avoid pushing the same passage twice — the heuristic is naive
      // (object identity), which is good enough for the typical flow
      // where existing passages came from Firestore and incoming
      // passages came from the importer.
      if (!merged.includes(section)) merged.push(section)
      return
    }
    const num = sourceNumber(section)
    if (num && usedNumbers.has(num)) return
    merged.push(section)
  })

  return merged
}
