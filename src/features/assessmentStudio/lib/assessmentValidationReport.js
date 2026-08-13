/**
 * The pre-export validation report (§10).
 *
 * ## Why a report and not a boolean
 *
 * The export gate answers one question — may this paper leave? — and it answers
 * it with the first blocker it finds, because that is what a disabled button
 * needs. A teacher about to run forty copies wants a different thing: the whole
 * list, each item naming the question and the reason, split into what stops the
 * export and what is merely worth a look before the photocopier.
 *
 * So this composes the checks that already exist rather than adding a fourth
 * opinion:
 *
 *   - the paper's arithmetic and structure — numbering, choices, marks — from
 *     `paperIntegrityCore`, the SAME module the server's export callable runs;
 *   - the measured page layout from `paperPaginationCore`, which knows about
 *     blank pages, split questions and separated diagrams;
 *   - the figures, from the resolved boxes on the document's own blocks;
 *   - two things only the finished document can answer: a maths node that never
 *     resolved to anything printable, and a font no renderer will have.
 *
 * ## What is a blocker and what is a warning
 *
 * A blocker is something that makes the printed paper WRONG — a learner cannot
 * answer it, or is marked against something they never saw. A warning is
 * something that makes it worse but still usable. The split is stated per check
 * rather than derived from severity strings, because "is this bad enough to stop
 * a download" is a decision, and a decision that lives in a `.filter()` is one
 * nobody can find later.
 *
 * Pure: given a document and a pagination result, no DOM and no network.
 */

import { collectPaperIntegrityIssues } from '../../../../functions/shared/assessment/paperIntegrityCore.js'
import { blockingLayoutIssues } from './printPdfReadiness.js'
import { PAGINATION_STATES } from '../../../utils/paperPaginationCore.js'
import { figureOverflowsPage } from '../../../utils/figureLayoutModel.js'
import { FONT_FAMILIES } from '../../../config/paperLayoutTokens.js'

export const REPORT_CHECKS = Object.freeze({
  PAGE_COUNT: 'page-count',
  NUMBERING: 'question-numbering',
  CHOICES: 'answer-choices',
  MARKS: 'marks-totals',
  FIGURES: 'figures',
  LAYOUT: 'page-layout',
  MATHS: 'maths',
  FONTS: 'fonts',
})

export const REPORT_ISSUES = Object.freeze({
  MISSING_DIAGRAM: 'figure-missing',
  OVERSIZED_FIGURE: 'figure-oversized',
  FIGURE_BELOW_MINIMUM: 'figure-below-minimum',
  UNRESOLVED_MATHS: 'maths-unresolved',
  UNSUPPORTED_FONT: 'font-unsupported',
  PAGES_NOT_MEASURED: 'pages-not-measured',
})

/**
 * A maths node the renderers could not turn into anything printable.
 *
 * The paper's own machinery must never reach the page (§4.1's
 * `FORBIDDEN_ON_PAPER` says the same thing from the prompt side), and the
 * specific failure this catches is a formula that survived as its SOURCE: a
 * stem printing `\frac{1}{2}` or `$$x^2$$` because the converter did not
 * recognise it. Detected on the flattened plain text, because that is what the
 * printer draws — checking the source would find LaTeX in every question that
 * legitimately contains a formula.
 */
const RAW_MATHS_MARKERS = [
  /\\(?:frac|sqrt|times|div|cdot|le|ge|neq|pm|ce)\b/,
  /\$\$?[^$]+\$\$?/,
  /\\begin\{[a-z]+\}/i,
]

export function findUnresolvedMaths(block) {
  const text = [block?.text || '', ...(block?.optionsPlain || [])].join(' ')
  if (!text.trim()) return null
  const hit = RAW_MATHS_MARKERS.find((pattern) => pattern.test(text))
  return hit ? text.match(hit)[0].slice(0, 60) : null
}

/**
 * A font the paper asks for that no renderer can be relied on to have.
 *
 * The resolved tokens normalise to a known family, so this can only fire on a
 * block carrying an inline `font-family` — pasted from Word, or an imported
 * paper's markup. It is a warning rather than a blocker: the browser and Word
 * both substitute, so the paper prints, it just prints in a face the teacher did
 * not choose, and line breaks move with it.
 */
const ALLOWED_FONT_NAMES = new Set(
  Object.values(FONT_FAMILIES)
    .flatMap((f) => [f.word, ...f.css.split(',')])
    .map((name) => name.replace(/['"]/g, '').trim().toLowerCase())
    .filter(Boolean),
)

export function findUnsupportedFonts(block) {
  const html = [block?.textHtml || '', ...(block?.optionsHtml || [])].join(' ')
  const found = new Set()
  for (const match of html.matchAll(/font-family\s*:\s*([^;"']+)/gi)) {
    const first = String(match[1]).split(',')[0].replace(/['"]/g, '').trim().toLowerCase()
    if (first && !ALLOWED_FONT_NAMES.has(first)) found.add(first)
  }
  return [...found]
}

const issue = (check, code, message, extra = {}) => ({ check, code, message, ...extra })

/**
 * Build the report.
 *
 * @param {object} input
 * @param {object} input.document   buildAssessmentDocument(...) output
 * @param {object} input.pagination usePaperPagination(...) result, or null
 * @param {object} input.assessment the raw paper, for the integrity checks
 * @param {Array}  input.questions  the raw questions, in printed order
 * @returns {{blockers, warnings, checks, ok, blockedForPrint}}
 */
export function buildExportValidationReport({
  document: paperDocument = null,
  pagination = null,
  assessment = null,
  questions = [],
} = {}) {
  const blocks = paperDocument?.blocks || []
  const questionBlocks = blocks.filter((b) => b.kind === 'question')
  const blockers = []
  const warnings = []
  const checks = []

  const record = (id, label, ok, detail = '') => checks.push({ id, label, ok, detail })

  // ── The paper's own arithmetic and structure ────────────────────────────
  // The same module the server runs, so a paper this report passes is one the
  // export callable passes.
  const integrity = collectPaperIntegrityIssues({
    assessment: assessment || {},
    questions: Array.isArray(questions) ? questions : [],
  })
  for (const item of integrity.blockers) {
    blockers.push(issue(checkForIntegrityCode(item.code), item.code, item.message, {
      questionNumber: item.questionNumber ?? null,
    }))
  }
  for (const item of integrity.warnings) {
    warnings.push(issue(checkForIntegrityCode(item.code), item.code, item.message, {
      questionNumber: item.questionNumber ?? null,
    }))
  }

  const integrityFor = (check) => [...blockers, ...warnings].filter((i) => i.check === check)
  record(REPORT_CHECKS.NUMBERING, 'Question numbering runs 1, 2, 3 with no gaps',
    integrityFor(REPORT_CHECKS.NUMBERING).length === 0)
  record(REPORT_CHECKS.CHOICES, 'Every multiple-choice question has the right choices, one of them correct',
    integrityFor(REPORT_CHECKS.CHOICES).length === 0)
  record(REPORT_CHECKS.MARKS, 'The marks add up — question to section to paper',
    integrityFor(REPORT_CHECKS.MARKS).length === 0,
    integrity.marks ? `${integrity.marks.totalMarks} marks in total` : '')

  // ── Figures ─────────────────────────────────────────────────────────────
  let missingFigures = 0
  let oversizedFigures = 0
  let smallFigures = 0
  for (const block of questionBlocks) {
    // A question that asks about a diagram it does not have. `diagramText` is
    // the brief the generator wrote; a stem carrying one with no figure attached
    // is a question a learner cannot answer at all.
    if (block.diagramText && !block.imageUrl && !block.imageDiagram && !(block.images || []).length) {
      missingFigures += 1
      blockers.push(issue(REPORT_CHECKS.FIGURES, REPORT_ISSUES.MISSING_DIAGRAM,
        `Question ${block.number} needs a diagram and does not have one.`,
        { questionNumber: block.number }))
    }
    if (block.figure && paperDocument?.layout && figureOverflowsPage(block.figure, paperDocument.layout)) {
      oversizedFigures += 1
      blockers.push(issue(REPORT_CHECKS.FIGURES, REPORT_ISSUES.OVERSIZED_FIGURE,
        `The figure on question ${block.number} is larger than the page and will be cut off.`,
        { questionNumber: block.number }))
    } else if (block.figure?.belowFloor) {
      // Advisory: the page could not accommodate the level's minimum. The figure
      // still prints, it is just smaller than the band asks for.
      smallFigures += 1
      warnings.push(issue(REPORT_CHECKS.FIGURES, REPORT_ISSUES.FIGURE_BELOW_MINIMUM,
        `The figure on question ${block.number} is smaller than this level's minimum — the page could not fit it any larger.`,
        { questionNumber: block.number }))
    }
  }
  record(REPORT_CHECKS.FIGURES, 'Every figure is present and fits the page',
    missingFigures === 0 && oversizedFigures === 0,
    smallFigures > 0 ? `${smallFigures} below the level's minimum size` : '')

  // ── Maths and fonts ─────────────────────────────────────────────────────
  let unresolvedMaths = 0
  const unsupportedFonts = new Set()
  for (const block of questionBlocks) {
    const raw = findUnresolvedMaths(block)
    if (raw) {
      unresolvedMaths += 1
      blockers.push(issue(REPORT_CHECKS.MATHS, REPORT_ISSUES.UNRESOLVED_MATHS,
        `Question ${block.number} would print its formula as source text (“${raw}”) rather than as a formula.`,
        { questionNumber: block.number }))
    }
    for (const font of findUnsupportedFonts(block)) unsupportedFonts.add(font)
  }
  if (unsupportedFonts.size > 0) {
    warnings.push(issue(REPORT_CHECKS.FONTS, REPORT_ISSUES.UNSUPPORTED_FONT,
      `This paper asks for ${[...unsupportedFonts].join(', ')}, which a school computer may not have — `
      + 'the text will print in a substitute face and the line breaks will move.'))
  }
  record(REPORT_CHECKS.MATHS, 'Every formula resolves to something printable', unresolvedMaths === 0)
  record(REPORT_CHECKS.FONTS, 'Every font is one every renderer has', unsupportedFonts.size === 0)

  // ── The measured layout ─────────────────────────────────────────────────
  // Not measured is NOT reported as a defect: it is our own progress, and it
  // clears itself within about a second. It does keep the check un-ticked, so
  // the report never claims a layout was verified when it was not.
  const status = pagination?.status ?? PAGINATION_STATES.IDLE
  const measured = status === PAGINATION_STATES.READY
  const layoutIssues = blockingLayoutIssues(pagination)
  for (const item of layoutIssues) {
    blockers.push(issue(REPORT_CHECKS.LAYOUT, item.code, item.message, {
      pageNumber: item.pageNumber ?? null,
      questionNumber: item.questionLabel ?? null,
    }))
  }
  record(REPORT_CHECKS.LAYOUT, 'The pages break cleanly — no blank sheets, no split questions',
    measured && layoutIssues.length === 0,
    measured ? '' : 'Still measuring…')
  record(REPORT_CHECKS.PAGE_COUNT, 'The page count is measured, not estimated',
    measured,
    measured ? `${pagination.pageCount} Print/PDF page${pagination.pageCount === 1 ? '' : 's'}` : '')

  return {
    blockers,
    warnings,
    checks,
    /** Nothing blocks the paper's content. Word may go. */
    ok: blockers.filter((b) => b.check !== REPORT_CHECKS.LAYOUT).length === 0,
    /** Nothing blocks the browser routes either. */
    blockedForPrint: blockers.length > 0 || !measured,
    totalMarks: integrity.marks?.totalMarks ?? 0,
    pageCount: measured ? pagination.pageCount : null,
  }
}

/** Which named check an integrity issue belongs under. */
function checkForIntegrityCode(code) {
  const id = String(code || '')
  if (id.startsWith('numbering-')) return REPORT_CHECKS.NUMBERING
  if (id.startsWith('choice-') || id === 'mixed-choice-count') return REPORT_CHECKS.CHOICES
  if (id.startsWith('marks-')) return REPORT_CHECKS.MARKS
  return REPORT_CHECKS.CHOICES
}

/**
 * The report as one sentence.
 *
 * Names the count and the first problem, because a teacher reading "3 problems"
 * still has to open something to find out what they are.
 */
export function reportHeadline(report) {
  if (!report) return ''
  const { blockers, warnings } = report
  if (blockers.length === 1) return `${blockers[0].message} Fix that, then export.`
  if (blockers.length > 1) {
    return `${blockers[0].message} There are ${blockers.length - 1} other problems to fix before this paper can be exported.`
  }
  if (warnings.length > 0) {
    return `Ready to export — ${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth a look first.`
  }
  return 'Every check passed — this paper is ready to export.'
}
