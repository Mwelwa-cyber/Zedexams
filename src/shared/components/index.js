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
 * Single-consumer chrome did not come here either: it travelled INTO its one
 * consumer. `StudioHeader` (+ its stylesheet and spec) went to
 * `features/lessonPlanStudio/components/`, `StudioUnavailableNotice` (+ spec)
 * to `features/dashboardV2/components/`. A component one feature draws is that
 * feature's, however shared its docblock says it is.
 *
 * A namespace marker, not a barrel — import the file, not this index.
 */

export {}
