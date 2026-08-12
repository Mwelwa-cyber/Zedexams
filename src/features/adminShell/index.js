/**
 * Public surface of the admin shell — the chrome every `/admin/*` route
 * renders inside (`AdminLayout`) and the ⌘K navigator it hosts
 * (`CommandPalette`).
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same chrome, same nav, same MFA gating
 * from App.jsx.
 *
 * **This front door is deliberately empty.** `AdminLayout` is reached by the
 * `lazy(() => import(…))` mount in App.jsx under the route-mount exception,
 * and `CommandPalette` is rendered by the layout and nothing else.
 *
 * ── The DASHBOARD is not here, and that is the whole finding ────────────
 *
 * `AdminDashboard.jsx` is the obvious centre of the admin shell and is
 * **frozen**. It imports `utils/seedData`, which writes `collection(db,
 * 'quizzes')` and calls `deleteQuizWithQuestions` — the "seed / clear sample
 * data" buttons create and destroy real quiz documents. Quizzes are frozen by
 * owner instruction, so the dashboard waits for the rollout flags.
 *
 * Three components go with it because it is their only consumer:
 * `ParentDigestTester`, `OpsAlertTester` (+ its spec) and `AdminSetupBanner`.
 * `seedData.js` stays too — the dashboard is its only reader.
 *
 * `GamesSeedAdmin` is blocked separately and for the same shape of reason: it
 * writes `collection(db, 'games')`, and games are named on the freeze list.
 *
 * ── Still in `components/admin/`, and NOT frozen ────────────────────────
 *
 * `AdminAppCheck` and `security/MfaSetupPage` are route-mounted, unrelated to
 * the shell, and unrelated to each other. They were left rather than swept in
 * here: proximity in a flat directory is not cohesion (the rule
 * `RevenueTrendCard` established), and a feature called `adminShell`
 * containing an App Check debugger would be a worse home than the one it has.
 *
 * `BulkGrantTrialsPanel` was on that list and has since left it — it is
 * `src/features/adminTrials/` as of Wave 4 slice 1, for the same reason it was
 * never swept in here.
 */

export {}
