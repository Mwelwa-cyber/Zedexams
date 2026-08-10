/**
 * Public surface of the admin AI-cost area — the spend dashboard at
 * `/admin/ai-costs` and the Treasury budget panel it renders.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same Firestore and
 * callable reads, same route.
 *
 * **This front door is deliberately empty.** The page is reached only by
 * `lazy(() => import('…/pages/AdminAiCosts'))` in App.jsx under the route-mount
 * exception, and `BudgetEnforcementPanel` is rendered by that page and nothing
 * else. Phase 2's rule is to export what is consumed today; that set is empty.
 *
 * ── What travelled, and the one thing that did not ──────────────────────
 *
 * `src/utils/aiBudget.js` came with it: its only two readers were the panel
 * and the panel's spec, so this feature is its whole consumer set.
 *
 * `src/utils/aiCosts.js` stayed, and the reason is the rule `adminUsers`
 * recorded — a util travels when the feature is its only consumer, and stays
 * when it is not. Three surfaces read it: this page, `adminSettings`'s
 * `useControlCenterData` (the Control Center's spend strip) and `companyHQ`.
 * Two of those are already features, so pulling it in here would turn two
 * legal downward imports into cross-feature ones, which is a failing build
 * rather than a tidier import path.
 *
 * **`RevenueTrendCard` is not part of this area at all**, despite sitting
 * beside it in `components/admin/` and being about money. `AdminAiCosts` never
 * renders it; its only consumer is `PaymentsPanel`. It belongs to the payments
 * surface and stays there — proximity in a flat directory is not cohesion.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * `aiBudget.js` calls a callable and the page reads Firestore directly, which
 * §14.2 would put behind `services/`. Not fixed here, under the standing
 * Phase 4 policy that a migration PR is a pure move.
 */

export {}
