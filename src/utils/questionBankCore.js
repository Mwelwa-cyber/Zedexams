/**
 * Firebase-free core for the teacher Question Bank.
 *
 * A teacher can save individual questions from the Assessment Studio and
 * re-insert them into any future paper. These helpers shape what gets
 * stored and how search/filtering works; the Firestore I/O lives in
 * questionBankService.js. Keeping the logic here means it's unit-testable
 * under plain `node`.
 */

import { extractRichTextPlain } from './quizRichText.js'

// Fields that are specific to a question's place in *one* paper, or are
// transient UI/runtime state. They must NOT travel with a saved question —
// otherwise a reused question would drag a stale part/passage link or an
// expired blob URL into the new paper.
const RUNTIME_FIELDS = [
  'localId', '_id', 'partId', 'passageId', 'order',
  'imageUploading', 'imageUploadStep', 'imageAssetId',
  'requiresReview', 'reviewNotes', 'importWarnings', 'sourcePage',
]

/**
 * A short, plain-text snippet of the question stem for list rows.
 *
 * Uses extractRichTextPlain (not richTextToPlainText) so a stem stored as a
 * stringified Tiptap doc — the shape the quiz editor saves, see
 * serializeRichField in quizSections.js — is decoded to its readable text
 * rather than dumped verbatim as `{"type":"doc",...}` into the card title.
 */
export function bankPreview(question) {
  let text = ''
  try {
    text = extractRichTextPlain(question?.text)
  } catch {
    text = String(question?.text ?? '')
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 160)
}

/** Strip paper-specific + runtime fields before saving a reusable question. */
export function sanitizeQuestionForBank(question) {
  if (!question || typeof question !== 'object') return {}
  const clean = { ...question }
  for (const field of RUNTIME_FIELDS) delete clean[field]
  // Drop any lingering blob: URLs — they're dead outside the session that
  // created them. The reused question keeps a real Storage URL or nothing.
  if (typeof clean.imageUrl === 'string' && clean.imageUrl.startsWith('blob:')) {
    clean.imageUrl = ''
  }
  if (Array.isArray(clean.optionMedia)) {
    clean.optionMedia = clean.optionMedia.map(slot => {
      if (!slot || typeof slot !== 'object') return slot
      const next = { ...slot }
      if (typeof next.imageUrl === 'string' && next.imageUrl.startsWith('blob:')) delete next.imageUrl
      if (next.imageAssetId) delete next.imageAssetId
      return next
    })
  }
  return clean
}

/**
 * Client-side search match. Firestore has no full-text search, so we pull a
 * teacher's (bounded) bank and filter here. Every whitespace-separated token
 * must appear somewhere in the preview / topic / subject / type haystack.
 */
export function bankRowMatches(row, term) {
  const tokens = String(term || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const hay = [row?.preview, row?.topic, row?.subject, row?.type]
    .filter(Boolean).join(' ').toLowerCase()
  return tokens.every(t => hay.includes(t))
}

/** Newest-first comparator on a Firestore Timestamp-ish `createdAt`. */
export function byNewest(a, b) {
  const ta = a?.createdAt?.seconds ?? 0
  const tb = b?.createdAt?.seconds ?? 0
  return tb - ta
}

/* ------------------------------------------------------------------ *
 * Central Question Bank — status lifecycle + dedup/search helpers.
 *
 * A captured question travels through these statuses:
 *   pending_review → approved | needs_admin | duplicate | rejected
 *   duplicate → merged (an admin confirmed it against the original) | approved
 * plus the terminal/manual states private_saved & archived. The Master
 * Bank is simply the set of rows with masterEligible === true (only ever
 * true when reviewStatus === 'approved').
 * ------------------------------------------------------------------ */

export const REVIEW_STATUS = Object.freeze({
  PRIVATE_SAVED: 'private_saved',
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  NEEDS_ADMIN: 'needs_admin',
  DUPLICATE: 'duplicate',
  // Terminal: an admin confirmed the row really is a copy and linked it to the
  // original via duplicateOf. Distinct from DUPLICATE, which only means "Qix
  // suspects this is a copy" and still sits in the admin review queue.
  MERGED: 'merged',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
})

/**
 * The review state an admin curation backfill stamps on already-vetted platform
 * content so it lands straight in the shared Master Bank (visible to every
 * teacher) without per-question Qix review. Only admins may write this — see
 * the questionBank create/update rules.
 */
export const MASTER_REVIEW_STATE = Object.freeze({
  reviewStatus: REVIEW_STATUS.APPROVED,
  masterEligible: true,
})

export const QUESTION_SOURCES = Object.freeze([
  'manual', 'ai', 'word', 'pdf', 'camera', 'past_paper',
  'quiz_studio', 'assessment_studio', 'test_paper_studio', 'exam_paper_studio',
  'homework_studio',
])

/**
 * Map a Homework Studio question (`{prompt, answer, workingNotes}`) to the
 * editor shape the bank stores. Homework items are always plain short-answer
 * (no type/options), so they map to `short_answer` with the prompt as the stem,
 * the answer as the key, and the working notes as the marking guide. Returns
 * null when there's no stem or no answer (an unkeyed question isn't useful in
 * the bank), so weak items are dropped rather than banked.
 */
export function homeworkQuestionToBank(q, meta = {}) {
  if (!q || typeof q !== 'object') return null
  const text = String(q.prompt ?? q.text ?? '').trim()
  const correctAnswer = String(q.answer ?? q.correctAnswer ?? '').trim()
  if (!text || !correctAnswer) return null
  return {
    type: 'short_answer',
    text,
    options: [],
    correctAnswer,
    explanation: String(q.workingNotes ?? q.explanation ?? ''),
    topic: String(q.topic ?? meta.topic ?? ''),
    marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
  }
}

/**
 * Map a question from the server quiz/exam-paper schema (stem `question`, MCQ
 * `correctAnswer` as the option *text*) to the editor shape the bank stores
 * (stem `text`, MCQ `correctAnswer` as the option *index*). Used by the AI Exam
 * Paper Generator's capture path — the other capture surfaces already hold
 * editor-shaped questions, so they don't need this. Returns null when the item
 * can't be mapped cleanly (no stem, or an MCQ whose key isn't among its
 * options) so a broken question is dropped rather than banked.
 */
export function examPaperQuestionToBank(q) {
  if (!q || typeof q !== 'object') return null
  const stem = String(q.question ?? q.text ?? '').trim()
  if (!stem) return null

  const TYPE_MAP = { multiple_choice: 'mcq', true_false: 'tf', short_answer: 'short_answer' }
  const type = TYPE_MAP[String(q.type || 'multiple_choice')] || 'mcq'
  const options = Array.isArray(q.options) ? q.options.map(o => String(o)) : []
  const base = {
    type,
    text: stem,
    explanation: String(q.explanation || ''),
    topic: String(q.topic || ''),
    difficulty: q.difficulty || undefined,
    marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
  }

  if (type === 'mcq') {
    if (options.length < 2) return null
    const norm = s => String(s).trim().toLowerCase()
    const idx = options.findIndex(o => norm(o) === norm(q.correctAnswer))
    if (idx < 0) return null // key not among options → untrustworthy, drop
    return { ...base, options, correctAnswer: idx }
  }
  if (type === 'tf') {
    const t = String(q.correctAnswer).trim().toLowerCase()
    const correctAnswer = (t === 'true' || t === 't' || t === '0') ? 0 : 1
    return { ...base, options: ['True', 'False'], correctAnswer }
  }
  // short_answer
  const correctAnswer = String(q.correctAnswer ?? q.answer ?? '').trim()
  if (!correctAnswer) return null
  return { ...base, options: [], correctAnswer }
}

// Words too common to help tell two questions apart. Kept small and
// domain-neutral so we don't accidentally strip subject signal.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'is',
  'are', 'was', 'were', 'be', 'by', 'with', 'as', 'it', 'this', 'that', 'which',
  'what', 'who', 'whom', 'how', 'why', 'when', 'where', 'from', 'into', 'than',
  'then', 'so', 'if', 'about', 'above', 'below', 'between', 'following', 'each',
  'will', 'would', 'can', 'could', 'do', 'does', 'did', 'has', 'have', 'had',
  'not', 'no', 'yes', 'all', 'any', 'some', 'one', 'two', 'these', 'those',
])

/**
 * Decode any rich-text shape (stringified Tiptap doc, HTML, or plain) to a
 * plain lowercased string. Decoding via extractRichTextPlain first means a
 * quiz-editor stem stored as `{"type":"doc",...}` contributes its real words to
 * the fingerprint/tokens/keywords instead of JSON noise like `paragraph` or
 * `textAlign` — so an identical question banked as Tiptap and as HTML now
 * fingerprints the same.
 */
function plainify(value) {
  let text
  try {
    text = extractRichTextPlain(value)
  } catch {
    text = String(value ?? '')
  }
  // Entities are decoded in one pass ("&amp;" handled together with the rest)
  // so a double-encoded "&amp;lt;" can never decode all the way to "<".
  const entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>' }
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|#\d+);/gi, (m, name) => {
      const key = name.toLowerCase()
      // Numeric references (&#160; …) are noise for fingerprinting, as before.
      return key.startsWith('#') ? ' ' : entities[key]
    })
    .toLowerCase()
}

/** Collapse to the comparable essence of the question text: letters/digits only. */
function normalizeText(value) {
  return plainify(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Deterministic, dependency-free 32-bit FNV-1a hash → 8-char hex. */
function fnv1aHex(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return ('0000000' + h.toString(16)).slice(-8)
}

/** The text we treat as the question's identity: stem + sorted normalized options. */
function identityText(question) {
  const stem = normalizeText(question?.text)
  const opts = Array.isArray(question?.options)
    ? question.options.map(o => normalizeText(o)).filter(Boolean).sort()
    : []
  return opts.length ? `${stem} :: ${opts.join(' | ')}` : stem
}

/**
 * Exact-duplicate fingerprint. Two questions with the same stem + same set
 * of options (order-independent) hash identically. Used for the cheap
 * first-pass dedup before any near-duplicate similarity work.
 */
export function questionFingerprint(question) {
  return fnv1aHex(identityText(question))
}

/**
 * Significant tokens for near-duplicate Jaccard comparison. Sorted, unique,
 * stopword-stripped words (length ≥ 3) drawn from the stem + options. Stored
 * on the doc as `simhashTokens` so the server compares arrays without
 * re-parsing rich text.
 */
export function questionTokens(question) {
  const text = `${normalizeText(question?.text)} ${
    Array.isArray(question?.options) ? question.options.map(o => normalizeText(o)).join(' ') : ''
  }`
  const set = new Set()
  for (const tok of text.split(/\s+/)) {
    if (tok.length >= 3 && !STOPWORDS.has(tok)) set.add(tok)
  }
  return [...set].sort()
}

/** Lowercased keyword list for search (tokens + topic/subject words). */
export function extractKeywords(question, meta = {}) {
  const base = questionTokens(question)
  const extra = `${meta.topic || question?.topic || ''} ${meta.subtopic || ''} ${meta.subject || ''}`
  const set = new Set(base)
  for (const tok of normalizeText(extra).split(/\s+/)) {
    if (tok.length >= 3) set.add(tok)
  }
  return [...set].sort().slice(0, 60)
}

/**
 * Jaccard similarity (|A∩B| / |A∪B|) of two token arrays, in [0,1].
 * Identical logic lives in functions/agents/questionDedupCore.js — keep them
 * in sync (both covered by tests).
 */
export function jaccardSimilarity(aTokens, bTokens) {
  const a = new Set(aTokens || [])
  const b = new Set(bTokens || [])
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}
