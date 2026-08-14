/**
 * Public surface of Platform Notices — the two banners in which the platform
 * tells every user something about its own state: maintenance mode, and (on
 * Android only) that a newer APK exists.
 *
 * Migrated from `src/components/banners/` under docs/architecture.md Phase 4,
 * following docs/MIGRATION_TEMPLATE.md. A move: same banners, same conditions,
 * same place in the shell.
 *
 * Both names are exported, because `App.jsx` mounts both above the router and
 * nothing else consumes either.
 *
 * ── Why not `announcements`, which is the same shape ────────────────────
 *
 * `features/announcements` is also a banner an admin controls, also mounted by
 * `App.jsx`, also above the router. The reason these are not lodgers there is
 * the rule that feature's own index states: the writer and the reader belong
 * together because **they share a vocabulary and are the only two places that
 * know it**. Announcements owns the `announcements` collection and its
 * audience/severity words. These two read `settings/global` through
 * `PlatformSettingsContext` — a different document, a different vocabulary
 * (`maintenanceMode`, `maintenanceMessage`, the Android `versionCode` and
 * download URL), and no overlap with an announcement at all.
 *
 * Filing them under a feature that reads a different collection because both
 * happen to render a coloured strip is precisely the "proximity is not
 * cohesion" mistake, one layer up from the directory that made it.
 *
 * ── Why not `adminSettings`, which DOES own the vocabulary ──────────────
 *
 * This is the closer call, and it was decided on chunk cost rather than on
 * subject. `features/adminSettings` is the Platform Control Center that WRITES
 * `settings/global`, so the writer/reader argument above genuinely points
 * there. But importing any name from a feature evaluates every module its
 * index re-exports, and `App.jsx` mounts `MaintenanceBanner` **eagerly, above
 * the router, on the public landing page** — so reaching these two through
 * `adminSettings` would put the admin control center in the main bundle for
 * every anonymous visitor. That is the cost `features/zedChat` measured and
 * `features/announcements` records for its own page.
 *
 * The pairing is real and unmet; the bundle is the reason. If `adminSettings`
 * ever splits its `settings/global` schema out of its page, these two should
 * read it from there.
 *
 * ── §14.6: neither is a shared component ────────────────────────────────
 *
 * Measured on the closure, not the name. `MaintenanceBanner` reaches
 * `AuthContext` (26 modules, including payment logic through the auth graph);
 * `AndroidUpdateBanner` reaches `firebase/config` via `PlatformSettingsContext`.
 * `shared` is in `NO_FIREBASE_LAYERS`, so promoting either is a hard boundary
 * failure rather than a matter of taste — the same test that kept
 * `VisitorTracker` and `CookieConsentBanner` out of `src/shared/components/`.
 */

export { default as MaintenanceBanner } from './components/MaintenanceBanner'
export { default as AndroidUpdateBanner } from './components/AndroidUpdateBanner'
