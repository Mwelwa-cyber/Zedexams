import { useMemo } from 'react'
import PaginatedPlanPreview from './PaginatedPlanPreview'
import { renderPlanHtml } from '../../../components/teacher/studio/utils/renderPlanHtml'
import { useStudioLessonCss } from '../hooks/useStudioLessonCss'
import { resolveLessonFormat } from '../../../utils/lessonPlanFormat'

/**
 * LessonPlanDocumentPreview — a structured lesson plan drawn as the paginated
 * A4 document, for any surface that is not the studio canvas.
 *
 * The studio canvas holds the three pieces itself (render → stylesheets →
 * sheets) because it also owns Fit to page, the page-count verdict and the live
 * reveal. Everywhere else only wants the document, and assembling those three
 * pieces by hand is how a second rendering appears: the Template Bank preview
 * called `renderPlanHtml` into a bare <div>, so it drew the same document with
 * no stylesheet and no pagination — the stage duration ran into the stage name
 * ("INTRODUCTION5 min"), the progression table lost its borders, and there was
 * no "Page N of M" because nothing had been laid out on a sheet.
 *
 * Both stylesheets are injected, not one. `lessonPlanPrintCss` (via
 * PaginatedPlanPreview) is what the print window and the PDF inline;
 * `/studio/lesson.css` carries the `.plan-official` overrides the studio
 * preview is drawn with. A surface that takes only the first renders a
 * recognisably different document.
 *
 * Props:
 *   planJson        the structured plan object
 *   meta            renderPlanHtml meta (format, header fields, lessonFormat)
 *   curriculumMode  'cbc' | 'previous'
 *   onPageCount     (pages: number | null) => void
 *   className       wrapper classes (width/centring belong to the caller)
 */
export default function LessonPlanDocumentPreview({
  planJson,
  meta,
  curriculumMode = 'cbc',
  onPageCount,
  className = 'mx-auto w-full max-w-[900px]',
}) {
  useStudioLessonCss()

  const fmt = resolveLessonFormat(meta?.lessonFormat || {})

  // renderPlanHtml is a pure string builder, so the document is rebuilt only
  // when the plan or its rendering options actually change.
  const html = useMemo(() => {
    if (!planJson || typeof planJson !== 'object') return ''
    try {
      return renderPlanHtml(planJson, meta || {}, curriculumMode)
    } catch {
      return ''
    }
  }, [planJson, meta, curriculumMode])

  if (!html) return null

  return (
    <div className={className}>
      <PaginatedPlanPreview html={html} format={fmt} onPageCount={onPageCount} />
    </div>
  )
}
