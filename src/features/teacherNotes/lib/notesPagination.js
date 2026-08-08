/**
 * Where the learner's notes break across sheets (§6).
 *
 * The preview draws real pages, and it draws the pages the printer will make —
 * not pages of a nominal height with content poured in until it looks about
 * right. That only works if the boundaries come from a MEASUREMENT of the same
 * blocks, in the same stylesheet, at the same width the sheet gives them, which
 * is what this module takes.
 *
 * Two things are borrowed rather than rebuilt, deliberately:
 *
 *   - the FLOW is `paperPaginationCore.paginateBlocks`, the paginator the
 *     assessment papers already use. It knows what a keep-together group is and
 *     what `break-inside: avoid` means to a printer. A second paginator would
 *     be a second set of answers to the same question.
 *   - the MEASUREMENT technique is `paperPaginationMeasure`'s: an off-screen
 *     iframe sized to the page's content box, `visibility: hidden` and never
 *     `display: none` (a display:none subtree has no layout, every height reads
 *     zero, and that paginates to one page and looks like a working answer),
 *     with fonts awaited before anything is read.
 *
 * What is NOT borrowed is the geometry: an A5 sheet is not an A4 sheet, and the
 * assessment geometry is A4 with a running footer reserved. The box comes from
 * the paper the teacher chose.
 */

import { mmToPx, paginateBlocks, PAGINATION_STATES, emptyPagination } from '../../../utils/paperPaginationCore.js'
import { buildLearnerNotesBlocks, learnerNotesCss, paperSize } from '../../../utils/learnerNotesPrintable.js'

/** How long to wait for the iframe document and its fonts before giving up. */
const MEASURE_TIMEOUT_MS = 6000

export function canMeasure() {
  return typeof document !== 'undefined' && typeof window !== 'undefined'
}

/** The box body content may occupy on one sheet of the chosen paper. */
export function notesContentBox(paper) {
  const size = paperSize(paper)
  return {
    width: mmToPx(size.widthMm - size.marginMm * 2),
    height: mmToPx(size.heightMm - size.marginMm * 2),
    // No running footer on a handout, so nothing is reserved at the bottom.
    // Passing the assessment's reservation would lose 18mm of every sheet.
    footerBandTop: mmToPx(size.heightMm - size.marginMm * 2),
    reservedBottom: 0,
    footerReserve: 0,
    marginBottom: mmToPx(size.marginMm),
  }
}

/**
 * A fingerprint of everything that can move a page boundary.
 *
 * The whole document, not a summary of its lengths: "IIII" and "WWWW" are the
 * same length and half a line apart, and a count-based fingerprint would call a
 * re-measured document fresh when it is not.
 */
export function notesFingerprint(notes, paper) {
  if (!notes) return 'empty'
  const source = JSON.stringify([
    paperSize(paper).id,
    notes.header, notes.learningOutcomes, notes.sections, notes.workedExamples,
    notes.dontMixThese, notes.learnerQuestions, notes.rememberBox, notes.exercise,
    notes.diagrams, notes.format,
  ])
  // djb2 — enough to notice a changed character, cheap enough to run on every
  // keystroke's debounce.
  let hash = 5381
  for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0
  return `${source.length}:${(hash >>> 0).toString(36)}`
}

function frameHtml(blocks, paper) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${learnerNotesCss({ paper })}
    body{margin:0}
    .ln-measure > *{display:block}
  </style></head><body><div class="ln-measure">
    ${blocks.map((b, i) => `<div data-block-index="${i}">${b.html}</div>`).join('')}
  </div></body></html>`
}

/** Wait for the frame's document and web fonts, or give up rather than hang. */
function ready(frame) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), MEASURE_TIMEOUT_MS)
    const done = () => {
      const doc = frame.contentDocument
      const fonts = doc && doc.fonts
      // A measurement taken while the serif face is still loading is taken
      // against fallback metrics, and it is wrong by a line here and there —
      // the kind of wrong that moves a page boundary without looking broken.
      const settle = fonts && fonts.ready ? fonts.ready : Promise.resolve()
      settle.then(() => {
        clearTimeout(timer)
        resolve(true)
      }).catch(() => {
        clearTimeout(timer)
        resolve(true)
      })
    }
    frame.addEventListener('load', done, { once: true })
  })
}

/**
 * Measure and flow. Browser only.
 *
 * Returns the same shape in every state, so a caller never has to check whether
 * `pages` exists. A measurement that could not be taken comes back FAILED, not
 * as a one-page answer — a page count nobody measured is indistinguishable on
 * screen from one that was.
 */
export async function measureNotesPages(notes, paper = 'a4') {
  if (!canMeasure()) return emptyPagination(PAGINATION_STATES.FAILED)
  const blocks = buildLearnerNotesBlocks(notes)
  if (blocks.length === 0) return { ...emptyPagination(PAGINATION_STATES.READY), blocks }

  const box = notesContentBox(paper)
  const frame = document.createElement('iframe')
  // Off-screen and INVISIBLE, never display:none — see the docblock.
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;`
    + `width:${box.width}px;height:${Math.ceil(box.height)}px;border:0`
  frame.srcdoc = frameHtml(blocks, paperSize(paper).id)
  document.body.appendChild(frame)

  try {
    const loaded = await ready(frame)
    const doc = frame.contentDocument
    // Every failure path carries the blocks back, so the preview can still show
    // the document as one continuous sheet. A failed measurement means we do
    // not know where the pages break — not that there is nothing to read.
    if (!loaded || !doc) return { ...emptyPagination(PAGINATION_STATES.FAILED), blocks }

    const els = Array.from(doc.querySelectorAll('.ln-measure > [data-block-index]'))
    if (els.length !== blocks.length) {
      return { ...emptyPagination(PAGINATION_STATES.FAILED), blocks }
    }

    const view = doc.defaultView
    const measured = els.map((el, index) => {
      const rect = el.getBoundingClientRect()
      // The block's own child carries the print rules; the wrapper is a plain
      // div, so the computed style has to be read one level down.
      const inner = el.firstElementChild || el
      const style = view.getComputedStyle(inner)
      return {
        id: blocks[index].id,
        blockIndex: index,
        kind: blocks[index].kind,
        heightPx: Math.max(0, rect.height),
        widthPx: rect.width,
        breakBefore: false,
        breakAfter: false,
        avoidBreakInside: style.breakInside === 'avoid' || style.pageBreakInside === 'avoid',
        avoidBreakAfter: blocks[index].keepWithNext
          || style.breakAfter === 'avoid' || style.pageBreakAfter === 'avoid',
        rendered: true,
      }
    })

    // A document whose every block measured zero was never laid out — a
    // detached frame, a `display:none` ancestor, an environment with no layout
    // engine at all. Flowing those heights produces a confident "1 page", which
    // is the exact shape of a working answer and the reason this check exists
    // rather than being left to look after itself.
    if (measured.every((b) => b.heightPx === 0)) {
      return { ...emptyPagination(PAGINATION_STATES.FAILED), blocks }
    }

    const flow = paginateBlocks(measured, box)
    return { ...flow, blocks, measured, paper: paperSize(paper).id }
  } catch (err) {
    console.error('[notesPagination] measurement failed', err)
    return { ...emptyPagination(PAGINATION_STATES.FAILED), blocks }
  } finally {
    frame.remove()
  }
}

/** "Page 1 of 2 · A4 portrait" — the indicator the preview prints per sheet. */
export function notesPageLabel(pageNumber, pageCount, paper) {
  const size = paperSize(paper)
  return `Page ${pageNumber} of ${pageCount} · ${size.label} portrait`
}
