import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { paginatePlan, scaleSheets } from '../lib/paginatePlan'
import { formatCssVariableString } from '../../../utils/lessonPlanPrintCss'
import { useLessonPlanDocumentCss } from '../hooks/useLessonPlanDocumentCss'
import { safeAreaOverlay } from '../lib/lessonPlanPagination'
import { resolveLessonFormat } from '../../../utils/lessonPlanFormat'

/**
 * PaginatedPlanPreview — the lesson plan on real A4 sheets (§3.3).
 *
 * The old preview was one continuous column, so a teacher could not see what
 * came out of the printer. These are actual 210 × 297 mm sheets at the chosen
 * margins, filled by the same block paginator the print window's layout obeys,
 * with a "Page N of M" footer on each and the dashed printable boundary drawn
 * when the margins are close to the edge.
 *
 * It reports the measured page count upward through `onPageCount`. The count is
 * measured or it is absent — the component emits `null` while it has nothing
 * laid out, and never an estimate.
 *
 * Props:
 *   html          renderPlanHtml output
 *   format        resolved lesson format (margins + typography)
 *   onPageCount   (pages: number | null) => void
 */
export default function PaginatedPlanPreview({ html, format, onPageCount }) {
  const fmt = resolveLessonFormat(format)
  const outerRef = useRef(null)
  const sheetsRef = useRef(null)
  const [outerHeight, setOuterHeight] = useState('auto')
  const onPageCountRef = useRef(onPageCount)
  onPageCountRef.current = onPageCount

  useLessonPlanDocumentCss(fmt)

  const overlay = safeAreaOverlay(fmt)
  const cssVars = formatCssVariableString(fmt)

  const relayout = useCallback(() => {
    const container = sheetsRef.current
    const outer = outerRef.current
    if (!container || !outer) return
    const pages = paginatePlan({
      container,
      html,
      marginMm: fmt.marginMm,
      cssVars,
      safeArea: overlay.show,
      safeAreaLevel: overlay.level,
    })
    const { heightPx } = scaleSheets(container, outer.clientWidth - 8)
    setOuterHeight(heightPx ? `${Math.ceil(heightPx) + 20}px` : 'auto')
    onPageCountRef.current?.(pages > 0 ? pages : null)
  }, [html, fmt.marginMm, cssVars, overlay.show, overlay.level])

  // Layout effect, not effect: the measurement must happen before the browser
  // paints, or the teacher sees one frame of an unpaginated document.
  useLayoutEffect(() => {
    relayout()
  }, [relayout])

  // Fonts change block heights, and a measurement taken against fallback
  // metrics is wrong by a line here and there — the kind of wrong that moves a
  // page boundary without ever looking broken.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts?.ready) return undefined
    let cancelled = false
    document.fonts.ready.then(() => { if (!cancelled) relayout() }).catch(() => {})
    return () => { cancelled = true }
  }, [relayout])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onResize = () => relayout()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [relayout])

  return (
    <div className="w-full">
      {overlay.show && (
        <div
          role="status"
          data-testid="margin-warning"
          className={[
            'mx-auto mb-3 max-w-[820px] rounded-xl border px-4 py-2.5 text-[13px] leading-snug',
            overlay.level === 'red'
              ? 'border-red-300 bg-red-50 text-red-800'
              : 'border-amber-300 bg-amber-50 text-amber-900',
          ].join(' ')}
        >
          {overlay.message}
        </div>
      )}
      <div ref={outerRef} className="overflow-hidden" style={{ height: outerHeight }}>
        {/* Filled imperatively by the paginator — React never owns these nodes,
            because the paginator has to measure them as it places them. */}
        <div ref={sheetsRef} className="lp-sheets" />
      </div>
    </div>
  )
}
