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
 * Filled 2026-08-16 from `src/utils/`, with the five modules that answer
 * "what is this account allowed to do":
 *
 *   • `teacherPlans.js`      — the plan registry the other four resolve against
 *   • `subscriptionConfig.js`— plan definitions, entitlements, PLANS
 *   • `subscriptionStatus.js`— an account's live standing against its plan
 *   • `subscriptionUpgrade.js`— which upgrade a given standing may take
 *   • `paywall.js`           — the gate the studios and the quiz limit consult
 *
 * **Why these five and no others.** Two rules decided it, and both were
 * measured rather than assumed:
 *
 *   1. `src/engines/**` may not import the Firebase SDK — an engine that needs
 *      the SDK is untestable without it, which is the whole reason the layer
 *      exists. All five were checked and none has a Firebase import; they are
 *      pure functions over a subscription object someone else fetched. That is
 *      what keeps the read/gate split above honest: this engine cannot write an
 *      entitlement because it cannot reach the database to write one.
 *   2. Nothing under `src/shared/`, `src/config/` or `src/curriculum/` may
 *      import an engine. Every one of the ~60 references to these five sits in
 *      `app/`, `features/`, `hooks/`, `contexts/` or `utils/` — all layers
 *      permitted to consume an engine — so this move broke no consumer. That
 *      check is the one that stopped eight curriculum modules migrating on the
 *      same day; see `src/curriculum/resolvers/index.js`.
 *
 * `permissions.js` did NOT come along and deliberately so: `isSuperAdmin` is a
 * role predicate the whole app reads, not a payment concept, and it has no
 * imports of its own. It stays in `src/utils/` and this engine reaches down to
 * it — the permitted direction.
 *
 * A namespace marker, not a barrel — import the file, not this index. That
 * matters more here than elsewhere: `PaywallHost`, `PremiumGate`,
 * `RenewalBanner` and `SubscriptionStatusBanner` are already the subject of a
 * recorded chunk-weight decision (`src/components/subscription/UpgradeModal.jsx`),
 * and a barrel here would pull the whole plan registry into any chunk that
 * wanted one predicate.
 */

export {}
