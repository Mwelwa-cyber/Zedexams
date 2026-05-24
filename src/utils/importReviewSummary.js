/**
 * Pure helper that turns a saved quiz or assessment record into the
 * minimal payload the ImportReviewBadge needs to render. Keeps the badge
 * stateless and the logic testable without React.
 *
 * Inputs of interest on the parent record (quizzes/{id} or
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
 *   - reviewCount: number (Phase 10). Snapshot of how many questions on
 *     the doc still carry requiresReview at last save. Recomputed on
 *     every save path so the badge / chip / banner stay truthful as
 *     teachers fix the flagged questions one by one. Falls back to the
 *     boolean importStatus signal when undefined (pre-Phase-10 docs).
 *
 * The summarizer never inspects the questions subcollection — that would
 * cost a network round-trip per list row.
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
      reviewCount: null,
      sampleWarnings: [],
      sourceFileName: '',
      sourceContentType: '',
    }
  }

  const warnings = Array.isArray(record.importWarnings) ? record.importWarnings : []
  const declaredStatus = String(record.importStatus || '').trim().toLowerCase()

  // Phase 10: reviewCount, when persisted, is the source of truth — it's
  // a fresh snapshot of how many questions still carry requiresReview at
  // the last save, so it stays honest as teachers fix flagged questions.
  // We accept either a number or a numeric string; anything else → null
  // and the badge/banner fall back to the boolean importStatus signal.
  const rawReviewCount = record.reviewCount
  const reviewCount = (() => {
    if (rawReviewCount == null) return null
    const n = Number(rawReviewCount)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  })()

  // A record is "needs review" if reviewCount > 0 (when available) — that
  // overrides the older boolean signal so a quiz with all flags cleared
  // stops nagging once the teacher saves. Falls back to the legacy signal
  // (status or warnings) for pre-Phase-10 docs where reviewCount is null.
  const needsReview = reviewCount !== null
    ? reviewCount > 0
    : declaredStatus === 'needs_review' || warnings.length > 0

  return {
    isImported: true,
    needsReview,
    warningCount: warnings.length,
    reviewCount,
    sampleWarnings: dedupeAndClamp(warnings),
    sourceFileName: String(record.sourceFileName || '').trim(),
    sourceContentType: String(record.sourceContentType || '').trim(),
  }
}
