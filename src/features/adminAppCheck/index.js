/**
 * Public surface of the App Check readiness dashboard — `/admin/app-check`,
 * the page that decides whether `APPCHECK_ENFORCE=1` is safe to flip.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, admin, slice 2),
 * following docs/MIGRATION_TEMPLATE.md.
 *
 * **This front door is deliberately empty.** The page is reached by the
 * `lazy(() => import(…))` mount in App.jsx under the route-mount exception,
 * and nothing else imports it.
 *
 * ── `src/utils/appCheckHealth.js` travelled with it ─────────────────────
 *
 * The rule is that a util travels when the feature is its only consumer, and
 * this one had exactly one: this page. It is now split in two, because it did
 * two jobs — `lib/appCheckHealthCore.js` decides what the counters MEAN
 * (`summarise`, `enforcementReadiness`, `classifyDeviceAttestation`) and
 * `services/appCheckHealthService.js` is the only thing that reads Firestore
 * (§14.2). The name `appCheckHealth` survives server-side as
 * `functions/appCheckHealthCore.js`, which is the WRITER — a separate module
 * with its own tests, untouched here.
 *
 * ── Outside the freeze ──────────────────────────────────────────────────
 *
 * Reads `appCheckHealth/{date}` and calls `appCheckPing`. It touches no past
 * paper, quiz, game or assessment surface, and neither does anything it
 * imports — the same dependency test that keeps `AdminCsvImport` inside the
 * freeze for calling `createQuiz` two hops down.
 */

export {}
