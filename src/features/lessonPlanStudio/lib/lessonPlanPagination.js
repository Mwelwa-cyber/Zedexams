/**
 * lessonPlanPagination — the pure half of the paginated A4 preview (§3.3) and
 * of Fit to page (§2.5).
 *
 * The preview used to be one continuous column, so a teacher could not see what
 * actually came out of the printer — including the half-blank pages and the
 * awkward gaps. The fix is to lay the plan out on real A4 sheets and count
 * them. Measuring needs a browser; deciding what to do with the measurement
 * does not, and that decision is here so it can be tested under plain `node`.
 *
 * The honesty rule this module enforces: **a page count is either measured or
 * it is absent.** There is no estimate. The predecessor of this feature printed
 * "Est. 3 pages · A4" from `ceil((questions + marks * 0.4) / 8)` on the
 * assessment side, and an arithmetic guess that looks like a measurement is
 * worse than no number at all.
 */

import {
  MARGIN_SAFE_AREA_MM,
  marginWarning,
  nextFitStep,
  resolveLessonFormat,
} from '../../../utils/lessonPlanFormat.js'

// A4 in millimetres, and the CSS reference conversion (96 dpi).
export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297
export const PX_PER_MM = 96 / 25.4

export const mmToPx = (mm) => mm * PX_PER_MM

/**
 * The content box of one sheet at a given margin — the space the paginator
 * flows blocks into.
 * @param {number} marginMm
 * @returns {{ widthPx: number, heightPx: number, widthMm: number, heightMm: number }}
 */
export function sheetContentBox(marginMm) {
  const widthMm = A4_WIDTH_MM - 2 * marginMm
  const heightMm = A4_HEIGHT_MM - 2 * marginMm
  return { widthMm, heightMm, widthPx: mmToPx(widthMm), heightPx: mmToPx(heightMm) }
}

/**
 * The page-count verdict shown next to Saved.
 *
 * `pages` is null when nothing has been measured yet — and that reads as
 * "measuring", never as a pass. A budget the app has not checked is not a
 * budget the app can promise.
 *
 * @param {number|null} pages
 * @param {object} format
 * @returns {{ level: 'measuring'|'ok'|'amber'|'red', pages: number|null, target: number|null, over: number, label: string }}
 */
export function pageCountVerdict(pages, format) {
  const fmt = resolveLessonFormat(format)
  const target = fmt.pageTarget

  if (pages == null || !Number.isFinite(pages) || pages < 1) {
    return { level: 'measuring', pages: null, target, over: 0, label: 'Measuring…' }
  }

  const label = `${pages} ${pages === 1 ? 'page' : 'pages'}`
  if (target == null || pages <= target) {
    return { level: 'ok', pages, target, over: 0, label }
  }
  const over = pages - target
  // One sheet over is a nudge — Fit to page usually recovers it. Two or more is
  // a different document from the one the teacher asked for.
  return { level: over >= 2 ? 'red' : 'amber', pages, target, over, label }
}

/**
 * How much a plan is spilling, as a fraction of its budget. §2.5's Fit to page
 * promises to recover a spill of ≤ 15% without a regeneration round-trip; this
 * is what "15%" is measured against.
 * @param {number|null} pages
 * @param {object} format
 * @returns {number} 0 when within budget or unmeasured
 */
export function spillFraction(pages, format) {
  const fmt = resolveLessonFormat(format)
  if (!fmt.pageTarget || pages == null || pages <= fmt.pageTarget) return 0
  return (pages - fmt.pageTarget) / fmt.pageTarget
}

/**
 * Run the Fit-to-page ladder.
 *
 * Tightens in §2.5's order — density, then margins (never past the printable
 * safe area), then the table font — re-measuring after each step, and stops the
 * moment the plan fits. `measure(format)` returns the page count for a format;
 * the caller supplies it because measuring needs a browser and this does not.
 *
 * A ladder that runs out without fitting returns `fitted: false` and
 * `needsCondense: true` — the signal to fall through to the §3.2 condense pass,
 * which is the only remaining lever that changes the words rather than the
 * layout.
 *
 * @param {object} format
 * @param {(format: object) => number} measure
 * @param {{ maxSteps?: number }} [opts]
 * @returns {{ format: object, pages: number, fitted: boolean, steps: string[], needsCondense: boolean }}
 */
export function fitToPage(format, measure, { maxSteps = 8 } = {}) {
  let fmt = resolveLessonFormat(format)
  const target = fmt.pageTarget
  let pages = measure(fmt)
  const steps = []

  if (target == null || pages <= target) {
    return { format: fmt, pages, fitted: true, steps, needsCondense: false }
  }

  for (let i = 0; i < maxSteps; i += 1) {
    const step = nextFitStep(fmt)
    if (!step.changed) break
    fmt = step.format
    steps.push(step.step)
    pages = measure(fmt)
    if (pages <= target) {
      return { format: fmt, pages, fitted: true, steps, needsCondense: false }
    }
  }

  return { format: fmt, pages, fitted: false, steps, needsCondense: true }
}

/**
 * What the preview should draw over each sheet, and what to tell the teacher.
 * Pure so the wording is testable and lives in exactly one place.
 * @param {object} format
 * @returns {{ show: boolean, level: string, message: string, insetMm: number }}
 */
export function safeAreaOverlay(format) {
  const fmt = resolveLessonFormat(format)
  const warning = marginWarning(fmt.marginMm)
  return {
    show: warning.showSafeArea,
    level: warning.level,
    message: warning.message,
    insetMm: MARGIN_SAFE_AREA_MM,
  }
}
