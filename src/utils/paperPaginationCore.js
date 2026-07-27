/**
 * Where the pages actually fall, from measured geometry.
 *
 * ## What this replaces
 *
 * `Math.max(1, Math.ceil((questionCount + totalMarks * 0.4) / 8))`. That number
 * was printed to teachers as "Est. 3 pages · A4" and it is a guess about a
 * document nobody measured: it cannot see a diagram, a comprehension passage, a
 * table, a page break the teacher inserted, or twenty ruled answer lines. A
 * teacher planning a double-sided print, or checking a paper fits the lesson,
 * was reading arithmetic on the question count.
 *
 * So this module does not estimate. It is handed the REAL rendered height of
 * every block, measured in the same engine, at the same width, under the same
 * stylesheet the print window uses, and it flows them into real A4 page boxes.
 *
 * ## Scope, and it is a hard boundary
 *
 * This is authoritative for the BROWSER print path and the PDF that comes out of
 * it, because those are the same engine rendering the same CSS. It is NOT the
 * Word page count and must never be presented as one: Word paginates with its
 * own engine, its own font metrics and its own widow/orphan rules, and a number
 * derived here would be wrong there in a way that is invisible until a teacher
 * opens the file. `.docx` exports carry no page count from this module.
 *
 * ## Why the flow is simulated rather than read out of the browser
 *
 * There is no API that reports where a browser fragmented a document — the
 * information exists only inside the print pipeline. What IS available is every
 * block's true height, and the fragmentation rules the stylesheet declares
 * (`page-break-inside: avoid`, explicit breaks). Flowing measured heights under
 * those rules is the same computation the engine performs, on the same inputs.
 * It is not a heuristic about the CONTENT; it is arithmetic on measurements.
 *
 * Where it can still differ from the printer, it says so rather than pretending:
 * a block taller than a whole page is reported, not silently split.
 */

import {
  PAGE_MM, PAGE_MARGINS_MM, PAGE_MARGIN_BOTTOM_MM, FOOTER_RESERVE_MM, RESERVED_BOTTOM_MM,
} from '../config/paperPageGeometry.js'

/** CSS pixels per millimetre at the 96dpi the print stylesheet is authored in. */
export const PX_PER_MM = 96 / 25.4

export const mmToPx = (mm) => mm * PX_PER_MM
export const pxToMm = (px) => px / PX_PER_MM

/**
 * The box body content is allowed to occupy on one sheet.
 *
 * Height excludes BOTH the page's bottom margin and the footer reservation,
 * because the running `<tfoot>` takes that height out of the flow on every
 * page — see paperPageGeometry.js, which owns that split.
 */
export function pageContentBoxPx() {
  return {
    width: mmToPx(PAGE_MM.width - PAGE_MARGINS_MM.left - PAGE_MARGINS_MM.right),
    height: mmToPx(PAGE_MM.height - PAGE_MARGINS_MM.top - RESERVED_BOTTOM_MM),
    // Where the footer band starts, measured from the top of the content box.
    // Body content below this line has entered the reserved zone.
    footerBandTop: mmToPx(PAGE_MM.height - PAGE_MARGINS_MM.top - RESERVED_BOTTOM_MM),
    reservedBottom: mmToPx(RESERVED_BOTTOM_MM),
    footerReserve: mmToPx(FOOTER_RESERVE_MM),
    marginBottom: mmToPx(PAGE_MARGIN_BOTTOM_MM),
  }
}

/** The states a measurement can be in. Exhaustive; the UI switches on these. */
export const PAGINATION_STATES = Object.freeze({
  IDLE: 'idle',
  MEASURING: 'measuring',
  READY: 'ready',
  STALE: 'stale',
  FAILED: 'failed',
})

/** Issue codes. Each names a defect a teacher would see on the printed sheet. */
export const PAGINATION_ISSUES = Object.freeze({
  BLANK_PAGE: 'blank-page',
  FOOTER_ONLY_PAGE: 'footer-only-page',
  BODY_IN_FOOTER: 'body-in-footer',
  HORIZONTAL_OVERFLOW: 'horizontal-overflow',
  MISSING_BLOCK: 'missing-block',
  QUESTION_SPLIT: 'question-split',
  DIAGRAM_SEPARATED: 'diagram-separated',
  CLIPPED_CONTENT: 'clipped-content',
  OVERSIZED_BLOCK: 'oversized-block',
})

/**
 * An empty result, so every consumer reads the same shape in every state.
 * A caller must never have to check whether `pages` exists.
 */
export function emptyPagination(status = PAGINATION_STATES.IDLE, extra = {}) {
  return { status, pageCount: 0, pages: [], issues: [], ...extra }
}

const issue = (code, message, detail = {}) => ({ code, message, ...detail })

/**
 * Flow measured blocks into pages.
 *
 * @param {Array} blocks measured blocks, in document order. Each:
 *   {id, kind, questionId, heightPx, widthPx, breakBefore, avoidBreakInside,
 *    ownerQuestionId, isFigure, rendered}
 * @param {object} box   pageContentBoxPx() (injected so tests can use round numbers)
 * @returns {{status, pageCount, pages, issues}}
 */
export function paginateBlocks(blocks = [], box = pageContentBoxPx()) {
  const list = Array.isArray(blocks) ? blocks.filter(Boolean) : []
  if (list.length === 0) {
    return { ...emptyPagination(PAGINATION_STATES.READY), pageCount: 0, pages: [] }
  }

  const issues = []
  const pages = []
  let current = newPage(1)
  let used = 0
  // A `.pagebreak` is a zero-height element carrying `page-break-after`, so the
  // break it declares belongs to the block that FOLLOWS it. Carried forward
  // rather than read off the next block, because the next block does not know
  // it is being pushed.
  let breakPending = false

  function newPage(pageNumber) {
    return { pageNumber, questionIds: [], blockIds: [], hasBodyContent: false, usedPx: 0 }
  }

  function closePage() {
    current.usedPx = used
    pages.push(current)
  }

  for (const block of list) {
    const height = Number(block.heightPx) || 0

    // A block that cannot fit a whole page will be fragmented by the printer
    // however we flow it. Reported rather than modelled: a paginator that
    // silently split it would produce a page count the printer disagrees with.
    if (height > box.height) {
      issues.push(issue(PAGINATION_ISSUES.OVERSIZED_BLOCK,
        block.ownerQuestionId
          ? `Question ${block.questionLabel ?? block.ownerQuestionId} is taller than one page and will be split across sheets.`
          : 'A block on this paper is taller than one page and will be split across sheets.',
        { blockId: block.id, questionId: block.ownerQuestionId ?? null }))
    }

    const forcedBreak = (Boolean(block.breakBefore) || breakPending)
      && (used > 0 || current.hasBodyContent)
    // `page-break-inside: avoid` is the stylesheet's instruction to move a block
    // whole rather than fragment it, and the printer obeys it. Recording the
    // property and then flowing as if it were not there would make the
    // measurement disagree with the printed sheet on exactly the papers the
    // rule exists for — a question with a figure, where the alternative is the
    // figure on one page and its stem on the previous one.
    //
    // A block that cannot fit an EMPTY page is unfittable, so moving it would
    // only add a blank sheet before splitting it anyway; that case is reported
    // as OVERSIZED_BLOCK above and flowed where it falls.
    const wouldFragment = used > 0 && used + height > box.height
    const keepsWhole = block.avoidBreakInside && height <= box.height
    const overflows = wouldFragment && (!block.avoidBreakInside || keepsWhole)

    if (forcedBreak || overflows) {
      closePage()
      current = newPage(pages.length + 1)
      used = 0
    }
    breakPending = Boolean(block.breakAfter)

    used += height
    current.blockIds.push(block.id)
    if (block.rendered !== false && height > 0) current.hasBodyContent = true
    const qid = block.ownerQuestionId ?? block.questionId
    if (qid != null && !current.questionIds.includes(qid)) current.questionIds.push(qid)
  }
  closePage()

  // A break left pending at the end opens one more sheet, and nothing lands on
  // it. This was modelled the other way round — "a trailing break adds no page"
  // — on the assumption that a printer would not bother. Chromium does: a paper
  // of four questions with a break after the last one measured 1 page and
  // printed 2. The assumption was mine, the test encoded it, and only the
  // printer could settle it.
  //
  // It is also what makes BLANK_PAGE reachable at all, which matters: an issue
  // code that cannot fire is decoration. This is the "why is there an extra
  // sheet" complaint, and now the gate refuses it.
  if (breakPending) {
    pages.push({ pageNumber: pages.length + 1, questionIds: [], blockIds: [], hasBodyContent: false, usedPx: 0 })
  }

  return {
    status: PAGINATION_STATES.READY,
    pageCount: pages.length,
    pages: pages.map(({ usedPx, ...page }) => ({ ...page, usedPx })),
    issues: [...issues, ...inspectPages(pages, list, box)],
  }
}

/**
 * The defects worth telling a teacher about, read off the finished layout.
 *
 * Deliberately reported rather than repaired: a paginator that quietly moved a
 * figure to keep it with its question would be making an authoring decision, and
 * the printed paper would stop matching the preview.
 */
export function inspectPages(pages = [], blocks = [], box = pageContentBoxPx()) {
  const issues = []
  const byId = new Map(blocks.map((b) => [b.id, b]))

  pages.forEach((page, index) => {
    const isLast = index === pages.length - 1
    if (!page.hasBodyContent) {
      // The distinction matters: a trailing blank sheet is the classic
      // "why is there an extra page" complaint, and an intermediate one means
      // something above it forced a break it should not have.
      issues.push(issue(
        isLast ? PAGINATION_ISSUES.BLANK_PAGE : PAGINATION_ISSUES.BLANK_PAGE,
        isLast
          ? `Page ${page.pageNumber} is blank — the paper ends with an empty sheet.`
          : `Page ${page.pageNumber} is blank.`,
        { pageNumber: page.pageNumber, trailing: isLast },
      ))
      return
    }
    const onlyFooter = page.blockIds.every((id) => byId.get(id)?.kind === 'footerCode')
    if (onlyFooter) {
      issues.push(issue(PAGINATION_ISSUES.FOOTER_ONLY_PAGE,
        `Page ${page.pageNumber} carries only the paper code.`,
        { pageNumber: page.pageNumber }))
    }
    if (page.usedPx > box.height + 0.5) {
      issues.push(issue(PAGINATION_ISSUES.BODY_IN_FOOTER,
        `Content on page ${page.pageNumber} runs into the footer area and may be cut off.`,
        { pageNumber: page.pageNumber, overflowPx: page.usedPx - box.height }))
    }
  })

  // A question whose parts land on two sheets: the learner turns the page
  // mid-question, which is the one break a paper may not contain.
  const pageOfQuestion = new Map()
  for (const page of pages) {
    for (const qid of page.questionIds) {
      if (!pageOfQuestion.has(qid)) pageOfQuestion.set(qid, new Set())
      pageOfQuestion.get(qid).add(page.pageNumber)
    }
  }
  for (const [qid, pageNumbers] of pageOfQuestion) {
    if (pageNumbers.size <= 1) continue
    const block = blocks.find((b) => (b.ownerQuestionId ?? b.questionId) === qid)
    issues.push(issue(PAGINATION_ISSUES.QUESTION_SPLIT,
      `Question ${block?.questionLabel ?? qid} is split across pages ${[...pageNumbers].join(' and ')}.`,
      { questionId: qid, pageNumbers: [...pageNumbers] }))
    // A figure separated from the question it belongs to is a stricter failure
    // than a split: the learner is asked to read a diagram that is not in front
    // of them.
    const figure = blocks.find((b) => b.isFigure && (b.ownerQuestionId ?? b.questionId) === qid)
    if (figure) {
      const stemPage = pageForBlock(pages, blocks.find((b) => !b.isFigure && (b.ownerQuestionId ?? b.questionId) === qid)?.id)
      const figurePage = pageForBlock(pages, figure.id)
      if (stemPage && figurePage && stemPage !== figurePage) {
        issues.push(issue(PAGINATION_ISSUES.DIAGRAM_SEPARATED,
          `The diagram for question ${figure.questionLabel ?? qid} prints on page ${figurePage}, `
          + `away from the question on page ${stemPage}.`,
          { questionId: qid, stemPage, figurePage }))
      }
    }
  }

  // Anything the renderer was asked to draw and did not.
  for (const block of blocks) {
    if (block.rendered === false) {
      issues.push(issue(PAGINATION_ISSUES.MISSING_BLOCK,
        block.ownerQuestionId
          ? `Part of question ${block.questionLabel ?? block.ownerQuestionId} did not render.`
          : 'Part of this paper did not render.',
        { blockId: block.id }))
    }
    if (Number(block.widthPx) > box.width + 1) {
      issues.push(issue(PAGINATION_ISSUES.HORIZONTAL_OVERFLOW,
        block.ownerQuestionId
          ? `Question ${block.questionLabel ?? block.ownerQuestionId} is wider than the page and will be cut off at the right edge.`
          : 'Something on this paper is wider than the page and will be cut off at the right edge.',
        { blockId: block.id, overflowPx: Number(block.widthPx) - box.width }))
    }
    if (block.clipped) {
      issues.push(issue(PAGINATION_ISSUES.CLIPPED_CONTENT,
        block.ownerQuestionId
          ? `The answer space or table for question ${block.questionLabel ?? block.ownerQuestionId} is being clipped.`
          : 'An answer space or table on this paper is being clipped.',
        { blockId: block.id }))
    }
  }

  return issues
}

function pageForBlock(pages, blockId) {
  if (!blockId) return null
  return pages.find((p) => p.blockIds.includes(blockId))?.pageNumber ?? null
}

/**
 * A cheap identity for "the thing that was measured".
 *
 * Any edit to content or layout must mark a finished result STALE rather than
 * leave a page count on screen that describes a paper the teacher has since
 * changed — a number that is quietly out of date is worse than no number,
 * because it still looks like an answer.
 */
export function paperFingerprint({ questions = [], passages = [], parts = [], pagebreaks = [], details = {} } = {}) {
  const q = (Array.isArray(questions) ? questions : []).map((question) => [
    question?.localId ?? question?.id ?? '',
    question?.type ?? '',
    typeof question?.text === 'string' ? question.text.length : JSON.stringify(question?.text ?? '').length,
    question?.marks ?? '',
    question?.answerLines ?? '',
    question?.imageDiagram?.libraryKey ?? '',
    question?.imageUrl ? 1 : 0,
    (question?.options || []).length,
  ].join(':')).join('|')
  const p = (Array.isArray(passages) ? passages : []).map((passage) => [
    passage?.localId ?? passage?.id ?? '',
    String(passage?.passageText ?? '').length,
    passage?.imageDiagram?.libraryKey ?? '',
  ].join(':')).join('|')
  return [
    q, p,
    (Array.isArray(parts) ? parts : []).map((part) => `${part?.id}:${part?.title}`).join('|'),
    (Array.isArray(pagebreaks) ? pagebreaks : []).join(','),
    details.mode ?? '', details.showAnswers ? 1 : 0, details.title ?? '', details.schoolName ?? '',
  ].join('#')
}

/** Has the paper changed since this result was measured? */
export function isStale(result, fingerprint) {
  if (!result || result.status !== PAGINATION_STATES.READY) return false
  return result.fingerprint !== fingerprint
}

/**
 * The words the studio shows.
 *
 * A page count with no unit is ambiguous the moment a `.docx` button sits next
 * to it, so the label says which document it counted. "Calculating" is a state,
 * not a number: nothing here ever returns a guess to fill the gap.
 */
export function paginationLabel(result) {
  const status = result?.status ?? PAGINATION_STATES.IDLE
  if (status === PAGINATION_STATES.MEASURING) return 'Calculating pages…'
  if (status === PAGINATION_STATES.STALE) return 'Calculating pages…'
  if (status === PAGINATION_STATES.FAILED) return 'Page count unavailable'
  if (status !== PAGINATION_STATES.READY) return 'Calculating pages…'
  const n = result.pageCount || 0
  return `${n} Print/PDF page${n === 1 ? '' : 's'}`
}
