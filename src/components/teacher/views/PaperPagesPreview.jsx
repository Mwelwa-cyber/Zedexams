/**
 * The paginated A4 preview (§1).
 *
 * ## What changed and why it matters
 *
 * The studio's preview was one continuous white column of unlimited height. A
 * teacher could not see where a page ended, so they could not see that question
 * 13's options were about to be split by a page turn, or that the paper ended
 * with a blank sheet — the two defects that are only visible on paper, and that
 * they therefore discovered at the photocopier.
 *
 * This draws real sheets: 210 × 297 mm each (or whatever the document's layout
 * tokens say — A5, Letter, landscape), separated by a grey gutter, each labelled
 * with its position. The break between page 1 and page 2 on screen is the break
 * the printer will make, because it is the break the MEASUREMENT found in the
 * print renderer — see paperPagePlan.js. The preview does not decide where pages
 * end; it is told.
 *
 * ## Zoom does not touch pagination
 *
 * The sheet is transformed by a CSS scale and the container is sized to the
 * scaled result so the scrollbars stay honest. Nothing in the zoom path can
 * reach the page plan, which is computed from a measurement always taken at full
 * page width. A teacher zooming to 75% is looking at the same three pages.
 *
 * ## While the measurement is out of date
 *
 * The plan says so, and the preview shows ONE continuous sheet with a "counting
 * pages" note rather than page boxes whose boundaries nobody has verified. Page
 * boxes drawn from a stale measurement are the failure this whole component
 * exists to prevent, one step removed.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PaperBlock } from './PaperBlocks'
import { buildPagePlan, pageLabel } from '../../../utils/paperPagePlan'
import {
  ZOOM_PRESETS, DEFAULT_ZOOM, normalizeZoom, resolveZoomScale,
} from '../../../utils/paperPreviewZoom'
import { DEFAULT_PAPER_LAYOUT } from '../../../config/paperLayoutTokens'
import '../studio/paperPages.css'

/**
 * @param {Array}  blocks  the document's BODY blocks, in order
 * @param {object} layout  resolvePaperLayout output (page size, margins)
 * @param {object} pagination the usePaperPagination result
 * @param {object} pageNumbering the document's page-numbering decision
 */
export default function PaperPagesPreview({
  blocks = [],
  layout = DEFAULT_PAPER_LAYOUT,
  pagination = null,
  pageNumbering = null,
  footerCode = '',
  className = '',
}) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [containerBox, setContainerBox] = useState({ width: 0, height: 0 })
  const scrollRef = useRef(null)

  const tokens = layout || DEFAULT_PAPER_LAYOUT
  const plan = useMemo(() => buildPagePlan(pagination, blocks.length), [pagination, blocks.length])

  // The container's size, watched rather than read once: "fit width" is a
  // relationship to a box that changes when the studio panel resizes, a phone
  // rotates, or a slide-over opens beside it.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      setContainerBox({ width: el.clientWidth, height: el.clientHeight })
    })
    observer.observe(el)
    setContainerBox({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  const scale = resolveZoomScale(zoom, {
    containerWidth: containerBox.width,
    containerHeight: containerBox.height,
    pageWidth: tokens.page.widthPx,
    pageHeight: tokens.page.heightPx,
  })

  // Keyboard zoom, because a teacher checking a page boundary reaches for it and
  // the browser's own zoom would rescale the whole studio instead of the sheet.
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key === '=' || event.key === '+') { setZoom('125'); event.preventDefault() }
      else if (event.key === '-') { setZoom('75'); event.preventDefault() }
      else if (event.key === '0') { setZoom('fit-width'); event.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const numbering = pageNumbering || { show: true, label: (p, t) => `Page ${p} of ${t}` }

  return (
    <div className={`pp-preview ${className}`.trim()}>
      <div className="pp-toolbar" role="toolbar" aria-label="Preview zoom">
        <span className="pp-pagecount">
          {plan.measured
            ? `${plan.pageCount} page${plan.pageCount === 1 ? '' : 's'} · ${tokens.page.label} · ${tokens.orientation === 'landscape' ? 'Landscape' : 'Portrait'}`
            : `${tokens.page.label} · ${tokens.orientation === 'landscape' ? 'Landscape' : 'Portrait'} · counting pages…`}
        </span>
        <div className="pp-zoom">
          {ZOOM_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`pp-zoom-btn ${normalizeZoom(zoom) === preset.id ? 'active' : ''}`}
              aria-pressed={normalizeZoom(zoom) === preset.id}
              onClick={() => setZoom(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pp-scroll" ref={scrollRef}>
        {plan.pages.length === 0 && (
          <p className="pp-empty">This paper has no content to preview yet.</p>
        )}
        {plan.pages.map((page) => (
          <PaperPage
            key={page.pageNumber}
            page={page}
            plan={plan}
            blocks={blocks}
            tokens={tokens}
            scale={scale}
            numbering={numbering}
            footerCode={footerCode}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * One sheet.
 *
 * The sheet is sized in MILLIMETRES — the same numbers the `@page` rule uses —
 * rather than in pixels converted from them, so a browser rounding CSS pixels
 * cannot make the on-screen sheet a slightly different shape from the printed
 * one. The scale is applied with a transform, and the wrapper is given the
 * scaled height so the page gutter and the scrollbar are both correct.
 */
function PaperPage({ page, plan, blocks, tokens, scale, numbering, footerCode }) {
  const { widthMm, heightMm } = tokens.page
  const { top, right, bottom, left } = tokens.margins
  const continuous = page.continuous

  const sheetStyle = {
    width: `${widthMm}mm`,
    // A continuous sheet has no page height: its whole point is that nobody has
    // verified where it ends, so it must not LOOK like a measured page.
    ...(continuous ? { minHeight: `${heightMm}mm` } : { height: `${heightMm}mm` }),
    paddingTop: `${top}mm`,
    paddingRight: `${right}mm`,
    paddingBottom: `${bottom + tokens.content.footerReserveMm}mm`,
    paddingLeft: `${left}mm`,
    fontFamily: tokens.typography.bodyFontCss,
    fontSize: `${tokens.typography.bodySizePt}pt`,
    lineHeight: tokens.typography.lineSpacing,
    transform: `scale(${scale})`,
    transformOrigin: 'top center',
  }

  return (
    <div className="pp-page-wrap">
      <div
        className="pp-sizer"
        // The scaled footprint, so the grey gutter between sheets is a real gap
        // rather than the next sheet overlapping the transformed one.
        style={{
          width: `calc(${widthMm}mm * ${scale})`,
          height: continuous ? undefined : `calc(${heightMm}mm * ${scale})`,
        }}
      >
        <div className="pp-sheet studio-v2" style={sheetStyle} data-page={page.pageNumber}>
          <div className="pp-sheet-body sv-paper">
            {page.blockIndexes.map((index) => (
              <PaperBlock key={index} block={blocks[index]} />
            ))}
          </div>
          {/* The paper code repeats on every sheet in print because it is a
              fixed element there; the preview draws it in the reserved band so
              a teacher can see the space it occupies rather than discovering it
              in the download. */}
          {footerCode && <div className="pp-sheet-footer">{footerCode}</div>}
        </div>
      </div>
      <div className="pp-page-label">
        {continuous
          ? pageLabel(page.pageNumber, plan.pageCount, { measured: false })
          : (numbering.show ? numbering.label(page.pageNumber, plan.pageCount) : `Page ${page.pageNumber}`)}
      </div>
    </div>
  )
}

export { PaperPage }
