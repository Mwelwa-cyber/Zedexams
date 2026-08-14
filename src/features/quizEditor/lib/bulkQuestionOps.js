/**
 * bulkQuestionOps — pure helpers behind the Quiz Editor's bulk-selection
 * toolbar (BulkActionBar in QuizSectionsEditor.jsx).
 *
 * Two capabilities on top of the existing bulk delete / bulk marks:
 *   - sanitizeBulkPatch: validate a "apply to all selected" field patch
 *     (topic, CBC tags, difficulty, Bloom's, marks) against the question
 *     schema's bounds, so one toolbar Apply can never poison N cards.
 *   - mergeStandaloneSections: combine 2+ selected standalone questions into
 *     the first one (document order) — the fix-up for an importer that split
 *     one printed question into fragments. Text concatenates, marks sum
 *     (clamped to the schema cap), figures are kept (absorbed stems' images
 *     move into the survivor's images[]), and absorbed questions' Firestore
 *     ids are returned so the caller can queue their deletion.
 *
 * No React/DOM/Firebase dependency — unit-tested under plain `node`
 * (bulkQuestionOps.test.js). ensureRichTextHtml degrades gracefully without
 * a DOM, so text merging works in both environments.
 */

import { ensureRichTextHtml, extractRichTextPlain } from '../../../utils/quizRichText.js'
import { normalizeMarks, MARKS_BOUNDS } from '../../../utils/questionType.js'

// Fields the bulk-patch toolbar may set, with their sanitisers. Mirrors the
// question schema's bounds (src/editor/schema/question.js) so an applied
// patch always round-trips the strict write schema.
const DIFFICULTIES = ['easy', 'medium', 'hard']
const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']

const PATCH_SANITIZERS = {
  marks: (value) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return undefined
    return normalizeMarks(n, MARKS_BOUNDS.quiz)
  },
  topic: (value) => String(value ?? '').trim().slice(0, 200) || undefined,
  subtopic: (value) => String(value ?? '').trim().slice(0, 200) || undefined,
  competency: (value) => String(value ?? '').trim().slice(0, 200) || undefined,
  specificOutcome: (value) => String(value ?? '').trim().slice(0, 500) || undefined,
  curriculum: (value) => String(value ?? '').trim().slice(0, 100) || undefined,
  difficulty: (value) => (DIFFICULTIES.includes(value) ? value : undefined),
  bloom: (value) => (BLOOM_LEVELS.includes(value) ? value : undefined),
}

export const BULK_PATCH_FIELDS = Object.keys(PATCH_SANITIZERS)

/**
 * Reduce a raw toolbar patch to the fields that are allowed AND carry a
 * usable value. Empty strings / unknown enums / junk numbers are dropped
 * rather than applied, so "Apply" with a half-filled form only touches the
 * fields the teacher actually filled in.
 */
export function sanitizeBulkPatch(patch = {}) {
  const out = {}
  for (const [field, sanitize] of Object.entries(PATCH_SANITIZERS)) {
    if (!(field in patch)) continue
    const value = sanitize(patch[field])
    if (value !== undefined) out[field] = value
  }
  return out
}

// ── Merge ─────────────────────────────────────────────────────────

function questionDbIds(question) {
  const id = question?._id || question?.id
  return id ? [id] : []
}

function plainish(value) {
  return String(value ?? '').trim()
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Fold any rich-text shape to an HTML string. ensureRichTextHtml handles
// HTML / stringified-Tiptap / plain; for Tiptap doc OBJECTS it needs Tiptap's
// DOM-backed generateHTML, which can fail (returns '') outside a browser —
// fall back to the pure plain-text extraction so merged content is never
// silently dropped, whatever the environment.
function richToHtml(value) {
  const html = ensureRichTextHtml(value)
  if (html) return html
  const plain = extractRichTextPlain(value)
  if (!plain) return ''
  return plain
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * Concatenate two rich-text values into one HTML string. Each side may be an
 * HTML string, a Tiptap JSON doc (object), a stringified Tiptap doc, or plain
 * text; empty sides drop out.
 */
export function mergeRichText(first, second) {
  const a = richToHtml(first)
  const b = richToHtml(second)
  if (!a) return b
  if (!b) return a
  return `${a}${b}`
}

const MAX_EXTRA_IMAGES = 6 // images[] cap in the question schema

/**
 * Merge the selected standalone sections into the FIRST selected one (in
 * document order). Only standalone sections participate (passage children
 * have their own grouping semantics); non-standalone / unknown ids in the
 * selection are ignored.
 *
 * Returns { sections, mergedCount, removedQuestionIds, notes } where
 * `mergedCount` is how many questions were absorbed (0 = nothing to do,
 * input returned untouched), and `removedQuestionIds` are the absorbed
 * questions' Firestore ids for the caller's deletion queue.
 */
export function mergeStandaloneSections(sections = [], selectedIds = []) {
  const wanted = new Set(Array.isArray(selectedIds) ? selectedIds : [])
  const list = Array.isArray(sections) ? sections : []
  const picked = list.filter(
    (section) => section && section.kind !== 'passage' && section.kind !== 'pagebreak' &&
      section.question && wanted.has(section.id),
  )
  if (picked.length < 2) {
    return { sections: list, mergedCount: 0, removedQuestionIds: [], notes: [] }
  }

  const [targetSection, ...absorbedSections] = picked
  const target = targetSection.question
  const absorbed = absorbedSections.map((section) => section.question)

  const notes = []

  // Text: target stem + each absorbed stem, in order.
  let text = target.text
  for (const question of absorbed) {
    text = mergeRichText(text, question.text)
  }

  // Explanations concatenate the same way (usually only one side has any).
  let explanation = target.explanation
  for (const question of absorbed) {
    explanation = mergeRichText(explanation, question.explanation)
  }

  // Marks: sum, clamped to the schema cap so a 12+12 merge can't fail save.
  const totalMarks = picked.reduce(
    (sum, section) => sum + (Number(section.question.marks) || 1), 0,
  )
  const marks = normalizeMarks(totalMarks, MARKS_BOUNDS.quiz)
  if (marks !== totalMarks) {
    notes.push(`Combined marks (${totalMarks}) exceeded the ${MARKS_BOUNDS.quiz.max}-mark cap and were clamped.`)
  }

  // Figures: keep every absorbed image by moving it into the survivor's
  // stacked images[] (schema cap 6; overflow becomes a review note instead of
  // a silent drop).
  const extraImages = [...(Array.isArray(target.images) ? target.images : [])]
  for (const question of absorbed) {
    if (plainish(question.imageUrl)) {
      extraImages.push({
        url: question.imageUrl,
        alt: plainish(question.imageAlt),
        width: question.imageWidth || 'full',
      })
    }
    for (const image of Array.isArray(question.images) ? question.images : []) {
      if (image && plainish(image.url)) extraImages.push(image)
    }
  }
  const images = extraImages.slice(0, MAX_EXTRA_IMAGES)
  if (extraImages.length > MAX_EXTRA_IMAGES) {
    notes.push(`${extraImages.length - MAX_EXTRA_IMAGES} merged figure(s) exceeded the ${MAX_EXTRA_IMAGES}-image cap — re-attach them manually.`)
  }

  // Answer model: the survivor keeps its own type/options/answer. If an
  // absorbed question carried its own options, flag it — the teacher should
  // confirm nothing answerable was lost.
  const absorbedWithOptions = absorbed.filter(
    (question) => Array.isArray(question.options) && question.options.some((option) => plainish(option)),
  ).length
  if (absorbedWithOptions) {
    notes.push(`${absorbedWithOptions} merged question(s) had their own answer options — check the combined question still reads correctly.`)
  }

  const reviewNotes = [
    ...new Set([
      ...(Array.isArray(target.reviewNotes) ? target.reviewNotes : []),
      ...absorbed.flatMap((question) => Array.isArray(question.reviewNotes) ? question.reviewNotes : []),
      ...notes,
      `Merged from ${picked.length} questions.`,
    ]),
  ]
  const importWarnings = [
    ...new Set([
      ...(Array.isArray(target.importWarnings) ? target.importWarnings : []),
      ...absorbed.flatMap((question) => Array.isArray(question.importWarnings) ? question.importWarnings : []),
    ]),
  ]

  const mergedQuestion = {
    ...target,
    text,
    explanation,
    marks,
    images,
    reviewNotes,
    importWarnings,
    requiresReview: true,
  }

  const absorbedSectionIds = new Set(absorbedSections.map((section) => section.id))
  const outSections = list
    .filter((section) => !absorbedSectionIds.has(section.id))
    .map((section) => (
      section.id === targetSection.id
        ? { ...section, question: mergedQuestion }
        : section
    ))

  return {
    sections: outSections,
    mergedCount: absorbed.length,
    removedQuestionIds: absorbed.flatMap(questionDbIds),
    notes,
  }
}
