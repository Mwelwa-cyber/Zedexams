/**
 * Public surface of the admin feedback area — the support and suggestion inbox
 * at `/admin/feedback`, where Echo's triage of `feedback` and public
 * `contactMessages` is read and worked through.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same page, same Firestore reads and
 * status writes, same route.
 *
 * **This front door is deliberately empty.** The page is a route mount and
 * nothing composes with it.
 *
 * ── Why this is one page and not the "support and ops" cluster ──────────
 *
 * `OpsAlertTester` and `ParentDigestTester` sat beside it in
 * `components/admin/` and read as the same subject — admin tools for checking
 * that a channel works. They are **rendered by `AdminDashboard`**, which is
 * part of the admin shell and has not migrated. Taking them here would leave
 * the dashboard importing two components through an unrelated feature's
 * directory; taking the dashboard too would make this the shell PR by
 * accident. They travel with the shell.
 *
 * ── What did not travel ─────────────────────────────────────────────────
 *
 * `features/feedback`'s `feedbackOptions` — the type and status vocabulary,
 * shared with the learner-facing FeedbackDialog. A util travels when the
 * feature is its only consumer.
 */

export {}
