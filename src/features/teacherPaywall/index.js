/**
 * Teacher paywall — public API (docs/architecture.md §3, §14.7).
 *
 * Everything a teacher sees when their plan is what decides the answer: the
 * locked studio with its read-only sample, the plan/usage cards, the free
 * allowance notices, and the upsells that appear mid-flow.
 *
 * ## This feature exists because §14.6 excluded it from `src/shared/`
 *
 * The studio-chrome pass promoted five components to `src/shared/components/`
 * and left six behind, each failing the shared test on its closure —
 * `engines/payment-engine/paywall`, `utils/lenco`, `utils/topup`, `engines/payment-engine/teacherPlans`, and
 * `utils/analytics`' Firebase reach. That exclusion is not a loose end: those
 * six are one coherent surface, and the payment logic that disqualified them
 * from the bottom layer is exactly what makes them a feature.
 *
 * ## Four exported names, and two components deliberately stayed behind
 *
 *   • `PlanUsageCard`, `FreeAllowanceNotice` — `TeacherDashboard`
 *   • `FreePreviewUpsell` — `assessmentStudio`'s `CreatePaperModal`, `schemeOfWork`
 *   • `StudioNextSteps` — `schemeOfWork`, `weeklyForecast`
 *
 * `UsageMeter` has exactly one importer — `PlanUsageCard`, lazily — so it
 * stays internal. Exporting it would put `utils/lenco` and `utils/topup` on
 * the import graph of anything that opens this door for a notice.
 *
 * **`LockedStudio` is NOT here, and it was moved in and then back out — the
 * measurement is the reason.** It imports ELEVEN features through their front
 * doors, and one of them (`flashcards`) reaches `firebase/config`. Re-exported
 * from this index, every consumer that opened the door for a 48-line upsell
 * pulled that entire graph: `CreatePaperModal.spec.jsx` went from 26 tests to
 * ZERO, failing at import with "Missing required Firebase web config" — and
 * Vitest still reported the run green, because a file with no tests is not a
 * failure. It was found by diffing per-file test counts against `main`
 * (3,830 → 3,804), not by any guard.
 *
 * That is the flashcards rule (§Phase 2: "exporting a page from a front door
 * puts the whole studio in the chunk of anything that wanted one component")
 * biting on a component rather than a page. So `LockedStudio` stays beside
 * `StudioGate` in `src/components/teacher/`, which is where it belongs on its
 * own merits too: the gate decides whether a studio renders and the locked
 * view is what it renders instead — one unit, reached by one `lazy()`.
 * `src/data/studioSamples.js` stayed with it, being its data.
 *
 * ## `StudioGate` deliberately stayed behind
 *
 * It is route infrastructure deciding whether a studio route renders at all,
 * it sits beside its own route table in `src/components/teacher/`, and
 * `teacherRoutes.jsx` imports it EAGERLY on purpose — it "must decide
 * synchronously from the already-loaded plan". Pulling it in here would make
 * the route table open this front door on the eager graph. That is the
 * `AdminMfaGate` precedent: a router guard belongs beside the router, not
 * inside the feature it guards the way past.
 *
 * ## Freeze note
 *
 * Measured after `LockedStudio` was taken back out, this feature's closure is
 * 42 modules and reaches **nothing** on the freeze list. The two frozen
 * modules the original seven-component measurement found
 * (`components/quiz/importRichText.js` and `importFormatTokens.js`) came
 * entirely through `LockedStudio` → `features/…` →
 * `src/utils/toolNotationRender.js`, and left with it. No frozen file is
 * edited either way.
 */

export { default as PlanUsageCard } from './components/PlanUsageCard'
export { default as FreeAllowanceNotice } from './components/FreeAllowanceNotice'
export { default as FreePreviewUpsell } from './components/FreePreviewUpsell'
export { default as StudioNextSteps } from './components/StudioNextSteps'
