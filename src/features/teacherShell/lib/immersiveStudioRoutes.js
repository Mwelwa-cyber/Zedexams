/**
 * Immersive teacher-studio routes.
 *
 * These are full-screen studios that render their OWN bottom bar pinned to the
 * bottom of the viewport, so the global dashboard dock (Home / Register /
 * Library / Assessments) must be suppressed — otherwise two bottom bars stack
 * and collide (the classic "two bottom bars" overlap bug). The studio's own bar
 * plus the top-bar / mobile header back button are the navigation surface there.
 *
 *   • Assessment / exam-paper studio (AssessmentStudio) → its own `.sv-dock`
 *     (Home / Build / Preview / Key / AI), `position: fixed`.
 *   • Lesson Plan Studio wizard (LessonPlanWizard) → its own `.lpw-nav`
 *     (Back / Save & exit / Next / Generate), `position: sticky` inside the
 *     wizard column — but it still reaches the viewport bottom while the form
 *     scrolls, so a fixed dock would sit on top of it just the same.
 *
 * This matches each studio (`.../new` and `.../:id/edit`) but NOT the plain list
 * route (`/teacher/assessment-papers`), which keeps the global nav. Includes
 * the legacy test-papers/exam-papers/assessments paths too — they redirect
 * to the canonical route, but matching here avoids a one-frame nav flash
 * before the redirect commits.
 */
const IMMERSIVE_STUDIO_PATH =
  /^\/teacher\/(assessment-papers|test-papers|assessments|exam-papers|lesson-plans)\/(new|[^/]+\/edit)\/?$/

export function isImmersiveStudioPath(pathname = '') {
  return IMMERSIVE_STUDIO_PATH.test(pathname)
}
