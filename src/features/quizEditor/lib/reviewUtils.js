/**
 * reviewUtils — pure helper for the Quiz Editor's review panel.
 *
 * After a scanned import, dozens of questions need a final pass: an answer set,
 * a flagged extraction confirmed, alt text added to a picture option. This
 * collects exactly those into a jump-list so the admin can step through them
 * instead of scrolling 60 cards.
 *
 * Pure and read-only — it never mutates a question, addresses them by stable
 * `localId`, and walks sections in display order so the numbers line up with
 * the editor.
 */

const ANSWERABLE_TYPES = new Set(['mcq', 'truefalse', 'tf'])

function hasAnswer(question) {
  const answer = question?.correctAnswer
  if (Number.isInteger(answer)) return true
  // Legacy / imported quizzes sometimes store the option index as a numeric
  // string ("2") rather than a number. Treat those as answered too — otherwise
  // a question with a perfectly valid key gets flagged "No answer" for no
  // reason. An empty string / blank still counts as unanswered.
  if (typeof answer === 'string') {
    const trimmed = answer.trim()
    return trimmed !== '' && Number.isInteger(Number(trimmed))
  }
  return false
}

function optionImagesMissingAlt(question) {
  const media = Array.isArray(question?.optionMedia) ? question.optionMedia : []
  return media.some(slot =>
    slot && typeof slot === 'object' &&
    (slot.imageUrl || slot.imageAssetId) &&
    !String(slot.alt ?? '').trim())
}

/**
 * Build the review jump-list. Returns { items, total } where each item is
 * { localId, number, inPassage, issues: string[], notes: string[] } for a
 * question that needs attention, and `total` is every question (for an
 * "N of M" readout).
 *
 * Issues reported:
 *   - 'No answer'        — an MCQ/TF with no correct option set
 *   - 'Flagged'          — question.requiresReview is true
 *   - 'Missing alt text' — a picture option with no alt text
 *   - 'Low confidence'   — an AI-imported question the model was unsure about
 *                          (aiConfidence < 0.8 — mirrors the server's
 *                          confidenceBand 'review'/'approve' threshold)
 *   - 'Missing image'    — the question's shared map/figure passage was
 *                          located by the importer but never got an image
 *                          attached (a failed/skipped figure-attach)
 *
 * `notes` carries the specific reasons a question was flagged (from
 * question.reviewNotes, falling back to importWarnings) so the panel can
 * tell the teacher *why* it needs a look, not just *that* it does.
 */
const LOW_CONFIDENCE_THRESHOLD = 0.8

function isLowConfidence(question) {
  const c = question?.aiConfidence
  return c != null && Number.isFinite(Number(c)) && Number(c) < LOW_CONFIDENCE_THRESHOLD
}

function passageMissingImage(passage) {
  if (!passage) return false
  const isMap = passage.passageKind === 'map' || passage.passageKind === 'diagram'
  const located = Boolean(passage.figureMeta) // the importer found a printed figure for this passage
  return isMap && located && !String(passage.imageUrl ?? '').trim()
}

export function collectReviewItems(sections = []) {
  const items = []
  let total = 0

  const inspect = (question, inPassage, passage) => {
    if (!question) return
    total += 1
    const number = Number.isFinite(question.sourceQuestionNumber)
      ? question.sourceQuestionNumber
      : total

    const issues = []
    if (ANSWERABLE_TYPES.has(question.type || 'mcq') && !hasAnswer(question)) {
      issues.push('No answer')
    }
    if (question.requiresReview) issues.push('Flagged')
    if (optionImagesMissingAlt(question)) issues.push('Missing alt text')
    if (isLowConfidence(question)) issues.push('Low confidence')
    if (passageMissingImage(passage)) issues.push('Missing image')

    if (issues.length && question.localId) {
      const noteSource = Array.isArray(question.reviewNotes) && question.reviewNotes.length
        ? question.reviewNotes
        : (Array.isArray(question.importWarnings) ? question.importWarnings : [])
      const notes = noteSource.map(note => String(note ?? '').trim()).filter(Boolean)
      items.push({ localId: question.localId, number, inPassage: Boolean(inPassage), issues, notes })
    }
  }

  sections.forEach(section => {
    if (section?.kind === 'passage') {
      (section.passage?.questions || []).forEach(q => inspect(q, true, section.passage))
    } else if (section?.kind === 'standalone') {
      inspect(section.question, false, null)
    }
    // pagebreak / unknown: nothing to review.
  })

  return { items, total }
}

/** Roll the items up into per-issue counts for the panel summary. */
export function summariseReviewIssues(items = []) {
  const counts = { 'No answer': 0, Flagged: 0, 'Missing alt text': 0, 'Low confidence': 0, 'Missing image': 0 }
  items.forEach(item => {
    item.issues.forEach(issue => {
      if (issue in counts) counts[issue] += 1
    })
  })
  return counts
}
