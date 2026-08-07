import { useEffect } from 'react'

// The studio's decorative document sheet, served from public/ so Vite does not
// bundle it. It is injected as a <link> rather than imported.
const LINK_ID = 'studio-lesson-css'

/**
 * Keep `/studio/lesson.css` present for the whole session.
 *
 * Every surface that draws a lesson plan needs it: it carries the
 * `.plan-official` overrides (masthead rules, stage-name metrics, table
 * colours) that sit on top of `lessonPlanPrintCss`. A surface that injects only
 * the print stylesheet renders the same document with different typography —
 * which is precisely how the Template Bank preview and the studio preview came
 * to disagree.
 *
 * The link is deliberately NOT removed on unmount: the styles are still needed
 * for window.print() after a client-side navigation.
 */
export function useStudioLessonCss() {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (document.getElementById(LINK_ID)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/studio/lesson.css'
    link.id = LINK_ID
    document.head.appendChild(link)
  }, [])
}
