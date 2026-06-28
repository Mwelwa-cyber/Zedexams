/**
 * Firebase-free core for the teacher Question Bank.
 *
 * A teacher can save individual questions from the Assessment Studio and
 * re-insert them into any future paper. These helpers shape what gets
 * stored and how search/filtering works; the Firestore I/O lives in
 * questionBankService.js. Keeping the logic here means it's unit-testable
 * under plain `node`.
 */

import { richTextToPlainText } from './quizRichText.js'

// Fields that are specific to a question's place in *one* paper, or are
// transient UI/runtime state. They must NOT travel with a saved question —
// otherwise a reused question would drag a stale part/passage link or an
// expired blob URL into the new paper.
const RUNTIME_FIELDS = [
  'localId', '_id', 'partId', 'passageId', 'order',
  'imageUploading', 'imageUploadStep', 'imageAssetId',
  'requiresReview', 'reviewNotes', 'importWarnings', 'sourcePage',
]

/** A short, plain-text snippet of the question stem for list rows. */
export function bankPreview(question) {
  const raw = String(question?.text ?? '')
  let text = ''
  try {
    text = richTextToPlainText(raw)
  } catch {
    text = raw
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
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
})

export const QUESTION_SOURCES = Object.freeze([
  'manual', 'ai', 'word', 'pdf', 'camera', 'past_paper',
  'quiz_studio', 'assessment_studio', 'test_paper_studio',
])

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

/** Strip HTML tags + entities to a plain lowercased string. Pure (no DOM). */
function plainify(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
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
