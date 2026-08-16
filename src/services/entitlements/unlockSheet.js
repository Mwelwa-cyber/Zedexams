/**
 * unlockSheet — the bus the contextual sheet listens on.
 *
 * Same shape as the existing `engines/payment-engine/paywall` bus, deliberately: a singleton a
 * lock badge anywhere in the tree can call without prop-drilling, with one
 * host mounted at the root. It carries the ROUTE decision (guardian vs
 * checkout) alongside the gate, so the host never re-derives it — the decision
 * is made once, in `resolveUnlockRoute`, where it is tested.
 */

const listeners = new Set()
let current = null

export const unlockSheet = {
  /**
   * @param {object} request
   * @param {string} request.gate     a gate id from the registry
   * @param {'guardian'|'checkout'} request.route
   * @param {object} [request.context] interpolation values + analytics props
   */
  open(request) {
    current = request || null
    listeners.forEach((fn) => fn(current))
  },
  close() {
    current = null
    listeners.forEach((fn) => fn(null))
  },
  isActive() {
    return current !== null
  },
  subscribe(fn) {
    listeners.add(fn)
    fn(current)
    return () => listeners.delete(fn)
  },
}
