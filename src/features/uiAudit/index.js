/**
 * Public surface of the UI audit — `/dev/ui`, the internal page that renders
 * every shared component in every state so a design change can be looked at
 * rather than reasoned about.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * **This front door is deliberately empty.** `UiAuditPage` is reached by the
 * `lazy(() => import(…))` mount in App.jsx (behind `ProtectedRoute` + admin +
 * `AdminMfaGate`) and nothing else in the tree imports any of this.
 *
 * ── Same depth, different root: why the imports were re-derived ─────────
 *
 * `components/dev/uiAudit/sections/X.jsx` and
 * `features/uiAudit/components/sections/X.jsx` are both four directories under
 * `src/`, so every `../../../` specifier still RESOLVES — to a different place.
 * `'../../../ui/Button'` meant `src/components/ui/Button` and would now mean
 * `src/features/ui/Button`. A regex depth-bump cannot see that, because
 * nothing about the string is wrong; it is the root that moved. Every
 * specifier here was therefore resolved against its old location and
 * re-expressed from the new one, then checked to exist on disk.
 *
 * ── Three couplings no import resolver can see ─────────────────────────
 *
 *   - `UiAuditPage` imports `uiAudit.css`, which now lives in `styles/`.
 *   - `lib/forcedStates.test.js` reads that stylesheet by HARDCODED
 *     repo-relative string, to assert it repeats `index.css`'s focus ring
 *     exactly. Moving the file breaks that with a file-read error at run time,
 *     not a build error.
 *   - `test:ui-audit-tokens`, `test:ui-audit-forced-states` and
 *     `test:ui-audit-icons` name the old paths in `package.json`.
 *
 * All three are updated in the same commit, and the three suites pass from
 * their new home (23 + 11 + 4 assertions).
 *
 * ── `components/dev/` is removed ────────────────────────────────────────
 *
 * `uiAudit/` was its only occupant, so the directory goes with it.
 */

export {}
