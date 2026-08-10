/**
 * Public surface of the admin payments area — the payments console at
 * `/admin/payments`: subscription activations, manual grants, invoice resends,
 * expiry reminders, and the revenue trend chart.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same page, same callables, same
 * Firestore reads, same route.
 *
 * **This front door is deliberately empty.** The page is reached only by
 * `lazy(() => import('…/pages/PaymentsPanel'))` in App.jsx under the
 * route-mount exception, and `RevenueTrendCard` is rendered by that page and
 * nothing else.
 *
 * ── The two modules that travelled ──────────────────────────────────────
 *
 * `adminPaymentsService.js` and `whatsapp.js`, each because this page was its
 * only consumer. `whatsapp.js` reads like a general-purpose helper from its
 * name and is not one: its own docblock calls it "the admin-only activation
 * confirmation sender", and both exports exist for the admin grant flow.
 *
 * `RevenueTrendCard` arrives here from the other direction. It sat beside
 * `AdminAiCosts` in the flat `components/admin/` directory and is about money,
 * so it read as belonging to the AI-cost feature; that migration left it
 * behind on the evidence that `AdminAiCosts` never renders it and this page
 * does. The grouping came from the import graph, and this is where it landed.
 *
 * ── What stayed ─────────────────────────────────────────────────────────
 *
 * `adminUsersService.js` — shared with `features/adminUsers`, which had
 * already recorded this exact pair from the other side ("also `PaymentsPanel`.
 * Moving it would make an unrelated admin page import through this feature's
 * front door"). Both halves are now features, and the module stays below both.
 *
 * `invoices.js` (5 consumers, including the learner InvoicesCard and the
 * upgrade modal) and `subscriptionConfig.js` stay for the ordinary reason: a
 * util travels when the feature is its only consumer.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * Callables and Firestore reads are inline, which §14.2 would put behind
 * `services/`. Not fixed here, under the standing Phase 4 policy that a
 * migration PR is a pure move — and this page ACTIVATES paid subscriptions
 * and grants roles, so a refactor of those call sites wants its own review.
 */

export {}
