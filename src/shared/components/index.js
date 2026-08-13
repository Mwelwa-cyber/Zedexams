/**
 * Shared presentation components — the ones with no feature knowledge
 * (buttons, dialogs, empty states, skeletons).
 *
 * A component that knows a curriculum rule, an AI prompt, a Firestore query or
 * payment logic is not shared — that is §14.6, and it is the test for whether
 * something belongs here at all.
 *
 * ## Residents
 *
 * `studioFields.jsx` — the first, and it arrived because eight migrated
 * features plus the dev UI-audit page were all reaching into
 * `src/components/teacher/generate/` to draw the same form controls
 * (`classTimetable` ×3, `flashcards`, `homework`, `rubric`, `schemeOfWork`,
 * `teacherNotes`, `worksheet`). A component that many features share belongs
 * below all of them — the rule that put `useIsMobile` in `src/shared/hooks/`
 * and `classListIcons.js` in `src/shared/icons/`, now reaching components.
 *
 * ## What the §14.6 test excluded, and how it was measured
 *
 * Two of `generate/`'s other components looked clean and are not: the test is
 * a module's REACH, not the imports written in its own file.
 *
 *   • `ImportFromClassListModal` calls `listTeacherRegisters()` and
 *     `listRoster()`, which are `firebase/firestore` queries one hop down. It
 *     is exactly "a component that knows a Firestore query".
 *   • `CreatedFromLessonPlanNotice` imports a single label helper from
 *     `lessonPlanInheritance`, which reaches `utils/teacherTools.js` →
 *     `firebase/functions` and `firebase/config`. It does not query, but
 *     promoting it would put `firebase/config` in this layer's module graph.
 *
 * Both stay in `src/components/teacher/generate/` until something splits the
 * data access out of them. `studioFields`' whole closure is three modules —
 * `react`, `ui/Icon`, `ui/icons` — which is why it could come alone.
 *
 * A namespace marker, not a barrel — import the file, not this index.
 */

export {}
