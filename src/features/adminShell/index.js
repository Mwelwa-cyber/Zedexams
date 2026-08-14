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
 * `AdminDashboard.jsx` is the obvious centre of the admin shell and was
 * **frozen** when this shell migrated. It imports `utils/seedData`, which
 * writes `collection(db, 'quizzes')` and calls `deleteQuizWithQuestions` — the
 * "seed / clear sample data" buttons create and destroy real quiz documents,
 * and quizzes are frozen by owner instruction.
 *
 * **Released by owner ruling on 2026-08-14 and migrated to
 * `features/adminHome` (Wave 4 slice 4)**, together with the three components
 * that had it as their only consumer — `ParentDigestTester`, `OpsAlertTester`
 * (+ its spec) and `AdminSetupBanner` — and `seedData.js`, which became that
 * feature's `services/seedDataService.js`.
 *
 * The finding above is left standing rather than deleted: the reasoning was
 * correct, the rollout flags have NOT reached 100%, and the dashboard moved
 * because the owner weighed this particular blast radius and released it. A
 * reader who saw the earlier claim needs to find out it was superseded by a
 * ruling, not find it silently absent — and must not read it as the quiz
 * freeze having lapsed. It has not.
 *
 * `GamesSeedAdmin` is blocked separately and for the same shape of reason: it
 * writes `collection(db, 'games')`, and games are named on the freeze list.
 *
 * ── Still in `components/admin/`, and NOT frozen ────────────────────────
 *
 * Nothing is left on it. All three route-mounted strays were left here rather
 * than swept into `adminShell` — proximity in a flat directory is not cohesion
 * (the rule `RevenueTrendCard` established) — and each has since become its own
 * feature for exactly that reason: `BulkGrantTrialsPanel` → `adminTrials`
 * (Wave 4 slice 1), `AdminAppCheck` → `adminAppCheck` (slice 2),
 * `security/MfaSetupPage` → `adminMfa` (slice 3).
 */

export {}
