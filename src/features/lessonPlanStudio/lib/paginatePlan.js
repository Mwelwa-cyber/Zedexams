/**
 * paginatePlan — the DOM half of the paginated A4 preview (§3.3).
 *
 * Browsers do not report where their own layout engine fragmented a document,
 * so the only way to show a teacher the real page count is to lay the plan out
 * on real A4 sheets ourselves and count them. This is that layout pass: append
 * blocks to a fixed-height page container, and when one no longer fits, start a
 * new sheet.
 *
 * Two rules make the result honest rather than decorative:
 *
 *   - **The progression table splits BY ROW**, re-emitting its header row at the
 *     top of each continuation sheet. Treating the table as one atomic block is
 *     what produced the half-blank pages the compactness work is removing.
 *   - **No vertical filler is ever inserted.** A sheet break happens only when
 *     the next block genuinely does not fit, so any remaining gap is at most one
 *     row tall — and it is visible to the teacher, where Fit to page can act on
 *     it.
 *
 * The container must be laid out and visible (not `display: none`): a
 * display:none subtree has no layout, every height reads zero, and that
 * paginates to one page and looks like a working answer.
 */

import { A4_HEIGHT_MM, A4_WIDTH_MM } from './lessonPlanPagination.js'

/**
 * Lay a rendered plan out onto A4 sheets.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container   emptied and filled with `.lp-sheet` elements
 * @param {string} opts.html             renderPlanHtml output
 * @param {number} opts.marginMm         page margin
 * @param {string} [opts.cssVars]        inline custom properties for the typography
 * @param {boolean} [opts.safeArea]      draw the dashed printable boundary
 * @param {string} [opts.safeAreaLevel]  'amber' | 'red'
 * @param {Document} [opts.doc]          injection point for tests
 * @returns {number} the number of sheets produced
 */
export function paginatePlan({
  container,
  html,
  marginMm,
  cssVars = '',
  safeArea = false,
  safeAreaLevel = 'amber',
  doc = typeof document !== 'undefined' ? document : null,
}) {
  if (!container || !doc) return 0

  // Parse the plan once, off-document, so the source nodes are never themselves
  // laid out — only the clones placed on a sheet are.
  const source = doc.createElement('div')
  source.innerHTML = html || ''
  if (!source.firstElementChild) {
    container.innerHTML = ''
    return 0
  }
  // renderPlanHtml wraps the document in a single `.plan-official` element, and
  // its children are the blocks to flow. Anything else — a bare fragment, a
  // legacy saved plan, a test stub — is flowed as-is. Assuming the wrapper is
  // always there silently paginated a wrapper-less plan to an empty page.
  const wrapper = source.firstElementChild
  const root = source.childElementCount === 1 && wrapper.classList.contains('plan-official')
    ? wrapper
    : source

  container.innerHTML = ''
  container.classList.add('lp-sheets')

  let sheet = null
  let content = null

  function newSheet() {
    sheet = doc.createElement('div')
    sheet.className = `lp-sheet${safeArea && safeAreaLevel === 'red' ? ' lp-safe-red' : ''}`
    sheet.style.padding = `${marginMm}mm`
    // Every sheet carries the document's own classes and custom properties, so
    // a block measures on the sheet exactly as it will print.
    content = doc.createElement('div')
    content.className = `lp-sheet-content ${root.className}`
    if (cssVars) content.setAttribute('style', cssVars)
    sheet.appendChild(content)
    if (safeArea) {
      const overlay = doc.createElement('div')
      overlay.className = 'lp-safe'
      sheet.appendChild(overlay)
    }
    container.appendChild(sheet)
  }

  const fits = () => content.scrollHeight <= content.clientHeight + 1

  function placeBlock(node) {
    content.appendChild(node)
    if (fits()) return
    content.removeChild(node)
    // An empty sheet that still cannot hold the block means the block is taller
    // than a page on its own — keep it rather than looping forever.
    if (content.childElementCount === 0) {
      content.appendChild(node)
      return
    }
    newSheet()
    content.appendChild(node)
  }

  function placeTable(srcTable) {
    const colgroup = srcTable.querySelector('colgroup')
    const thead = srcTable.querySelector('thead')
    const rows = [...srcTable.querySelectorAll('tbody tr')]

    const startTable = () => {
      const t = doc.createElement('table')
      t.className = srcTable.className
      if (srcTable.getAttribute('style')) t.setAttribute('style', srcTable.getAttribute('style'))
      if (srcTable.hasAttribute('border')) t.setAttribute('border', srcTable.getAttribute('border'))
      if (colgroup) t.appendChild(colgroup.cloneNode(true))
      // The header row is re-emitted at the top of every continuation sheet —
      // this is the preview's counterpart to docx's `tableHeader: true`.
      if (thead) t.appendChild(thead.cloneNode(true))
      t.appendChild(doc.createElement('tbody'))
      content.appendChild(t)
      if (!fits() && content.childElementCount > 1) {
        content.removeChild(t)
        newSheet()
        content.appendChild(t)
      }
      return t
    }

    let table = startTable()
    for (const row of rows) {
      table.tBodies[0].appendChild(row.cloneNode(true))
      if (fits()) continue
      table.tBodies[0].lastElementChild.remove()
      // A row taller than a whole empty sheet has to stay where it is; the
      // alternative is an infinite loop of empty pages.
      if (table.tBodies[0].childElementCount === 0 && content.childElementCount === 1) {
        table.tBodies[0].appendChild(row.cloneNode(true))
        continue
      }
      newSheet()
      table = startTable()
      table.tBodies[0].appendChild(row.cloneNode(true))
    }
  }

  newSheet()
  for (const child of [...root.children]) {
    if (child.tagName === 'TABLE' && child.classList.contains('lp-table')) {
      placeTable(child)
    } else {
      placeBlock(child.cloneNode(true))
    }
  }

  const sheets = [...container.children]
  sheets.forEach((pg, i) => {
    const footer = doc.createElement('div')
    footer.className = 'lp-pgnum'
    footer.textContent = `Page ${i + 1} of ${sheets.length}`
    pg.appendChild(footer)
  })
  return sheets.length
}

/**
 * Lay a plan out off-screen and return only the page count.
 *
 * Used by Fit to page, which has to ask "how many pages would THIS format
 * produce?" for candidate formats the teacher never sees.
 *
 * The measuring container is `visibility: hidden` and positioned off-screen —
 * **never `display: none`**. A display:none subtree has no layout, every height
 * reads zero, and that paginates to one page and looks like a working answer.
 *
 * @param {object} opts  same shape as paginatePlan, minus `container`
 * @returns {number} pages, or 0 when there is nothing to measure
 */
export function measurePlanPages({ html, marginMm, cssVars = '', doc = typeof document !== 'undefined' ? document : null }) {
  if (!doc || !doc.body || !html) return 0
  const probe = doc.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none'
  probe.style.width = `${A4_WIDTH_MM}mm`
  doc.body.appendChild(probe)
  try {
    return paginatePlan({ container: probe, html, marginMm, cssVars, doc })
  } finally {
    probe.remove()
  }
}

/**
 * Scale the sheet stack down to the available width, and report the height it
 * now occupies so the caller can size its scroll container.
 *
 * Scaling rather than reflowing is the point: a sheet that reflowed to fit a
 * phone would no longer be the sheet that prints, and the page count would be a
 * count of something else.
 *
 * @param {HTMLElement} container
 * @param {number} availableWidthPx
 * @returns {{ scale: number, heightPx: number }}
 */
export function scaleSheets(container, availableWidthPx) {
  if (!container) return { scale: 1, heightPx: 0 }
  const pxPerMm = 96 / 25.4
  const sheetWidth = A4_WIDTH_MM * pxPerMm
  const scale = Math.min(1, Math.max(0.2, availableWidthPx / sheetWidth))
  container.style.transform = `scale(${scale})`
  const count = container.childElementCount
  // 20px is the inter-sheet margin in the sheet stylesheet.
  const stackHeight = count * (A4_HEIGHT_MM * pxPerMm + 20)
  container.style.marginLeft = scale < 1 ? `${Math.max(0, (availableWidthPx - sheetWidth * scale) / 2)}px` : 'auto'
  return { scale, heightPx: stackHeight * scale }
}
