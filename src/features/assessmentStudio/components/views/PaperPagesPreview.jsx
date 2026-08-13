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
 * ## Zoom is also a gesture, and the preview can leave the panel
 *
 * On a phone the preset buttons are the wrong instrument: teachers zoom a
 * document with two fingers, the way they zoom everything else on the device.
 * A two-finger pinch (or Ctrl+wheel — a trackpad pinch arrives as one) scales
 * the sheet continuously around the point between the fingers, and the scroll
 * container pans in both axes while zoomed. The maths lives in
 * `paperPreviewGestures.js` where a plain-node test holds it still.
 *
 * The full-screen mode exists for the same screen: inside the studio panel an
 * A4 sheet on a phone is a stamp. Full screen portals the preview over the
 * whole viewport (a portal, because an ancestor with a CSS transform would
 * quietly re-anchor `position: fixed` to itself), drops the desk's padding so
 * the sheet takes the width, and Escape or the close button returns.
 *
 * ## While the measurement is out of date
 *
 * The plan says so, and the preview shows ONE continuous sheet with a "counting
 * pages" note rather than page boxes whose boundaries nobody has verified. Page
 * boxes drawn from a stale measurement are the failure this whole component
 * exists to prevent, one step removed.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PaperBlock } from '../../../../components/teacher/views/PaperBlocks'
import { buildPagePlan, pageLabel } from '../../lib/paperPagePlan'
import {
  ZOOM_PRESETS, DEFAULT_ZOOM, normalizeZoom, resolveZoomScale,
} from '../../lib/paperPreviewZoom'
import {
  touchDistance, touchMidpoint, pinchNextScale, focalPointScroll, wheelZoomScale,
} from '../../lib/paperPreviewGestures'
import { DEFAULT_PAPER_LAYOUT } from '../../../../config/paperLayoutTokens'
import Icon from '../studioIcons'
import '../../styles/paperPages.css'

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
  // A pinch or Ctrl+wheel produces a continuous scale no preset names. While it
  // is set it overrides the preset; choosing a preset clears it.
  const [pinchScale, setPinchScale] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [containerBox, setContainerBox] = useState({ width: 0, height: 0 })
  const scrollRef = useRef(null)

  const tokens = layout || DEFAULT_PAPER_LAYOUT
  const plan = useMemo(() => buildPagePlan(pagination, blocks.length), [pagination, blocks.length])

  // The container's size, watched rather than read once: "fit width" is a
  // relationship to a box that changes when the studio panel resizes, a phone
  // rotates, or a slide-over opens beside it. Re-attached on the fullscreen
  // flip because the portal remounts the DOM node the observer was watching.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      setContainerBox({ width: el.clientWidth, height: el.clientHeight })
    })
    observer.observe(el)
    setContainerBox({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [fullscreen])

  const presetScale = resolveZoomScale(zoom, {
    containerWidth: containerBox.width,
    containerHeight: containerBox.height,
    pageWidth: tokens.page.widthPx,
    pageHeight: tokens.page.heightPx,
    // Full screen exists so the sheet takes the whole width — "fit width" there
    // means the sheet, not the sheet plus a desk gutter.
    gutter: fullscreen ? 0 : undefined,
  })
  const scale = pinchScale ?? presetScale

  // The gesture handlers are native listeners reading a ref, not React state:
  // they must call preventDefault (React's synthetic touch/wheel listeners are
  // passive) and they fire between renders.
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  // Scroll offsets a gesture asked for, applied AFTER the new scale has
  // rendered — setting them before the transform updates anchors the focal
  // point against the old geometry.
  const pendingScrollRef = useRef(null)

  useLayoutEffect(() => {
    const el = scrollRef.current
    const target = pendingScrollRef.current
    if (!el || !target) return
    pendingScrollRef.current = null
    el.scrollLeft = target.left
    el.scrollTop = target.top
  }, [scale])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined

    const pinch = { active: false, startDistance: 0, startScale: 1 }

    const applyGestureScale = (nextScale, clientX, clientY) => {
      const prevScale = scaleRef.current
      if (nextScale === prevScale) return
      const rect = el.getBoundingClientRect()
      pendingScrollRef.current = focalPointScroll({
        scroll: { left: el.scrollLeft, top: el.scrollTop },
        focal: { x: clientX - rect.left, y: clientY - rect.top },
        prevScale,
        nextScale,
      })
      setPinchScale(nextScale)
    }

    const onTouchStart = (event) => {
      if (event.touches.length === 2) {
        pinch.active = true
        pinch.startDistance = touchDistance(event.touches[0], event.touches[1])
        pinch.startScale = scaleRef.current
      } else {
        pinch.active = false
      }
    }
    const onTouchMove = (event) => {
      if (!pinch.active || event.touches.length !== 2) return
      // Ours, not the browser's: without this the page (or the WebView) zooms
      // the whole studio and the preview appears frozen under it.
      event.preventDefault()
      const next = pinchNextScale({
        startScale: pinch.startScale,
        startDistance: pinch.startDistance,
        distance: touchDistance(event.touches[0], event.touches[1]),
      })
      const mid = touchMidpoint(event.touches[0], event.touches[1])
      applyGestureScale(next, mid.x, mid.y)
    }
    const onTouchEnd = (event) => {
      if (event.touches.length < 2) pinch.active = false
    }
    // A trackpad pinch reaches the browser as Ctrl+wheel; a mouse user gets the
    // same affordance for free.
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const next = wheelZoomScale({ scale: scaleRef.current, deltaY: event.deltaY })
      applyGestureScale(next, event.clientX, event.clientY)
    }
    // Safari's proprietary gesture events zoom the page itself; cancelling them
    // leaves the pinch to the touch handlers above.
    const preventGesture = (event) => event.preventDefault()

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', preventGesture)
    el.addEventListener('gesturechange', preventGesture)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', preventGesture)
      el.removeEventListener('gesturechange', preventGesture)
    }
  }, [fullscreen])

  // Keyboard zoom, because a teacher checking a page boundary reaches for it and
  // the browser's own zoom would rescale the whole studio instead of the sheet.
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key === '=' || event.key === '+') { setZoom('125'); setPinchScale(null); event.preventDefault() }
      else if (event.key === '-') { setZoom('75'); setPinchScale(null); event.preventDefault() }
      else if (event.key === '0') { setZoom('fit-width'); setPinchScale(null); event.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Full screen owns the viewport while it is up: Escape leaves, and the page
  // behind must not scroll under the overlay.
  useEffect(() => {
    if (!fullscreen || typeof document === 'undefined') return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreen])

  const toggleFullscreen = () => {
    setFullscreen((on) => !on)
    // Entering: the point is the sheet at the screen's width. Leaving: the
    // panel is a different box, so a pinched scale for the old one is stale.
    setZoom('fit-width')
    setPinchScale(null)
  }

  const numbering = pageNumbering || { show: true, label: (p, t) => `Page ${p} of ${t}` }
  const activePreset = pinchScale == null ? normalizeZoom(zoom) : null

  const preview = (
    <div className={`pp-preview ${fullscreen ? 'pp-fullscreen' : ''} ${className}`.trim()}>
      <div className="pp-toolbar" role="toolbar" aria-label="Preview zoom">
        <span className="pp-pagecount">
          {plan.measured
            ? `${plan.pageCount} page${plan.pageCount === 1 ? '' : 's'} · ${tokens.page.label} · ${tokens.orientation === 'landscape' ? 'Landscape' : 'Portrait'}`
            : `${tokens.page.label} · ${tokens.orientation === 'landscape' ? 'Landscape' : 'Portrait'} · counting pages…`}
          {pinchScale != null && ` · ${Math.round(scale * 100)}%`}
        </span>
        <div className="pp-zoom">
          {ZOOM_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`pp-zoom-btn ${activePreset === preset.id ? 'active' : ''}`}
              aria-pressed={activePreset === preset.id}
              onClick={() => { setZoom(preset.id); setPinchScale(null) }}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className="pp-zoom-btn pp-fs-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
          >
            <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} size={14} />
          </button>
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

  return fullscreen && typeof document !== 'undefined'
    ? createPortal(preview, document.body)
    : preview
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
    // Top LEFT, so the scaled sheet exactly fills the sizer's footprint. With
    // `top center` the sheet slid sideways inside its layout box as the scale
    // moved away from 1 — and once it spilled LEFT of the scroll content's
    // origin the overhang was unreachable: browsers only grow scrollable range
    // to the right and bottom. That was the "zoomed in but can't pan to the
    // left edge" defect on phones.
    transformOrigin: 'top left',
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
