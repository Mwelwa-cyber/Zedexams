# Phase 5 — Functions restructure: plan and ledger

> Snapshot as of 2026-08-08 — verify before acting. The binding scope is
> [`architecture.md`](./architecture.md) § Phase 5; this file is the working
> plan and running ledger, per the phase3-plan precedent.

## Ledger

> **Phase 5: STARTED — contract/inventory stage.** No backend behaviour
> changes yet. Migration batches risk-ascending. Payment/webhook and audit
> behaviour changes deferred pending external review coverage.
> Backup/restore drill required on exit.
>
> **2026-08-08 — batch 1a extracted** (the seven passkey callables →
> `passkeys/passkeyCallableHandlers.js`, dependency-injected App Check
> observer; options stay in `index.js` where the guard reads them).
> **Reclassified by hand:** `getUpgradeQuote` and `bulkGrantDemoTrials`
> mechanical → payment-webhook batch 3 — their names dodge the seeding
> regex, their writes do not. Batch 1 is 12 (7 done, 5 in batch 1b).
> **Review debt:** Codex quota exhausted since #2168; batch 1a ships on
> self-verification (guard + suite + discovery-load) and carries the debt
> explicitly until quota returns.

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
| 2 | secrets-bound | 21 | standard CI + secrets bindings pinned by the guard |
| 3 | payment/webhook + audit-surface | 9 | **deferred until external review coverage is restored**; payment-lifecycle emulator + webhook-signature suites mandatory |

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

## Exit criteria

1. `functions/index.js` reduced to exports; every inline handler in a domain
   module; drift guard green throughout.
2. Payment-lifecycle emulator + webhook-signature suites green on the final
   state.
3. Audit burn-down complete (separate PRs, external review restored).
4. **Backup/restore drill re-run** — architecture.md §1129 re-arms the
   restore rehearsal after Phase 5, by original instruction. This is an exit
   criterion, recorded now rather than discovered at completion.
