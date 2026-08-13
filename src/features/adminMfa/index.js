/**
 * Public surface of admin TOTP enrolment — `/admin/security/mfa-setup`, the
 * full-screen page an administrator must complete before any `/admin/*` route
 * will render for them.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin, slice 3).
 *
 * **This front door is deliberately empty.** The page is reached by the
 * `lazy(() => import(…))` mount in App.jsx under the route-mount exception,
 * and nothing else imports it.
 *
 * ── Nothing travelled with it, and that is the finding ──────────────────
 *
 * A util travels when the feature is its only consumer, and neither is:
 *
 *   - `src/services/adminMfa.js` — also `auth/Login.jsx` and
 *     `auth/MfaChallenge.jsx`. Enrolment and challenge are two ends of one
 *     protocol, so the service is genuinely shared and belongs at the shared
 *     level. That also keeps §14.2 satisfied without a `services/` folder
 *     here: the feature's Firebase access already goes through one module,
 *     it just is not one this feature owns.
 *   - `src/utils/mfaErrors.js` — also `Login`, `MfaChallenge` and
 *     `accountReauth`.
 *
 * `AdminMfaGate` (`components/layout/`) and its private `utils/adminMfaAccess`
 * stay too. The gate is route infrastructure that decides whether ANY admin
 * route renders — it sits beside `ProtectedRoute` and `LearnerOnlyRoute`,
 * wraps this page's siblings rather than this page, and is deliberately not
 * applied to the enrolment route itself (an unenrolled admin has to be able to
 * reach it). Pulling it in here would put a router guard inside the feature it
 * guards the way past.
 *
 * ── No test was added, deliberately ─────────────────────────────────────
 *
 * The two slices before this one extracted pure logic and pinned it on the way
 * out. Nothing is extracted here: it is one component over shared services
 * that already carry their own suites (`MfaChallenge.spec.jsx`,
 * `Login.spec.jsx`, `AdminMfaGate.spec.jsx`, `test:admin-mfa`). A test written
 * to make the PR look symmetrical would cover the move, not the behaviour.
 */

export {}
