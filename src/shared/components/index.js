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
 * `studioFields.jsx` — the first, and it arrived because SEVEN migrated
 * features, across NINE import sites, plus the dev UI-audit page were all
 * reaching into `src/components/teacher/generate/` to draw the same form
 * controls (`classTimetable` ×3, `flashcards`, `homework`, `rubric`,
 * `schemeOfWork`, `teacherNotes`, `worksheet`). Seven and nine differ because
 * `classTimetable` imports it from three files; the earlier note said "eight
 * features", which was neither count. A component that many features share belongs
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
 * ## The studio chrome, promoted together
 *
 * Four more arrived from the top level of `src/components/teacher/`, where
 * sixteen migrated features were still reaching for them. Same rule as
 * `studioFields`, at the scale the directory actually had:
 *
 *   • `StudioPageHeader.jsx` — the one header band for every studio page.
 *     Fourteen features, plus `LockedStudio` and `GeneratorStudioShell`.
 *   • `StudioOutputBoundary.jsx` — the error boundary around a generated
 *     result. Eight features.
 *   • `StudioStepper.jsx` — the wizard stepper. `lessonPlanStudio` and
 *     `classTimetable`.
 *   • `SetupForYouCard.jsx` — `lessonPlanStudio` and `GeneratorStudioShell`.
 *
 * `StudioHeader.jsx` followed them, and it is the one resident here whose
 * placement demand did NOT decide — **owner ruling, 2026-08-13**. It has one
 * consumer (`lessonPlanStudio`), so the sole-consumer rule filed it inside that
 * feature on the first pass. The ruling is that the band is *intended* as the
 * shared studio identity band — its own docblock has said so since #2094's
 * consistency pass — and the next studio to adopt it must not have to import a
 * feature's internals or move the file a second time. Consumer count measures
 * adoption so far; it cannot see intent, and intent is an owner's call.
 *
 * It travels as a trio — component, `studioHeader.css`, spec — because the
 * stylesheet is the component's own and is imported by it directly. That is
 * NOT a precedent for splitting `src/index.css`: this file was already separate
 * before the move.
 *
 * `StudioPageHeader`'s styles stay in `src/index.css` under
 * `.studio-page-header`. The monolith is split per-feature later in Phase 4
 * (§2); moving one component's rules out ahead of that would fork the
 * stylesheet, not migrate it.
 *
 * ## What the §14.6 test excluded on THIS pass
 *
 * Seven studio components stayed behind, and two of them are the ones worth
 * remembering — because each has two feature consumers and would have passed a
 * by-eye reading of its own imports:
 *
 *   • `StudioNextSteps` and `FreePreviewUpsell` both import `utils/analytics`,
 *     which reaches `firebase/config` and five Firebase SDK entry points.
 *     `shared` is in `NO_FIREBASE_LAYERS`, so this is a hard boundary failure
 *     rather than a judgement call.
 *   • `StudioGate`, `LockedStudio`, `UsageMeter`, `PlanUsageCard` and
 *     `FreeAllowanceNotice` reach `utils/paywall`, `utils/lenco`,
 *     `utils/topup` or `utils/teacherPlans` — payment logic, named in §14.6.
 *
 * Single-consumer chrome travels INTO its one consumer unless an owner rules
 * otherwise: `StudioUnavailableNotice` (+ spec) went to
 * `features/dashboardV2/components/`, and stays there. `StudioHeader` is the
 * exception recorded above, not the rule — the default is still that a
 * component one feature draws is that feature's.
 *
 * ## Two learner-side residents, and the bundle argument that put them here
 *
 * `GameStickerStyles.jsx` and `Confetti.jsx` arrived from the games migration
 * (2026-08-14). Both pass §14.6 outright — the first imports NOTHING, the
 * second imports React — and both are drawn by surfaces outside games:
 *
 *   • `GameStickerStyles` — `features/quiz/QuizList`, `learnerDashboard/GradeHub`
 *     and `learnerDashboard/SubjectDrillDown`, as well as `games/GamesShell`.
 *     (QuizList reached it through a freeze shim at
 *     `components/games/GameStickerStyles.jsx` for a few hours; the quiz
 *     migration moved QuizList and the shim was deleted.)
 *   • `Confetti` — `components/exams/ExamCelebrations`, and seven game engines.
 *
 * Consumer count alone would have justified this. What made it necessary was
 * measured: exporting them from `features/games/index.js` instead cost
 * **+75 kB of static edges each on GradeHub, SubjectDrillDown and
 * ExamResultsPage**, because Rollup groups a front door's re-exports into one
 * chunk, and one of the other names on that door (`GameBadgeCard`) reaches
 * `utils/gamesService` and the Firebase client. Three learner routes that
 * render no game were being made to fetch the games service to draw a
 * stylesheet. Below both callers, the whole migration costs +124 bytes of
 * bundle and no route gains a chunk.
 *
 * It also removed a debt-list entry that the other shape required: a shim onto
 * `shared/` is a legal import for the legacy tree, while a shim into a feature
 * is recorded debt in `test:import-boundaries`.
 *
 * ## Eight more from the quiz migration, on the same rule at larger scale
 *
 * The reading-assist cluster and the two image components arrived from
 * `src/components/quiz/` the same day (2026-08-14). Each is drawn from THREE
 * different areas, which is what puts it below all of them rather than in
 * `features/quiz`:
 *
 *   • `PassageViewer`, `ReadingSettingsButton`, `ReadingSettingsSheet`,
 *     `TextToSpeechButton`, `ThemePreview` (private to the sheet), and
 *     `QuizReviewScreen` — drawn by `features/quiz/QuizRunnerV2`,
 *     `features/papers/PublicQuizRunner`, and `components/exams/DailyExamRunner`.
 *   • `ExtraQuestionImages` and `ZoomableImage` — the same three, plus the quiz
 *     EDITOR, which stays in `src/components/quiz/` behind the frozen
 *     `admin/CreateQuizV2`. Those two were the ONLY modules the runner and the
 *     editor shared, so promoting them is what made the runner separable at all.
 *
 * §14.6 measured on reach, not on each file's own import list: six import
 * nothing but React, `ThemePreview` nothing at all, and `PassageViewer` reaches
 * `editor/RichContent` (19 modules of TipTap and KaTeX, no Firebase). None
 * touches a curriculum rule, an AI prompt, a Firestore query or payment logic.
 *
 * `DailyExamRunner` is on the freeze list in its own right — outside Phase 3
 * entirely, retiring with the Daily Quiz rework — and was NOT covered by the
 * ruling that released `components/quiz/`. It reaches six of these through
 * one-line shims at the old paths, so it is byte-identical to `main` and no
 * debt entry was needed.
 *
 * A namespace marker, not a barrel — import the file, not this index.
 */

export {}
