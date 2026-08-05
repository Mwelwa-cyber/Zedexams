/**
 * The provider stack — target home for `src/contexts/` (AuthContext,
 * ThemeContext, DataSaverContext, NotificationContext,
 * PlatformSettingsContext) composed behind a single `AppProviders` mounted in
 * `main.jsx`.
 *
 * Empty until Phase 4. One provider does NOT move here: `OfflineContext` stays
 * exported from `src/offline/`, which owns the IndexedDB stack it wraps
 * (docs/architecture.md §12).
 */

export {}
