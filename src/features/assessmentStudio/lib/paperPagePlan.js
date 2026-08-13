/**
 * Which blocks land on which A4 sheet — the bridge between the measurement and
 * the paginated preview.
 *
 * ## Why the preview does not paginate itself
 *
 * The obvious way to build an A4 preview is to give it page-sized boxes and let
 * it fill them until they overflow. That produces a preview with its OWN
 * pagination rules, in its own stylesheet, at its own font metrics — a second
 * opinion about where the pages fall. It would be wrong in exactly the cases
 * teachers care about (a question near a boundary, a diagram at the foot of a
 * sheet) and it would be wrong CONFIDENTLY, because it looks like paper.
 *
 * So it does not paginate. The measurement already renders the real print
 * document, at the real page width, under the real print stylesheet, and reports
 * where the breaks fall. This module turns that report into "page 2 holds blocks
 * 7 through 12", and the preview draws exactly that. When the PDF has three
 * pages the preview has three pages because it is the same answer, not a
 * matching guess.
 *
 * ## Blocks the measurement did not report
 *
 * `measureBlocks` drops zero-height elements — they occupy no space and would
 * add noise. But the preview still has to draw them somewhere, and dropping them
 * would silently remove content from the preview that the PDF contains. So every
 * unreported index is placed with the block before it. Adjacency, not omission:
 * an unplaced block is a hole, and a hole in a preview is indistinguishable from
 * a paper that genuinely does not have that content.
 *
 * ## When there is no measurement
 *
 * Idle, measuring, failed, or a paper measured before the last edit — the plan
 * says so (`measured: false`) and puts everything on one continuous sheet. That
 * is the honest fallback: a single page that is clearly still being counted,
 * rather than three page-shaped boxes with boundaries nobody verified.
 */

import { PAGINATION_STATES } from '../../../utils/paperPaginationCore.js'

/**
 * Build the page plan.
 *
 * @param {object} pagination the `usePaperPagination` result
 * @param {number} blockCount how many body blocks the preview will draw
 * @returns {{measured, stale, status, pageCount, pages: Array<{pageNumber, blockIndexes}>}}
 */
export function buildPagePlan(pagination, blockCount = 0) {
  const total = Math.max(0, Math.floor(Number(blockCount) || 0))
  const status = pagination?.status ?? PAGINATION_STATES.IDLE
  const measured = status === PAGINATION_STATES.READY
    && Array.isArray(pagination?.pages)
    && pagination.pages.length > 0

  if (!measured) {
    return {
      measured: false,
      stale: status === PAGINATION_STATES.STALE,
      status,
      pageCount: total > 0 ? 1 : 0,
      pages: total > 0 ? [{ pageNumber: 1, blockIndexes: range(total), continuous: true }] : [],
    }
  }

  // Where each reported index was placed. A block reported on two pages (which
  // the flow cannot produce, but a future change could) keeps its first page:
  // drawing it twice would be worse than drawing it early.
  const pageOfIndex = new Map()
  pagination.pages.forEach((page, i) => {
    const pageNumber = page.pageNumber ?? i + 1
    for (const index of page.blockIndexes || []) {
      if (Number.isInteger(index) && index >= 0 && index < total && !pageOfIndex.has(index)) {
        pageOfIndex.set(index, pageNumber)
      }
    }
  })

  // Nothing was stamped — an older renderer, or a measurement of a document
  // built before block indices existed. One continuous sheet, honestly labelled,
  // rather than page boxes drawn from a mapping that does not exist.
  if (pageOfIndex.size === 0) {
    return {
      measured: false,
      stale: false,
      status,
      pageCount: total > 0 ? 1 : 0,
      pages: total > 0 ? [{ pageNumber: 1, blockIndexes: range(total), continuous: true }] : [],
    }
  }

  const buckets = new Map()
  const pageNumbers = pagination.pages.map((p, i) => p.pageNumber ?? i + 1)
  for (const n of pageNumbers) buckets.set(n, [])

  let lastPage = pageNumbers[0] ?? 1
  for (let index = 0; index < total; index += 1) {
    const page = pageOfIndex.get(index) ?? lastPage
    lastPage = page
    if (!buckets.has(page)) buckets.set(page, [])
    buckets.get(page).push(index)
  }

  const pages = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, blockIndexes]) => ({ pageNumber, blockIndexes, continuous: false }))

  return {
    measured: true,
    stale: false,
    status,
    // Every measured sheet is kept, including one that carries nothing: a blank
    // trailing page is a real defect the teacher should SEE in the preview
    // rather than read about in a warning.
    pageCount: pages.length,
    pages,
  }
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i)
}

/** "Page 2 of 3" — the one place the preview words a page position. */
export function pageLabel(pageNumber, pageCount, { measured = true } = {}) {
  if (!measured) return 'Continuous preview — counting pages…'
  return `Page ${pageNumber} of ${pageCount}`
}
