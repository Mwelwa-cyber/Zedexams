/**
 * Public surface of subscriptions — the paywall, the upgrade and top-up flows
 * (Lenco mobile money and cards on web, Google Play Billing on Android), the
 * renewal and usage reminders, and `/my-subscription`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4), last and most widely
 * consumed of the wave.
 *
 * ── The three frozen consumers are reached by a SHIM, not an edit ───────
 *
 * `components/quiz/QuizRunnerV2`, `components/quiz/QuizList` and
 * `components/games/PlayGame` import `UpgradeModal`, and all three are frozen
 * while Phase 3 replaces the quiz runner behind rollout flags. They are
 * byte-identical after this migration: `components/subscription/UpgradeModal.jsx`
 * survives as a one-line re-export shim carrying its own retirement condition.
 * See that file for why going around was chosen over editing three one-line
 * imports.
 *
 * **All three were released on 2026-08-14** — `PlayGame` to
 * `features/games/pages/`, `QuizRunnerV2` and `QuizList` (and the three runner
 * specs) to `features/quiz/pages/`. None of the shim's consumers is frozen any
 * more, so what holds it is no longer the freeze: it is the chunk measurement,
 * which never depended on one. Routing those six through this front door would
 * put the status banner, `PremiumGate` and `RenewalBanner` into the chunks of
 * the quiz runner, the quizzes hub and the play-game route. Its retirement is
 * now a measurement rather than a date — see that file's docblock.
 *
 * ── What is exported, and the one that is not ───────────────────────────
 *
 * `SubscriptionStatusBanner` (App.jsx, EAGER), `UsageReminderBanner`,
 * `UpgradeModal`, `PremiumGate` + its `UpgradeBanner`/`AttemptCounter`,
 * `RenewalBanner`, `SubscriptionReminderCard`.
 *
 * The six paywall and route mounts in App.jsx — `PaywallHost`,
 * `PostUpgradeContinuation`, `LockedFeatureModal`, `QuizLimitPopup`,
 * `SubscriptionReminderPopup`, `MySubscriptionRoute` — stay
 * `lazy(() => import(…))` against their paths under the route-mount exception,
 * as does `MySubscriptionPage` from `teacherRoutes`.
 *
 * ── Which utils travelled ───────────────────────────────────────────────
 *
 * Four had no consumer outside this directory: `pendingPremiumAction`,
 * `lockedFeature`, `reminderVisibility`, `usageReminderLogic`, each with its
 * spec. The rest stayed because something else reads them —
 * `subscriptionConfig` (11 other consumers), `teacherPlans` (13), `paywall`
 * (7), plus `subscriptionStatus`, `lenco`, `invoices`, `topup` and
 * `playBilling`. On an area this widely wired, most of them are not private.
 */

export { default as SubscriptionStatusBanner } from './components/SubscriptionStatusBanner'
export { default as UsageReminderBanner } from './components/UsageReminderBanner'
export { default as UpgradeModal } from './components/UpgradeModal'
export { default as RenewalBanner } from './components/RenewalBanner'
export { default as SubscriptionReminderCard } from './components/SubscriptionReminderCard'
export { default as PremiumGate, UpgradeBanner, AttemptCounter } from './components/PremiumGate'

// ── Where the tiered gating surfaces are, and why none is here ──────────
//
// This door eagerly exports `UpgradeModal`, and through it `utils/invoices` —
// which resolves the Functions SDK at module load. Anything routed through it
// carries that whole closure into the importer's chunk, which is the same
// measurement the shim note above records for the quiz runner and PlayGame. So
// each new surface lives where its consumers can reach it WITHOUT paying for
// the checkout:
//
//   PlanChip, LockedCard/LockBadge  → src/shared/components/ (two features
//                                     each; they reach Firebase only through
//                                     src/services/entitlements)
//   PaperContinueLock               → src/features/papers/components/ (one
//                                     consumer: the free-set results screen)
//   UnlockSheetHost, GraceRibbon    → lazy route mounts in App.jsx, under the
//                                     same exception as the six paywall hosts
//   MomentOfWinModal                → stays in this feature, unexported: it
//                                     has no mount yet (Part 9, the last step
//                                     of the rollout) and an export with no
//                                     consumer is a door to nowhere.
