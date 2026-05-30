/**
 * scannedQuizImporter — client orchestration for importing a scanned
 * (image-only) PDF past paper into the Quiz Editor.
 *
 * Flow:
 *   1. Rasterise each PDF page to a JPEG (good OCR resolution).
 *   2. Batch the pages (with a 1-page overlap so a passage/map that straddles
 *      a page boundary stays intact in at least one batch) and send each
 *      batch to the `structureScannedQuiz` callable, which runs the
 *      dual-model OCR pipeline server-side.
 *   3. Merge the batches into ordered editor sections — comprehension
 *      passages and shared maps/diagrams keep their grouped questions;
 *      everything else is a standalone question.
 *   4. Every answer is left BLANK + flagged requiresReview (ECZ question
 *      papers carry no answer key — the teacher sets answers before
 *      publishing). Map passages and diagram questions get the rendered
 *      source page attached so figures aren't lost.
 *
 * The pure helpers are exported and unit-tested in
 * scannedQuizImporter.test.js; the model call and page rendering are
 * injected/guarded so the tests run in plain Node with no DOM.
 */

import { createStandaloneSection, createPassageSection } from '../../utils/quizSections.js'
import { importMarkupToRichHtml, importMarkupToOptionHtml } from './importRichText.js'

// Pages per server call. The callable caps at 8; 5 + a 1-page overlap keeps
// each Claude vision response inside its output-token budget while letting a
// passage/map that crosses a boundary be captured whole in one batch.
export const SCANNED_BATCH_SIZE = 5
export const SCANNED_BATCH_OVERLAP = 1
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

/**
 * Split page descriptors into batches, optionally sharing `overlap` trailing
 * pages with the next batch so boundary-straddling passages/maps survive.
 */
export function chunkPages(pages = [], size = SCANNED_BATCH_SIZE, overlap = SCANNED_BATCH_OVERLAP) {
  const batchSize = Math.max(1, size)
  const step = Math.max(1, batchSize - Math.max(0, overlap))
  const batches = []
  if (!pages.length) return batches
  for (let i = 0; i < pages.length; i += step) {
    batches.push(pages.slice(i, i + batchSize))
    if (i + batchSize >= pages.length) break
  }
  return batches
}

function questionKey(q) {
  const stem = String(q?.text || '').trim().toLowerCase()
  const opts = (Array.isArray(q?.options) ? q.options : []).join('|').toLowerCase()
  return `${stem}::${opts}`
}

function passageKey(section) {
  const kind = section?.passageKind === 'map' ? 'map' : 'comprehension'
  const title = String(section?.title || '').trim().toLowerCase()
  // Prefer the title — the same passage re-read across the batch overlap keeps
  // its title even if OCR of the body text drifts slightly. Fall back to a text
  // prefix, then to the page (so the same untitled map merges across the
  // overlap but two different maps on different pages stay separate).
  if (title) return `${kind}::title::${title}`
  const text = String(section?.passageText || '').trim().toLowerCase().slice(0, 80)
  if (text) return `${kind}::text::${text}`
  return `${kind}::page${section?.sourcePage ?? '?'}`
}

/**
 * Merge the per-batch section arrays into one ordered list. Duplicate
 * questions (from the batch overlap) are dropped by stem; a passage seen in
 * two batches has its questions unioned and the richer text/image kept.
 */
export function mergeSectionBatches(batchResults = []) {
  const sections = []
  const warnings = []
  const seenQuestions = new Set()
  const passageByKey = new Map()
  let detectedTotal = 0

  const takeQuestions = (list = []) => {
    const kept = []
    list.forEach(q => {
      const stem = String(q?.text || '').trim()
      if (!stem) return
      const key = questionKey(q)
      if (seenQuestions.has(key)) return
      seenQuestions.add(key)
      kept.push(q)
    })
    return kept
  }

  batchResults.forEach(result => {
    if (!result) return
    if (Array.isArray(result.warnings)) warnings.push(...result.warnings)
    detectedTotal += Number(result.detectedCount) || 0

    ;(Array.isArray(result.sections) ? result.sections : []).forEach(section => {
      if (section?.kind === 'passage') {
        const key = passageKey(section)
        const existing = passageByKey.get(key)
        if (existing) {
          // Same passage seen again (overlap) — union new questions, keep richer text.
          existing.questions.push(...takeQuestions(section.questions))
          if (String(section.passageText || '').length > String(existing.passageText || '').length) {
            existing.passageText = section.passageText
          }
          if (!existing.title && section.title) existing.title = section.title
          if (!existing.instructions && section.instructions) existing.instructions = section.instructions
          existing.hasImage = existing.hasImage || section.hasImage
          return
        }
        const merged = { ...section, questions: takeQuestions(section.questions) }
        // A passage whose every question was a duplicate carries no new
        // content — drop it rather than emit an empty passage.
        if (!merged.questions.length) return
        passageByKey.set(key, merged)
        sections.push(merged)
      } else {
        const q = section?.question || section
        const kept = takeQuestions([q])
        if (kept.length) sections.push({ kind: 'standalone', question: kept[0] })
      }
    })
  })

  return { sections, warnings: [...new Set(warnings)], detectedTotal }
}

// Preserve line breaks the editor would otherwise collapse. importMarkupToRichHtml
// only builds block HTML when it detects maths/table markup; a plain multi-line
// stem (e.g. a special-paper box pattern the model did NOT table-ise, or a
// multi-paragraph passage) would render as one run. When that happens we wrap
// the lines into a <p> joined by <br> so the structure survives.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function toRichPreservingBreaks(text, toRich) {
  const raw = String(text ?? '')
  if (!raw.trim()) return ''
  const html = toRich(raw)
  // toRich returned the input unchanged (no markup) but it spans multiple
  // lines — preserve them explicitly.
  if (html === raw && /\n/.test(raw)) {
    const paragraphs = raw.split(/\n{2,}/).map(block =>
      `<p>${block.split(/\n/).map(line => escapeHtml(line.trim())).filter(Boolean).join('<br>')}</p>`,
    )
    return paragraphs.join('')
  }
  return html
}

function mapVisionQuestion(q, order, options, deps) {
  const toRich = deps.toRichHtml || importMarkupToRichHtml
  const toOption = deps.toOptionHtml || importMarkupToOptionHtml
  const pageAssetByNumber = options.pageAssetByNumber || {}
  const usedAssetIds = options.usedAssetIds

  const opts = (Array.isArray(q?.options) ? q.options : []).map(opt => toOption(String(opt ?? '')))
  const overrides = {
    text: toRichPreservingBreaks(q?.text, toRich),
    sharedInstruction: q?.sharedInstruction ? toRichPreservingBreaks(q.sharedInstruction, toRich) : '',
    options: opts.length ? opts : ['', '', '', ''],
    correctAnswer: '', // blank — teacher fills in
    explanation: '',
    type: 'mcq',
    detectedType: 'mcq',
    marks: 1,
    order,
    requiresReview: true,
    reviewNotes: ['Imported from a scanned paper — set the correct answer and check the wording.'],
    sourceQuestionNumber: Number.isFinite(q?.sourceQuestionNumber) ? q.sourceQuestionNumber : order + 1,
    sourcePage: q?.sourcePage ?? null,
  }

  if (q?.hasDiagram && q?.sourcePage != null) {
    const asset = pageAssetByNumber[q.sourcePage]
    if (asset) {
      overrides.imageUrl = asset.imageUrl || asset.objectUrl || ''
      overrides.imageAssetId = asset.id
      overrides.diagramText = `Figure on page ${q.sourcePage} — crop or replace this image with just this question's diagram.`
      usedAssetIds?.add(asset.id)
    }
  }
  return overrides
}

/**
 * Map merged vision sections onto editor sections. Passages become passage
 * sections (comprehension or map, with the source page attached for maps);
 * standalone questions become standalone sections. Answers are blank and
 * every question is flagged for review.
 */
export function visionSectionsToLocal(sections = [], options = {}, deps = {}) {
  const pageAssetByNumber = options.pageAssetByNumber || {}
  const toRich = deps.toRichHtml || importMarkupToRichHtml
  const makeStandalone = deps.createSection || createStandaloneSection
  const makePassage = deps.createPassage || createPassageSection
  const usedAssetIds = new Set()
  let order = 0

  const local = sections.map(section => {
    if (section?.kind === 'passage') {
      const questions = (Array.isArray(section.questions) ? section.questions : [])
        .map(q => mapVisionQuestion(q, order++, { pageAssetByNumber, usedAssetIds }, deps))
      const overrides = {
        title: section.title || '',
        instructions: section.instructions ? toRichPreservingBreaks(section.instructions, toRich) : '',
        passageText: section.passageText ? toRichPreservingBreaks(section.passageText, toRich) : '',
        passageKind: section.passageKind === 'map' ? 'map' : 'comprehension',
        questions,
      }
      if (section.hasImage && section.sourcePage != null) {
        const asset = pageAssetByNumber[section.sourcePage]
        if (asset) {
          overrides.imageUrl = asset.imageUrl || asset.objectUrl || ''
          overrides.imageAssetId = asset.id
          usedAssetIds.add(asset.id)
        }
      }
      return makePassage(overrides)
    }
    return makeStandalone(mapVisionQuestion(section.question, order++, { pageAssetByNumber, usedAssetIds }, deps))
  })

  return { sections: local, usedAssetIds }
}

/** Count questions across local editor sections (passage children + standalones). */
export function countLocalQuestions(sections = []) {
  return sections.reduce((total, section) => {
    if (section?.kind === 'passage') return total + (section.passage?.questions?.length || 0)
    return total + 1
  }, 0)
}

/**
 * Build the importer summary object shown in the editor's import panel.
 */
export function buildScannedSummary({ sections = [], fileName = '', pageCount = 0, warnings = [] } = {}) {
  const questions = countLocalQuestions(sections)
  const passages = sections.filter(s => s?.kind === 'passage').length
  const images = sections.reduce((n, s) => {
    if (s?.kind === 'passage') {
      return n + (s.passage?.imageAssetId ? 1 : 0) +
        (s.passage?.questions || []).filter(q => q?.imageAssetId).length
    }
    return n + (s.question?.imageAssetId ? 1 : 0)
  }, 0)
  return {
    questions,
    passages,
    images,
    needsReview: questions,
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
 * diagram/map questions). `onProgress({ phase, current, total })` reports
 * rendering progress for the UI.
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

  const batches = chunkPages(pageImages)
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

  const merged = mergeSectionBatches(batchResults)
  const { sections, usedAssetIds } = visionSectionsToLocal(merged.sections, {
    pageAssetByNumber: assetByPage,
  })

  // Only ship assets that actually got attached, so we don't upload a dozen
  // unused full-page snapshots at save time. Revoke the rest to avoid a leak.
  const imageAssets = Object.values(assetByPage).filter(asset => usedAssetIds.has(asset.id))
  Object.values(assetByPage).forEach(asset => {
    if (!usedAssetIds.has(asset.id) && asset.objectUrl && typeof URL !== 'undefined') {
      URL.revokeObjectURL(asset.objectUrl)
    }
  })

  const warnings = [...new Set([...renderWarnings, ...merged.warnings])]
  if (!sections.length) {
    warnings.push('No questions could be read from this scanned paper.')
  } else {
    warnings.unshift('Answers were left blank — set the correct answer for each question before publishing.')
  }

  return {
    sections,
    imageAssets,
    warnings,
    pageCount: pageImages.length,
    summary: buildScannedSummary({
      sections,
      fileName: file?.name || '',
      pageCount: pageImages.length,
      warnings,
    }),
  }
}
