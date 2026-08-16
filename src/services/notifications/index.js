/**
 * Notification transport — FCM token registration and the native push bridge.
 *
 * The first of the seven service areas §12 names (`firebase/ firestore/
 * storage/ ai/ payments/ analytics/ notifications/`) to exist as a directory.
 * It was created 2026-08-16 by the notification-engine migration rather than
 * as a scaffolding exercise, which is why it holds two real modules and not an
 * empty marker.
 *
 * `fcm.js` — web push: permission, `getToken`, token write, foreground
 * handler. `nativePush.js` — the Capacitor path it delegates to on Android,
 * where the web messaging SDK does not work.
 *
 * **Why these are services and not the engine that owns the feature.** Both
 * import `firebase/messaging` and `firebase/firestore` directly, and an engine
 * may not touch the Firebase SDK — that rule is what keeps an engine testable
 * without it. §12's own answer is that engines reach Firebase through this
 * layer, so `src/engines/notification-engine/` holds the preference logic and
 * calls in here for transport. The split is the architecture's, not an
 * accommodation.
 *
 * Direction to preserve: this layer may be called by `app/`, `features/`,
 * `engines/` and the legacy tree, and may itself read `src/firebase/` and
 * `src/utils/`. It must never import from `app/`, `features/`, `engines/` or
 * `curriculum/` — a service reaching upward is what makes it un-reusable, and
 * `test:import-boundaries` fails the build on it.
 *
 * A namespace marker, not a barrel — import the file, not this index.
 */

export {}
