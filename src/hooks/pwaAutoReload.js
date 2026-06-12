// src/hooks/pwaAutoReload.js
//
// Pure decision helper for "apply a pending PWA update on the next in-app
// navigation". Kept dependency-free (no React, no DOM) so it can be unit-tested
// under plain node and reasoned about in isolation.
//
// Why navigation, not an immediate reload: a hard reload the instant a new
// service worker activates can interrupt an in-flight operation (e.g. a
// document-quiz/notes import that runs for 15-30 s). A route change is a safe
// teardown point — the current screen is being unmounted anyway, so reloading
// then loses no state and never interrupts a long-running op (those don't
// navigate). The "New version available" toast remains as a fallback for users
// who sit on a single screen.
//
// State machine (called once per effect run, on [updateReady, location]):
//   • no update pending            → disarm,    don't reload
//   • update pending, not armed    → ARM here,  don't reload (this is the
//                                    location where the update became ready)
//   • update pending, already armed→ stay armed, RELOAD (a navigation happened
//                                    after arming)

/**
 * @param {{ armed: boolean, updateReady: boolean }} state
 * @returns {{ armed: boolean, reload: boolean }}
 */
export function pwaReloadOnNavigate({ armed, updateReady }) {
  if (!updateReady) return { armed: false, reload: false }
  if (!armed) return { armed: true, reload: false }
  return { armed: true, reload: true }
}
