# 08 — Payments & Entitlements

> Snapshot as of 2026-07-19. Layer 9. Finding IDs: `PAY-*`.

## Verdict

**A hostile client CANNOT mark itself paid or alter the charged amount on either rail.**
The amount is server-authoritative on both Lenco and Google Play, the
payment/subscription/entitlement documents are server-write-only in Firestore rules,
and both rails funnel through one idempotent activation chokepoint
(`subscriptionActivation.js`). Entitlement is enforced **server-side** before AI
generation and at Firestore read-time for premium content. This layer is a
**strength**. Residual risks are secondary.

## Evidence of correctness

- **Server-set amount (Lenco):** plan resolved from `getPlan(planId)`; `amount` set from
  `plan.priceZMW` / prorated upgrade quote server-side (`functions/index.js:3226,3258`;
  `subscriptionUpgrade.js:96`). Client `expectedAmountZMW` is a *display* check only
  (`paymentInitiationCore.js:105`) — the server amount is charged regardless.
- **Server-set amount (Play):** price enforced by Google Play Console;
  `amountZMW: plan.priceZMW` is "list price for dashboards only — Google is authoritative"
  (`googlePlayBilling.js:424-427`); productId→plan map is server-side
  (`googlePlayBillingCore.js:19`).
- **Webhook HMAC (Lenco):** SHA-512 over `req.rawBody`, timing-safe, **fail-closed** 401
  (`index.js:3735-3742`, `lencoService.js:253-266`).
- **Collected-amount verification:** `checkCollectedAmount` blocks activation on
  under-collection/currency mismatch, parks as `amount_mismatch`, pages admin
  (`subscriptionActivation.js:51`).
- **Idempotent activation:** status-guarded transaction — replayed webhook / duplicate
  settlement no-ops (`subscriptionActivation.js:115`); shared by webhook + OTP + status-poll
  + Till reconcile + manual recovery.
- **Play token verified server-side** against `purchases.subscriptionsv2.get`
  (`googlePlayBilling.js:325,162`); deterministic receipt doc `payments/gp_<hash>`
  (`Core.js:89`); cross-account replay blocked (`wrong_user`, `:406-442`); restore handling
  (`index.js:3649-3659`).
- **Reconcile cron (Till):** hourly `hourlyRevenueReconcile` re-queries Lenco for stale
  `pending` docs within a 3-day window via the idempotent path (`agents/runners/till.js:174-195`).
- **No client self-grant:** `users` create pins + update blocklists every entitlement field
  (`firestore.rules:299-403`); `payments`/`invoices`/`subscriptionEvents`/`usageMeters` are
  server-write-only.
- **Server-side entitlement gate:** every teacher generator calls `assertVerifiedAuth` +
  `assertAndIncrement(uid, tool)` before the AI call; plan read from `users.teacherPlan` with
  expiry (`usageMeter.js:71-79`). Premium learner content gated at read-time with unexpired
  `subscriptionExpiry` (`firestore.rules:149-166`).

## Findings

### PAY-001 — Google Play account-binding is observe-only by default
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `functions/googlePlayBilling.js:283`, `googlePlayBillingCore.js:68`
- **Current:** `evaluateAccountBinding` (obfuscated-account-id) is enforced only when
  `PLAY_ENFORCE_ACCOUNT_BINDING === "1"`, which is not set; `absent` ids are never rejected.
  The cross-account guard only triggers once a `gp_*` doc exists.
- **Exploit:** an attacker who obtains another user's **unredeemed** purchase token (before the
  legitimate owner verifies it) could bind it to their own account first. Requires stealing a
  fresh valid token — not trivial at scale. Known issue #1596, mid-rollout.
- **Correction:** set `PLAY_ENFORCE_ACCOUNT_BINDING=1` after confirming legitimate clients send
  the obfuscated account id. **Launch blocker:** No (Android). **Complexity:** Low (config + client verify).

### PAY-002 — Card collection proxies raw PAN/CVV through the function (PCI scope)
- **Severity:** Medium (currently inert) · **Confidence:** High confidence
- **Affected:** `functions/lencoService.js:170-176`; disabled at `index.js:3219`
- **Current:** `initiateCardCollection` would proxy raw card data through the Cloud Function,
  pulling it into PCI-DSS scope. Card checkout is currently **disabled** (throws
  `failed-precondition`), so the path is dormant.
- **Risk:** If re-enabled without a tokenized/hosted-fields flow, the backend enters PCI scope.
- **Correction:** if cards are wanted, use Lenco hosted fields / tokenization; never transit raw
  PAN. **Launch blocker:** No (disabled). Flag before any card re-enable.

### PAY-003 — Lenco collected-amount check skipped when provider omits `data.amount`
- **Severity:** Low · **Confidence:** High confidence
- **Affected:** `functions/subscriptionActivation.js:54`
- **Current:** when `collectedAmount` is absent/≤0 the check returns `{ok:true, checked:false}`
  and activation proceeds with no collected-amount verification. Defense-in-depth gap only — the
  charged amount was server-set at initiation and Lenco enforces its own collection.
- **Correction:** treat a missing amount on a `successful` event as suspicious (log + reconcile),
  or require the amount before granting. **Launch blocker:** No.

### PAY-004 — No single append-only per-transition payment ledger
- **Severity:** Informational · **Confidence:** Moderate confidence
- **Affected:** `payments` docs (field overwrite), `subscriptionEvents`, `invoices`
- **Current:** state transitions are traceable via `payments` fields + `subscriptionEvents` +
  ops alerts, but failed→success retries overwrite fields rather than appending an immutable
  ledger row. Adequate for reconciliation; not a forensic-grade audit trail.
- **Correction:** consider an append-only `paymentEvents` log for every transition. **Blocker:** No.

### PAY-005 — No documented sandbox/production separation for either rail
- **Severity:** Informational · **Confidence:** Moderate confidence
- **Current:** Lenco has a `LENCO_API_BASE` override but no committed sandbox config; Play uses
  license-tester accounts in the same package (standard). Since there is a single Firebase
  project (see [`13`](./13-cicd-and-release.md) CICD-004), payment testing shares the production
  data plane. **Correction:** document the sandbox path; ideally a staging project. **Blocker:** No.

## Cross-references
- Entitlement rules: [`04-security-and-access-control.md`](./04-security-and-access-control.md).
- Server usage metering + budget: [`07-ai-readiness.md`](./07-ai-readiness.md).
