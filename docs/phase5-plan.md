# Phase 5 — Functions restructure: plan and ledger

> Snapshot as of 2026-08-08 — verify before acting. The binding scope is
> [`architecture.md`](./architecture.md) § Phase 5; this file is the working
> plan and running ledger, per the phase3-plan precedent.

## Ledger

> **Phase 5: BATCH 2 PAUSED (2026-08-09, owner decision).** Batches 1a and 1b
> are merged and deployed. **No further Functions migrations start until the
> `apiTrackVisit` work and Cloud Functions error monitoring are done** (#2230).
> The reason is not that the extractions were unsafe — 1b's post-deploy check
> found no fault in it — but that the verification only worked because someone
> read Cloud Logging by hand. Sentry is frontend-only and reported zero while
> Cloud Logging held 80 errors, so the next batch would deploy into the same
> blind spot. Migrating more Functions before we can SEE Functions fail is
> ordering the work backwards. #2202 is not reverted.
>
> **Phase 5: STARTED — contract/inventory stage.** No backend behaviour
> changes yet. Migration batches risk-ascending. Payment/webhook and audit
> behaviour changes deferred pending external review coverage.
> Backup/restore drill required on exit.
>
> **2026-08-09 — what batch 1b's deploy actually taught us.** Two findings, and
> neither is an argument against the restructure:
>
> - **`functions/index.js` costs 148 MiB RSS and 2.7s to LOAD** (measured, Node
>   22, bare node is 43 MiB). Every v2 instance pays it, because all 202 exports
>   deploy from one source — so it is on the cold start of every function in the
>   project, not just the big ones. `apiTrackVisit` declared 128MiB and was
>   therefore provisioned below the cost of starting up (#2231). This is the
>   strongest measured argument for Phase 5 so far, and a better one than
>   tidiness: the exit criterion "index.js reduced to exports" has a number
>   attached to it now.
> - **The frozen-surface manifest could not see the setting that broke.**
>   `apiTrackVisit` is a `require('./x').y` delegation, which the extractor
>   classifies as factory-built and records in `optionsUnresolved`. The one
>   function in the codebase with a fatal option sat inside the guard's declared
>   141-entry blind spot. The blind spot being written down is what made this
>   legible rather than surprising — but it is now a shrink target with a
>   demonstrated cost, not a theoretical one. Following `require('...').member`
>   is a tractable extractor improvement.

> **2026-08-09 — the guard follows delegations** (#2194's last open P1). A
> delegated export's wrapper is read in the module that builds it, so the
> frozen surface covers what actually ships rather than what index.js
> happens to declare. 16 exports newly guarded; the 141 it still cannot
> reach (factory-built, or re-exported through a second hop) are named in
> `optionsUnresolved` and ratcheted shrink-only — a blind spot written down
> is a work item, one that reads as "no options" is a false green.
> **Review debt CLOSED:** Codex quota returned and reviewed #2194 (5
> findings, all fixed); Rex approved.

> **2026-08-09 — batch 1 reconciled, and 1b prepared.** The plan's
> **14 mechanical** = 1a's 7 + 1b's 5 + **2 reclassified**:
> **`getUpgradeQuote`** (subscription upgrade pricing) and
> **`bulkGrantDemoTrials`** (writes subscription state) moved to
> payment-webhook **batch 3** before any code was extracted — their names
> dodge the seeding regex, their writes do not. Nothing was omitted; batch 1
> is 12 handlers and batch 3 is now 11.
> **Batch 1a deployed** (run #709, success, 06:19:58Z). Sentry: 0 errors in
> the 24h covering it, 0 passkey/webauthn/credential errors ever;
> pipeline confirmed alive (15 errors/30d), so the zero is evidence rather
> than silence. **A live functional passkey sign-in could NOT be run from
> the build sandbox** — outbound to `cloudfunctions.net` is blocked by the
> agent proxy — so that half of the spot-check was owner-side.
> **CLOSED 2026-08-09 11:30Z:** the owner enabled the passkey flag in
> production and signed in successfully. Batch 1a's seven extracted passkey
> callables are confirmed working against real traffic, which is the check
> the sandbox could not make. Sentry over the same window: 0 errors of any
> kind — worth reading as "nothing broke loudly" rather than as strong
> independent confirmation, since at ~0.5 errors/day a one-day zero is also
> what an untouched path looks like.

## What this phase does

Move the inline handlers out of `functions/index.js` into domain modules;
reduce `index.js` to exports. **Frozen for the duration:** export names,
trigger/callable kinds, regions (africa-south1 triggers / us-central1
callables), secrets bindings, runtime options (timeout, memory, concurrency,
min-instances, App Check enforcement), and Hosting rewrite paths.

The measured inventory (PR-zero): **201 exports, of which 44 are inline** —
40 `onCall`, 3 `onRequest`, 1 v1 auth trigger. The other 157 are already
delegated to modules or built by factories; they need no extraction, and
their manifest entries freeze the *export binding* (kind + target
expression), while their options are guarded where they are defined.

## The contract (PR-zero, this PR)

- **`scripts/functions-manifest.json`** — the frozen-surface manifest: every
  export's kind, options, delegation target, rewrite path, risk
  classification, and extraction batch. Regenerate with
  `node scripts/generate-functions-manifest.mjs`; `classification` and
  `batch` are hand-owned and survive regeneration.
- **`test:functions-manifest`** — the drift guard, in `test:all` on every PR.
  A migration that changes any frozen field without updating the manifest in
  the same diff fails CI with the field named. The comparison is
  **semantic**: reindenting, reordering keys, or rewording comments changes
  nothing (control-verified); a region, secret, timeout, memory or App Check
  value moving fails (control-verified). New exports must arrive classified;
  removed exports must leave the manifest in the same PR.

## Extraction batches, risk-ascending

| batch | class | count | gate |
|---|---|---|---|
| 1 | mechanical (no secrets) | 14 | standard CI |
| 2 | secrets-bound | 21 | **PAUSED 2026-08-09** — blocked on #2230 (Cloud Functions error monitoring). Standard CI + secrets bindings pinned by the guard when it resumes |
| 3 | payment/webhook + audit-surface | 11 | **deferred until external review coverage is restored**; payment-lifecycle emulator + webhook-signature suites mandatory |

Every batch, regardless of apparent relevance, runs the payment-lifecycle
emulator suite and the webhook-signature tests before merge.

### Extraction invariants (every batch)

An extraction PR preserves, demonstrably: the export symbol, the wrapper and
builder kind, region, runtime options (timeout/memory/concurrency/
min-instances where present), secrets bindings, App Check / auth
assumptions, and error/response semantics. The drift guard enforces the
frozen fields mechanically; error/response semantics are the reviewer's
question, which is why **extraction PRs contain no behaviour change** —

- **Audit burn-down items (unauthenticated HTTP surface, uncapped AI
  callables) are SEPARATE PRs, never combined with extraction** — even when
  they touch the same function. The diff must prove whether a failure came
  from relocation or from changed behaviour.

## Deployment boundary

Every merge that touches `functions/**` auto-deploys via
`deploy-firebase.yml`. **No functions batch merges into an active rollout
hold window** (Phase 3 §7.3's attribution rule: an anomaly during a hold
must have one candidate cause). Batches are prepared and PR'd at any time;
they merge between holds. PR-zero itself touches nothing under `functions/`
and is hold-safe by construction.

## Recorded debt (not blocking any batch)

- **v1 auth triggers are not runtime-testable in isolation.** Batch 1b's
  `setUserRole` extraction was verified by byte-identity against `HEAD`, the
  pinned `functions.auth.user().onCreate` chain, `security/adminClaims`'
  own tests, export discovery and the full suite — but NOT by executing the
  extracted handler, because `firebase-admin` exposes `auth` as a
  non-writable getter, so the obvious mock does not take and the handler
  cannot be driven without an initialised app. Recorded 2026-08-09 by owner
  instruction, deliberately as its own item rather than folded into the
  extraction PR: mixing a testability improvement into a mechanical move
  destroys the property that makes the move reviewable.
  The fix, when someone takes it: inject the auth client the way
  `resolveInitialUserRole` is already injected, so the trigger's role
  decisions (learner default, verified-admin, and the
  **unverified-allowlisted-address must NOT become admin** case that AUTH-L6
  turns on) can be asserted without Firebase. Worth doing before the Daily
  Quiz rework adds more auth-adjacent triggers.

## Exit criteria

1. `functions/index.js` reduced to exports; every inline handler in a domain
   module; drift guard green throughout.
2. Payment-lifecycle emulator + webhook-signature suites green on the final
   state.
3. Audit burn-down complete (separate PRs, external review restored).
4. **Backup/restore drill re-run** — architecture.md §1129 re-arms the
   restore rehearsal after Phase 5, by original instruction. This is an exit
   criterion, recorded now rather than discovered at completion.
