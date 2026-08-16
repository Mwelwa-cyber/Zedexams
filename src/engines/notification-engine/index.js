/**
 * Notification Engine — the client half of in-app notifications, FCM
 * registration and announcement display (docs/architecture.md §7, §12).
 *
 * Quiet hours are Lusaka time and dead-token pruning is server-side; this
 * engine renders and subscribes, it does not schedule.
 *
 * Filled 2026-08-16 with `notificationPrefs.js` — and the more useful half of
 * this note is what did NOT come with it, because the answer shaped where the
 * rest went.
 *
 * §12 names "FCM registration" as this engine's job, and the two modules that
 * do that — `fcm.js` and `nativePush.js` — cannot live here. Both import
 * `firebase/messaging` and `firebase/firestore` directly, and
 * `src/engines/**` may not touch the Firebase SDK (`NO_FIREBASE_LAYERS` in
 * `scripts/test-import-boundaries.mjs`, which catches the dynamic
 * `await import('firebase/…')` form that ESLint does not see).
 *
 * That is not a contradiction in the target, it is the target working: §12 also
 * says engines reach Firebase **through `src/services/`**, and it names a
 * `notifications/` area there. So the pair went to
 * `src/services/notifications/` on the same commit, which is the destination
 * the architecture already specified rather than a workaround invented for
 * this migration. What is left here is the part that was always engine-shaped:
 * preference logic over a plain object, with no I/O.
 *
 * The consequence worth keeping: an engine module in this directory may call
 * into `src/services/notifications/`, but must not grow a Firebase import of
 * its own. The moment it needs one, the code belongs in the service and the
 * engine should consume it.
 *
 * A namespace marker, not a barrel — import the file, not this index.
 */

export {}
