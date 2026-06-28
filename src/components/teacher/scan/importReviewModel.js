/**
 * importReviewModel — pure logic behind the Test Paper Studio photo-import
 * review screen.
 *
 * After a scanned/photographed paper is OCR'd into studio `sections`, the review
 * screen shows the teacher what was reconstructed, grouped by source page, with
 * the figures that need a decision and the questions that need attention
 * highlighted — before anything lands in the builder. This module turns the
 * studio's section/question shape into that page-grouped, signalled model.
 *
 * It deliberately holds NO React / DOM / Firebase dependency so it unit-tests
 * under plain `node` (see importReviewModel.test.js). The component layer
 * supplies page image URLs and writes edits back through callbacks.
 *
 * Signals (per item) mirror the product spec's highlight list:
 *   - needsReview    — the importer flagged it (requiresReview)
 *   - noAnswer       — an MCQ/true-false with no correct answer set yet
 *   - lowConfidence  — OCR was unsure of the wording (from reviewNotes)
 *   - hasDiagram     — a figure was detected for this item
 *   - missingDiagram — a figure was detected but no image is attached (cropped
 *                      content lost / never produced)
 *   - extraDiagrams  — count of EXTRA figures detected on the same item beyond
 *                      the single one the studio can attach (so the teacher
 *                      knows to add the rest with the Diagram Scanner)
 *   - missingAlt     — pictorial options without alt text
 */

export function stripTags(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isMcqLike(type) {
  const t = String(type || 'mcq').toLowerCase()
  return t === 'mcq' || t === 'multiple_choice' || t === 'true_false' || t === 'truefalse' || t === 'tf'
}

const LOW_CONFIDENCE_RE =
  /could\s*n.?t read|couldn.?t make out|unclear|illegible|low.?confidence|unsure|hard to read/i

/**
 * Compute the review signals for one question or passage object.
 */
export function getItemSignals(item = {}) {
  const detected = Array.isArray(item.detectedDiagrams) ? item.detectedDiagrams : []
  const notes = Array.isArray(item.reviewNotes) ? item.reviewNotes : []
  const hasImage = Boolean(item.imageUrl || item.imageAssetId)
  const hasDiagram = detected.length > 0 || Boolean(item.hasDiagram) || hasImage

  const noAnswer =
    isMcqLike(item.type) && (item.correctAnswer === '' || item.correctAnswer == null)

  const lowConfidence =
    notes.some((n) => LOW_CONFIDENCE_RE.test(String(n))) ||
    (Number.isFinite(item.ocrConfidence) && item.ocrConfidence < 0.5)

  // A figure was detected but nothing is attached to render — content the
  // teacher needs to redraw or re-crop.
  const missingDiagram = (detected.length > 0 || Boolean(item.hasDiagram)) && !hasImage

  // Claude often detects several figures on one question, but the question shape
  // holds a single image, so the importer attaches only the primary and records
  // how many it left behind. Surface that count so the teacher can add the rest
  // with the Diagram Scanner instead of them being silently dropped.
  const extraDiagrams = Number.isFinite(item.diagramMeta?.extraCount)
    ? Math.max(0, item.diagramMeta.extraCount)
    : Math.max(0, detected.length - 1)

  const missingAlt =
    Array.isArray(item.optionMedia) &&
    item.optionMedia.some(
      (m) => m && (m.imageUrl || m.imageAssetId) && !String(m.alt || '').trim(),
    )

  // A "label the diagram" question (the diagram editor in identify mode) with
  // no labels to place — the teacher needs to add the parts to name.
  const isIdentifyDiagram =
    String(item.type) === 'diagram' && String(item.diagramMode) === 'identify'
  const missingLabels =
    isIdentifyDiagram &&
    !(Array.isArray(item.diagramLabels) && item.diagramLabels.length > 0)

  const issues = []
  if (noAnswer) issues.push('No answer')
  if (lowConfidence) issues.push('Low confidence')
  if (missingDiagram) issues.push('Missing diagram')
  if (missingLabels) issues.push('Missing labels')
  if (missingAlt) issues.push('Missing alt text')
  if (item.requiresReview && !issues.length) issues.push('Check wording')

  return {
    needsReview: Boolean(item.requiresReview),
    noAnswer,
    lowConfidence,
    hasDiagram,
    missingDiagram,
    extraDiagrams,
    missingLabels,
    missingAlt,
    issues,
  }
}

/**
 * Flatten studio sections into addressable review items, in document order.
 * Each item carries the indices needed to write an edit back via the studio's
 * `updateSection(sectionIndex, updater)` mutator.
 *
 * For a passage section we emit the passage itself (it may own a shared figure)
 * followed by one item per sub-question.
 */
export function flattenReviewItems(sections = []) {
  const items = []
  let runningNumber = 0

  ;(Array.isArray(sections) ? sections : []).forEach((section, sectionIndex) => {
    if (section?.kind === 'passage' && section.passage) {
      const p = section.passage
      items.push({
        key: `s${sectionIndex}-passage`,
        sectionIndex,
        questionIndex: null,
        kind: 'passage',
        label: stripTags(p.title) || 'Reading passage',
        sourcePage: p.sourcePage ?? null,
        ref: p,
      })
      ;(Array.isArray(p.questions) ? p.questions : []).forEach((q, questionIndex) => {
        runningNumber += 1
        items.push({
          key: `s${sectionIndex}-q${questionIndex}`,
          sectionIndex,
          questionIndex,
          kind: 'passage-question',
          label: `Q${q?.sourceQuestionNumber || runningNumber}`,
          sourcePage: q?.sourcePage ?? p.sourcePage ?? null,
          ref: q,
        })
      })
    } else if (section?.question) {
      const q = section.question
      runningNumber += 1
      items.push({
        key: `s${sectionIndex}-standalone`,
        sectionIndex,
        questionIndex: null,
        kind: 'standalone',
        label: `Q${q?.sourceQuestionNumber || runningNumber}`,
        sourcePage: q?.sourcePage ?? null,
        ref: q,
      })
    }
  })

  return items
}

/**
 * Group flattened items by their source page, preserving page order. Items with
 * no page number land in a trailing group with page=null.
 */
export function groupReviewItemsByPage(items = []) {
  const order = []
  const byPage = new Map()
  items.forEach((item) => {
    const page = item.sourcePage == null ? null : item.sourcePage
    if (!byPage.has(page)) {
      byPage.set(page, [])
      order.push(page)
    }
    byPage.get(page).push(item)
  })
  order.sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    return a - b
  })
  return order.map((page) => ({ page, items: byPage.get(page) }))
}

/**
 * Build the full review model from studio sections.
 * @param {Array} sections
 * @param {object} [pageImageUrls] map of page number → original page image URL
 *   (optional; the original figure for each item always comes from its own crop)
 */
export function buildReviewModel(sections = [], pageImageUrls = {}) {
  const items = flattenReviewItems(sections).map((item) => ({
    ...item,
    signals: getItemSignals(item.ref),
    preview: stripTags(
      item.kind === 'passage' ? item.ref?.passageText : item.ref?.text,
    ).slice(0, 280),
    originalFigureUrl: item.ref?.imageUrl || null,
  }))

  const pages = groupReviewItemsByPage(items).map((group) => ({
    page: group.page,
    originalUrl: group.page == null ? null : pageImageUrls[group.page] || null,
    items: group.items,
  }))

  return { pages, summary: summarizeReviewModel({ pages }) }
}

export function summarizeReviewModel(model = {}) {
  const pages = Array.isArray(model.pages) ? model.pages : []
  let totalItems = 0
  let needsReview = 0
  let lowConfidence = 0
  let withDiagrams = 0
  let missingDiagrams = 0
  let missingLabels = 0
  let noAnswer = 0
  pages.forEach((p) => {
    p.items.forEach((item) => {
      if (item.kind === 'passage') {
        if (item.signals.hasDiagram) withDiagrams += 1
        if (item.signals.missingDiagram) missingDiagrams += 1
        return
      }
      totalItems += 1
      if (item.signals.needsReview) needsReview += 1
      if (item.signals.lowConfidence) lowConfidence += 1
      if (item.signals.hasDiagram) withDiagrams += 1
      if (item.signals.missingDiagram) missingDiagrams += 1
      if (item.signals.missingLabels) missingLabels += 1
      if (item.signals.noAnswer) noAnswer += 1
    })
  })
  return {
    pageCount: pages.length,
    totalItems,
    needsReview,
    lowConfidence,
    withDiagrams,
    missingDiagrams,
    missingLabels,
    noAnswer,
  }
}

/**
 * Whether every page in the model has been approved by the teacher.
 * @param {object} model
 * @param {Set|Array} approvedPages set/array of approved page keys
 */
export function isReviewComplete(model = {}, approvedPages = new Set()) {
  const set = approvedPages instanceof Set ? approvedPages : new Set(approvedPages)
  const pages = Array.isArray(model.pages) ? model.pages : []
  if (!pages.length) return false
  return pages.every((p) => set.has(pageKey(p.page)))
}

// Stable key for a page value (null → "null") so it survives a Set.
export function pageKey(page) {
  return page == null ? 'null' : String(page)
}
