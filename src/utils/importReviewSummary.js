/**
 * Pure helper that turns a saved quiz or assessment record into the
 * minimal payload the ImportReviewBadge needs to render. Keeps the badge
 * stateless and the logic testable without React.
 *
 * Two inputs of interest live on the parent record (quizzes/{id} or
 * assessments/{id}):
 *   - mode: 'imported_document' when the record came in via the DOCX/PDF
 *     importer. Anything else is hand-authored or AI-generated and gets
 *     no badge.
 *   - importStatus: 'success' | 'needs_review' | undefined. Set on save
 *     based on whether any question accumulated requiresReview during the
 *     import.
 *   - importWarnings: array of human-readable warning strings the importer
 *     emitted (e.g. "PDF page 4 looked image-based. Review the imported
 *     diagram question before publishing.").
 *
 * The summarizer never inspects the questions subcollection — that would
 * cost a network round-trip per list row. Question-level review counts
 * are a Phase 8 if we want them.
 */

const MAX_SAMPLE_WARNINGS = 3
const MAX_WARNING_LENGTH = 160

function dedupeAndClamp(warnings = []) {
  const seen = new Set()
  const out = []
  for (const raw of warnings) {
    const text = String(raw || '').trim()
    if (!text) continue
    if (seen.has(text)) continue
    seen.add(text)
    out.push(text.length > MAX_WARNING_LENGTH ? `${text.slice(0, MAX_WARNING_LENGTH - 1)}…` : text)
    if (out.length >= MAX_SAMPLE_WARNINGS) break
  }
  return out
}

/**
 * Build a renderer-ready summary of a record's import-review state.
 *
 * Always returns an object — `isImported: false` is a valid result that
 * tells the caller "render nothing". Callers should branch on that flag
 * before reading the rest of the payload.
 */
export function summarizeImportReview(record = {}) {
  const isImported = record && record.mode === 'imported_document'
  if (!isImported) {
    return {
      isImported: false,
      needsReview: false,
      warningCount: 0,
      sampleWarnings: [],
      sourceFileName: '',
      sourceContentType: '',
    }
  }

  const warnings = Array.isArray(record.importWarnings) ? record.importWarnings : []
  const declaredStatus = String(record.importStatus || '').trim().toLowerCase()
  // A record is "needs review" if the saver flagged it (any question with
  // requiresReview, OR explicit status), OR if any warning text survived
  // into the persisted record. The latter catches edge cases where the
  // status wasn't set but the warnings array is non-empty.
  const needsReview = declaredStatus === 'needs_review' || warnings.length > 0

  return {
    isImported: true,
    needsReview,
    warningCount: warnings.length,
    sampleWarnings: dedupeAndClamp(warnings),
    sourceFileName: String(record.sourceFileName || '').trim(),
    sourceContentType: String(record.sourceContentType || '').trim(),
  }
}
