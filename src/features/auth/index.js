/**
 * Public surface of authentication — sign-in, registration, the email-action
 * and verification screens, the TOTP challenge, passkeys, and the guardian
 * consent + age-gate flow.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * ── What deliberately did NOT come here: routing and session chrome ─────
 *
 * `LearnerOnlyRoute`, `MissingProfileRecovery`, `SessionRestorationLoader`
 * and `SessionRestorationScreen` (with its 403-line stylesheet) moved to
 * `components/layout/` instead, beside `ProtectedRoute` and `AdminMfaGate`.
 * They decide whether a route renders at all; they are not the feature the
 * route leads to. That is the same call `adminMfa` made about `AdminMfaGate`,
 * applied consistently.
 *
 * The Loader and the Screen went together on purpose, even though the Screen
 * is purely presentational and looks like feature code. Splitting them would
 * make `ProtectedRoute` — which `App.jsx` imports EAGERLY — import this front
 * door, and importing any name from a feature evaluates every module its index
 * re-exports. That would put `PasskeySection` and, through it,
 * `@simplewebauthn/browser` in the main bundle for every visitor including
 * signed-out ones. The pair has exactly one consumer, so keeping them together
 * costs nothing and closes that path.
 *
 * ── Four exports, all reached from lazily-loaded surfaces ───────────────
 *
 *   - `PasskeySection`      — `settings/zedexams-settings`, and the Security
 *                             panels of `learnerSettings` and `teacherSettings`
 *   - `OtpInput`            — `features/adminMfa`'s enrolment page
 *   - `GoogleSignInButton`  — the same page, for re-authentication
 *   - `GuardianConsentBanner` — `learnerDashboard`'s StudentDashboard
 *
 * Every one of those consumers is behind a `lazy()` route, so the front door
 * is never evaluated in the main bundle. `MfaChallenge` is NOT exported —
 * `Login` is its only consumer, and it stays internal.
 *
 * The four pages are route-mounted under the Phase 1 exception and are not
 * exported either; `Register` alone is 876 lines.
 */

export { default as PasskeySection } from './components/passkeys/PasskeySection'
export { default as OtpInput } from './components/OtpInput'
export { default as GoogleSignInButton } from './components/GoogleSignInButton'
export { default as GuardianConsentBanner } from './components/GuardianConsentBanner'
