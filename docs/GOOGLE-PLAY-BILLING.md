# Google Play Billing — Android subscriptions

> Snapshot as of 2026-07-09 — verify before acting.

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

3b. **Create the 2 one-time products** (Monetise ▸ In-app products), for the
   guardian passes. These are NOT subscriptions: they never renew, Play shows
   no manage screen for them, and the app says so.

   | Product ID | Type | Mirrors web plan |
   |---|---|---|
   | `learner_premium_day_pass` | One-time (managed) | day_pass (K5/1d) |
   | `learner_premium_term_pass` | One-time (managed) | term_pass (K120/120d) |

   **Price parity is the rule, and Play's ZMW tiers are where it breaks.**
   Play prices in fixed tiers, so a kwacha figure may not be selectable
   exactly. Pick the NEAREST tier and record any product where Android and
   web would quote different numbers — a parent comparing the two must not
   find a discrepancy nobody decided on. The K5 day pass is the one most
   likely to have no exact tier: check it first, and if it cannot land on
   K5, raise it before launch rather than shipping two prices for one
   product.
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
   SA + API wiring end to end. **Vigil now runs this probe hourly**
   (`checkPlayBilling` in `functions/agents/runners/monitor.js` →
   `googlePlayBilling.probePlayConfig`) and escalates a broken config as a
   critical failure, so a misconfiguration is caught within an hour instead
   of by a paying customer.

## Config-failure diagnosability

Every config-failure stage carries a machine-readable reason —
`sa-json-missing` / `sa-json-invalid` / `sa-json-incomplete` /
`token-fetch-failed` (OAuth, e.g. `invalid_grant` on a revoked key) /
`play-api-rejected` (Play Developer API 401/403: SA not invited in Play
Console or the API not enabled). The callable throws `failed-precondition`
with the reason in `details.reason`, the client records it as `errorReason`
on the `play_verify_failed` PostHog event, and a **throttled critical ops
email** goes to `OPS_ALERT_EMAILS` the moment a real purchase hits a config
error (a buyer has paid and is not getting access — Google auto-refunds
after 3 days, so an unfixed config loses the sale).

`getAccessToken` parses the secret through `parseServiceAccountJson`, which
**self-heals the two ways `firebase functions:secrets:set` + copy-paste mangle
the SA JSON**: a single-quote-wrapped object (`'{...}'`) and a double-encoded
JSON string (`"{\"type\":...}"`). Prefer `--data-file ./sa.json` when setting
the secret to avoid the mangling entirely; the tolerant parse is a backstop, not
a licence to paste. A genuinely bad/empty value still fails `sa-json-invalid`.

## Fixing `play-api-rejected` (401 / 403) — step by step

This reason means the SA JSON parsed, we obtained an OAuth token from it, but
the **Play Developer API refused that token** (buyers pay, get no access, and
Google auto-refunds after 3 days). The repo wiring (secret bound to
`verifyGooglePlayPurchase` + `hourlyMonitor`) is already correct when this
fires — the fix is entirely in Play Console / Google Cloud. Work through it in
order:

1. **Read the exact cause.** The thrown message now carries Google's own error
   detail, so you rarely have to guess between the two failure modes. Find it
   in the ops email (`Detail: …`), Cloud Logging
   (`[verifyGooglePlayPurchase] config error`), or the PostHog
   `play_verify_failed.errorReason`:
   - `SERVICE_DISABLED` / "…API has not been used… or it is disabled" → **the
     API is off** (step 2).
   - `PERMISSION_DENIED` / "insufficient permissions" (usually 403) → **the SA
     isn't authorised in Play Console** (step 3).
   - "invalid authentication credentials" (401) → **wrong-project / rotated
     key** (step 4).
2. **Enable the API on the SA's Cloud project.** The service account's project
   id is embedded in its email —
   `<name>@<PROJECT_ID>.iam.gserviceaccount.com` (read `client_email` from the
   secret's JSON). Open
   `https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com`,
   pick **that** project, and click **Enable**. Propagation can take a few
   minutes.
3. **Invite the SA in Play Console.** Play Console ▸ **Users and permissions** ▸
   **Invite new user** ▸ paste the SA `client_email` ▸ grant **View financial
   data, orders, and cancellation survey responses** + **Manage orders and
   subscriptions** (account-level, or scoped to the ZedExams app) ▸ **Invite
   user**. New grants usually apply within minutes.
4. **Confirm the key belongs to the linked project.** Play Console ▸ **Settings
   ▸ Developer account ▸ API access** shows the Google Cloud project linked to
   this Play account and the service accounts under it. The SA whose JSON is in
   `GOOGLE_PLAY_SA_JSON` must appear here. A key minted in a *different* Cloud
   project produces a 401 no matter the permissions — re-mint the key from the
   linked project's SA and re-set the secret:
   ```bash
   firebase functions:secrets:set GOOGLE_PLAY_SA_JSON --project examsprepzambia
   # paste the FULL service-account JSON, then let CI redeploy the two bound
   # functions so the new secret version is picked up.
   ```
5. **Verify without a device.** Re-run runbook step 6 — call
   `verifyGooglePlayPurchase` with a garbage token and expect
   `results[0].status === "not_found"`. Or just wait for Vigil's hourly probe
   (`checkPlayBilling`): the `playBilling` critical clears on `/admin/company`
   and in the `hourlyMonitor` rollup once the config is good. A cleared probe
   proves secret → SA → OAuth → Play API auth end to end.

## Test surface

`npm run test:google-play-core`, `test:google-play-verify`,
`test:activation-provider`, `test:play-catalog-mirror` (all in `test:all`),
plus vitest specs `PlayUpgradePanel.spec.jsx`, `UpgradeModal.native.spec.jsx`,
and the native blocks in `PaywallHost.spec.jsx` / `MySubscriptionPage.spec.jsx`
(web-regression locks included).

The parent rail adds `test:google-play-guardian` (beneficiary + one-time
passes + the cross-rail refusal), `test:google-play-rtdn`,
`test:guardian-billing-auth`, `test:cross-rail`,
`test:shared-billing-neutral` and `test:play-steering-copy`, plus
`ParentPlayCheckout.spec.jsx`, `ParentPlanStatus.spec.jsx` and
`ParentPlan.rails.spec.jsx` — the last of which asserts over the WHOLE
rendered page that no ZMW literal and no mobile-money copy reaches the
Android build.

## Real-time Developer Notifications (owner runbook)

> **STATUS: the handler is written and tested; the EXPORT is held back.**
> `functions/index.js` does not currently export `googlePlayRtdn`, because
> `onMessagePublished` needs its topic to exist and `firebase deploy`
> fails the WHOLE functions deploy when it cannot create one —
> `Unexpected error creating Pub/Sub topic`. That took `main` out of
> deployment on 2026-08-21 (run 32460825117, both attempts) until the
> export was removed: hosting correctly refuses to ship over functions
> that may not have landed, so a single un-creatable topic stops
> everything. **Do step 1 and 2 below FIRST, then restore the export**
> (the commented block in `functions/index.js` says exactly how) and
> regenerate the manifest. Until then the Android rail still works —
> purchases verify through the client's own `verifyGooglePlayPurchase`
> call and renewals land on the next app open — it is only the real-time
> half that is off.

Without this, the ONLY thing that advances a Play subscription is the
Android client's restore-on-open. That is survivable for a learner who
opens the app most days and wrong for a **parent**, who buys a plan for
their child and may not open the app again for a month: Google keeps
charging them while `subscriptionExpiry` sits at last month's date, and
the family loses access having paid.

1. **Create the Pub/Sub topic** in the Firebase project:
   ```bash
   gcloud pubsub topics create play-rtdn --project examsprepzambia
   ```
   Use a different name only if you also set `PLAY_RTDN_TOPIC` on the
   functions deploy — the export reads it (`functions/index.js`).
2. **Grant Google Play permission to publish to it.** Play publishes as
   `google-play-developer-notifications@system.gserviceaccount.com`:
   ```bash
   gcloud pubsub topics add-iam-policy-binding play-rtdn \
     --member=serviceAccount:google-play-developer-notifications@system.gserviceaccount.com \
     --role=roles/pubsub.publisher --project examsprepzambia
   ```
   Play Console refuses the topic if this binding is missing.

   The DEPLOY service account also needs to attach the trigger to the
   topic — `roles/pubsub.admin` (or at minimum `pubsub.topics.get` +
   `pubsub.subscriptions.create`) on the project. Creating the topic by
   hand is not sufficient on its own if the deployer cannot read it, and
   the failure looks identical from the deploy log. If the Pub/Sub API
   has never been used on this project, enable it too:
   `gcloud services enable pubsub.googleapis.com --project examsprepzambia`.
3. **Point Play at it** — Play Console ▸ Monetise ▸ Monetisation setup ▸
   Real-time developer notifications ▸ full topic name
   `projects/examsprepzambia/topics/play-rtdn`.
4. **Send a test notification** from that same screen. A `testNotification`
   is parsed, logged and ignored **by design** — seeing
   `[googlePlayRtdn] ignored (test-notification)` in Cloud Logging is the
   pass condition, and it proves topic → IAM → function end to end.
5. **Enable voided purchases** on the same screen so refunds and
   chargebacks arrive. Without it a refunded family keeps their access.

What each notification does:

| Notification | Effect |
|---|---|
| RENEWED / RECOVERED / RESTARTED | re-verified against Google; `expiresAt` advances, no access gap |
| CANCELED | `autoRenewing` off; access holds to `expiresAt` |
| ON_HOLD / PAUSED / EXPIRED / REVOKED | re-verified; access lapses at Google's date |
| One-time PURCHASED | pass granted (used when the client's own call is interrupted) |
| Voided purchase | access **removed** from the accounts that payment granted, payment stamped `refunded` |
| Test / price change / deferred | ignored — nothing about the current entitlement changed |

Two properties worth keeping if this is ever rewritten: the notification
is a **doorbell, not the truth** (every actionable one re-asks the Play
Developer API, which is what makes an out-of-order Pub/Sub redelivery
harmless), and the handler **never throws** for a message it merely
cannot act on (a permanently-failing message would be redelivered forever
and build a backlog in front of the renewals behind it).

## The parent rail (web = Lenco, Android = Play)

A guardian buys for a linked child on `/family/plan`. Which rail takes the
payment is the `isNativePlatform()` seam, the same one `UpgradeModal`
uses; everything else about the purchase is identical, including that the
money credits the CHILD (`beneficiaryUid`) and cascades to every other
approved-linked learner.

- **Authorisation is one module, both rails.**
  `functions/guardianBillingAuth.js` reads `parentLinks` server-side and is
  called by `initiateLencoPayment` AND `verifyGooglePlayPurchase`. A
  co-guardian may not pay; only the owner can.
- **The obfuscated account id binds the PARENT, not the child.** Google
  records the buyer. Binding the child would make every guardian purchase
  look like a cross-account replay.
- **A restore names no child.** It enumerates whatever the Google account
  owns and cannot know who each purchase was for, so an interrupted
  purchase that is later restored credits the payer — the child is still
  unlocked, through the cascade.
- **Cross-rail guard.** `functions/shared/billing/crossRailCore.js` is
  shared with the browser: it hides the Buy button and refuses the grant.
  On Play the refusal happens *after* Google has taken the money, so the
  purchase is deliberately left UNACKNOWLEDGED — Google auto-refunds it
  after three days. A refused grant logs `DOUBLE PURCHASE … refund owed`
  with the order id; that line is the only record a manual refund is due.
- **Cancel is branched by source.** Play buyers get "Manage in Google
  Play" and no in-app cancel (a Play subscription can only be cancelled in
  Play). Web buyers keep the in-app control. A one-time pass gets neither.

## Known v1 limits / follow-ups

- **RTDN is written but NOT DEPLOYED.** `googlePlayRtdn` (Pub/Sub,
  us-central1) applies renewals, cancellations, grace period, on-hold,
  revocation and refunds — and its export is held back until the
  `play-rtdn` topic exists, because a missing topic fails the entire
  functions deploy. See the status note under "Real-time Developer
  Notifications". Until it is restored, renewals still land on the next
  app open (restore-on-open), which is the pre-existing behaviour.
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
