/**
 * scannedQuizImporter — client orchestration for importing a scanned
 * (image-only) PDF past paper into the Quiz Editor.
 *
 * Flow:
 *   1. Rasterise each PDF page to a JPEG (good OCR resolution).
 *   2. Batch the pages and send each batch to the `structureScannedQuiz`
 *      callable, which runs the dual-model OCR pipeline server-side.
 *   3. Merge the batches, renumber, and map every question to an editor
 *      section with a BLANK answer + `requiresReview` (these papers have
 *      no answer key — the teacher sets answers before publishing).
 *   4. For questions the model flagged as diagram-dependent, attach the
 *      rendered page image so the figure isn't lost; the teacher can crop
 *      or replace it in the editor.
 *
 * The pure helpers are exported and unit-tested in
 * scannedQuizImporter.test.js; the model call and page rendering are
 * injected/guarded so the tests run in plain Node with no DOM.
 */

import { createStandaloneSection } from '../../utils/quizSections.js'
import { importMarkupToRichHtml, importMarkupToOptionHtml } from './importRichText.js'

// Pages per server call. The callable caps at 8; 6 keeps each Claude vision
// response inside its output-token budget with comfortable headroom.
export const SCANNED_BATCH_SIZE = 6
// Hard ceiling on pages we OCR in one import, to bound cost/latency. ECZ
// papers are ≤ ~16 pages; longer uploads are almost always the wrong file.
export const SCANNED_MAX_PAGES = 40
// Below this many extracted characters per sampled page, a PDF is treated as
// a scanned image (no usable text layer).
const SCANNED_TEXT_CHARS_PER_PAGE = 40

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Decide whether a PDF is a scanned image paper (no text layer) from a cheap
 * sample of the first few pages' extracted-text length.
 */
export function isLikelyScannedPdf({ sampledChars = 0, sampledPages = 0 } = {}) {
  if (sampledPages <= 0) return false
  return sampledChars < sampledPages * SCANNED_TEXT_CHARS_PER_PAGE
}

/** Split page descriptors into fixed-size batches, preserving order. */
export function chunkPages(pages = [], size = SCANNED_BATCH_SIZE) {
  const batchSize = Math.max(1, size)
  const batches = []
  for (let i = 0; i < pages.length; i += batchSize) {
    batches.push(pages.slice(i, i + batchSize))
  }
  return batches
}

/**
 * Merge the per-batch question arrays into a single ordered list, dropping
 * exact-duplicate stems that can appear when a question straddles a batch
 * boundary and both batches transcribe it. Renumbering is left to the caller.
 */
export function mergeQuestionBatches(batchResults = []) {
  const questions = []
  const warnings = []
  const seen = new Set()
  let detectedTotal = 0

  batchResults.forEach(result => {
    if (!result) return
    if (Array.isArray(result.warnings)) warnings.push(...result.warnings)
    detectedTotal += Number(result.detectedCount) || 0
    ;(Array.isArray(result.questions) ? result.questions : []).forEach(q => {
      const stem = String(q?.text || '').trim().toLowerCase()
      const optionKey = (Array.isArray(q?.options) ? q.options : []).join('|').toLowerCase()
      const key = `${stem}::${optionKey}`
      if (stem && seen.has(key)) return
      if (stem) seen.add(key)
      questions.push(q)
    })
  })

  return { questions, warnings: [...new Set(warnings)], detectedTotal }
}

/**
 * Map the merged vision questions to editor sections. Answers are forced
 * blank ('' — the editor's "unset" state) and every question is flagged for
 * review. Diagram-flagged questions get the source page image attached via
 * `pageAssetByNumber`.
 *
 * `deps` lets the test inject light-weight rich-text + section factories so
 * the mapping logic is verifiable without the editor's real (DOM-coupled)
 * helpers. Production callers use the defaults.
 */
export function visionQuestionsToSections(questions = [], options = {}, deps = {}) {
  const pageAssetByNumber = options.pageAssetByNumber || {}
  const toRich = deps.toRichHtml || importMarkupToRichHtml
  const toOption = deps.toOptionHtml || importMarkupToOptionHtml
  const makeSection = deps.createSection || createStandaloneSection

  const usedAssetIds = new Set()

  const sections = questions.map((q, index) => {
    const options2 = (Array.isArray(q?.options) ? q.options : [])
      .map(opt => toOption(String(opt ?? '')))
    const overrides = {
      text: toRich(String(q?.text ?? '')),
      sharedInstruction: q?.sharedInstruction ? toRich(String(q.sharedInstruction)) : '',
      options: options2.length ? options2 : ['', '', '', ''],
      // Blank answer: teacher fills in. '' is the editor's recognised "unset".
      correctAnswer: '',
      explanation: '',
      type: 'mcq',
      detectedType: 'mcq',
      marks: 1,
      order: index,
      requiresReview: true,
      reviewNotes: ['Imported from a scanned paper — set the correct answer and check the wording.'],
      sourceQuestionNumber: Number.isFinite(q?.sourceQuestionNumber) ? q.sourceQuestionNumber : index + 1,
      sourcePage: q?.sourcePage ?? null,
    }

    // Attach the source page image when the question depends on a diagram and
    // we have that page rendered. Multiple questions on one page reuse the
    // same asset id (one upload at save time).
    if (q?.hasDiagram && q?.sourcePage != null) {
      const asset = pageAssetByNumber[q.sourcePage]
      if (asset) {
        overrides.imageUrl = asset.imageUrl || asset.objectUrl || ''
        overrides.imageAssetId = asset.id
        overrides.diagramText = `Figure on page ${q.sourcePage} — crop or replace this image with just the diagram for this question.`
        usedAssetIds.add(asset.id)
      }
    }

    return makeSection(overrides)
  })

  return { sections, usedAssetIds }
}

/**
 * Build the importer summary object shown in the editor's import panel.
 */
export function buildScannedSummary({ questions = [], fileName = '', pageCount = 0, warnings = [] } = {}) {
  return {
    questions: questions.length,
    passages: 0,
    images: questions.filter(q => q?.imageAssetId).length,
    needsReview: questions.length,
    pageCount,
    fileName,
    importStatus: 'needs_review',
    warnings,
    scanned: true,
  }
}

// ─── DOM-backed helpers (browser only) ───────────────────────────────────────

function canvasToDataUrl(canvas, quality = 0.72) {
  return canvas.toDataURL('image/jpeg', quality)
}

function dataUrlToBlob(dataUrl) {
  const [, mime, b64] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) || []
  if (!b64) return null
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime || 'image/jpeg' })
}

let assetCounter = 0
function makePageAsset(blob, pageNumber) {
  assetCounter += 1
  const id = `scanned-page-${Date.now().toString(36)}-${assetCounter}`
  const objectUrl = URL.createObjectURL(blob)
  return {
    id,
    blob,
    objectUrl,
    imageUrl: objectUrl,
    contentType: 'image/jpeg',
    extension: 'jpg',
    fileName: `${id}.jpg`,
    sourcePath: `scanned-page-${pageNumber}.jpg`,
    sourcePage: pageNumber,
  }
}

/**
 * Render PDF pages to JPEGs at an OCR-friendly resolution. Returns the data
 * URLs (for the vision call) and a per-page in-memory asset (for attaching to
 * diagram questions). `onProgress({ phase, current, total })` reports rendering
 * progress for the UI.
 */
export async function renderPdfPagesForVision(pdf, { maxPages = SCANNED_MAX_PAGES, onProgress, targetWidth = 1500 } = {}) {
  const total = Math.min(pdf.numPages, maxPages)
  const pageImages = []
  const assetByPage = {}
  const warnings = []
  if (pdf.numPages > maxPages) {
    warnings.push(`Only the first ${maxPages} pages were read; re-run on the rest if needed.`)
  }

  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    try {
      const page = await pdf.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      // Scale up small scans for legible OCR, but never blow past ~2x.
      const scale = Math.min(2, Math.max(1, targetWidth / base.width))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d', { alpha: false })
      await page.render({ canvasContext: context, viewport }).promise
      const dataUrl = canvasToDataUrl(canvas)
      pageImages.push({ pageNumber, dataUrl })
      const blob = dataUrlToBlob(dataUrl)
      if (blob) assetByPage[pageNumber] = makePageAsset(blob, pageNumber)
    } catch {
      warnings.push(`Could not render page ${pageNumber} for reading.`)
    }
    onProgress?.({ phase: 'rendering', current: pageNumber, total })
  }

  return { pageImages, assetByPage, warnings }
}

/**
 * Full scanned-import orchestration. Renders pages, calls the vision callable
 * batch-by-batch, merges, and maps to editor sections. `callVision` is the
 * `structureScannedQuiz` client wrapper (injected for testing).
 *
 * Returns { sections, imageAssets, warnings, summary, pageCount }.
 */
export async function runScannedImport({
  pdf,
  file,
  subjectHint = '',
  gradeHint = '',
  callVision,
  onProgress,
} = {}) {
  const { pageImages, assetByPage, warnings: renderWarnings } =
    await renderPdfPagesForVision(pdf, { onProgress })

  if (!pageImages.length) {
    throw new Error('None of the PDF pages could be read for import.')
  }

  const batches = chunkPages(pageImages, SCANNED_BATCH_SIZE)
  const batchResults = []
  for (let i = 0; i < batches.length; i += 1) {
    onProgress?.({ phase: 'reading', current: i + 1, total: batches.length })
    // Sequential: keeps us under the per-call daily AI meter and avoids
    // hammering the vision API with concurrent large requests.
    const result = await callVision({
      fileName: file?.name || '',
      pages: batches[i],
      subjectHint,
      gradeHint,
    })
    batchResults.push(result)
  }

  const merged = mergeQuestionBatches(batchResults)
  const { sections, usedAssetIds } = visionQuestionsToSections(merged.questions, {
    pageAssetByNumber: assetByPage,
  })

  // Only ship assets that actually got attached to a question, so we don't
  // upload a dozen unused full-page snapshots at save time.
  const imageAssets = Object.values(assetByPage).filter(asset => usedAssetIds.has(asset.id))
  // Revoke the object URLs of unused page assets to avoid a memory leak.
  Object.values(assetByPage).forEach(asset => {
    if (!usedAssetIds.has(asset.id) && asset.objectUrl && typeof URL !== 'undefined') {
      URL.revokeObjectURL(asset.objectUrl)
    }
  })

  const warnings = [...new Set([...renderWarnings, ...merged.warnings])]
  if (!sections.length) {
    warnings.push('No multiple-choice questions could be read from this scanned paper.')
  } else {
    warnings.unshift('Answers were left blank — set the correct answer for each question before publishing.')
  }

  return {
    sections,
    imageAssets,
    warnings,
    pageCount: pageImages.length,
    summary: buildScannedSummary({
      questions: sections.map(s => s.question),
      fileName: file?.name || '',
      pageCount: pageImages.length,
      warnings,
    }),
  }
}
