/**
 * Payment / Entitlement Engine — the client half: entitlement checks, usage
 * gates, the paywall host (docs/architecture.md §9, §12).
 *
 * Client-side only, and the boundary is the point: entitlements are written
 * server-side exclusively, pricing is server-authoritative from
 * `functions/plans.js`, and every activation path converges on
 * `activateSubscriptionFromPayment`. Nothing here may grant an entitlement —
 * it reads and gates.
 *
 * Empty until Phase 4.
 */

export {}
