/**
 * Lessons — public API (docs/architecture.md §3, §14.7).
 *
 * Slide-based interactive lessons, end to end: the learner list and player,
 * the teacher's library and slide editor, and the PowerPoint importer that
 * turns a .pptx into slides. Four of these files were already here (the
 * learner list); the other seventeen arrived from `src/components/lessons/`,
 * which the migration removed.
 *
 * **No page is exported.** All four — `LearnerLessonsList`, `LessonPlayer`,
 * `LessonDashboard`, `LessonEditor` — are reached only by
 * `lazy(() => import('…/pages/X'))` from `App.jsx` and `teacherRoutes.jsx`,
 * under the route-mount exception. Putting one here would drop the slide
 * editor and the pptx importer into the chunk of anything that opened this
 * door for a constant.
 *
 * ## The one exported name
 *
 * `LESSON_THEME_MAP` — the slide theme lookup, drawn by `features/notes`'
 * `SlideNotesReader` because a note renders as slides too. That is the entire
 * outside demand on this feature.
 *
 * `lessonConstants.js` itself stays in `lib/`: eleven of its twelve importers
 * are lesson files, and promoting a 381-line module to `src/shared/` on the
 * strength of ONE imported constant is the over-promotion the `studioFields`
 * pass was careful to avoid. A module is not shared because one export of it
 * is — the front door is what makes the single genuine edge legal.
 *
 * ## `lessonResume` lives here, and that was decided before this migration
 *
 * `lib/lessonResume.js` came from `features/learnerHome/lib/`, where it sat
 * next to a reader rather than next to its subject. Moving `LessonPlayer`
 * alone would have turned a recorded legacy→feature import into a
 * cross-feature one, and `KNOWN_CROSS_FEATURE_IMPORTS` only shrinks. The
 * papers migration hit the identical shape and wrote the answer down for this
 * case in `test-import-boundaries.mjs`.
 *
 * Unlike `paperResumeSync`, this needed no shared module: that hook and
 * learner-home shared a localStorage contract (hence
 * `src/shared/utils/paperResumeStorage.js`), whereas this one has a single
 * importer and writes `noteProgress` directly. Learner-home meets it at the
 * COLLECTION, not at a module, so there is nothing to put below both.
 *
 * ## Known gap: §14.2 is not satisfied here
 *
 * `services/` does not exist and Firebase access is not funnelled through it.
 * `pages/LessonEditor.jsx` reaches `firebase/storage`, `firebase/config` and
 * `firebase/attestedStorage` directly, and `lib/firestore.js` queries
 * Firestore from `lib/`. Both predate this migration and are left exactly as
 * they were: extracting a Storage upload path is a rewrite, not a move, and
 * it sits on slide-image upload. Recorded so the next reader finds a known
 * gap rather than an oversight.
 */

export { LESSON_THEME_MAP } from './lib/lessonConstants'
