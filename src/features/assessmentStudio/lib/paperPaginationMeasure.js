/**
 * Measure a paper the way the print window will render it.
 *
 * Browser-only. The arithmetic that turns these measurements into pages is in
 * `paperPaginationCore.js`, which is pure and tested without a DOM; this file is
 * only the part that needs one.
 *
 * ## The whole point is that nothing here is a second renderer
 *
 * The HTML comes from `buildPrintableHtml` — the same function the print window
 * is handed — carrying the same stylesheet, the same `@page` rule and the same
 * flattened maths. Measuring anything else would measure a document nobody
 * prints. So the iframe is sized to the A4 CONTENT box and the document renders
 * into it at the width it will occupy on the sheet, and every height read back
 * is the height that sheet will have.
 *
 * Two consequences worth stating, because they are what makes the number
 * trustworthy rather than merely plausible:
 *
 *   - the iframe is `visibility: hidden` and off-screen, NOT `display: none`.
 *     A display:none subtree has no layout at all and every height comes back
 *     zero — which paginates to one page and looks like a working answer.
 *   - fonts must be ready before anything is read. A measurement taken while
 *     the serif face is still loading is taken against a fallback with
 *     different metrics, and it is wrong by a line here and there — the kind of
 *     wrong that shifts a page boundary without ever looking broken.
 */

import { buildPrintableHtml } from '../../../utils/assessmentToPdf.js'
import { pageContentBoxPx, paginateBlocks, PAGINATION_STATES, PAGINATION_ISSUES, emptyPagination } from '../../../utils/paperPaginationCore.js'
import { assertMeasurable, renderableAssessment } from './printableModel.js'

/** How long to wait for the iframe document and its fonts before giving up. */
const MEASURE_TIMEOUT_MS = 8000

export function canMeasure() {
  return typeof document !== 'undefined' && typeof window !== 'undefined'
}

/**
 * The selector for every element that occupies flow height on the sheet.
 * Kept beside the renderer's own class names; a block the renderer emits that
 * is not listed here is invisible to the measurement, which `paginateBlocks`
 * would then quietly under-count. `assertBlocksCoverDocument` is the guard.
 */
const BLOCK_SELECTOR = [
  '.paper-sheet > tbody > tr > td > *',
].join(', ')

/** Read the question a block belongs to out of the markup the renderer emits. */
function ownerQuestionOf(el) {
  const owner = el.closest?.('[data-question-id]') || el.querySelector?.('[data-question-id]')
  return owner?.getAttribute?.('data-question-id') ?? el.getAttribute?.('data-question-id') ?? null
}

function questionLabelOf(el) {
  const owner = el.closest?.('[data-question-number]') || el.querySelector?.('[data-question-number]')
  const raw = owner?.getAttribute?.('data-question-number') ?? el.getAttribute?.('data-question-number')
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Turn a rendered document into the measured blocks the core flows into pages.
 *
 * `getBoundingClientRect` rather than `offsetHeight`: it is fractional, and a
 * paper of forty blocks each rounded down by half a pixel loses most of a line
 * by the bottom of the sheet.
 */
export function measureBlocks(doc) {
  const container = doc.querySelector('.paper-sheet > tbody > tr > td')
  const els = Array.from(doc.querySelectorAll(BLOCK_SELECTOR))
  if (!container || els.length === 0) return []
  const view = doc.defaultView
  const containerBottom = container.getBoundingClientRect().bottom

  // Heights are the DISTANCE TO THE NEXT BLOCK, not the block's own box plus
  // its margins. Adjacent vertical margins COLLAPSE — a 12px bottom margin
  // against a 12px top margin occupies 12px, not 24 — so summing both sides
  // over-counts every gap on the paper. On a 12-question paper of ruled essay
  // answers that came to a whole extra sheet: measured 6 where Chromium
  // printed 5. Reading positions instead makes collapsing something the
  // browser has already done for us rather than something to model.
  const tops = els.map((el) => el.getBoundingClientRect().top)

  return els.map((el, index) => {
    const rect = el.getBoundingClientRect()
    const style = view.getComputedStyle(el)
    const nextTop = index + 1 < els.length ? tops[index + 1] : containerBottom
    const heightPx = Math.max(0, nextTop - tops[index])
    const isPageBreak = el.classList.contains('pagebreak') || el.classList.contains('page-break')
    // The block's position in the paper's body, stamped by the renderer. This is
    // what lets the studio's paginated preview draw the pages this measurement
    // found rather than inventing its own boundaries (§1).
    const rawIndex = el.getAttribute('data-block-index')
    const blockIndex = rawIndex == null ? null : Number(rawIndex)
    return {
      id: el.id || `block-${index}`,
      blockIndex: Number.isInteger(blockIndex) ? blockIndex : null,
      kind: el.getAttribute('data-block-kind') || el.className || 'block',
      heightPx,
      widthPx: rect.width,
      breakBefore: style.breakBefore === 'page' || style.pageBreakBefore === 'always',
      // `.pagebreak` is a zero-height element carrying `page-break-after`, so the
      // break belongs to whatever comes NEXT. Reading only break-before missed
      // every teacher-inserted page break: the element was invisible to the flow
      // and the count came out a page short.
      breakAfter: style.breakAfter === 'page' || style.pageBreakAfter === 'always' || isPageBreak,
      avoidBreakInside: style.breakInside === 'avoid' || style.pageBreakInside === 'avoid',
      // Keep-with-next (§7). A section heading declares `break-after: avoid`,
      // which the printer honours by moving the heading down with the question
      // that follows it. Reading only break-inside meant the paginator flowed
      // the two independently and reported a layout the printer never produces
      // — on exactly the papers the rule exists for.
      avoidBreakAfter: style.breakAfter === 'avoid' || style.pageBreakAfter === 'avoid',
      ownerQuestionId: ownerQuestionOf(el),
      questionLabel: questionLabelOf(el),
      isFigure: Boolean(el.querySelector?.('.q-diagram, svg, img')) && !el.querySelector?.('.q-text'),
      // A figure element that produced no drawing at all: the renderer was
      // asked for something and returned nothing.
      rendered: !(el.classList.contains('figure-missing')
        || Boolean(el.querySelector?.('.figure-missing'))),
      clipped: style.overflow === 'hidden' && el.scrollHeight > Math.ceil(rect.height) + 1,
      // A zero-height element is normally noise, but a page break is zero-height
      // BY DESIGN and dropping it loses the break entirely.
      structural: isPageBreak,
    }
  }).filter((b) => b.heightPx > 0 || b.rendered === false || b.structural)
}

/**
 * Wait for one image to reach its final size, or to fail.
 *
 * Returns whether it drew. A failed image still has to be waited for — an
 * un-awaited broken image resolves to a zero-height box AFTER the measurement
 * and moves every page boundary below it.
 */
async function settleImage(img) {
  if (img.complete) return img.naturalWidth > 0
  try {
    if (typeof img.decode === 'function') {
      await img.decode()
      return img.naturalWidth > 0
    }
  } catch {
    return false
  }
  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(img.naturalWidth > 0), { once: true })
    img.addEventListener('error', () => resolve(false), { once: true })
  })
}

/**
 * Wait for the iframe's document, its fonts, its IMAGES, and one layout pass.
 *
 * Images are the half that was missing and they are the half that moves pages.
 * A photograph, an uploaded diagram or a school logo occupies zero height until
 * it decodes; measure before that and every block below it is measured at the
 * wrong offset, and the page count is confidently wrong. Fonts matter for the
 * same reason at a smaller scale — a fallback face is wrong by a line here and
 * there, which is exactly enough to move a break.
 *
 * Returns the document plus the images that never drew, so a paper with a
 * broken figure reports it instead of returning a page count derived from a
 * hole in the layout.
 */
function whenReady(frame, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pagination measurement timed out')), timeoutMs)
    const done = async () => {
      try {
        const doc = frame.contentDocument
        if (!doc) throw new Error('no measurement document')
        if (doc.fonts?.ready) await doc.fonts.ready
        const images = Array.from(doc.images || [])
        const drew = await Promise.all(images.map(settleImage))
        const brokenImages = images.filter((_, i) => !drew[i])
        // One frame after everything has settled, so the layout the heights are
        // read from is the final one rather than the one mid-reflow.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        clearTimeout(timer)
        resolve({ doc, brokenImages })
      } catch (err) {
        clearTimeout(timer)
        reject(err)
      }
    }
    frame.addEventListener('load', done, { once: true })
  })
}

/**
 * Measure a paper and return where its pages fall.
 *
 * Takes the CANONICAL PRINTABLE MODEL — the same object the fingerprint
 * identifies — rather than loose arguments. Passing the pieces separately is how
 * the passages, parts and pagebreaks came to be fingerprinted but not rendered.
 *
 * @param {object} model  buildPrintableModel(...) output
 * @param {object} opts   {timeoutMs}
 * @returns {Promise<{status, pageCount, pages, issues}>}
 */
export async function measurePagination(model, opts = {}) {
  assertMeasurable(model)
  const questions = model.questions
  const assessment = renderableAssessment(model)
  if (!canMeasure()) {
    // Not an error: a server-rendered or test environment simply has no page
    // count to give, and saying so is better than returning 1.
    return emptyPagination(PAGINATION_STATES.FAILED, {
      issues: [{ code: 'no-dom', message: 'Page count needs a browser to measure.' }],
    })
  }
  const box = pageContentBoxPx()
  const frame = document.createElement('iframe')
  // Off-screen and INVISIBLE, never display:none — a display:none subtree has
  // no layout, every height reads zero, and the result is a confident "1 page".
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.style.cssText = [
    'position:absolute', 'left:-10000px', 'top:0', 'visibility:hidden',
    `width:${box.width}px`, `height:${box.height}px`, 'border:0',
  ].join(';')

  try {
    document.body.appendChild(frame)
    const html = buildPrintableHtml(assessment, questions || [], model.mode, {
      attribution: Boolean(model.attribution),
    })
    const ready = whenReady(frame, opts.timeoutMs || MEASURE_TIMEOUT_MS)
    frame.srcdoc = html
    const { doc, brokenImages } = await ready
    const blocks = measureBlocks(doc)
    const result = paginateBlocks(blocks, box)
    // An image the paper asked for and did not get is a hole in the layout, and
    // a page count measured around a hole is a confident wrong answer. Reported
    // as a layout issue so the Print/PDF gate refuses it, in the same shape as
    // every other pagination issue.
    const imageIssues = brokenImages.map((img) => ({
      code: PAGINATION_ISSUES.MISSING_BLOCK,
      message: 'An image on this paper did not load, so the page layout could not be checked. '
        + 'Replace or re-upload it before printing.',
      src: img.getAttribute?.('src') || '',
    }))
    return {
      ...result,
      issues: [...result.issues, ...imageIssues],
      measuredBlocks: blocks.length,
    }
  } catch (err) {
    // A measurement that failed says so. Falling back to the old arithmetic
    // here would put a guess on screen wearing the new label, which is the one
    // outcome worse than no number.
    return emptyPagination(PAGINATION_STATES.FAILED, {
      issues: [{ code: 'measure-failed', message: err?.message || 'Could not measure the pages.' }],
    })
  } finally {
    frame.remove()
  }
}
