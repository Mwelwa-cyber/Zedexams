# Cloud Functions region migration (us-central1 → africa-south1)

> Snapshot as of 2026-08-01 — verify before acting. Nothing has moved yet:
> `functions/functionRegions.json`'s `migrated` list is empty, so every
> HTTP/callable function still serves from `us-central1`.

## Why

The `(default)` Firestore database lives in **`africa-south1`**. The
HTTP/callable surface lives in **`us-central1`**. Every Firestore operation a
callable performs therefore pays a US↔ZA round trip (~180–250 ms), and the
handlers that hurt are the ones doing several *sequentially*.

The passkey sign-in path was the measured case study: ~6 sequential Firestore
operations, warm ≈ 3.2 s / cold ≈ 6.6 s end to end, while the WebAuthn
cryptography itself was ~4 ms. The latency was almost entirely cross-region.

Firestore-triggered functions (`onDocument*`), the agent dispatcher and the
storage-cleanup triggers are **already** pinned to `africa-south1` so Eventarc
does not make a cross-region hop per event. This migration extends that to the
request-serving surface.

## Current state (measured 2026-08-01)

| Thing | Count |
|---|---|
| `region: "us-central1"` literals under `functions/` | 111 |
| `region: "africa-south1"` literals under `functions/` | 14 |
| `index.js` `onCall`/`onRequest` exports with **no** explicit region (default `us-central1`) | 43 |
| `onCall` definition sites | 137 |
| `onRequest` definition sites | 12 |
| `onSchedule` definition sites | 34 |
| Firestore triggers | 21 |
| Hosting rewrites pinned to `us-central1` in `firebase.json` | 12 |
| `src/` files calling `getFunctions(app, '<region>')` | 57 |

Good news from the client audit: **no production call site omits the region**,
so nothing breaks silently through the SDK default. The bad news is the same
fact — all 57 have to be edited, in step with their function.

## The three constraints that shape the plan

**1. A region change is delete-and-recreate, not a move.** Firebase creates the
function in the new region; the old one is a separate deletion. Between the two
a caller can reach neither. This is why waves are small and why a function and
its callers must never flip in different deploys.

**2. Region is resolved at deploy-analysis time.** `firebase deploy` discovers
each function's region by running the source in a subprocess
(firebase-tools `prepare.js` → `discoverBuild`), so `region:` must resolve
**synchronously at module load** from CommonJS. This is why the registry is a
JSON file requireable from `functions/`, not an ESM module under
`functions/shared/` — the same deploy-time analysis trap documented for
secrets in `functions/opsAlertSecrets.js`.

**3. A Hosting rewrite is a public URL.** The 12 `/api/*` rewrites name a
region explicitly. If a rewrite names a region the function no longer serves
from, `zedexams.com/api/…` returns 404 — including `lencoWebhook` and
`apiWhatsAppWebhook`, whose callers are third parties that will not retry
forever. `test:function-regions` fails if a rewrite and the registry disagree.

## Trade-offs that are NOT wins

State these before deciding a wave is worth it:

- **Cost goes up.** `africa-south1` (Johannesburg) is a premium-tier region;
  Cloud Run/Functions there costs meaningfully more per invocation and
  GB-second than `us-central1`. Migrating the whole surface raises the monthly
  functions bill. *Not yet quantified — do this before the AI waves, which are
  the highest-volume ones.*
- **AI calls get slightly slower.** Every generator calls Anthropic/OpenAI in
  the US. From Johannesburg that adds a round trip per provider call. It is
  small next to model latency, and those handlers also do a lot of Firestore
  work, but it is the opposite direction from the win — so AI functions are a
  late wave, not an early one.
- **Unverified availability.** `africa-south1` support for **Cloud Scheduler**
  (34 `onSchedule` functions) and for **Hosting rewrites** to that region has
  **not** been confirmed in this project. Eventarc is proven there (the
  Firestore triggers already run). Confirm both before waves 3 and 4.

## How a wave is run

1. Add the export name(s) to `migrated` in `functions/functionRegions.json`.
2. Add the same name(s) to `MIGRATED_FUNCTIONS` in
   `src/config/functionRegions.js` (hand mirror — the guard test compares them).
3. Replace the literal at the export:
   `region: "us-central1"` → `region: regionFor("<exportName>")`.
4. Replace the client literal:
   `getFunctions(app, 'us-central1')` → `getFunctions(app, regionFor('<exportName>'))`.
5. If the function is a Hosting rewrite target, update its `region` in
   `firebase.json` **in the same change**.
6. `npm run test:function-regions && npm run lint && npm run build`.
7. Merge → `deploy-firebase.yml` creates the function in the new region.
8. **Delete the old-region function explicitly** once the new one serves.
9. Watch for `functions/not-found` in client error reporting and 404s on any
   `/api/` path the wave touched.

Steps 1–5 land together on purpose: converting a call site to `regionFor()`
while it still resolves to `us-central1` would hide a wrong export name until
the wave that flips it.

## Rollback

Remove the name from both lists and redeploy — the function is recreated in
`us-central1`. This is a redeploy, not a flag flip, so it is minutes not
seconds. The passkey migration bought instant rollback by deploying regional
**twins** under `…Africa` names alongside the originals and routing with a
Firestore flag; that is available for any wave judged too risky to cut over
directly, at the cost of running two copies.

## Proposed wave order

Ordered by (benefit × confidence) ÷ blast radius. **None of these is approved
or started.**

| Wave | Contents | Rationale |
|---|---|---|
| 0 ✅ | Registry + guard test + this doc | No behaviour change. Done. |
| 1 | A handful of Firestore-only callables with no Hosting rewrite and no external caller | Pure colocation win, smallest blast radius, proves the wave mechanics end to end |
| 2 | The remaining Firestore-heavy `onCall` surface | The bulk of the user-visible win |
| 3 | `onSchedule` (34) | Needs Cloud Scheduler availability confirmed first; no user waits on these, so latency benefit is bookkeeping only — arguably skip |
| 4 | `onRequest` behind Hosting rewrites (12) | Needs Hosting-rewrite region support confirmed; public URLs, so highest blast radius |
| 5 | AI generators | Highest volume (cost) and the one group where the provider hop works against us |

`generatePasskey*` / `verifyPasskey*` are deliberately excluded: passkey
sign-in is being turned off at the feature flag, and its four `…Africa` twins
already exist under the separate scheme in `functions/passkeys/passkeyRegions.js`.
Retire that scheme rather than folding it into this one.

## Tests

- `npm run test:function-regions` — registry shape, client⇄server parity,
  migrated names are real exports, no migrated export still hard-codes the
  legacy region, and every Hosting rewrite names the region its function
  actually serves from.
