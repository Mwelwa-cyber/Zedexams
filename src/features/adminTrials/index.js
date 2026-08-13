/**
 * Public surface of the demo-trials panel — the `/admin/demo-trials` screen
 * that creates batches of demo learner accounts, each with a Premium trial,
 * for workshops, partner schools and pilot cohorts.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin, slice 1),
 * following docs/MIGRATION_TEMPLATE.md. A move: same form, same validation
 * order, same operator messages, same callable.
 *
 * **This front door is deliberately empty.** `BulkGrantTrialsPanel` is reached
 * by the `lazy(() => import(…))` mount in App.jsx under the route-mount
 * exception, and nothing else imports it — `git grep` found exactly one
 * consumer before the move and finds exactly one after.
 *
 * ── Why this was the slice to take first ────────────────────────────────
 *
 * Of the files left in `src/components/admin/`, this one had the shortest
 * argument: six imports, all shared infrastructure, no private utils slice, no
 * `index.css` slice, no spec, and **no Firestore access at all** — its only
 * backend contact is the `bulkGrantDemoTrials` callable.
 *
 * It is also outside every freeze clause, and that is worth stating rather
 * than assuming. The freeze covers past papers, quizzes, games and the
 * assessment-engine cutover; this panel creates Auth users and grants
 * subscriptions, and nothing it imports reads or writes those collections.
 * The same dependency test puts `AdminDashboard` INSIDE the freeze without it
 * being named there, because `seedData.js` writes `collection(db, 'quizzes')`.
 * Getting the opposite answer here is the test working.
 *
 * ── What did NOT come with it ───────────────────────────────────────────
 *
 * Nothing. Proximity in a flat directory is not cohesion (the rule
 * `RevenueTrendCard` established), so the neighbours stayed: `AdminAppCheck`
 * and `security/MfaSetupPage` are route-mounted, unrelated to trials and
 * unrelated to each other, and a feature called `adminTrials` holding an App
 * Check debugger would be a worse home than the one they have. Both have since
 * become their own features — `adminAppCheck` and `adminMfa` — rather than
 * lodgers here, which is the same rule reaching the same answer.
 */

export {}
