/**
 * Notifications — public API (docs/architecture.md §3, §14.7).
 *
 * The in-app notification surface: the bell that sits in a header with its
 * unread count, and the centre it opens (list, search, mark-read, delete).
 *
 * ## A feature, not a `src/shared/` promotion
 *
 * These two look like chrome — a bell in a header — and the three promotions
 * before this one moved exactly that shape into `src/shared/components/`.
 * The closure is what decides it: both reach `AuthContext` and
 * `NotificationContext`, and through them `firebase/firestore`,
 * `firebase/messaging` and five more SDK entry points. `shared` is in
 * `NO_FIREBASE_LAYERS`, so promoting either is a hard boundary failure rather
 * than a matter of taste. It also owns a collection, which is what a feature
 * is for.
 *
 * ## Both names are exported, and that costs nothing
 *
 * Four consumers, each drawing one of the two:
 *
 *   • `components/layout/Navbar.jsx` — the bell (legacy → feature)
 *   • `features/dashboardV2`, `features/learnerHome`, `features/teacherShell`
 *     — the centre, each in its own header (cross-feature)
 *
 * All four are legal only through this door, which is why it exports both
 * rather than one. It adds no edge to the import graph either:
 * `NotificationBell` already imports `NotificationCenter`, so a consumer
 * opening this door for the centre was pulling the bell's closure anyway.
 *
 * ## `NotificationContext` deliberately stays in `src/contexts/`
 *
 * It has twenty consumers including `main.jsx`, and §2 moves `src/contexts/`
 * to `src/app/providers/` in Phase 4 — `FORBIDDEN_TARGETS.features` includes
 * `app` with no front-door exemption. Pulling the provider in here would plant
 * an edge that an already-decided migration turns into a hard failure, which
 * is the `useRecentStudios` ruling of 2026-08-13 applied unchanged.
 *
 * `src/utils/notificationPrefs.js` stays for the ordinary reason: its
 * consumers are the settings page and `teacherSettings`' panel, neither of
 * which is this feature.
 */

export { default as NotificationBell } from './components/NotificationBell'
export { default as NotificationCenter } from './components/NotificationCenter'
