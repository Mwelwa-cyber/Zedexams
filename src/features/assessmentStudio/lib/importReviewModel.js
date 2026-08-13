/**
 * importReviewModel — pure logic behind the Assessment Paper Studio
 * photo-import review screen.
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

import { bandFor, CONFIDENCE_BANDS } from './objectConfidence.js'

export function stripTags(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip HTML tags while converting block-end boundaries (</p>, <br>, </div>,
 * </h1>–</h6>) to newlines first, so paragraph and line structure survives.
 * Collapses only horizontal whitespace (spaces/tabs) — never newlines.
 * Does NOT slice; suitable for seeding an editable textarea with the full text.
 */
export function stripTagsPreservingBreaks(value) {
  let out = String(value == null ? '' : value)
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
  // Strip tags to a fixpoint so removals can't reassemble a tag
  // (e.g. "<scr<x>ipt>").
  let prev
  do {
    prev = out
    out = out.replace(/<[^>]*>/g, '')
  } while (out !== prev)
  // Decode entities in one pass ("&amp;" handled together with the rest) so a
  // double-encoded "&amp;lt;" can never decode all the way to "<".
  const entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>' }
  return out
    .replace(/&(nbsp|amp|lt|gt);/g, (m, name) => entities[name])
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escHtmlEntities(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Re-encode a plain-text string (from the editable textarea) back into the
 * studio's rich HTML shape: blank-line-separated blocks become <p>…</p> and
 * single newlines become <br>. Mirrors the toRichPreservingBreaks fallback in
 * scannedQuizImporter.js so the re-encoded output is structurally identical to
 * what the original importer would have produced.
 */
export function encodeToRichHtml(plain) {
  const text = String(plain ?? '').trim()
  if (!text) return ''
  const paragraphs = text.split(/\n{2,}/).map((block) =>
    `<p>${block
      .split(/\n/)
      .map((line) => escHtmlEntities(line.trim()))
      .filter(Boolean)
      .join('<br>')}</p>`,
  )
  return paragraphs.join('')
}

/**
 * True when the importQuizDocument result contains at least one question or
 * section. Used as the early-return guard in runImportDocument so a
 * zero-extraction parse does not wipe the current paper before the failure is
 * detected.
 */
export function importHasQuestions(imported) {
  return ((imported?.sections?.length || 0) + (imported?.questions?.length || 0)) > 0
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

  // Claude can detect several figures on one question. The importer now crops
  // and attaches all of them (primary → imageUrl, rest → images[]), so this
  // counts only figures it detected but could NOT attach (e.g. a crop that
  // failed) — surfaced so the teacher can add them with the Diagram Scanner.
  const attachedExtras = Array.isArray(item.images)
    ? item.images.filter((im) => im && im.url).length
    : 0
  const attachedCount = (hasImage ? 1 : 0) + attachedExtras
  const extraDiagrams = Number.isFinite(item.diagramMeta?.extraCount)
    ? Math.max(0, item.diagramMeta.extraCount)
    : Math.max(0, detected.length - Math.max(1, attachedCount))

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

  // Maths OCR is imperfect, so a stem carrying maths markup is always worth a
  // human glance to confirm fractions / vertical arithmetic rendered correctly.
  const checkMath = Boolean(item.hasMath)

  const issues = []
  if (noAnswer) issues.push('No answer')
  if (lowConfidence) issues.push('Low confidence')
  if (missingDiagram) issues.push('Missing diagram')
  if (missingLabels) issues.push('Missing labels')
  if (missingAlt) issues.push('Missing alt text')
  if (checkMath) issues.push('Check maths')
  if (item.requiresReview && !issues.length) issues.push('Check wording')

  // Per-object confidence. For a question we prefer the model's OCR read
  // confidence; for a figure-only item we fall back to the detection confidence.
  // Null when nothing recorded one — we never fabricate a score.
  const ocr = Number.isFinite(item.ocrConfidence) ? item.ocrConfidence : null
  const figureConfidence = Number.isFinite(item.diagramMeta?.confidence)
    ? item.diagramMeta.confidence
    : Number.isFinite(detected[0]?.confidence)
      ? detected[0].confidence
      : null
  const confidence = ocr != null ? ocr : figureConfidence

  // Three-tier band from the shared policy (>0.95 auto / 0.80-0.95 review /
  // <0.80 approve; unknown → review). Only a KNOWN score below the auto bar
  // forces the review chip — an item with no score keeps the legacy
  // issues-only readiness so older imports don't all flip to "review".
  const band = confidence == null ? null : bandFor(confidence)
  const knownBelowAuto = band != null && band !== CONFIDENCE_BANDS.AUTO

  // Coarse readiness for the review UI's status chip. A runtime figure failure
  // (a clean/redraw/rebuild that errored) is tracked in the component and shown
  // as 'failed' on top of this — the model only knows 'review' vs 'ready'.
  const status = issues.length > 0 || knownBelowAuto ? 'review' : 'ready'

  // Strict auto-approve: only a high-confidence item with no outstanding issues
  // may pre-check its page. Unknown confidence is never auto-approved.
  const autoApprove = band === CONFIDENCE_BANDS.AUTO && issues.length === 0

  return {
    needsReview: Boolean(item.requiresReview),
    noAnswer,
    lowConfidence,
    hasDiagram,
    missingDiagram,
    extraDiagrams,
    missingLabels,
    missingAlt,
    checkMath,
    issues,
    status,
    confidence,
    band,
    autoApprove,
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
    editableText: stripTagsPreservingBreaks(
      item.kind === 'passage' ? item.ref?.passageText : item.ref?.text,
    ),
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
  let autoApprovable = 0
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
      if (item.signals.autoApprove) autoApprovable += 1
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
    autoApprovable,
  }
}

/**
 * A short, honest scale/cost line for the review header. The heavy AI (diagram
 * redraw / generation) is opt-in per figure, so we describe SCALE — pages read
 * and figures awaiting a decision — and make clear generation only runs on the
 * teacher's choice, rather than inventing a dollar figure. Pure; returns '' when
 * there is nothing to describe.
 *
 * @param {object} summary a summarizeReviewModel() result
 */
export function describeImportScale(summary = {}) {
  const pages = Number(summary.pageCount) || 0
  const figures = Number(summary.withDiagrams) || 0
  if (!pages && !figures) return ''
  const parts = []
  if (pages) parts.push(`${pages} page${pages === 1 ? '' : 's'} read`)
  if (figures) parts.push(`${figures} figure${figures === 1 ? '' : 's'} detected`)
  let line = `Reconstructed from ${parts.join(' · ')}.`
  if (figures) line += ' AI redraw / generation runs only when you choose it for a figure.'
  return line
}

/**
 * The set of page keys safe to pre-approve: pages that have at least one
 * question and whose EVERY question item is high-confidence with no outstanding
 * issue (`signals.autoApprove`). Passage-only rows (a shared figure) don't block
 * approval on their own. Unknown-confidence items keep a page out of this set —
 * the system never silently auto-approves what it isn't sure about.
 *
 * @param {object} model the built review model ({ pages })
 * @returns {Set<string>} page keys (via pageKey) to seed the approved set with
 */
export function autoApprovedPageKeys(model = {}) {
  const pages = Array.isArray(model.pages) ? model.pages : []
  const keys = new Set()
  pages.forEach((p) => {
    const questionItems = p.items.filter((item) => item.kind !== 'passage')
    if (!questionItems.length) return
    if (questionItems.every((item) => item.signals?.autoApprove)) {
      keys.add(pageKey(p.page))
    }
  })
  return keys
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
