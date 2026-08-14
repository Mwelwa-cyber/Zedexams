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
import { importMarkupToRichHtml, importMarkupToOptionHtml, hasImportMarkup } from '../../shared/utils/importRichText.js'
import { cleanDiagramSource, isDiagramCleanSupported } from '../../utils/diagramClean.js'
import { enhanceCanvasInPlace } from '../../utils/imageEnhance.js'
import { collectDeclaredRanges, reconcilePaperNumbering, assignPartsFromRanges } from './pastPaperParts.js'
import { mapAiError } from '../../utils/aiErrorTaxonomy.js'

// How detected diagrams are handled when converting a scanned paper. The
// DEFAULT is 'keep' — many Zambian assessment questions depend on their figure,
// so we never drop diagrams unless the teacher explicitly chooses 'text'.
//   keep  — crop each diagram and place it under its question, as-is.
//   clean — crop, then clean it (B&W, de-shadowed, sharpened) before adding.
//   text  — leave diagrams out; import the typed text only.
//   ask    — crop + attach, but flag every diagram for the teacher to decide.
export const DIAGRAM_HANDLING_MODES = ['keep', 'clean', 'text', 'ask']
export const DEFAULT_DIAGRAM_HANDLING = 'keep'

// Client importer version stamp. Surfaced in the editor's import summary
// alongside the server's engineVersion so "is the latest code actually
// running?" is observable rather than a guess. The client ships via Hosting
// and the server (engineVersion) ships via the Functions deploy — showing both
// makes a half-deployed state (new UI, stale function, or vice-versa) obvious.
// Bump on a meaningful change to this file's extraction/merge/recovery logic.
export const SCANNED_IMPORTER_VERSION = '2026.07.19-parallel'

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
// How many extraction batches to read AT ONCE. The old importer read every
// batch strictly one-after-another, so a long paper (a 16-page comprehension is
// ~6 batches, each a 20–60s vision call) waited on all of them back-to-back —
// the single biggest cause of the "why is import taking so long" complaint.
// Reading a small window of batches concurrently overlaps those calls and cuts
// wall-clock time by roughly this factor, while staying well under the vision
// API's rate limit. It does NOT change cost or the daily AI meter, which count
// TOTAL calls, not how many run at once. Kept small so a big paper can't fan
// out into dozens of simultaneous requests.
export const SCANNED_BATCH_CONCURRENCY = 3
// Recovery re-scans use SMALLER batches than the first pass: fewer pages per
// call make the vision model enumerate more reliably AND keep each call well
// inside the function deadline (the pages being recovered are usually the
// dense/slow ones that made the original 4-page batch time out).
export const SCANNED_RECOVERY_BATCH_SIZE = 2
// Cross-batch gap recovery. A single batch can badly under-extract its pages
// (the vision model "summarises" a long run and silently skips a block), which
// the per-batch server recovery never sees — leaving a contiguous range of
// printed numbers missing from the merged paper (the classic "imported 47 of
// 60, questions 43-55 missing" report). After the first merge we find those
// missing numbers, re-scan ONLY the pages they sit on, and merge what comes
// back. Bounded rounds; a round that recovers nothing new stops the loop.
export const SCANNED_RECOVERY_ROUNDS = 2
// Cap on how many distinct pages one recovery round re-scans, so a wildly
// sparse numbering (or a hallucinated number) can't trigger a re-scan of the
// whole paper. Comfortably covers a real multi-page gap.
export const SCANNED_RECOVERY_MAX_PAGES = 24
// Ceiling on pages we OCR in one import. This bounds browser memory (each page
// is rasterised to a ~1500px canvas) and the daily AI meter — it is NOT a
// question cap: pages are processed in small batches and merged, so a 100+
// question paper imports in full as long as its pages fit here. Set high enough
// to cover a long multi-part paper; if a PDF still exceeds it the importer
// surfaces a clear "only the first N pages were read" warning rather than
// silently dropping the rest.
export const SCANNED_MAX_PAGES = 120
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

/**
 * Should a failed vision call be retried? Transient failures (timeout,
 * deadline-exceeded, dropped connection, server hiccup) are worth a smaller
 * retry; hard failures (daily AI limit, permission, bad request, App Check)
 * will fail identically on every retry, so retrying just burns time.
 * The callable wrapper preserves the Firebase error code on the error it
 * throws; when only a friendly message survives, fall back to message
 * heuristics and default to retryable (retries are strictly bounded).
 */
export function isRetryableImportError(error) {
  const code = String(error?.code || '').toLowerCase()
  // resource-exhausted is ambiguous: a SHORT-TERM burst throttle is retryable
  // (the scanned import legitimately fires ~40 calls; the server cap is set for
  // that, and a throttle should pace-and-retry, never drop pages), whereas a
  // DAILY-quota / MONTHLY-budget exhaustion is terminal. The backend now attaches
  // a structured reason (functions/aiErrorReasons.js) so we can tell them apart.
  if (code.includes('resource-exhausted')) {
    return mapAiError(error).retryable // burst → true; daily/budget → false
  }
  if (code) {
    if (/permission-denied|unauthenticated|invalid-argument|failed-precondition|not-found/.test(code)) {
      return false
    }
    if (/timeout|deadline|internal|unavailable|aborted|cancelled|unknown|network/.test(code)) {
      return true
    }
  }
  const message = String(error?.message || '').toLowerCase()
  if (/daily limit|usage limit|limit reached|sign in|permission|not allowed/.test(message)) return false
  return true
}

/**
 * Read one batch of pages resiliently. `readPages(pages)` is the vision call
 * for an arbitrary page list. Strategy:
 *   1. Try the whole batch once.
 *   2. On a retryable failure, fall back to reading each page individually —
 *      a single page is a much smaller request (far less likely to hit the
 *      function deadline) and the model enumerates one page very reliably.
 *   3. A page that fails retryably gets exactly one more attempt.
 * Returns { results, failedPages, errors } — pages listed in failedPages are
 * genuinely unread and should be surfaced to the teacher. Never throws.
 * Pure orchestration (readPages injected) so it unit-tests under plain node.
 */
export async function readBatchResilient(batchPages = [], readPages) {
  const pages = Array.isArray(batchPages) ? batchPages.filter(Boolean) : []
  if (!pages.length) return { results: [], failedPages: [], errors: [] }
  try {
    return { results: [await readPages(pages)], failedPages: [], errors: [] }
  } catch (error) {
    if (!isRetryableImportError(error)) {
      return { results: [], failedPages: pages.map(p => p.pageNumber), errors: [error] }
    }
    const results = []
    const failedPages = []
    const errors = [error]
    for (const page of pages) {
      try {
        results.push(await readPages([page]))
      } catch (pageError) {
        if (isRetryableImportError(pageError)) {
          try {
            results.push(await readPages([page]))
            continue
          } catch (retryError) {
            errors.push(retryError)
            failedPages.push(page.pageNumber)
            continue
          }
        }
        errors.push(pageError)
        failedPages.push(page.pageNumber)
      }
    }
    return { results, failedPages, errors }
  }
}

/** Human-readable page list: "page 5" / "pages 5, 6 and 9". */
export function formatPageList(pages = []) {
  const list = [...new Set(pages)].sort((a, b) => a - b)
  if (!list.length) return ''
  if (list.length === 1) return `page ${list[0]}`
  return `pages ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
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

function normalizeReadText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenOverlapRatio(a, b) {
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let hit = 0
  ta.forEach(t => { if (tb.has(t)) hit += 1 })
  return hit / Math.min(ta.size, tb.size)
}

/**
 * Are two extracted questions two OCR READS of the same printed question?
 * The batch overlap and the recovery re-scans read the same physical page more
 * than once, and OCR drift means the second read rarely matches the first
 * verbatim — questionKey() then treats them as distinct and BOTH survive the
 * merge (the "Duplicate numbers: 42, 43…" + "Q42 has only 2 options, Q42 has
 * only 3 options" report). Same printed number on the same/adjacent page with
 * a similar stem (or matching options, or one unreadable stem) is one question.
 * Adjacent pages count because a question straddling a page boundary can be
 * stamped with either page across two reads. Numbers far apart in the paper
 * (e.g. papers that restart numbering per section) never collide because their
 * pages differ by more than one. Pure + exported for tests.
 */
export function isSameQuestionRead(a, b) {
  const na = Number(a?.sourceQuestionNumber)
  const nb = Number(b?.sourceQuestionNumber)
  if (!Number.isInteger(na) || na <= 0 || na !== nb) return false
  const pa = Number(a?.sourcePage)
  const pb = Number(b?.sourcePage)
  if (Number.isInteger(pa) && pa > 0 && Number.isInteger(pb) && pb > 0 && Math.abs(pa - pb) > 1) {
    return false
  }
  const sa = normalizeReadText(a?.text)
  const sb = normalizeReadText(b?.text)
  // One read couldn't extract the stem — same number on the same page is the
  // same printed question; merging fills the blank instead of duplicating it.
  if (!sa || !sb) return true
  if (sa === sb || sa.startsWith(sb) || sb.startsWith(sa)) return true
  if (tokenOverlapRatio(sa, sb) >= 0.6) return true
  // Stems drifted apart — shared answer options still identify the read.
  const optsA = new Set((Array.isArray(a?.options) ? a.options : []).map(normalizeReadText).filter(Boolean))
  const optsB = (Array.isArray(b?.options) ? b.options : []).map(normalizeReadText).filter(Boolean)
  return optsB.filter(o => optsA.has(o)).length >= 2
}

// How "complete" one OCR read of a question is. Options dominate (a read that
// captured all four options beats a read that captured two), then stem length,
// then attached figures.
function readScore(q) {
  const opts = Array.isArray(q?.options) ? q.options.filter(o => String(o ?? '').trim()).length : 0
  const stem = String(q?.text || '').trim().length
  const figs = Array.isArray(q?.diagrams) ? q.diagrams.length : 0
  return opts * 1000 + Math.min(stem, 900) + figs * 50
}

/**
 * Merge a second OCR read of the same printed question INTO the kept object
 * (in place, so references already inside merged sections upgrade too). The
 * more complete read wins per field; the other read back-fills anything the
 * winner left blank, and the richer options/diagram lists are kept outright.
 * Exported for tests.
 */
export function mergeQuestionReads(kept, incoming) {
  const [win, lose] = readScore(incoming) > readScore(kept) ? [incoming, kept] : [kept, incoming]
  const merged = { ...lose }
  Object.entries(win).forEach(([k, v]) => {
    const empty = v == null ||
      (typeof v === 'string' && !v.trim()) ||
      (Array.isArray(v) && !v.length)
    if (!empty) merged[k] = v
  })
  const optCount = list => (Array.isArray(list) ? list.filter(o => String(o ?? '').trim()).length : 0)
  if (optCount(lose.options) > optCount(win.options)) merged.options = lose.options
  const figCount = list => (Array.isArray(list) ? list.length : 0)
  if (figCount(lose.diagrams) > figCount(win.diagrams)) merged.diagrams = lose.diagrams
  // Sighting flags OR together: a winner read that simply MISSED the figure
  // (hasDiagram:false — not "empty", so the spread above would keep it) must
  // not erase the other read's sighting, or the crop/fallback pass skips a
  // figure the paper really has. Same for pictorial options.
  if (win.hasDiagram === false && lose.hasDiagram) merged.hasDiagram = true
  if (win.optionsAreImages === false && lose.optionsAreImages) merged.optionsAreImages = true
  Object.keys(kept).forEach(k => { delete kept[k] })
  Object.assign(kept, merged)
  return kept
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
  // Every kept question, indexed by its printed number, so a second OCR read
  // of the same printed question (overlap / recovery re-scan, with OCR drift)
  // merges into the kept object instead of surviving as a duplicate.
  const keptByNumber = new Map()
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
      if (hasNumber) {
        const candidates = keptByNumber.get(q.sourceQuestionNumber) || []
        const match = candidates.find(existing => isSameQuestionRead(existing, q))
        if (match) {
          // Same printed question read twice — upgrade the kept copy in place
          // (it's already referenced from a merged section) and drop this one.
          mergeQuestionReads(match, q)
          seenQuestions.add(key)
          return
        }
        candidates.push(q)
        keptByNumber.set(q.sourceQuestionNumber, candidates)
      }
      seenQuestions.add(key)
      kept.push(q)
    })
    return kept
  }

  // Declared Part definitions (label / section / printed range / instruction)
  // the model returns alongside the sections. Unioned across batches by range
  // so a Part that straddles a batch boundary is kept once; the richest
  // instruction wins. Consumed as ground truth by pastPaperParts.
  const partByRange = new Map()

  batchResults.forEach(result => {
    if (!result) return
    if (Array.isArray(result.warnings)) warnings.push(...result.warnings)
    detectedTotal += Number(result.detectedCount) || 0

    ;(Array.isArray(result.parts) ? result.parts : []).forEach(part => {
      const start = Number(part?.firstNumber)
      const end = Number(part?.lastNumber)
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return
      const key = `${start}-${end}`
      const existing = partByRange.get(key)
      const instruction = String(part?.instruction || '').trim()
      if (!existing) {
        partByRange.set(key, {
          label: String(part?.label || '').trim(),
          sectionTitle: String(part?.sectionTitle || '').trim(),
          firstNumber: start,
          lastNumber: end,
          instruction,
          hasExample: Boolean(part?.hasExample),
        })
      } else {
        if (!existing.label && part?.label) existing.label = String(part.label).trim()
        if (!existing.sectionTitle && part?.sectionTitle) existing.sectionTitle = String(part.sectionTitle).trim()
        if (instruction.length > existing.instruction.length) existing.instruction = instruction
        existing.hasExample = existing.hasExample || Boolean(part?.hasExample)
      }
    })

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

  const parts = [...partByRange.values()].sort((a, b) => a.firstNumber - b.firstNumber)
  return { sections, parts, warnings: [...new Set(warnings)], detectedTotal }
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
    // Per-question OCR confidence (0-1) drives the review screen's auto-approve
    // band. null when the backend gave no score (treated as "review", never
    // auto-approved). Handwritten items arrive capped below the auto bar.
    ocrConfidence: Number.isFinite(q?.ocrConfidence) ? q.ocrConfidence : null,
    source: q?.source === 'handwritten' ? 'handwritten' : 'printed',
    // Whether the stem carried maths markup (\frac, $…$, [[vmath]]). Maths OCR
    // is the least reliable read, so the review screen asks the teacher to
    // confirm it renders correctly before publishing.
    hasMath: hasImportMarkup(rawStem),
  }
  // A handwritten stem is worth a visible note so the teacher checks the typed
  // transcription — the wording was inferred from handwriting, not printed text.
  if (q?.source === 'handwritten') {
    reviewNotes.push('Transcribed from handwriting — check the typed wording matches the original.')
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
 * Map a list of missing printed question numbers to the rendered page numbers
 * they most likely sit on, so a recovery pass can re-scan just those pages.
 *
 * Uses the captured questions as anchors: each carries its printed
 * `sourceQuestionNumber` and the `sourcePage` it was read from. For a missing
 * number N we take the page of the nearest captured number below it and the
 * nearest above it, and include every page in that (inclusive) range — the
 * missing question has to live somewhere between its neighbours. Numbers below
 * the first / above the last captured anchor extend to the first / last known
 * page. Returns a sorted, de-duplicated, capped page list. Pure + node-testable.
 */
export function pagesForMissingNumbers(rawSections = [], missingNumbers = [], { maxPages = SCANNED_RECOVERY_MAX_PAGES } = {}) {
  const anchors = []
  const collect = (q) => {
    const n = Number(q?.sourceQuestionNumber)
    const p = Number(q?.sourcePage)
    if (Number.isInteger(n) && n > 0 && Number.isInteger(p) && p > 0) anchors.push({ n, p })
  }
  ;(Array.isArray(rawSections) ? rawSections : []).forEach(section => {
    if (section?.kind === 'passage') (section.questions || []).forEach(collect)
    else collect(section?.question || section)
  })
  if (!anchors.length) return []
  anchors.sort((a, b) => a.n - b.n)
  const minPage = anchors.reduce((m, a) => Math.min(m, a.p), anchors[0].p)
  const maxPage = anchors.reduce((m, a) => Math.max(m, a.p), anchors[0].p)
  const pages = new Set()
  ;(Array.isArray(missingNumbers) ? missingNumbers : []).forEach(raw => {
    const N = Number(raw)
    if (!Number.isInteger(N) || N <= 0) return
    let low = null
    let high = null
    for (const a of anchors) {
      if (a.n < N) low = a
      else if (a.n > N) { high = a; break }
    }
    const lo = Math.min(low ? low.p : minPage, high ? high.p : maxPage)
    const hi = Math.max(low ? low.p : minPage, high ? high.p : maxPage)
    for (let p = lo; p <= hi; p += 1) pages.add(p)
  })
  return [...pages].sort((a, b) => a - b).slice(0, maxPages)
}

/**
 * Find pages that were read successfully but yielded NO questions at all.
 * findMissingQuestionNumbers only sees gaps BETWEEN captured printed numbers —
 * a block dropped at the very END of the paper (numbers past the last capture)
 * or on a paper without reliable numbering leaves no gap to detect. A page
 * that produced zero questions is the complementary signal: re-scan it once.
 *
 * `layoutQuestionsByPage` (Map pageNumber → question count from the cheap
 * layout pass) filters out pages that genuinely have no questions (cover /
 * instructions / passage-continuation pages). Without layout info the only
 * heuristic is skipping page 1 (usually the cover). `excludePages` removes
 * pages already reported unreadable — they had the full retry treatment.
 * Pure + node-testable.
 */
export function findZeroYieldPages(rawSections = [], pageNumbers = [], {
  layoutQuestionsByPage = null,
  excludePages = [],
  maxPages = SCANNED_RECOVERY_MAX_PAGES,
} = {}) {
  if (!Array.isArray(rawSections) || !rawSections.length) return []
  const yielded = new Set()
  const collect = (q) => {
    const p = Number(q?.sourcePage)
    if (Number.isInteger(p) && p > 0) yielded.add(p)
  }
  rawSections.forEach(section => {
    if (section?.kind === 'passage') {
      const own = Number(section?.sourcePage)
      if (Number.isInteger(own) && own > 0) yielded.add(own)
      ;(section.questions || []).forEach(collect)
    } else {
      collect(section?.question || section)
    }
  })
  // No section carries a page attribution at all → there is no per-page yield
  // signal to act on; re-scanning every page would be pure noise.
  if (!yielded.size) return []
  const excluded = new Set(excludePages)
  return (Array.isArray(pageNumbers) ? pageNumbers : [])
    .filter(n => !yielded.has(n) && !excluded.has(n))
    .filter(n => {
      if (layoutQuestionsByPage && layoutQuestionsByPage.has(n)) {
        return layoutQuestionsByPage.get(n) > 0
      }
      return n !== 1
    })
    .slice(0, maxPages)
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

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Preserves input
 * order in the result. Small, dependency-free — used to parallelise the cheap
 * per-page layout pass without hammering the callable.
 */
export async function mapWithConcurrency(items = [], limit = 4, fn) {
  const list = Array.isArray(items) ? items : []
  const results = new Array(list.length)
  let cursor = 0
  const workers = new Array(Math.max(1, Math.min(limit, list.length))).fill(0).map(async () => {
    while (cursor < list.length) {
      const i = cursor
      cursor += 1
      results[i] = await fn(list[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Compare what the cheap layout pass SAW on the pages against what the
 * extraction actually captured, and return a warning when the layout detected
 * notably more structured objects (tables/pictographs/diagrams) than were
 * reconstructed — the "a table went missing" signal. Advisory + pure: given an
 * aggregate layout summary ({ tables, diagrams }) and the merged sections,
 * returns a warning string or null. Never throws; a missing/empty layout
 * summary yields null so the importer degrades to no layout reconciliation.
 */
export function reconcileLayoutCoverage(rawSections = [], layoutSummary = null) {
  if (!layoutSummary || typeof layoutSummary !== 'object') return null
  const sawTables = Number(layoutSummary.tables) || 0
  const capturedFigures = countDetectedDiagrams(rawSections)
  // Only warn on a meaningful shortfall (layout saw ≥2 more structured objects
  // than were captured) — a 1-object slack absorbs the usual detector noise.
  if (sawTables > 0 && capturedFigures + 1 < sawTables) {
    return (
      `The page scan spotted about ${sawTables} table/figure${sawTables === 1 ? '' : 's'} ` +
      `but ${capturedFigures} were reconstructed — check the pages for a table or ` +
      'diagram that may have been missed.'
    )
  }
  return null
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
export function buildScannedSummary({ sections = [], fileName = '', pageCount = 0, warnings = [], engineVersion = '' } = {}) {
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
    // Version stamps so a stale deploy is visible in the editor: the client
    // importer's own version, and the engine version the deployed Cloud
    // Function reported back (empty if it returned none — i.e. running code
    // older than this stamp).
    importerVersion: SCANNED_IMPORTER_VERSION,
    engineVersion: engineVersion || '',
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
export async function renderPdfPagesForVision(pdf, { maxPages = SCANNED_MAX_PAGES, onProgress, targetWidth = 1500, enhance = true } = {}) {
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
      // Keep the ORIGINAL render for the review-screen preview + any figure the
      // teacher keeps; send an ENHANCED copy (de-shadowed, levelled, sharpened)
      // to vision for a cleaner OCR read. Enhance for the machine, preserve the
      // original for the human.
      const originalDataUrl = canvasToDataUrl(canvas)
      const blob = dataUrlToBlob(originalDataUrl)
      if (blob) assetByPage[pageNumber] = makePageAsset(blob, pageNumber)
      let visionDataUrl = originalDataUrl
      if (enhance) {
        const { blurry } = enhanceCanvasInPlace(canvas, { blackAndWhite: false })
        visionDataUrl = canvasToDataUrl(canvas)
        if (blurry) {
          warnings.push(`Page ${pageNumber} looks blurry — a sharper scan reads more accurately.`)
        }
      }
      pageImages.push({ pageNumber, dataUrl: visionDataUrl })
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
async function rasterizeImageFile(file, targetWidth = 1500, { enhance = true } = {}) {
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
    // Original for the preview/asset; enhanced copy for vision (see the PDF path).
    const originalDataUrl = canvasToDataUrl(canvas)
    const blob = dataUrlToBlob(originalDataUrl)
    let visionDataUrl = originalDataUrl
    let blurry = false
    if (enhance) {
      const res = enhanceCanvasInPlace(canvas, { blackAndWhite: false })
      visionDataUrl = canvasToDataUrl(canvas)
      blurry = res.blurry
    }
    return { dataUrl: visionDataUrl, blob, blurry }
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
export async function renderImageFilesForVision(files, { maxImages = SCANNED_MAX_IMAGES, onProgress, targetWidth = 1500, enhance = true } = {}) {
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
      const { dataUrl, blob, blurry } = await rasterizeImageFile(list[i], targetWidth, { enhance })
      pageImages.push({ pageNumber, dataUrl })
      if (blob) assetByPage[pageNumber] = makePageAsset(blob, pageNumber)
      if (blurry) {
        warnings.push(`"${list[i]?.name || `Image ${pageNumber}`}" looks blurry — a sharper photo reads more accurately.`)
      }
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
  // Optional Map<partLabel, instruction> from the declared-range reconciler, so
  // a rebuilt Part carries its printed instruction (e.g. "Choose the sentence
  // which is correctly punctuated") instead of an empty instruction box.
  const instructionByLabel = deps.instructionByLabel instanceof Map ? deps.instructionByLabel : null
  const labelOf = (section) => {
    if (section?.kind === 'passage') {
      // A passage rarely carries its own section heading — the "Section A" label
      // usually sits on its questions. Fall back to the first question's title so
      // the passage is grouped with the questions it belongs to, not orphaned.
      const own = String(section.passage?.sectionTitle || '').trim()
      if (own) return own
      const firstQ = Array.isArray(section.passage?.questions) ? section.passage.questions[0] : null
      return String(firstQ?.sectionTitle || '').trim()
    }
    return String(section?.question?.sectionTitle || '').trim()
  }
  const parts = []
  let currentLabel = null
  let currentPartId = null
  ;(Array.isArray(sections) ? sections : []).forEach((section) => {
    const label = labelOf(section)
    if (label && label !== currentLabel) {
      const instructions = instructionByLabel?.get(label) || ''
      const part = makePart({ title: label, order: parts.length, ...(instructions ? { instructions } : {}) })
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
  callLayout,
  onProgress,
  sourceNoun = 'scanned paper',
  diagramHandling = DEFAULT_DIAGRAM_HANDLING,
} = {}) {
  if (!pageImages.length) {
    throw new Error(`None of the ${sourceNoun} pages could be read for import.`)
  }
  const handling = normaliseDiagramHandling(diagramHandling)

  // ── Optional layout-first pass ─────────────────────────────────────────────
  // When a cheap layout classifier is wired, inventory each page's objects
  // (in bounded parallel) BEFORE extraction so we can reconcile coverage. This
  // is advisory: any failure yields an empty inventory and we carry on. Runs
  // once per page (no duplicate pages within an import → nothing to cache
  // beyond this single pass).
  let layoutSummary = null
  // Per-page question counts from the layout pass — lets the zero-yield
  // recovery below tell an under-extracted page apart from a page that
  // genuinely has no questions (cover / instructions / passage continuation).
  let layoutQuestionsByPage = null
  // Kick the layout pass off CONCURRENTLY with extraction rather than blocking
  // on it up front. Its results are only consumed AFTER the main extraction
  // pass (zero-yield recovery + coverage reconciliation), so starting it now and
  // awaiting it just before the recovery step overlaps its latency with the
  // batch reads instead of stacking on top of them — on a long paper this alone
  // shaves the whole layout wave off the perceived import time.
  const layoutPromise = (typeof callLayout === 'function')
    ? (async () => {
      try {
        const perPage = await mapWithConcurrency(pageImages, 4, (p) =>
          callLayout(p.dataUrl).catch(() => null),
        )
        const qByPage = new Map()
        perPage.forEach((res, i) => {
          const s = res && res.summary
          // Only record an AUTHORITATIVE per-page count from a NON-degraded
          // layout that actually reported a `questions` number. A degraded /
          // timed-out layout returns { summary: { total: 0 }, degraded: true }
          // with no `questions` field — recording that as 0 would make the
          // zero-yield pass treat the page as confirmed-empty and wrongly
          // suppress its re-scan. Leaving it absent lets findZeroYieldPages fall
          // back to its "assume a non-cover page has questions" heuristic.
          if (s && !res.degraded && Number.isFinite(Number(s.questions))) {
            qByPage.set(pageImages[i].pageNumber, Number(s.questions))
          }
        })
        const summary = perPage.reduce((acc, res) => {
          const s = res && res.summary
          if (!s) return acc
          acc.tables += Number(s.tables) || 0
          acc.diagrams += Number(s.diagrams) || 0
          acc.questions += Number(s.questions) || 0
          return acc
        }, { tables: 0, diagrams: 0, questions: 0 })
        return { layoutSummary: summary, layoutQuestionsByPage: qByPage }
      } catch {
        return { layoutSummary: null, layoutQuestionsByPage: null }
      }
    })()
    : null

  const runBatch = async (pages, phase, current, total) => {
    onProgress?.({ phase, current, total })
    // Sequential: keeps us under the per-call daily AI meter and avoids
    // hammering the vision API with concurrent large requests.
    return callVision({
      fileName: file?.name || '',
      pages,
      subjectHint,
      gradeHint,
    })
  }

  const batches = chunkPages(pageImages)
  const batchResults = []
  // A single failed reading batch (timeout, network drop, daily-cap,
  // rate-limit, App Check) must NOT discard the pages that read fine — that is
  // the "import cuts off on its own and I lose everything" report. Each batch
  // reads resiliently: a transient failure (typically the function deadline on
  // a dense 4-page batch) falls back to one-page-at-a-time reads with a retry,
  // so a slow batch degrades to smaller calls instead of losing its pages —
  // the recurring "one group of pages could not be read / questions 23-33
  // missing" report. Only pages that STILL failed after that are surfaced, and
  // we only hard-fail if EVERY batch failed (so a config problem is visible).
  const batchErrors = []
  const failedPages = []
  const readOkPages = new Set()
  const markRead = (pages, unread) => {
    const unreadSet = new Set(unread)
    pages.forEach(p => { if (!unreadSet.has(p.pageNumber)) readOkPages.add(p.pageNumber) })
  }
  // Read the batches with BOUNDED CONCURRENCY instead of strictly one-at-a-time.
  // Each batch still reads resiliently (a transient failure degrades to per-page
  // reads with a retry), so a slow batch never loses its pages. Progress reports
  // COMPLETED batches (order-independent) so the bar still advances honestly.
  let readDone = 0
  const perBatch = await mapWithConcurrency(batches, SCANNED_BATCH_CONCURRENCY, async (batch) => {
    const out = await readBatchResilient(batch, pages => callVision({
      fileName: file?.name || '',
      pages,
      subjectHint,
      gradeHint,
    }))
    readDone += 1
    onProgress?.({ phase: 'reading', current: readDone, total: batches.length })
    return out
  })
  // Fold the per-batch outputs in batch order, so batchErrors[0] stays the
  // lowest-index failing batch (its message is the reason surfaced on a total
  // failure and in the partial-import warning).
  perBatch.forEach((out, i) => {
    batchResults.push(...out.results)
    failedPages.push(...out.failedPages)
    markRead(batches[i], out.failedPages)
    if (out.errors.length) batchErrors.push({ batch: i + 1, message: out.errors[0]?.message || '' })
  })

  if (!batchResults.length) {
    // Nothing to build from. Bubble up the first batch's real error (daily
    // limit reached, App Check failed, permission denied, timeout) instead of
    // a blank cutoff, so the teacher/admin knows what to fix.
    const reason = batchErrors[0]?.message
    throw new Error(
      reason
        ? `Could not read this ${sourceNoun}: ${reason}`
        : `Could not read this ${sourceNoun}. Please try again.`,
    )
  }

  let merged = mergeSectionBatches(batchResults)

  // Resolve the layout pass now (it ran concurrently with extraction above). By
  // the time the batches are read it is usually already done, so this rarely
  // waits — the point was to overlap its latency, not add to it.
  if (layoutPromise) {
    const resolved = await layoutPromise
    layoutSummary = resolved?.layoutSummary ?? null
    layoutQuestionsByPage = resolved?.layoutQuestionsByPage ?? null
  }

  // Pages the zero-yield pass targeted (for the honest warning below).
  let zeroYieldTargets = []

  // ── Cross-batch gap recovery ───────────────────────────────────────────────
  // The merge only WARNS about printed numbers that never came back. Here we
  // close the loop: re-scan just the pages a missing block sits on (smaller,
  // focused batches make the vision model enumerate far more reliably) and
  // merge the recovered questions in. Bounded rounds; a round that recovers
  // nothing new stops the loop, so a genuinely complete paper costs nothing.
  if (typeof callVision === 'function') {
    const pageImageByNumber = new Map(pageImages.map(p => [p.pageNumber, p]))
    for (let round = 0; round < SCANNED_RECOVERY_ROUNDS; round += 1) {
      const missing = findMissingQuestionNumbers(merged.sections)
      if (!missing.length) break
      const targetPages = pagesForMissingNumbers(merged.sections, missing)
      const retryImages = targetPages
        .map(n => pageImageByNumber.get(n))
        .filter(Boolean)
      if (!retryImages.length) break
      const before = missing.length
      // Recovery re-scans use smaller, no-overlap batches: the pages being
      // recovered are usually the dense/slow ones, and fewer pages per call
      // both reads more reliably and stays inside the function deadline. The
      // resilient reader degrades a still-failing pair to single-page reads.
      const retryBatches = chunkPages(retryImages, SCANNED_RECOVERY_BATCH_SIZE, 0)
      for (let i = 0; i < retryBatches.length; i += 1) {
        // A failed recovery page just means we keep the missing-number
        // warning — readBatchResilient never throws, so a bad page can't
        // sink the whole import.
        const { results, failedPages: unread } = await readBatchResilient(
          retryBatches[i],
          pages => runBatch(pages, 'recovering', i + 1, retryBatches.length),
        )
        batchResults.push(...results)
        markRead(retryBatches[i], unread)
      }
      merged = mergeSectionBatches(batchResults)
      // Stop as soon as a round recovers nothing new (the model genuinely
      // can't read those pages — re-running would only burn the AI meter).
      if (findMissingQuestionNumbers(merged.sections).length >= before) break
    }

    // ── Zero-yield page recovery ─────────────────────────────────────────────
    // The number-gap loop above can only see gaps BETWEEN captured numbers; a
    // block dropped at the very END of the paper (or a paper without reliable
    // numbering) leaves no gap. Complementary signal: a page that read fine
    // but produced NO questions gets one focused re-scan — unless the layout
    // pass says the page genuinely has none (cover / instructions page).
    // Pages that failed outright are excluded (they already had the full
    // retry ladder and are covered by the unread-pages warning).
    {
      const allPageNumbers = pageImages.map(p => p.pageNumber)
      const excludedPages = failedPages.filter(n => !readOkPages.has(n))
      if (merged.sections.length) {
        zeroYieldTargets = findZeroYieldPages(merged.sections, allPageNumbers, {
          layoutQuestionsByPage,
          excludePages: excludedPages,
        })
      } else if (layoutQuestionsByPage && layoutQuestionsByPage.size) {
        // The first pass returned NOTHING, so findZeroYieldPages has no page
        // attribution to work from — but the layout pass DID see questions on
        // some pages. Re-scan exactly those (focused per-page reads enumerate
        // far more reliably than the failed whole-paper pass) instead of
        // falling straight through to "no questions could be read". Only pages
        // a non-degraded layout reported questions on, and not ones that
        // failed to read outright.
        const excluded = new Set(excludedPages)
        zeroYieldTargets = allPageNumbers
          .filter(n => !excluded.has(n) && (layoutQuestionsByPage.get(n) || 0) > 0)
          .slice(0, SCANNED_RECOVERY_MAX_PAGES)
      }
      if (zeroYieldTargets.length) {
        const retryImages = zeroYieldTargets
          .map(n => pageImageByNumber.get(n))
          .filter(Boolean)
        const retryBatches = chunkPages(retryImages, SCANNED_RECOVERY_BATCH_SIZE, 0)
        for (let i = 0; i < retryBatches.length; i += 1) {
          const { results, failedPages: unread } = await readBatchResilient(
            retryBatches[i],
            pages => runBatch(pages, 'recovering', i + 1, retryBatches.length),
          )
          batchResults.push(...results)
          markRead(retryBatches[i], unread)
        }
        merged = mergeSectionBatches(batchResults)
      }
    }
  }

  // ── Declared-range reconciliation (printed "Questions X–Y" as ground truth) ──
  // ECZ / PSLE papers declare each Part's question range and instruction, so we
  // use them to (a) drop questions numbered outside every declared range — the
  // phantom over-count (60 → 65) — (b) dedupe same-number reads, (c) snap
  // mis-read numbers back to the printed sequence when the count lines up, and
  // (d) turn a stem-less spelling/punctuation item into a real question whose
  // stem is the Part instruction and whose options are the four sentences.
  // No-op on a paper that declares no ranges (returned untouched). Runs on the
  // RAW merged sections so it flows through visionSectionsToLocal unchanged.
  let rangeReport = null
  let partInstructionByLabel = null
  const declaredRanges = collectDeclaredRanges(merged)
  if (declaredRanges.length) {
    const rec = reconcilePaperNumbering(merged.sections, declaredRanges)
    const assigned = assignPartsFromRanges(rec.sections, declaredRanges)
    merged.sections = assigned.sections
    partInstructionByLabel = assigned.instructionByLabel
    rangeReport = {
      declaredTotal: rec.declaredTotal,
      droppedOutOfRange: rec.droppedOutOfRange,
      droppedDuplicate: rec.droppedDuplicate,
      missing: rec.missing,
      snapped: rec.snapped,
      stemsFilled: assigned.stemsFilled,
    }
  }

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
  // Some pages failed to read even after the per-page retries — surface a
  // clear, honest partial-import notice naming the exact pages instead of
  // silently dropping their questions. A page that failed inside one batch but
  // was read successfully by another pass (overlap / split retry / recovery)
  // is NOT reported: its content made it in.
  const unreadPages = [...new Set(failedPages)].filter(n => !readOkPages.has(n))
  if (unreadPages.length) {
    const pageLabel = formatPageList(unreadPages)
    warnings.unshift(
      `${pageLabel.charAt(0).toUpperCase()}${pageLabel.slice(1)} could not be read even after retrying ` +
      `(${batchErrors[0]?.message || 'the reader failed'}) — questions on ` +
      `${unreadPages.length === 1 ? 'that page' : 'those pages'} may be missing. ` +
      'Re-import to try again, or add them by hand.',
    )
  }
  // Zero-yield pages that STILL produced nothing after their focused re-scan:
  // tell the teacher exactly which pages to check instead of leaving a silent
  // hole. (Re-checked against the post-recovery merge so a recovered page is
  // not reported; the "assume questions" map skips the cover-page heuristic —
  // these pages were already judged worth re-scanning.)
  if (zeroYieldTargets.length) {
    const stillZero = findZeroYieldPages(merged.sections, zeroYieldTargets, {
      layoutQuestionsByPage: new Map(zeroYieldTargets.map(n => [n, 1])),
    })
    if (stillZero.length) {
      warnings.push(
        `No questions were found on ${formatPageList(stillZero)} even after a second read — ` +
        `if the paper has questions there, re-import ${stillZero.length === 1 ? 'that page' : 'those pages'} ` +
        'or add the questions by hand.',
      )
    }
  }
  // Layout-vs-extraction reconciliation: if the cheap layout pass saw more
  // tables/figures than we reconstructed, surface it so a missed table is
  // visible rather than silently dropped.
  const layoutWarning = reconcileLayoutCoverage(merged.sections, layoutSummary)
  if (layoutWarning && !warnings.includes(layoutWarning)) warnings.push(layoutWarning)
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
    // Gap check. When the paper declared its ranges we trust the reconciler's
    // declared-total gap list (accurate even for a block dropped at the very
    // end); otherwise fall back to the observed-sequence heuristic.
    const missing = rangeReport ? rangeReport.missing : findMissingQuestionNumbers(merged.sections)
    if (missing.length) {
      warnings.unshift(
        `${missing.length} question${missing.length === 1 ? '' : 's'} appear to be missing (${formatMissingList(missing)}). ` +
        'Re-import (it may catch them on a second pass) or add them by hand.',
      )
    }
    // Declared-range reconciliation notices — honest about what was auto-fixed
    // against the paper's own printed structure.
    if (rangeReport) {
      const removed = rangeReport.droppedOutOfRange + rangeReport.droppedDuplicate
      if (removed > 0) {
        warnings.unshift(
          `Removed ${removed} extra question${removed === 1 ? '' : 's'} the scanner added that ${removed === 1 ? "isn't" : "aren't"} on the paper ` +
          `(it prints ${rangeReport.declaredTotal} questions). Check the count looks right.`,
        )
      }
      if (rangeReport.snapped) {
        warnings.push(
          `Question numbers were re-aligned to the paper's printed 1–${rangeReport.declaredTotal} sequence — ` +
          'check a few land where you expect.',
        )
      }
      if (rangeReport.stemsFilled > 0) {
        warnings.push(
          `${rangeReport.stemsFilled} question${rangeReport.stemsFilled === 1 ? '' : 's'} (e.g. spelling / punctuation) had no printed wording, so the Part's ` +
          'instruction was used as the question and the printed choices as the options — review them before publishing.',
        )
      }
    }
    warnings.unshift('Answers were left blank — set the correct answer for each question before publishing.')
  }

  // Group the sections under their printed headings (Section A / B … or the
  // reconciled "Part N: Questions X–Y" labels) into part groups so the paper
  // rebuilds with its original section structure — carrying each Part's printed
  // instruction when the declared-range reconciler resolved one.
  const { parts } = groupSectionsIntoParts(sections, { instructionByLabel: partInstructionByLabel || undefined })

  // The engine version the DEPLOYED function reported (first non-empty across
  // batches). Empty means the live function is older than version stamping —
  // a stale deploy — which the editor surfaces so it's visible, not silent.
  const engineVersion = batchResults
    .map(r => (r && typeof r.engineVersion === 'string' ? r.engineVersion : ''))
    .find(Boolean) || ''

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
    engineVersion,
    summary: buildScannedSummary({
      sections,
      fileName: file?.name || '',
      pageCount: pageImages.length,
      warnings,
      engineVersion,
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
  callLayout,
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
    callLayout,
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
  callLayout,
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
    callLayout,
    onProgress,
    sourceNoun: list.length > 1 ? 'images' : 'image',
    diagramHandling,
  })
}
