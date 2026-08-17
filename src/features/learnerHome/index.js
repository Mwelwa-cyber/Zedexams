/**
 * Public surface of the learner home — the four-tab shell, Home, the subject
 * screen and Profile (learner redesign steps 1–10).
 *
 * ── Three exports, and they are all VIEW MODEL rather than screen ───────
 *
 * The pages are deliberately absent. `App.jsx` mounts them with
 * `lazy(() => import('…/pages/LearnerHomePage'))`, and a page behind a front
 * door lands in the chunk of every consumer of that door — the rule the
 * flashcards reference migration states and the one `features/quiz` follows.
 *
 * What IS exported is what a SECOND feature legitimately needs: the Guardian
 * Zone shows a parent the same subject progress, weak topics and recent
 * activity the child sees on Home, and it must be the same numbers. Two
 * derivations over the same documents are two things free to disagree — the
 * parent reading 62% while the child reads 48% is a support ticket nobody can
 * resolve. So the hook travels rather than the logic being copied.
 *
 * `useLearnerDashboard` reaches Firebase, which is why it stays in a feature
 * rather than moving down to `src/hooks/`: `src/shared/**` may not import the
 * Firebase SDK, and feature → feature through a front door is the allowed
 * route (docs/architecture.md §14.7). The chunk cost is small and measured —
 * this door re-exports two hooks and one pure module, no pages, no components.
 */

export { default as useLearnerDashboard } from './hooks/useLearnerDashboard'
export { default as useWeeklySummary } from './hooks/useWeeklySummary'
export { firstNameOf } from './lib/learnerHomeCore'
