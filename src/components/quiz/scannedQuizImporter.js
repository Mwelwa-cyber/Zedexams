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

import { createStandaloneSection, createPassageSection, createPartGroup } from '../../utils/quizSections.js'
import { canonicalizeQuestionType } from '../../utils/questionType.js'
import { defaultDiagramLabels } from '../../utils/aiPaperToSections.js'
import { importMarkupToRichHtml, importMarkupToOptionHtml } from './importRichText.js'
import { cleanDiagramSource, isDiagramCleanSupported } from '../../utils/diagramClean.js'

// How detected diagrams are handled when converting a scanned paper. The
// DEFAULT is 'keep' — many Zambian assessment questions depend on their figure,
// so we never drop diagrams unless the teacher explicitly chooses 'text'.
//   keep  — crop each diagram and place it under its question, as-is.
//   clean — crop, then clean it (B&W, de-shadowed, sharpened) before adding.
//   text  — leave diagrams out; import the typed text only.
//   ask    — crop + attach, but flag every diagram for the teacher to decide.
export const DIAGRAM_HANDLING_MODES = ['keep', 'clean', 'text', 'ask']
export const DEFAULT_DIAGRAM_HANDLING = 'keep'

export function normaliseDiagramHandling(mode) {
  return DIAGRAM_HANDLING_MODES.includes(mode) ? mode : DEFAULT_DIAGRAM_HANDLING
}

// Pages per server call. Smaller batches make the vision model enumerate
// every numbered question far more reliably — large batches tempt it to
// "summarise" a long run of items and silently skip some (the English
// missing-questions bug). 4 pages + a 1-page overlap keeps each call light
// while still capturing a passage/map that crosses a boundary whole.
export const SCANNED_BATCH_SIZE = 4
export const SCANNED_BATCH_OVERLAP = 1
// Hard ceiling on pages we OCR in one import, to bound cost/latency. ECZ
// papers are ≤ ~16 pages; longer uploads are almost always the wrong file.
export const SCANNED_MAX_PAGES = 40
// Below this many extracted characters per sampled page, a PDF is treated as
// a scanned image (no usable text layer).
const SCANNED_TEXT_CHARS_PER_PAGE = 40
// Hard ceiling on how many photos/screenshots we OCR in one import. Each image
// is one "page" through the same vision pipeline; more than this is almost
// always the wrong selection (and would blow the daily AI meter).
export const SCANNED_MAX_IMAGES = SCANNED_MAX_PAGES

// Picture formats the editor can rasterise + OCR. HEIC (the iPhone default) is
// deliberately excluded — browsers can't decode it to a canvas, so it would
// fail silently; teachers should export/share as JPEG instead.
export const IMAGE_IMPORT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
const IMAGE_IMPORT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * True when a picked file is a picture we can OCR (photo/screenshot of a paper),
 * as opposed to a Word/PDF document. Checks the MIME type first, then falls back
 * to the extension (phone photos sometimes arrive with an empty/odd MIME).
 */
export function isImageImportFile(file) {
  if (!file) return false
  const type = String(file.type || '').toLowerCase()
  if (type) return IMAGE_IMPORT_MIME.has(type)
  const ext = String(file.name || '').toLowerCase().split('.').pop() || ''
  return IMAGE_IMPORT_EXTENSIONS.includes(ext)
}

/**
 * Normalise the importer entry argument (a single File, a FileList, or an array)
 * into a clean array of files. Lets the importer accept several photographed
 * pages in one go while staying backward-compatible with the single-File calls.
 */
export function normalizeImportInput(input) {
  if (!input) return []
  if (Array.isArray(input)) return input.filter(Boolean)
  if (typeof FileList !== 'undefined' && input instanceof FileList) {
    return Array.from(input).filter(Boolean)
  }
  return [input]
}

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
  // When the vision model returns a printed question number, two questions with
  // different numbers are by definition distinct — even when OCR drift makes
  // their stems or options look identical (common in math papers where many
  // questions share the same small numeric option set like "1|2|3|4").
  // Without this, Q11 and Q21 both rendered as "3 × 8 = ?" with options
  // "24|28|32|36" collapse to one question and are silently dropped.
  const num = Number.isFinite(q?.sourceQuestionNumber) ? `#${q.sourceQuestionNumber}` : ''
  return `${num}${stem}::${opts}`
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
      const hasNumber = Number.isFinite(q?.sourceQuestionNumber) && q.sourceQuestionNumber > 0
      // A question with no text AND no printed number carries nothing the teacher
      // can act on — skip it. A question whose OCR returned an empty stem but
      // that still carries a printed question number (common for diagram/equation-
      // only math questions) must be kept so no numbered question is silently
      // dropped; it will be flagged requiresReview so the teacher can fill in
      // the wording.
      if (!stem && !hasNumber) return
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
  const diagramHandling = normaliseDiagramHandling(options.diagramHandling)

  const opts = (Array.isArray(q?.options) ? q.options : []).map(opt => toOption(String(opt ?? '')))
  const rawStem = String(q?.text ?? '').trim()
  const stemHtml = toRichPreservingBreaks(rawStem, toRich)
  // An empty stem means the OCR couldn't read this question (diagram/equation-
  // only question, or poor scan quality). Keep the question so the teacher can
  // type the wording; add a specific review note so the gap is obvious.
  const reviewNotes = ['Imported from a scanned paper — set the correct answer and check the wording.']
  if (!rawStem) {
    reviewNotes.push('Question text could not be read from the scan — please type the question here.')
  }

  // The backend now classifies each question (mcq / true_false / fill_blank /
  // matching / short_answer / diagram_label); fold that onto the editor's
  // canonical vocabulary (true_false→tf, fill_blank→fill_blanks). Default to
  // mcq for older results.
  let canonicalType = q?.type ? canonicalizeQuestionType(q.type) : 'mcq'
  // A "label the diagram" question is stored as the editor's `diagram` type
  // with diagramMode='identify' (that's what surfaces the label-layer editor);
  // remember to set those once the overrides object exists.
  const isLabelDiagram = canonicalType === 'diagram_label'
  if (isLabelDiagram) canonicalType = 'diagram'
  const isChoice = canonicalType === 'mcq' || canonicalType === 'tf'

  const overrides = {
    text: stemHtml,
    sharedInstruction: q?.sharedInstruction ? toRichPreservingBreaks(q.sharedInstruction, toRich) : '',
    // Choice questions keep their printed options (or 4 blanks to fill in);
    // written-answer types (short_answer/fill/matching) carry no options.
    options: opts.length ? opts : (isChoice ? ['', '', '', ''] : []),
    correctAnswer: '', // blank — teacher fills in
    explanation: '',
    type: canonicalType,
    detectedType: canonicalType,
    marks: Number.isFinite(q?.marks) && q.marks > 0 ? q.marks : 1,
    // Blank ruled answer lines the OCR counted under a written-answer question;
    // null falls back to the editor's per-type default.
    ...(Number.isFinite(q?.answerLines) && q.answerLines > 0
      ? { answerFormat: 'lines', answerLines: q.answerLines }
      : {}),
    // Section heading (e.g. "Section A") carried for part grouping below; the
    // editor doesn't surface it directly but groupSectionsIntoParts reads it.
    sectionTitle: String(q?.sectionTitle || '').trim(),
    order,
    requiresReview: true,
    reviewNotes,
    sourceQuestionNumber: Number.isFinite(q?.sourceQuestionNumber) ? q.sourceQuestionNumber : order + 1,
    sourcePage: q?.sourcePage ?? null,
  }

  // Structured extras the OCR read off the paper, pre-populating the right
  // editor block. The pairing/answers stay blank (ECZ papers print no key).
  if (canonicalType === 'matching') {
    const left = (Array.isArray(q?.matchingLeft) ? q.matchingLeft : []).map(s => String(s ?? '').trim()).filter(Boolean)
    const right = (Array.isArray(q?.matchingRight) ? q.matchingRight : []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (left.length) overrides.matchingLeft = left
    if (right.length) overrides.matchingRight = right
    // One blank answer slot per left item — the teacher sets the pairing.
    if (left.length) overrides.matchingAnswer = left.map(() => -1)
  }
  const wordBank = (Array.isArray(q?.wordBank) ? q.wordBank : []).map(s => String(s ?? '').trim()).filter(Boolean)
  if (wordBank.length) overrides.wordBank = wordBank

  // Label-the-diagram: switch the diagram editor into "identify" mode and seed
  // the parts the learner must name as positioned leader-line labels (default
  // margin placement; the teacher drags each leader tip onto the figure once
  // it's attached). The figure itself is attached by the diagram pass below.
  if (isLabelDiagram) {
    overrides.diagramMode = 'identify'
    const labels = defaultDiagramLabels(Array.isArray(q?.diagramLabels) ? q.diagramLabels : [])
    if (labels.length) overrides.diagramLabels = labels
  }

  const diagrams = Array.isArray(q?.diagrams) ? q.diagrams : []
  const hasCroppableDiagram = diagrams.some(d => d?.box)

  // 'text' mode: the teacher chose text-only — leave every figure out.
  if (diagramHandling !== 'text') {
    // Carry the detected-diagram metadata so the DOM crop pass cuts each
    // figure out of its page and the studio can show the Detected Diagrams
    // review. attachQuestionDiagrams sets the actual imageUrl from the crop.
    if (diagrams.length) overrides.detectedDiagrams = diagrams

    // Whole-page fallback ONLY when a figure was flagged but no croppable box
    // was given — otherwise the precise crop replaces it.
    if (q?.hasDiagram && q?.sourcePage != null && !hasCroppableDiagram) {
      const asset = pageAssetByNumber[q.sourcePage]
      if (asset) {
        overrides.imageUrl = asset.imageUrl || asset.objectUrl || ''
        overrides.imageAssetId = asset.id
        overrides.diagramText = `Figure on page ${q.sourcePage} — crop or replace this image with just this question's diagram.`
        usedAssetIds?.add(asset.id)
      }
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
  const diagramHandling = normaliseDiagramHandling(options.diagramHandling)
  const toRich = deps.toRichHtml || importMarkupToRichHtml
  const makeStandalone = deps.createSection || createStandaloneSection
  const makePassage = deps.createPassage || createPassageSection
  const usedAssetIds = new Set()
  let order = 0

  const local = sections.map(section => {
    if (section?.kind === 'passage') {
      const questions = (Array.isArray(section.questions) ? section.questions : [])
        .map(q => mapVisionQuestion(q, order++, { pageAssetByNumber, usedAssetIds, diagramHandling }, deps))
      const overrides = {
        title: section.title || '',
        instructions: section.instructions ? toRichPreservingBreaks(section.instructions, toRich) : '',
        passageText: section.passageText ? toRichPreservingBreaks(section.passageText, toRich) : '',
        passageKind: section.passageKind === 'map' ? 'map' : 'comprehension',
        questions,
      }
      const pDiagrams = Array.isArray(section.diagrams) ? section.diagrams : []
      const pHasCroppable = pDiagrams.some(d => d?.box)
      if (diagramHandling !== 'text') {
        // Carry the shared map's diagram metadata + its page so the crop pass
        // can cut the map out precisely (and the studio can review it).
        if (pDiagrams.length) {
          overrides.detectedDiagrams = pDiagrams
          overrides.sourcePage = section.sourcePage ?? null
        }
        if (section.hasImage && section.sourcePage != null && !pHasCroppable) {
          const asset = pageAssetByNumber[section.sourcePage]
          if (asset) {
            overrides.imageUrl = asset.imageUrl || asset.objectUrl || ''
            overrides.imageAssetId = asset.id
            usedAssetIds.add(asset.id)
          }
        }
      }
      return makePassage(overrides)
    }
    return makeStandalone(mapVisionQuestion(section.question, order++, { pageAssetByNumber, usedAssetIds, diagramHandling }, deps))
  })

  return { sections: local, usedAssetIds }
}

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

/**
 * For a raw vision question with pictorial options, return the crop plan:
 * one { index, box, label } per option that has a usable bounding box and a
 * rendered source page to crop from. Pure — the actual crop is done in the
 * DOM helper below. Returns [] for normal text-option questions.
 */
export function planOptionImageCrops(rawQuestion, pageAsset) {
  if (!rawQuestion?.optionsAreImages || !pageAsset) return []
  const boxes = Array.isArray(rawQuestion.optionImageBoxes) ? rawQuestion.optionImageBoxes : []
  const plan = []
  boxes.forEach((box, index) => {
    if (box && Number.isFinite(box.w) && Number.isFinite(box.h) && box.w > 0 && box.h > 0) {
      plan.push({ index, box, label: OPTION_LETTERS[index] || `Option ${index + 1}` })
    }
  })
  return plan
}

/**
 * For a raw vision item (question or passage) with detected diagrams, return
 * the crop plan: one entry per diagram that has a usable bounding box and a
 * rendered source page to crop from, LARGEST FIRST (so the primary figure leads).
 * Pure — the actual crop is done in the DOM helper below. Returns [] when the
 * item has no croppable diagram.
 */
export function planDiagramCrops(rawItem, pageAsset) {
  if (!pageAsset) return []
  const diagrams = Array.isArray(rawItem?.diagrams) ? rawItem.diagrams : []
  const plan = []
  diagrams.forEach((d, index) => {
    const box = d?.box
    if (box && Number.isFinite(box.w) && Number.isFinite(box.h) && box.w > 0 && box.h > 0) {
      plan.push({
        index,
        box,
        area: box.w * box.h,
        classification: d.classification || 'review',
        kind: d.kind || 'other',
        caption: String(d.caption || ''),
        confidence: Number.isFinite(d.confidence) ? d.confidence : null,
      })
    }
  })
  return plan.sort((a, b) => b.area - a.area)
}

// A short, teacher-facing note explaining how a detected diagram was handled,
// keyed off the AI's classification. Surfaced in the question's reviewNotes and
// the Detected Diagrams review step. Pure.
export function diagramReviewNote(classification, { cleaned = false } = {}) {
  if (cleaned) return 'Diagram was cleaned for printing — check it reads clearly, then adjust if needed.'
  switch (classification) {
    case 'preserve':
      return 'Diagram kept as an image (complex figure). Crop or replace it if the capture is off.'
    case 'recreate':
      return 'Simple figure — kept as an image; you can recreate it as an editable diagram.'
    case 'clean':
      return 'Diagram attached — clean it for a sharper print, or replace it.'
    case 'review':
    default:
      return 'Diagram attached for review — confirm it belongs to this question.'
  }
}

/** Count questions across local editor sections (passage children + standalones). */
export function countLocalQuestions(sections = []) {
  return sections.reduce((total, section) => {
    if (section?.kind === 'passage') return total + (section.passage?.questions?.length || 0)
    return total + 1
  }, 0)
}

/**
 * Find printed question numbers that are missing from the extracted set.
 * The vision model returns each question's printed `sourceQuestionNumber`; if
 * the paper runs 1..N but a number in that range never came back, the model
 * dropped it. Returns the sorted list of missing numbers (e.g. [21, 47]).
 *
 * Works on the RAW merged vision sections (before the local-numbering
 * fallback), so it reflects the paper's real numbering, not display order.
 */
export function findMissingQuestionNumbers(rawSections = []) {
  const seen = new Set()
  const collect = (q) => {
    const n = Number(q?.sourceQuestionNumber)
    if (Number.isInteger(n) && n > 0 && n <= 500) seen.add(n)
  }
  rawSections.forEach(section => {
    if (section?.kind === 'passage') (section.questions || []).forEach(collect)
    else collect(section?.question || section)
  })
  // Need a few real numbers before we trust the sequence (avoids false alarms
  // on papers the model numbered sparsely).
  if (seen.size < 3) return []
  const max = Math.max(...seen)
  const missing = []
  for (let n = 1; n <= max; n += 1) {
    if (!seen.has(n)) missing.push(n)
  }
  return missing
}

/**
 * Count the figures the vision model detected across the RAW merged sections
 * (questions + shared maps). Used to warn a teacher who chose "text only" that
 * the paper actually had figures, and to report how many were attached. Pure.
 */
export function countDetectedDiagrams(rawSections = []) {
  const ofItem = (item) => (Array.isArray(item?.diagrams) ? item.diagrams.length : 0)
  return rawSections.reduce((total, section) => {
    if (section?.kind === 'passage') {
      return total + ofItem(section) +
        (section.questions || []).reduce((m, q) => m + ofItem(q), 0)
    }
    return total + ofItem(section?.question || section)
  }, 0)
}

/** Human-readable "21, 22, 47 and 3 more" for a list of missing numbers. */
export function formatMissingList(numbers = [], limit = 8) {
  if (!numbers.length) return ''
  if (numbers.length <= limit) return numbers.join(', ')
  return `${numbers.slice(0, limit).join(', ')} and ${numbers.length - limit} more`
}

/**
 * Build the importer summary object shown in the editor's import panel.
 */
export function buildScannedSummary({ sections = [], fileName = '', pageCount = 0, warnings = [] } = {}) {
  const questions = countLocalQuestions(sections)
  const passages = sections.filter(s => s?.kind === 'passage').length
  const questionImages = (q) =>
    (q?.imageAssetId ? 1 : 0) +
    (Array.isArray(q?.optionMedia) ? q.optionMedia.filter(slot => slot?.imageAssetId).length : 0)
  const images = sections.reduce((n, s) => {
    if (s?.kind === 'passage') {
      return n + (s.passage?.imageAssetId ? 1 : 0) +
        (s.passage?.questions || []).reduce((m, q) => m + questionImages(q), 0)
    }
    return n + questionImages(s.question)
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

// Guard URL.revokeObjectURL — global `URL` exists in Node (so a bare
// `typeof URL` check passes), but revokeObjectURL only exists in the browser.
// Checking the method keeps the pure pipeline test runnable under plain node.
function canRevokeObjectUrl() {
  return typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function'
}

// Companion guard for creating object URLs (browser-only). The import review
// screen shows the original page photos beside the reconstruction; we mint a
// SEPARATE, review-only object URL per page so it's independent of the upload
// assets (revoking it when review closes never touches a saved figure).
function canCreateObjectUrl() {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
}

// Build a { [pageNumber]: objectUrl } map of review-only originals from the
// rendered page assets. These are owned by the caller (the studio revokes them
// when the review screen closes) and are NEVER added to imageAssets, so they
// don't get uploaded to Storage at save time.
export function buildReviewPageImages(assetByPage = {}) {
  const map = {}
  if (!canCreateObjectUrl()) return map
  Object.entries(assetByPage).forEach(([pageNumber, asset]) => {
    if (asset && asset.blob) {
      try {
        map[pageNumber] = URL.createObjectURL(asset.blob)
      } catch {
        // ignore — a page without a usable blob just has no original preview
      }
    }
  })
  return map
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

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load page image for cropping.'))
    img.src = url
  })
}

// Crop a normalised box {x,y,w,h} (fractions of the page) out of a rendered
// page asset and return a fresh in-memory image asset for that region.
async function cropAssetRegion(pageAsset, box) {
  const img = await loadImage(pageAsset.objectUrl || pageAsset.imageUrl)
  const W = img.naturalWidth || img.width
  const H = img.naturalHeight || img.height
  const sx = Math.max(0, Math.round(box.x * W))
  const sy = Math.max(0, Math.round(box.y * H))
  const sw = Math.max(1, Math.min(W - sx, Math.round(box.w * W)))
  const sh = Math.max(1, Math.min(H - sy, Math.round(box.h * H)))
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d', { alpha: false })
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  const blob = await canvasToBlob(canvas)
  return makePageAsset(blob, pageAsset.sourcePage)
}

function canvasToBlob(canvas, quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not crop an option image.'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Walk local sections alongside the raw vision sections (same order) and, for
 * every pictorial-option question, crop each option's picture out of its page
 * and write it into the question's optionMedia slots. Returns the new crop
 * assets so the caller can upload them at save time. DOM-only (uses canvas).
 */
async function attachOptionImages(localSections, rawSections, assetByPage, usedAssetIds) {
  const cropAssets = []

  const pairsFor = (local, raw) => {
    if (local?.kind === 'passage') {
      const qs = local.passage?.questions || []
      return qs.map((q, j) => [q, raw?.questions?.[j]])
    }
    return [[local?.question, raw?.question || raw]]
  }

  for (let i = 0; i < localSections.length; i += 1) {
    const raw = rawSections[i]
    for (const [localQ, rawQ] of pairsFor(localSections[i], raw)) {
      if (!localQ || !rawQ) continue
      const pageAsset = assetByPage[localQ.sourcePage]
      const plan = planOptionImageCrops(rawQ, pageAsset)
      if (!plan.length) continue

      const media = Array.isArray(localQ.optionMedia) ? [...localQ.optionMedia] : []
      let attached = 0
      for (const { index, box, label } of plan) {
        try {
          const crop = await cropAssetRegion(pageAsset, box)
          media[index] = {
            imageAssetId: crop.id,
            imageUrl: crop.objectUrl,
            alt: `Option ${label} image (imported — please review)`,
          }
          cropAssets.push(crop)
          usedAssetIds?.add(crop.id)
          attached += 1
        } catch {
          // Skip a crop we couldn't render; the option keeps its text/blank.
        }
      }
      if (attached) {
        // Keep optionMedia a clean array parallel to options (null = text option).
        const len = Math.max(media.length, (localQ.options || []).length)
        localQ.optionMedia = Array.from({ length: len }, (_, k) => media[k] || null)
        localQ.requiresReview = true
        const note = 'Option images were auto-cropped from the scan — check each crop and add alt text.'
        localQ.reviewNotes = [...new Set([...(localQ.reviewNotes || []), note])]
      }
    }
  }
  return cropAssets
}

/**
 * Crop each question's (and shared map's) detected diagram out of its page and
 * attach it under the right item — the heart of "keep diagrams in the correct
 * questions". Walks the local sections, reads the `detectedDiagrams` metadata
 * carried by mapVisionQuestion / visionSectionsToLocal, crops the primary
 * figure, optionally cleans it (handling === 'clean'), and writes
 * imageUrl/imageAlt/diagramText/diagramMeta onto the item. Returns the new crop
 * assets so the caller uploads them at save time. DOM-only (canvas).
 *
 * `diagramHandling` of 'text' never reaches here (the metadata isn't carried);
 * 'keep'/'ask' attach as-is, 'clean' runs the cleaner first. Every item gets
 * flagged requiresReview so the Detected Diagrams step can show it.
 */
async function attachQuestionDiagrams(localSections, assetByPage, usedAssetIds, diagramHandling = DEFAULT_DIAGRAM_HANDLING) {
  const cropAssets = []
  if (diagramHandling === 'text') return cropAssets

  // Every item that can own a diagram: standalone questions, the passage's own
  // shared map, and each passage child question.
  const targets = []
  localSections.forEach(section => {
    if (section?.kind === 'passage') {
      if (section.passage) targets.push(section.passage)
      ;(section.passage?.questions || []).forEach(q => targets.push(q))
    } else if (section?.question) {
      targets.push(section.question)
    }
  })

  for (const target of targets) {
    const diagrams = Array.isArray(target?.detectedDiagrams) ? target.detectedDiagrams : []
    if (!diagrams.length) continue
    const pageAsset = assetByPage[target.sourcePage]
    if (!pageAsset) continue
    const plan = planDiagramCrops({ diagrams }, pageAsset)
    if (!plan.length) continue

    // Crop EVERY planned figure: the largest becomes the primary (imageUrl),
    // the rest stack below in images[]. Each cropped figure gets its own
    // in-memory asset so the save path uploads it. Cropping one figure failing
    // never drops the others.
    const attached = []
    for (const planItem of plan) {
      try {
        const crop = await cropAssetRegion(pageAsset, planItem.box)
        let asset = crop
        let cleaned = false
        if (diagramHandling === 'clean' && isDiagramCleanSupported()) {
          try {
            const result = await cleanDiagramSource(crop.objectUrl, { mimeType: 'image/png' })
            if (result?.blob) {
              asset = makePageAsset(result.blob, pageAsset.sourcePage)
              cleaned = true
              // The raw (uncleaned) crop is now unused — release it.
              if (crop.objectUrl && canRevokeObjectUrl()) URL.revokeObjectURL(crop.objectUrl)
            }
          } catch {
            // Cleaning failed — keep the plain crop rather than losing the figure.
          }
        }
        attached.push({ asset, planItem, cleaned })
        cropAssets.push(asset)
        usedAssetIds?.add(asset.id)
      } catch {
        // This figure failed to crop — skip it; the rest may still attach.
      }
    }

    if (!attached.length) {
      // Every crop failed — fall back to attaching the whole source page so the
      // figure is never silently lost.
      target.imageUrl = pageAsset.imageUrl || pageAsset.objectUrl || ''
      target.imageAssetId = pageAsset.id
      target.diagramText = `Figure on page ${target.sourcePage} — crop or replace this image with just this item's diagram.`
      target.requiresReview = true
      usedAssetIds?.add(pageAsset.id)
      continue
    }

    const [primary, ...extras] = attached
    target.imageUrl = primary.asset.objectUrl
    target.imageAssetId = primary.asset.id
    target.imageAlt = primary.planItem.caption || target.imageAlt || ''
    target.diagramText = diagramReviewNote(primary.planItem.classification, { cleaned: primary.cleaned })
    target.diagramMeta = {
      classification: primary.planItem.classification,
      kind: primary.planItem.kind,
      confidence: primary.planItem.confidence,
      caption: primary.planItem.caption,
      sourcePage: target.sourcePage ?? null,
      handling: diagramHandling,
      cleaned: primary.cleaned,
      // Figures detected but NOT attached (failed to crop) — usually 0 now that
      // we attach every figure. Drives the review screen's "extra figures" hint.
      extraCount: Math.max(0, plan.length - attached.length),
    }
    // The additional figures, in detection order, stacked below the primary.
    // imageAssetId is transient — the save pass swaps it for the uploaded URL.
    target.images = extras.map(e => ({
      url: e.asset.objectUrl,
      imageAssetId: e.asset.id,
      alt: e.planItem.caption || '',
      width: 'full',
    }))
    target.requiresReview = true
    target.reviewNotes = [...new Set([
      ...(target.reviewNotes || []),
      diagramReviewNote(primary.planItem.classification, { cleaned: primary.cleaned }),
    ])]
  }
  return cropAssets
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
 * Rasterise one uploaded picture (photo/screenshot) onto a canvas at an
 * OCR-friendly width and return its JPEG data URL + blob. Large phone photos are
 * scaled down to the target width; small screenshots are scaled up to at most 2×
 * so text stays legible — mirroring the scanned-PDF page heuristic.
 */
async function rasterizeImageFile(file, targetWidth = 1500) {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const W = img.naturalWidth || img.width
    const H = img.naturalHeight || img.height
    if (!W || !H) throw new Error('Image had no readable dimensions.')
    const scale = Math.min(2, targetWidth / W)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(W * scale))
    canvas.height = Math.max(1, Math.round(H * scale))
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvasToDataUrl(canvas)
    return { dataUrl, blob: dataUrlToBlob(dataUrl) }
  } finally {
    if (canRevokeObjectUrl()) URL.revokeObjectURL(url)
  }
}

/**
 * Turn uploaded picture files into the same { pageImages, assetByPage } shape
 * the scanned-PDF path produces, so both feed the shared vision pipeline. Each
 * image becomes one page (in selection order). `onProgress({ phase, current,
 * total })` reports rasterising progress for the UI.
 */
export async function renderImageFilesForVision(files, { maxImages = SCANNED_MAX_IMAGES, onProgress, targetWidth = 1500 } = {}) {
  const list = normalizeImportInput(files)
  const total = Math.min(list.length, maxImages)
  const pageImages = []
  const assetByPage = {}
  const warnings = []
  if (list.length > maxImages) {
    warnings.push(`Only the first ${maxImages} images were read; import the rest separately if needed.`)
  }

  for (let i = 0; i < total; i += 1) {
    const pageNumber = i + 1
    try {
      const { dataUrl, blob } = await rasterizeImageFile(list[i], targetWidth)
      pageImages.push({ pageNumber, dataUrl })
      if (blob) assetByPage[pageNumber] = makePageAsset(blob, pageNumber)
    } catch {
      warnings.push(`Could not read "${list[i]?.name || `image ${pageNumber}`}" for import.`)
    }
    onProgress?.({ phase: 'rendering', current: pageNumber, total })
  }

  return { pageImages, assetByPage, warnings }
}

/**
 * Group imported sections under the paper's printed section headings (e.g.
 * "Section A", "Section B"). A new part group starts whenever a section's
 * heading changes; every section in that run gets the part's id (standalone
 * questions via `question.partId`, passages via `section.partId`, matching how
 * serializeQuizSections reads membership). Passages with no heading of their
 * own inherit the current section. Returns the (mutated) sections plus the
 * parts list — empty when the paper printed no headings, so the default
 * single-flow import is unchanged. Pure + node-testable (deps injectable).
 */
export function groupSectionsIntoParts(sections = [], deps = {}) {
  const makePart = deps.createPart || createPartGroup
  const labelOf = (section) => {
    if (section?.kind === 'passage') return String(section.passage?.sectionTitle || '').trim()
    return String(section?.question?.sectionTitle || '').trim()
  }
  const parts = []
  let currentLabel = null
  let currentPartId = null
  ;(Array.isArray(sections) ? sections : []).forEach((section) => {
    const label = labelOf(section)
    if (label && label !== currentLabel) {
      const part = makePart({ title: label, order: parts.length })
      parts.push(part)
      currentPartId = part.id
      currentLabel = label
    }
    if (currentPartId) {
      if (section?.kind === 'passage') section.partId = currentPartId
      else if (section?.question) section.question.partId = currentPartId
    }
  })
  return { sections, parts }
}

/**
 * Source-agnostic vision import: given pre-rendered page images (from a scanned
 * PDF or from uploaded photos), call the vision callable batch-by-batch, merge
 * the results, and map them onto editor sections. `callVision` is the
 * `structureScannedQuiz` client wrapper (injected for testing).
 *
 * `pageImages` is [{ pageNumber, dataUrl }] and `assetByPage` maps a page
 * number to its in-memory image asset (for attaching diagrams/maps). `sourceNoun`
 * tunes the "nothing read" message ("scanned paper" vs "image"). Returns
 * { sections, imageAssets, warnings, summary, pageCount }.
 */
export async function runVisionImport({
  pageImages = [],
  assetByPage = {},
  renderWarnings = [],
  file,
  subjectHint = '',
  gradeHint = '',
  callVision,
  onProgress,
  sourceNoun = 'scanned paper',
  diagramHandling = DEFAULT_DIAGRAM_HANDLING,
} = {}) {
  if (!pageImages.length) {
    throw new Error(`None of the ${sourceNoun} pages could be read for import.`)
  }
  const handling = normaliseDiagramHandling(diagramHandling)

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
    diagramHandling: handling,
  })

  // Crop pictorial answer options out of their page into per-option media.
  // Runs before the revoke pass below so the page object URLs are still alive.
  const optionCropAssets = await attachOptionImages(sections, merged.sections, assetByPage, usedAssetIds)

  // Crop each detected diagram out of its page and place it under the right
  // question/passage (unless the teacher chose text-only). Same lifetime rules
  // as the option crops — runs before the revoke pass.
  const diagramCropAssets = await attachQuestionDiagrams(sections, assetByPage, usedAssetIds, handling)

  // Only ship assets that actually got attached, so we don't upload a dozen
  // unused full-page snapshots at save time. Revoke the rest to avoid a leak.
  const imageAssets = [
    ...Object.values(assetByPage).filter(asset => usedAssetIds.has(asset.id)),
    ...optionCropAssets,
    ...diagramCropAssets,
  ]
  Object.values(assetByPage).forEach(asset => {
    if (!usedAssetIds.has(asset.id) && asset.objectUrl && canRevokeObjectUrl()) {
      URL.revokeObjectURL(asset.objectUrl)
    }
  })

  const warnings = [...new Set([...renderWarnings, ...merged.warnings])]
  // Diagram handling notices: never silently drop figures.
  const detectedDiagramCount = countDetectedDiagrams(merged.sections)
  if (handling === 'text' && detectedDiagramCount > 0) {
    warnings.push(
      `${detectedDiagramCount} diagram${detectedDiagramCount === 1 ? '' : 's'} were left out because "text only" was chosen. ` +
      'Re-import with a diagram option, or add them with the Diagram Scanner, if a question needs its figure.',
    )
  } else if (diagramCropAssets.length > 0) {
    warnings.push(
      `${diagramCropAssets.length} diagram${diagramCropAssets.length === 1 ? '' : 's'} were placed under their questions` +
      `${handling === 'clean' ? ' and cleaned for printing' : ''} — review each one before publishing.`,
    )
  }
  if (!sections.length) {
    warnings.push(`No questions could be read from this ${sourceNoun}.`)
  } else {
    // Gap check: if the paper is numbered 1..N but some numbers never came
    // back, tell the admin exactly which are missing so they can re-import the
    // affected pages or add those questions by hand.
    const missing = findMissingQuestionNumbers(merged.sections)
    if (missing.length) {
      warnings.unshift(
        `${missing.length} question${missing.length === 1 ? '' : 's'} appear to be missing (${formatMissingList(missing)}). ` +
        'Re-import (it may catch them on a second pass) or add them by hand.',
      )
    }
    warnings.unshift('Answers were left blank — set the correct answer for each question before publishing.')
  }

  // Group the sections under their printed headings (Section A / B …) into
  // part groups so the paper rebuilds with its original section structure.
  const { parts } = groupSectionsIntoParts(sections)

  return {
    sections,
    parts,
    imageAssets,
    // Review-only originals (one object URL per page), independent of the
    // upload assets — the studio shows them in the import review screen and
    // revokes them when it closes.
    pageImageUrls: buildReviewPageImages(assetByPage),
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

/**
 * Full scanned-PDF import orchestration: rasterise the PDF pages, then run the
 * shared vision pipeline. `callVision` is the `structureScannedQuiz` client
 * wrapper (injected for testing).
 */
export async function runScannedImport({
  pdf,
  file,
  subjectHint = '',
  gradeHint = '',
  callVision,
  onProgress,
  diagramHandling = DEFAULT_DIAGRAM_HANDLING,
} = {}) {
  const { pageImages, assetByPage, warnings: renderWarnings } =
    await renderPdfPagesForVision(pdf, { onProgress })

  if (!pageImages.length) {
    throw new Error('None of the PDF pages could be read for import.')
  }

  return runVisionImport({
    pageImages,
    assetByPage,
    renderWarnings,
    file,
    subjectHint,
    gradeHint,
    callVision,
    onProgress,
    sourceNoun: 'scanned paper',
    diagramHandling,
  })
}

/**
 * Full picture import orchestration: rasterise the uploaded photos/screenshots
 * (one image per page), then run the shared vision pipeline. Used when a teacher
 * imports questions from pictures instead of a Word/PDF document.
 */
export async function runImageImport({
  files,
  file,
  subjectHint = '',
  gradeHint = '',
  callVision,
  onProgress,
  diagramHandling = DEFAULT_DIAGRAM_HANDLING,
} = {}) {
  const list = normalizeImportInput(files)
  const { pageImages, assetByPage, warnings: renderWarnings } =
    await renderImageFilesForVision(list, { onProgress })

  if (!pageImages.length) {
    throw new Error('None of the images could be read for import.')
  }

  return runVisionImport({
    pageImages,
    assetByPage,
    renderWarnings,
    file: file || list[0],
    subjectHint,
    gradeHint,
    callVision,
    onProgress,
    sourceNoun: list.length > 1 ? 'images' : 'image',
    diagramHandling,
  })
}
