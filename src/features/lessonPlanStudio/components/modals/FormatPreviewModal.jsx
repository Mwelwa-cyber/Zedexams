import { useEffect } from 'react'
import { renderPlanHtml } from '../../../../components/teacher/studio/utils/renderPlanHtml'
import { resolveLessonFormat } from '../../../../utils/lessonPlanFormat'
import { lessonPlanPrintCss } from '../../../../utils/lessonPlanPrintCss'
import {
  CBC_SAMPLE_DATA,
  CBC_SAMPLE_META,
  OLD_SAMPLE_DATA,
  OLD_SAMPLE_META,
  formatPreviewTitle,
} from '../../lib/formatPreviewSamples'

/**
 * FormatPreviewModal — shows a fully-styled sample lesson plan in the chosen
 * format, so a teacher can see what a format looks like before generating.
 *
 * The sample is rendered through the real renderPlanHtml() renderers, so the
 * preview matches the studio's actual output. The live Advanced-Options toggles
 * (compact metadata, lesson evaluation, enrolment, attendance)
 * are honoured so the preview reflects the teacher's current choices.
 *
 * Props:
 *   format          : 'modern' | 'classic' | 'official' | null  — null = closed
 *   curriculumMode  : 'cbc' | 'previous'
 *   advanced        : formatOptions.advanced object (optional)
 *   onClose         : () => void
 */
export function FormatPreviewModal({ format, curriculumMode = 'cbc', advanced = {}, formatOptions = null, onClose }) {
  const open = Boolean(format)

  // Ensure the document stylesheet is present so the sample renders exactly as
  // the plan will print. Idempotent — the paginated preview injects the same
  // <style> on mount, but the modal can open before that runs, and it is the
  // one shared stylesheet in either case.
  useEffect(() => {
    if (!open) return
    const id = 'lesson-plan-document-css'
    let style = document.getElementById(id)
    if (!style) {
      style = document.createElement('style')
      style.id = id
      document.head.appendChild(style)
    }
    style.textContent = lessonPlanPrintCss(formatOptions ?? {}, { includePageRule: false, includeSheets: true })
  }, [open, formatOptions])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const isOld = curriculumMode === 'previous'
  const baseData = isOld ? OLD_SAMPLE_DATA : CBC_SAMPLE_DATA
  const baseMeta = isOld ? OLD_SAMPLE_META : CBC_SAMPLE_META

  // Map the live Format & Options choices onto the renderer's meta, falling
  // back to the sample defaults when one is absent. The sample is rendered by
  // the real renderer, so the page budget, margins, environment display and
  // section toggles all show here exactly as they will print.
  const meta = {
    ...baseMeta,
    format,
    lessonFormat: resolveLessonFormat(formatOptions ?? {}),
    compactMeta: advanced.compactMetadata ?? baseMeta.compactMeta,
    showEnrolment: advanced.includeEnrolment ?? baseMeta.showEnrolment,
    showAttendance: advanced.includeAttendance ?? baseMeta.showAttendance,
  }

  const html = renderPlanHtml(baseData, meta, curriculumMode)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={formatPreviewTitle(format, curriculumMode)}
    >
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      {/* Panel */}
      <div className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e5ddd0] px-4 py-3">
          <h3 className="text-[14px] font-semibold text-[#3d3529]">
            {formatPreviewTitle(format, curriculumMode)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[#7a6d5d] hover:bg-[#f5f0ea] hover:text-[#3d3529]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable sample document */}
        <div className="flex-1 overflow-auto bg-[#f2ede6] p-4 sm:p-6">
          <div className="doc-wrap mx-auto">
            {/* Safe: html is our own renderPlanHtml() output over fixed sample data, never user input */}
            <div className="doc" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    </div>
  )
}
