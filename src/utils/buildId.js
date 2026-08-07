/**
 * Which BUILD of the app shell is running — the short commit sha stamped by
 * deploy-hosting.yml, or 'dev' anywhere no deploy stamped one (local dev,
 * tests, the smoke build).
 *
 * Why telemetry needs this: flag changes travel over the live Firestore
 * settings subscription (~1s to every client, shell age irrelevant), but CODE
 * travels in the bundle, and an already-open tab keeps its old shell until
 * the service worker turns over. During a rollout hold the fleet is therefore
 * a MIX of shells all obeying the same flag — and an event stream that cannot
 * say which shell produced each row makes that mix look like nondeterminism.
 * Stamping the build makes it legible instead.
 */
export const BUILD_ID = (import.meta.env.VITE_BUILD_SHA || 'dev').slice(0, 8)
