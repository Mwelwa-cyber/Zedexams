# Google Play Billing — Android subscriptions

> Snapshot as of 2026-07-05 — verify before acting.

The Android (Capacitor) app sells digital subscriptions through **Google Play
Billing only** (Play policy). The website keeps the Lenco mobile-money flow
unchanged — the two meet at the same Firestore `users/{uid}` fields, so one
account is premium regardless of where it paid.

## How it fits together

```
Android app (@capgo/native-purchases, Play Billing 7.x)
  purchase / restore-on-open
    → purchaseToken → callable verifyGooglePlayPurchase (us-central1)
        → Google Play Developer API (purchases.subscriptionsv2.get)
        → payments/{gp_<sha256(token|expiry)>} doc (provider: "google_play")
        → activateSubscriptionFromPayment (SAME chokepoint as Lenco)
            → users/{uid}: premium flags + subscriptionExpiry = Google's expiryTime
        → v1 acknowledge (purchases must be acked ≤3 days or Google refunds)
```

- **Client seam:** `src/components/subscription/UpgradeModal.jsx` is a platform
  dispatcher — web renders the untouched Lenco checkout, native renders
  `PlayUpgradePanel.jsx`. Plugin calls live only in `src/utils/playBilling.js`.
- **Catalog:** `src/utils/playBillingCatalog.js` ↔
  `functions/googlePlayBillingCore.js` (exact inverses, enforced by
  `npm run test:play-catalog-mirror`).
- **Renewals/downgrades:** entitlement is read-time (`subscriptionExpiry > now`).
  Restore-on-open (`NativePlayBillingSync` → `verifyGooglePlayPurchase`)
  re-pins the expiry on every renewal; when Google reports the sub
  expired/revoked AND the user is Play-managed by that exact token, the past
  expiry is written and access lapses. A Lenco/web subscription can never be
  downgraded from the Android path (`decideEntitlementUpdate` guards).
- The app purchases with `autoAcknowledgePurchases: false`; the server
  acknowledges after verification. If verification never succeeds within 3
  days, Google refunds automatically — the correct failure mode.

## Account binding (issue #1596)

Each purchase is bound to the buyer's ZedExams `uid` so a leaked/stolen
purchase token can't be claimed by another account:

- **Client:** `purchasePlaySubscription(planId, uid)` passes the uid as
  `appAccountToken` (→ Google Play's `ObfuscatedAccountId` on Android, via
  `@capgo/native-purchases`). The uid is an opaque, non-PII Firebase token
  under Play's 64-char cap, so it's bound verbatim —
  `obfuscatedAccountIdForUid()` (mirrored in `playBillingCatalog.js` ↔
  `googlePlayBillingCore.js`) returns `''` (binding skipped) only for a uid
  over the cap, which Firebase Auth uids (28 chars) never hit.
- **Server:** `parseSubscriptionV2` reads it back from
  `externalAccountIdentifiers.obfuscatedExternalAccountId`;
  `evaluateAccountBinding` compares it to the authenticated caller's derived
  id (`request.auth.uid`, never client-supplied).
- **Rollout (graduated, like App Check):** observe-only by default — every
  purchase's outcome (match / absent / mismatch) is counted in
  `playBindingHealth/{YYYY-MM-DD}` but nothing is rejected. Set
  `PLAY_ENFORCE_ACCOUNT_BINDING=1` on the Functions deploy to hard-reject a
  **present-but-mismatched** id (`{status: "account_mismatch"}`) once the
  counters show new purchases reliably carry a matching id. **Absent** ids
  (legacy / pre-update clients) are never rejected, so old tokens and
  in-flight purchases keep working through the transition.

## Play Console setup (owner runbook, in order)

1. **Fund the secret BEFORE merging this code** — a bound `defineSecret` with
   no Secret Manager value hard-fails every CI functions deploy
   (see `functions/deadProviderSecrets.test.js`):
   ```bash
   firebase functions:secrets:set GOOGLE_PLAY_SA_JSON --project examsprepzambia
   # paste the FULL service-account JSON file as the value
   ```
   Service account: Play Console ▸ Users and permissions ▸ invite the SA from
   the linked Cloud project with **View financial data** + **Manage orders**
   permissions, and enable the *Google Play Android Developer API* on that
   Cloud project. (This is a runtime secret — separate from the
   `PLAY_SERVICE_ACCOUNT_JSON` GitHub secret CI uses for AAB upload, though
   the same SA JSON can serve both if given both permission sets.)
2. **Upload an AAB with billing** to the *internal testing* track first —
   Play Console won't let you create in-app products until an artifact with
   the `com.android.vending.BILLING` permission exists. Build via
   `android-play-release.yml` (workflow_dispatch; defaults are
   `upload_to_play=false`, `track=alpha`, `release_status=draft` — set
   `upload_to_play=true`, `track=internal`) or tag `v1.3.0`.
3. **Create the 6 subscriptions** (Monetise ▸ Subscriptions), one base plan
   each, auto-renewing, ZMW prices to match the web:

   | Product ID | Base plan ID | Mirrors web plan |
   |---|---|---|
   | `learner_premium_weekly` | `weekly` | weekly (K15/7d) |
   | `learner_premium_monthly` | `monthly` | monthly (K50/30d) |
   | `teacher_pro_monthly` | `monthly` | pro_monthly (K59/30d) |
   | `teacher_pro_yearly` | `yearly` | pro_yearly (K590/365d) |
   | `teacher_max_monthly` | `monthly` | max_monthly (K149/30d) |
   | `teacher_max_yearly` | `yearly` | max_yearly (K1490/365d) |

   Product/base-plan IDs must match the catalog files exactly — activate each
   product after saving.
4. **Licence testers** — Play Console ▸ Settings ▸ Licence testing: add tester
   Gmail accounts (test purchases are free, renew on an accelerated clock).
5. **Closed-testing device pass** (cannot be verified without a device):
   - Buy weekly with a licence tester → `users/{uid}` flips
     (`subscriptionProvider: "google_play"`, expiry = Google's) and a
     `payments/gp_*` doc appears.
   - Kill + reopen the app → no duplicate payment/invoice (idempotent).
   - Cancel in the Play Store → access continues to period end, then lapses
     on the next open after expiry.
   - A web (Lenco) subscribed account on the same device must never be
     downgraded.
   - "Manage Google Play Subscription" (My Subscription / teacher settings)
     opens Play's management screen.
6. **Sanity-check the backend without a device:** call
   `verifyGooglePlayPurchase` with a garbage token — expect a
   `results[0].status === "not_found"` response, which proves the secret +
   SA + API wiring end to end.

## Test surface

`npm run test:google-play-core`, `test:google-play-verify`,
`test:activation-provider`, `test:play-catalog-mirror` (all in `test:all`),
plus vitest specs `PlayUpgradePanel.spec.jsx`, `UpgradeModal.native.spec.jsx`,
and the native blocks in `PaywallHost.spec.jsx` / `MySubscriptionPage.spec.jsx`
(web-regression locks included).

## Known v1 limits / follow-ups

- **No RTDN webhook yet** — renewals/cancellations/refunds land on the next
  app open (restore-on-open), not in real time. Follow-up: Pub/Sub
  Real-time Developer Notifications → the same verify path.
- **No K25 top-up on Android** — it's a Lenco one-off; top-up CTAs route to
  the Play subscription upgrade. Follow-up: a consumable Play product.
- **No native Pro→Max plan change/proration** — an actively subscribed user
  gets a "managed" panel; plan changes happen at renewal or on web (for
  web-billed users). Follow-up: Play upgrade/downgrade flows (`oldToken`
  replacement).
- **Grade packs / single-subject have no Play products** — their Android CTAs
  fall back to learner weekly/monthly.
- **Till ignores `google_play` payments** by design (provider guard); a
  stranded pending Play doc self-heals on the next verify/restore of the
  same token+expiry.
- Play `payments` docs store the **ZMW list price for dashboards only** —
  Google is authoritative on money actually collected.
