/**
 * Immersive teacher-studio routes.
 *
 * The assessment / exam-paper studio (AssessmentStudio) is a full-screen editor
 * that renders its own fixed bottom dock (`.sv-dock` — Home / Build / Preview /
 * Key / AI). The global TeacherBottomNav is also `fixed` at the bottom, so on
 * these routes the two bars stack and the higher-z-index dark dock covers the
 * global nav's "Library" / "Assessments" labels (the classic "two bottom bars"
 * overlap bug). On the studio routes we suppress the global nav — the studio's
 * dock plus the top-bar back button are the navigation surface there.
 *
 * This matches the studio (`.../new` and `.../:id/edit`) but NOT the plain list
 * route (`/teacher/test-papers`), which keeps the global nav.
 */
const IMMERSIVE_STUDIO_PATH =
  /^\/teacher\/(test-papers|assessments|exam-papers)\/(new|[^/]+\/edit)\/?$/

export function isImmersiveStudioPath(pathname = '') {
  return IMMERSIVE_STUDIO_PATH.test(pathname)
}
