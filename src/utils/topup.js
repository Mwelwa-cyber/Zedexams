// Singleton bus for the pay-per-generation top-up checkout, mirroring
// engines/payment-engine/paywall.js. Any module can call `topup.show({ feature })` to open the
// K25 "one extra generation" modal; PaywallHost mounts the listener once and
// renders <TopUpModal />. Kept separate from the paywall bus so the top-up can
// be opened on its own (e.g. straight from the dashboard usage banner) without
// first routing through an upgrade-comparison scenario.

const listeners = new Set()
let currentState = null

export const topup = {
  show(ctx = {}) {
    currentState = { ctx }
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
}
