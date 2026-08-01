# Cloud Functions region migration (us-central1 → africa-south1)

> Snapshot as of 2026-08-01 — verify before acting. Nothing has moved yet:
> `functions/functionRegions.json`'s `migrated` list is empty, so every
> HTTP/callable function still serves from `us-central1`.
>
> **Revision 2 (2026-08-01)** corrects four claims in revision 1 that were
> asserted without verification. The corrections are recorded in
> "What revision 1 got wrong" at the foot of this document rather than quietly
> edited away, because a runbook that silently changes its mind teaches nobody
> which parts were ever checked.

## Why

The `(default)` Firestore database lives in **`africa-south1`**. The
HTTP/callable surface lives in **`us-central1`**. Every Firestore operation a
callable performs therefore pays a US↔ZA round trip (~180–250 ms), and the
handlers that hurt are the ones doing several *sequentially*.

The passkey sign-in path was the measured case study: ~6 sequential Firestore
operations, warm ≈ 3.2 s / cold ≈ 6.6 s end to end, while the WebAuthn
cryptography itself was ~4 ms.

Firestore-triggered functions, the agent dispatcher and the storage-cleanup
triggers are **already** pinned to `africa-south1`. This migration extends that
to the request-serving surface.

## Current state (measured 2026-08-01)

| Thing | Count |
|---|---|
| `region: "us-central1"` literals under `functions/` | 111 |
| `region: "africa-south1"` literals under `functions/` | 14 |
| `index.js` `onCall`/`onRequest` exports with no explicit region | 43 |
| `onCall` definition sites | 137 |
| `onRequest` definition sites | 12 |
| `onSchedule` definition sites | 34 |
| Firestore triggers | 21 |
| Hosting rewrites pinned to `us-central1` | 12 |
| `src/` files calling `getFunctions(app, '<region>')` | 57 |

No production client call site omits the region, so nothing breaks silently
through the SDK default. All 57 still have to be edited, in step with their
function.

## Ineligible today — not everything can move

**1st-generation functions cannot move at all.** `africa-south1` is
**2nd-generation only**. Two files still import `firebase-functions/v1`, and
one real export depends on it:

- `exports.setUserRole` (`index.js:785`) is `functions.auth.user().onCreate(…)`.
  Firebase Auth lifecycle triggers of that shape are 1st-gen; there is no
  drop-in 2nd-gen equivalent, so this is a rewrite (to a blocking function or
  a different mechanism), not a region flip.
- `functions/storageCleanup/onUserDeleted.js` references the same trigger.

**Scheduled functions cannot be scheduled from Johannesburg.** Cloud Scheduler
has **no African region**. See wave 3 below.

Both limits are enforced by `test:function-regions`, not merely written here —
adding either kind of export to `migrated` fails CI, and the guard carries
self-checks so it cannot pass vacuously.

## The three constraints that shape the plan

**1. Region changes need PARALLEL deployment, and an outage is avoidable.**
Firebase does not change a live function's region in place, but the documented
procedure is to deploy the new function under a **new name** in the
destination region, run **both** versions simultaneously, move callers over,
and only then delete the original. A same-name cutover followed by immediate
deletion is what creates a gap — the procedure below avoids it by construction.

This matters most for **Android**. An installed APK calls whatever region its
bundled JavaScript names. A web deploy re-points every browser at once; an
installed app does not update until the user takes the new build. **Deleting a
`us-central1` endpoint while old installs are still calling it breaks those
users**, and the Play install base is exactly the audience this project is
growing. The old endpoint must therefore outlive the client cutover, and may
proxy or redirect to the new one in the meantime.

The repo already has a worked example of this shape: the passkey `…Africa`
twins in `functions/passkeys/passkeyRegions.js`, routed by a Firestore flag so
rollback is a flag flip rather than a redeploy.

**2. Region is resolved at deploy-analysis time.** `firebase deploy` discovers
each function's region by running the source in a subprocess (firebase-tools
`prepare.js` → `discoverBuild`), so `region:` must resolve **synchronously at
module load** from CommonJS. This is why the registry is a JSON file
requireable from `functions/`, not an ESM module under `functions/shared/` —
the same deploy-time analysis trap documented for secrets in
`functions/opsAlertSecrets.js`.

**3. A Hosting rewrite is a public URL.** The 12 `/api/*` rewrites name a
region explicitly. If a rewrite names a region the function no longer serves
from, `zedexams.com/api/…` returns 404 — including `lencoWebhook` and
`apiWhatsAppWebhook`, whose callers are third parties that will not retry
forever. `test:function-regions` fails if a rewrite and the registry disagree.

## Trade-offs — what is measured, and what is not

- **Cost: unknown, must be measured.** `africa-south1` is **Tier 1** pricing,
  the same tier as `us-central1` — *not* a premium tier. Any bill difference
  therefore has to come from compute, egress, invocation volume and Artifact
  Registry, and must be calculated rather than assumed. Do this before the
  high-volume AI waves.
- **AI latency: a hypothesis, not a finding.** Moving to Johannesburg adds a
  hop to Anthropic/OpenAI while *removing* repeated ZA↔US Firestore hops. The
  net effect depends on how many sequential Firestore operations versus
  provider calls each handler makes. Classify AI functions on **measured warm
  and cold p50/p95 end-to-end latency**, not on the direction of one hop.
- **Hosting rewrites: supported, with a latency caveat.** A function behind
  Hosting may live in any supported functions region. But Firebase recommends
  colocating with Hosting in one of its recommended regions for best
  performance, and **Johannesburg is not among them** — so the 12 `/api/*`
  endpoints need real latency, timeout and webhook-delivery testing before
  cutover, not just a config edit.
- **Hosting's 60-second timeout applies regardless.** Hosting returns 504
  after 60 s even when the function's own timeout is longer. This already
  constrains the SSE endpoints (`apiAiChat`, the lesson-plan and worksheet
  streams) and does not change with region — but any latency added in front of
  a long stream eats the same budget.

## How a wave is run

1. Add the export name(s) to `migrated` in `functions/functionRegions.json`
   **and** to `MIGRATED_FUNCTIONS` in `src/config/functionRegions.js` (hand
   mirror; the guard test compares them).
2. **Deploy a twin, do not move the original.** Export the same handler under
   `<baseName>Africa` with `region: regionFor("<baseName>")`, following
   `passkeyRegionalCallable()` in `functions/index.js`. Same handler, same
   runtime options, same App Check label — so security checks and error codes
   are identical by construction.
3. Verify the twin serves correctly in production before any client points at
   it.
4. Move callers: `getFunctions(app, regionFor('<exportName>'))` from
   `src/config/functionRegions.js`. Prefer a routed rollout (pilot uid → all)
   over a hard cutover where the surface allows it.
5. Hosting rewrite targets: update `region` in `firebase.json` only after
   step 3, and run the `/api/*` latency + webhook-delivery checks.
6. `npm run test:function-regions && npm run lint && npm run build`.
7. Observe. Then, and only then, consider retiring the original — see below.

## Before deleting any us-central1 endpoint

A checklist, because this is the irreversible step:

- [ ] The twin has served production traffic for a full observation window.
- [ ] Error reporting shows no `functions/not-found` for the export.
- [ ] For rewrite targets: the `/api/` path returns 200 from the new region,
      and any third-party webhook (Lenco, Meta) has delivered successfully.
- [ ] **Android**: telemetry shows no meaningful install base still on a build
      that addresses `us-central1`, or the old endpoint proxies to the new one.
- [ ] Rollback rehearsed: routing back to `us-central1` verified to work.
- [ ] Deletion is explicitly approved. It is never automatic and never part of
      the same deploy that created the twin.

## Rollback

While both twins exist, rollback is a routing change — remove the name from
both lists (or flip the routing flag, where one is used) and redeploy the
client. Once the original is deleted, rollback becomes a redeploy of the old
function, which is minutes rather than seconds. That asymmetry is the reason
deletion sits behind its own checklist.

## Proposed wave order

Ordered by (benefit × confidence) ÷ blast radius. **None of these is approved
or started.**

| Wave | Contents | Rationale |
|---|---|---|
| 0 ✅ | Registry + guard test + this doc | No behaviour change. Merged in #2086. |
| 1 | A few Firestore-heavy, **2nd-gen** callables with no Hosting rewrite and no third-party caller | Pure colocation win, smallest blast radius, proves the twin procedure end to end |
| 2 | The remaining Firestore-heavy `onCall` surface | The bulk of the user-visible win |
| 3 | ~~`onSchedule` (34)~~ **Blocked — Cloud Scheduler has no African region.** Options: leave them in `us-central1` (default); or keep the Scheduler job in a supported region and have it invoke a Johannesburg HTTPS function. Nobody waits on a cron, so the benefit likely does not justify splitting schedule from work. Recommendation: **skip.** |
| 4 | `onRequest` behind Hosting rewrites (12) | Supported, but public URLs + Johannesburg is not a recommended Hosting colocation region → needs measured latency and webhook-delivery tests first |
| 5 | AI generators | Highest volume (cost) and the group whose net latency effect is genuinely unknown — measure before classifying |
| — | 1st-gen (`setUserRole`) | **Ineligible.** Needs a 2nd-gen rewrite first; that is its own piece of work |

`generatePasskey*` / `verifyPasskey*` are excluded: passkey sign-in is being
turned off at the feature flag, and its four `…Africa` twins already exist
under the separate scheme in `functions/passkeys/passkeyRegions.js`. Retire
that scheme rather than folding it into this one.

## What revision 1 got wrong

Recorded so the corrections are auditable:

1. **"Between the two, callers reach neither."** Wrong as stated — an outage is
   avoidable via parallel deployment, and revision 1's procedure compounded the
   error by flipping the client in the same change that created the function.
   It also ignored installed Android clients entirely.
2. **"`africa-south1` is a premium-tier region, so the bill goes up."**
   Unsupported. It is Tier 1, same as `us-central1`.
3. **"Hosting-rewrite support in `africa-south1` is unverified."** It is
   supported; the real caveat is that Johannesburg is not a recommended
   colocation region for Hosting.
4. **"Cloud Scheduler availability is unverified."** It is *unsupported* —
   stronger and more actionable, and it makes wave 3 as written impossible.

Revision 1 also missed the 1st-generation inventory entirely.

## Tests

- `npm run test:function-regions` — registry shape, client⇄server parity,
  migrated names are real exports, no migrated export still hard-codes the
  legacy region, no 1st-gen or `onSchedule` export marked migrated (with
  self-checks so the eligibility guards cannot pass vacuously), and every
  Hosting rewrite names the region its function actually serves from.

## Sources

- [Cloud Scheduler locations](https://docs.cloud.google.com/scheduler/docs/locations)
- [Cloud Functions locations (Firebase)](https://firebase.google.com/docs/functions/locations)
- [Serve dynamic content with Cloud Functions (Hosting)](https://firebase.google.com/docs/hosting/functions)
- [Configure Hosting behavior](https://firebase.google.com/docs/hosting/full-config)
