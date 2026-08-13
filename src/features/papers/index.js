/**
 * Public surface of the past-papers area — the hub at `/papers`, the paper
 * reader, the timed practice runner, the public paper-quiz runner, and the
 * learner's own paper history.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4), following
 * docs/MIGRATION_TEMPLATE.md. A move: same routes, same Firestore reads and
 * writes, same rendering, same engine flag wiring.
 *
 * **The pages are not exported.** All five are reached only by
 * `lazy(() => import(…))` in App.jsx under the route-mount exception.
 *
 * What IS exported is one component, because two screens outside this feature
 * genuinely compose with it: `AdminPastPapers` and `PastPaperStudio` both draw
 * a paper's provenance badge. `PaperTitle` is 93 lines of presentation with no
 * Firestore, no curriculum rule and no heavy dependency, so a consumer that
 * wants the badge pays for the badge.
 *
 * ── The consumers `git grep` could not see ─────────────────────────────
 *
 * Searching for `components/papers` finds the five route mounts and stops.
 * It cannot find `import { PaperSourceBadge } from '../papers/PaperTitle'` —
 * a relative specifier from a sibling directory never contains the string
 * being searched for. Three more consumers were sitting behind that blind
 * spot, and what surfaced them was `npm run test:import-boundaries`, which
 * resolves every specifier to a file on disk rather than matching text. Two
 * of the three are dynamic imports the build would not have failed on: they
 * would have shipped as a runtime chunk-load error on one admin step.
 *
 * ── This area was FROZEN, and moved on an explicit owner ruling ─────────
 *
 * `components/papers/` is named by path in §13's freeze clause — first in the
 * list — and the freeze lifts when the Phase 3 rollout flags reach 100%. They
 * had not: every `featureFlags.assessmentEngine.*` switch defaults off and
 * `rolloutPercent` defaults to 0, and `PublicQuizRunner` still carries both
 * runners behind `useAssessmentEngineFlag('pastPaperQuiz')`.
 *
 * The owner lifted the freeze for this area on 2026-08-13, the same way the
 * lesson-plan studio was unblocked the day before. Recorded here as well as in
 * §13 because the clause a reader will find first still says "frozen", and a
 * ruling that lives only in a chat log is not a ruling anyone can check.
 *
 * **What that means for the canary:** past-paper quizzes are the FIRST
 * production flag flip (§13), so this feature holds the surface the engine
 * rollout is measured on. Nothing here changes which runner a visitor gets —
 * the flag read, its fail-closed default and the latch are byte-identical and
 * simply moved. `test:paper-quiz-zero-write` still points at the runner and
 * still proves it writes nothing, which is the property that made it the safe
 * canary in the first place.
 *
 * ── The one design change, and why a pure move could not avoid it ──────
 *
 * `usePaperResumeSync` lived in `features/learnerHome/lib/`, and
 * `PastPaperViewer` imported it. While the viewer was legacy code that was
 * recorded debt (`KNOWN_LEGACY_FEATURE_IMPORTS`). The moment the viewer became
 * a feature the same import turns into a **cross-feature** one, and
 * `KNOWN_CROSS_FEATURE_IMPORTS` only ever shrinks — so the move had to resolve
 * it rather than re-file it. MIGRATION_TEMPLATE.md §8 names this exactly: an
 * entry a migration would ADD is a signal that something belongs on the other
 * side of the boundary.
 *
 * It does. The hook is about papers: it takes a paper, reads the page number
 * `PastPaperViewer` itself writes, and only lived next to its READER. So it
 * came here, and the storage contract the two features share —
 * `PAPER_RESUME_KEY`, `writeJson`, `readPaperPage` — was promoted to
 * `src/shared/utils/paperResumeStorage.js`, the `studioFields` (#2322) and
 * `shellNavGuardCore` (#2315) precedent. `learnerLocal.js` re-exports those so
 * learner-home's own callers are untouched.
 *
 * Net effect on the debt lists: **legacy→feature 5 → 4, cross-feature 3 → 3.**
 * One entry cleared, none added.
 *
 * ── What did NOT come with it, and why it CANNOT ───────────────────────
 *
 * The `src/utils/` slice stayed, and this is a constraint rather than a
 * deferral. The two modules the feature leans on hardest are shared with files
 * that are **still frozen**:
 *
 *   • `pastPapers.js` — 17 consumers outside this feature, including
 *     `PastPaperStudio`, `AdminPastPapers` and `ManageContent`.
 *   • `pastPaperQuizStatus.js` — 4, the first two of those same three.
 *
 * A util travels when the feature is its only consumer; these have consumers
 * that cannot be edited yet, so moving either would mean either editing a
 * frozen file or forking a rule that `test:shim-guard` exists to stop being
 * forked. `pastPaperQuiz.js` / `pastPaperQuizLoad.js` / `paperTitleCore.js`
 * are papers-only today and could travel, but `paperIdentity.test.js` covers
 * `paperTitleCore` alongside a module this feature does not own, so splitting
 * that test is its own PR (MIGRATION_TEMPLATE.md §5). They follow when the
 * frozen half unfreezes, and all of them move together at that point.
 *
 * Reaching back into `src/utils/` is what the layering allows and what
 * MIGRATION_TEMPLATE.md §2 calls the honest interim state of a phased
 * migration — a feature may import anything below it.
 *
 * `src/index.css` was NOT split either: the past-paper rules there
 * (`.zx-page-dock` and the Zed-launcher lift that reacts to it) are entangled
 * with global print and theme cascades, and lifting them is a CSS change that
 * wants its own review rather than a rename inside a move.
 *
 * ── The PDF viewers went DOWN a layer, not across ──────────────────────
 *
 * `PdfJsViewer`, `PdfScrollViewer` and the two components private to the first
 * (`GlassPageNavigation`, `PageThumbnailSheet`) are now in
 * `src/shared/components/`. Their consumer sets are what decided it, and one
 * of them settles the question on its own: **`PdfScrollViewer`'s only consumer
 * is `TimetableViewerPage`** — an exam *timetable*, not a past paper. It was
 * never papers' to keep. `PdfJsViewer` is shared between two papers pages and
 * the admin `PastPaperStudio`.
 *
 * They pass §14.6 on reach rather than on their own import lines: each takes a
 * URL and renders pages, and `pdfjsLoader` + `friendlyErrors` have no static
 * imports at all — no Firestore, no curriculum, no AI, no payment logic.
 *
 * The alternative was re-exporting them here so the admin and dashboard
 * screens could reach them through this door, and that is the barrel cost
 * MIGRATION_TEMPLATE.md §4 warns about: `AdminPastPapers` wants a 93-line
 * badge, and would have had two PDF viewers and their chrome evaluated at
 * import time to get it. **`PastPaperStudio`'s lazy boundary is preserved
 * exactly** — still `lazy(() => import(…))`, still deferred until the admin
 * reaches a PDF asset, now pointing one layer down instead of sideways.
 */

export { default as PaperTitle, PaperSourceBadge } from './components/PaperTitle'
