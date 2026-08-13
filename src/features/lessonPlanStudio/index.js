/**
 * Lesson Plan Studio — public API (docs/architecture.md §3, §14.7).
 *
 * The studio at `/teacher/lesson-plans/{new,:lessonPlanId/edit}`: the five-step
 * wizard, the editor, the live and paginated previews, and the document
 * renderer. The page is NOT exported — `teacherRoutes.jsx` mounts it with
 * `lazy(() => import('…/pages/LessonPlanStudio'))` under the route-mount
 * exception, which is the whole reason it stays off this index.
 *
 * Two names, both imported by something outside the feature TODAY:
 *
 *   • `LessonPlanView` — the saved-plan renderer. Drawn by `features/teacherLibrary`
 *     (`LibraryItemDetail` and the signed-out `/share/:token` page) and by the
 *     `/teachers` marketing page.
 *   • `LessonPlanDocumentPreview` — drawn by `features/templateBank`'s detail page
 *     to preview a plan built from a template.
 *
 * **The exporters are deliberately absent.** `lessonPlanToDocx` and
 * `lessonPlanToPdf` went to `src/engines/export-engine/` and `teacherLibrary`
 * reaches them there DIRECTLY, on #2172's rule. Listing them here would put
 * jsPDF and html2canvas in the chunk of every consumer that wanted one
 * renderer — and two of the three consumers above (`PublicShareView` and
 * `/teachers`) are declared light pages in `check:bundle-edges`, so that would
 * be a failing build rather than something to remember.
 *
 * Also NOT here, and for the same reason the register's shell guard was not:
 * the five hooks and six utils that stayed in `src/components/teacher/studio/`
 * (`useSubjectTopics`, `useAvailableGrades`, `useSubjectsForGrade`,
 * `useSubtopicDetail`, `useTeacherPlanContext`, `curriculumDataService`,
 * `renderPlanHtml`, `subjectName`, `teacherPlanContext`, `lessonMemory`,
 * `splitSpecificOutcomes`) plus `lessonStudio.css`. Each is read by surfaces
 * this feature does not own — the curriculum selector, the generator shell,
 * `features/schemeOfWork`, `features/templateBank`, and the Assessment Studio's
 * own modals. They are shared teacher infrastructure that this studio happens
 * to sit next to, not studio internals, so they stayed below both.
 */

export { default as LessonPlanView } from './components/LessonPlanView'
export { default as LessonPlanDocumentPreview } from './components/LessonPlanDocumentPreview'
