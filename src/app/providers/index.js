/**
 * The provider stack. `AppProviders.jsx` lives here and is mounted in
 * `main.jsx` — that is §12's named artifact for this area, and it landed
 * 2026-08-16.
 *
 * **The context modules themselves are NOT here, and this is a block rather
 * than a to-do.** §12 sends `AuthContext`, `ThemeContext`, `DataSaverContext`,
 * `NotificationContext` and `PlatformSettingsContext` into this directory.
 * They cannot come, for the same reason `../layouts/index.js` records for the
 * two layouts — and at far greater scale:
 *
 *   **294 files under `src/features/` import `src/contexts/`**, and a feature
 *   may not import `src/app/**`. That rule is error-level in
 *   `eslint.config.js` AND independently enforced by `FORBIDDEN_TARGETS` in
 *   `scripts/test-import-boundaries.mjs`, which consults no allowance list.
 *   Moving the contexts here converts 294 currently-legal imports into build
 *   failures at once.
 *
 * **And there is no second destination.** The obvious escape — put them in
 * `src/shared/`, which features may import — is closed: `AuthContext` and
 * `NotificationContext` use the Firebase SDK, and `src/shared/**` may not
 * touch it. So under the layering exactly as it stands, the contexts have
 * nowhere legal to go, which is precisely why they never moved.
 *
 * `AppProviders.jsx` is reachable only because nothing under `features/`
 * imports it: `main.jsx` is its sole consumer and the src root is the legacy
 * layer, which may import anything. Do not export it from a feature-facing
 * path, or this file becomes the 295th problem.
 *
 * **Resolving it is an owner decision with two shapes, and neither is a
 * migration commit.** Either the layering is amended so `features` may import
 * a narrow `app/providers` surface — which weakens the rule that keeps the app
 * shell mounting features rather than the reverse — or the contexts split into
 * a Firebase-free state layer that can live in `shared/` and a thin
 * app-layer provider that wires it, which is a refactor of five contexts and
 * their 294 consumers, not a move. Recorded here rather than attempted,
 * because choosing one silently is how a layering rule stops meaning anything.
 *
 * One provider does NOT move here under any resolution: `OfflineContext` stays
 * exported from `src/offline/`, which owns the IndexedDB stack it wraps
 * (docs/architecture.md §12).
 */

export {}
