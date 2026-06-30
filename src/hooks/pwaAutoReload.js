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
// `busy` guards against reloading while a critical operation is in flight (e.g.
// a teacher lesson-plan generation that streams for up to ~2 minutes and lives
// only in React state). The original assumption above — "long-running ops don't
// navigate, so they're safe" — was wrong: a teacher mid-generation can navigate,
// and the reload wiped the in-progress plan ("it refreshed on its own and
// started over"). While busy we DISARM and never reload, so a navigation during
// the op is harmless. Once busy clears we re-arm on the next run, and the update
// still lands on the following navigation — users always reach the new build.
//
// State machine (called once per effect run, on [updateReady, location, busy]):
//   • no update pending            → disarm,    don't reload
//   • update pending, busy         → disarm,    don't reload (op in flight)
//   • update pending, not armed    → ARM here,  don't reload (this is the
//                                    location where the update became ready)
//   • update pending, already armed→ stay armed, RELOAD (a navigation happened
//                                    after arming)

/**
 * @param {{ armed: boolean, updateReady: boolean, busy?: boolean }} state
 * @returns {{ armed: boolean, reload: boolean }}
 */
export function pwaReloadOnNavigate({ armed, updateReady, busy = false }) {
  if (!updateReady) return { armed: false, reload: false }
  if (busy) return { armed: false, reload: false }
  if (!armed) return { armed: true, reload: false }
  return { armed: true, reload: true }
}
