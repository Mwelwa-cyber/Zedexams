import { useEffect } from 'react'
import { lessonPlanPrintCss } from '../../../utils/lessonPlanPrintCss'

// One <style> element for the whole app. The document's own rules live in
// lessonPlanPrintCss so the preview, the print window and the PDF are styled by
// the same string; only the custom properties differ per plan, and those ride
// on the document element rather than in this sheet.
const STYLE_ID = 'lesson-plan-document-css'

/**
 * Keep the lesson-plan document stylesheet present and current.
 *
 * Every surface that renders a plan calls this — the paginated preview, the
 * live "writing itself" preview, the format-sample modal. The live preview is
 * the reason it is a shared hook rather than the paginated preview's private
 * effect: it mounts the moment Generate is clicked, long before any sheets
 * exist, and an unstyled document flashing on screen for the whole generation
 * is what happened when only the paginated preview injected these rules.
 *
 * `includePageRule` is deliberately OFF here: an `@page` rule injected into the
 * app would repaginate the whole application the next time a teacher pressed
 * Ctrl+P on any other screen. The print window and the PDF exporter inline
 * their own copy, with the page rule, from the same function.
 *
 * @param {object} format  raw or resolved lesson format
 */
export function useLessonPlanDocumentCss(format) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    let style = document.getElementById(STYLE_ID)
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = lessonPlanPrintCss(format, { includePageRule: false, includeSheets: true })
  }, [format])
}
