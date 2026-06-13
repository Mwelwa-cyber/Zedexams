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
