// Singleton bus for the "this is a Pro feature" modal, mirroring engines/payment-engine/paywall.js.
// Any component can call lockedFeature.show({ feature, audience }) to prompt an
// upgrade without prop-drilling. LockedFeatureModal mounts once at the root and
// subscribes. Kept separate from the teacher-studio paywall bus so the learner
// and teacher reminder copy can diverge cleanly.

const listeners = new Set()
let currentState = null

export const lockedFeature = {
  /**
   * @param {object} [ctx]
   * @param {string} [ctx.feature] human name of the locked feature (e.g. "Exam mode")
   * @param {'learner'|'teacher'} [ctx.audience] override the audience (defaults to role)
   */
  show(ctx = {}) {
    currentState = { feature: ctx.feature || null, audience: ctx.audience || null }
    listeners.forEach((fn) => fn(currentState))
  },
  hide() {
    currentState = null
    listeners.forEach((fn) => fn(null))
  },
  subscribe(fn) {
    listeners.add(fn)
    fn(currentState)
    return () => listeners.delete(fn)
  },
  // Synchronous read for surfaces that must not stack on top of an open
  // locked-feature modal (e.g. the Welcome-Back popup defers while it shows).
  isActive() {
    return currentState !== null
  },
}
