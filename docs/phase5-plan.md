# Phase 5 — Functions restructure: plan and ledger

> Snapshot as of 2026-08-08 — verify before acting. The binding scope is
> [`architecture.md`](./architecture.md) § Phase 5; this file is the working
> plan and running ledger, per the phase3-plan precedent.

## Ledger

> **2026-08-14 — batch 3 extracted; EXIT CRITERIA 1 AND 2 MET, 3 AND 4 OPEN.**
> The 11 payment/webhook + audit-surface bodies moved to
> `functions/paymentHandlers.js` (9) and `functions/httpSurfaceHandlers.js` (2).
> `index.js` 3,601 → 2,517 lines. **No provider-backed or payment body is
> declared inline in `index.js` any more.**
>
> Membership was DERIVED (`batch === 3`), not read from the table below.
>
> What the verification actually proves, in the order it was run:
>
> - **Frozen surface: 0 drift across all 195 exports.** Options, kind, rewrite
>   path and classification compared field-by-field against `main`; the only
>   manifest change is `inline: true → false` and `batch: 3 → null` on the 11.
> - **Bodies are byte-identical.** Each moved body was de-indented and compared
>   to the text that was in `index.js` on `main`: 11/11 exact. "No behaviour
>   change" is therefore a property of the method, not a claim about care.
> - **`index.js` LOADS.** 195 exports materialize, all 11 among them. This is
>   the check a green deploy does not make — a TDZ fault throws at container
>   start, after upload has already succeeded.
> - **`no-undef` over both new modules + `index.js`, clean, with a control**
>   proving the run can fail. `eslint.config.js` still does not enable it for
>   `functions/`, so an un-injected dep would otherwise surface as a
>   ReferenceError inside a payment handler.
> - **Exit criterion 2 is met:** `test:payment-lifecycle-emulator` (35
>   assertions, real Firestore emulator), `test:lenco-webhook`,
>   `test:payment-contract`, `test:payment-initiation`, `test:admin-payments` all
>   green on the final state; plus 713 node scripts, 3,827 Vitest tests, build.
>
> Two defects batch 2 recorded were hit again and fixed the way it fixed them,
> which is the value of having written them down:
>
> 1. **TDZ.** `CHAT_HEARTBEAT_MS` is a `const` declared below the build point and
>    `apiAiChat` closes over it. Hoisted beside `ZED_CHAT_MODEL`.
> 2. **Span attribution.** The deps object names `anthropicApiKey`/`openaiApiKey`,
>    and `aiEndpointDiscovery` attributes every line to the nearest preceding
>    `exports.X` — so placed mid-file it made an unrelated export look
>    provider-backed. It now sits ahead of every export, where it belongs to no
>    span.
> 3. **Path-keyed inventories went stale, loudly.** `aiProviderCallInventory`'s
>    `apiAiChat` row re-pointed to `httpSurfaceHandlers.js`; the generator
>    inventory's `functions/index.js` composite record is now GONE rather than
>    shrunk, because nothing provider-backed remains inline there.
>
> **This does not close Phase 5.** Exit criteria 3 (audit burn-down — separate
> PRs, by the rule above) and 4 (backup/restore drill, which needs production
> access) are untouched by this batch and remain open. `setUserRole` still reads
> `inline: true`: that is the one-line v1 builder chain
> `functions.auth.user().onCreate(userRoleTrigger)`, whose handler already lives
> in `account/userRoleTrigger`. Criterion 1's "every inline handler in a domain
> module" is satisfied for it; the manifest's `inline` flag means "the builder is
> written in index.js", which is not the same question.

> **Phase 5: BOTH GATES CLEAR (2026-08-12).** Batch 2 was paused on 2026-08-09
> pending (a) Cloud Functions error monitoring and (b) the manifest's
> `optionsUnresolved` blind spot. Both are now closed:
>
> - **Gate (a) — CLOSED 2026-08-12.** The owner ran the drill from /admin →
>   Developer tools. `sendTestFunctionErrorAlert` injected a synthetic memory
>   kill, the REAL `runFunctionErrorWatch` fired, and a CRITICAL email arrived
>   at 22:10:22+02 — *"Cloud Functions: 1 function(s) killed for memory"*,
>   naming `zedexams-alarm-drill`, marked SYNTHETIC ALARM DRILL. That proves
>   the whole path (classifier → thresholds → channel → secret bindings), which
>   is what the drill exists for: a mailer test would have proved only the last
>   link.
> - **Gate (b) — CLOSED 2026-08-12.** `optionsUnresolved` is 0 across all 195
>   exports (#2263, #2290, #2310), and no export's options record the NAME of a
>   const in place of its value (this PR — 21 regions). See "Guard gap" below.
>   No named exemptions were needed.
>
> The stated blocker is therefore satisfied. **Scheduling the next batch is a
> separate decision** — it deploys Functions, so it wants a hold window and the
> deployment boundary below, not an automatic start.
>
> The reason for the pause was never that the extractions were unsafe — 1b's
> post-deploy check found no fault in it — but that the verification only
> worked because someone read Cloud Logging by hand. Sentry is frontend-only
> and reported zero while Cloud Logging held 80 errors, so the next batch would
> have deployed into the same blind spot. Migrating more Functions before we
> can SEE Functions fail is ordering the work backwards. #2202 is not reverted.
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
>   22, bare node is 43 MiB). Every v2 instance pays it, because every export
>   deploys from one source — so it is on the cold start of every function in the
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
| 2 | secrets-bound | derive from the manifest (23 on 2026-08-09; was 21 at PR-zero) | **UNBLOCKED 2026-08-12** — both gates closed (see the ledger). Standard CI + secrets bindings pinned by the guard, which now reads every export's options. Scheduling is a separate decision: this batch deploys Functions |
| 3 | payment/webhook + audit-surface | 11 | **EXTRACTED 2026-08-14** on owner instruction, over the standing "deferred until external review coverage is restored" hold — that hold was the owner's to lift and they lifted it. The mandatory suites ran and are green (see the ledger); the audit burn-down on these same surfaces is still a SEPARATE PR and is still outstanding |

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

## Guard gap — CLOSED 2026-08-12 (recorded 2026-08-09, owner instruction)

**`optionsUnresolved` is 0.** Every one of the 195 exports has its frozen
options read from wherever they are actually declared. Derive it, do not trust
this line:

    node -e "const m=require('./scripts/functions-manifest.json').exports; \
      console.log(Object.values(m).filter(e => e.optionsUnresolved).length)"

It was 141 of 192 on 2026-08-09, 131 then 54 of 194 on 2026-08-10, 5 of 195
after #2290, and 0 after #2310. Memory had been separately protected since
#2231/#2233, but that was one option; the rest — region, timeout, secrets, App
Check enforcement, concurrency, min-instances — were recorded as unreadable,
which is what the owner's instruction was about.

**A count of 0 was not the whole gap, and #2310 briefly said it was.** An
export can be "resolved" and still record the NAME of a const rather than what
it holds: 21 rows froze `region: REGION` / `region: PASSKEY_REGIONAL_REGION`,
so swapping which const an option read was caught and changing the const's
value was not. #2310's text credited that fix to a PR that had not merged —
this PR is the one that makes it true. Region is the first thing
architecture.md § Phase 5 freezes, so the claim mattered.

`scripts/functions-unresolved-baseline.json` stays, empty. It is the RATCHET,
not a to-do list: a new blind export fails `test:functions-manifest` and has to
be added there WITH the reason it cannot be read — a decision made on the
record rather than a row that quietly appears. Control-verified by adding a
second builder to a factory and watching two exports fail as NEW unguarded.

The shapes that defeated the follower, and where each was closed. **Re-derive
the current number before acting on any of this** — the history is here because
the numbers were quoted against each other and did not reconcile, which is the
failure this file now warns about everywhere:

| shape | 08-09 | 08-10 | #2290 | #2310 | now |
|---|---|---|---|---|---|
| destructured binding — `const {x} = require("./mod")` | 65 | 0 | 0 | 0 | **0** |
| `require("./x").y` inline in the export | 19 | 0 | 0 | 0 | **0** |
| factory call — `exports.x = createX(secret)` | 48 | 49 | 0 | 0 | **0** |
| module-local factory — `x: makeTrigger("path")` | — | 4 | 4 | 4 | **0** |
| v1 chained builder — `functions.region().runWith()…` | — | 1 | 1 | 1 | **0** |
| option VALUE is a const's NAME (`region: REGION`) | — | — | 21 | 0 | **0** |
| **total unresolved** | **141** | **131 → 54** | **5** | **5** | **0** |

The last two shapes are the ones worth remembering, because both were invisible
rather than merely unread:

- **A module-local factory's ARGUMENTS are frozen nowhere.** An index.js
  factory's call site is recorded verbatim in `target`; a factory called inside
  its own module has no such record. So `document: documentPath` had to become
  `document: "quizzes/{quizId}/questions/{questionId}"` — otherwise the
  collection a Firestore trigger fires on was guarded by nothing at all. This
  is why arguments are substituted for module-local factories and deliberately
  NOT for index.js ones.
- **A v1 chain spreads its surface across the chain.** Region is an argument to
  `.region()`, runtime options are the `.runWith({…})` literal, and the EVENT —
  `auth.user().onDelete` — is the trigger's whole meaning. All three are read,
  and the event is canonicalised to the spelling `extractExports` already
  produces for index.js's v1 triggers so the same trigger written either way
  compares alike.

### What this gap is NOT

**It does not make Batch 2's membership wrong, and an earlier revision of this
section claimed it did.** That was incorrect, and the correction matters
because it changes what "closing the gate" has to achieve:

- `optionsUnresolved` is only ever set on delegated or factory entries;
  `extractExports()` marks both `inline: false`; the generator assigns every
  non-inline entry `batch: null`. **0 of them carry a batch at all.**
- Every Batch 2 entry is an inline builder whose options are read directly from
  `index.js`: **22 of 22 are `inline: true` with `optionsUnresolved: null`.**

So the extraction boundary IS verifiable from the manifest today. What is not
verifiable is the frozen surface of the 141 modular exports — which is a real
problem, and the owner's stated reason for the gate, but a different one from
"the batch list is wrong".

**A hand-owned classification is also still available.** `classification`
survives regeneration whenever its risk rank is at least the generated seed, so
an unresolved export CAN be marked `secrets-bound` by audit. Only the automatic
*seed* is unable to infer it from an empty options map. An earlier revision said
such entries "can never earn that classification"; they can, by hand.

That distinction is what makes the nine modular exports whose modules declare
`secrets:` — `backupCompletionCheck`, `dailyFirestoreBackup`,
`storageBackupCheck`, `storageBackupHeartbeat`, `opsHeartbeatCheck`,
`rateLimitHealthCheck`, `recordAgeGateAttempt`, `sendGuardianConsent` (all
seeded `mechanical`) and `apiGuardianConsent` (`audit-surface`) — a manual
audit item rather than a blocked migration. **None of them is inline, so none
was ever in any batch, and nothing has been mis-migrated.**

### Batch 2's real baseline is DERIVED, not written down

The table above this section says 21, inherited from PR-zero's estimate. The
manifest said 22 when this gap was first recorded and says **23** a few merges
later (#2228 added `accountPurgeSweep`, a secrets-bound scheduled function).

That drift is the point: **do not trust a number typed into this file.** Derive
it, every time:

    node -e "const m=require('./scripts/functions-manifest.json').exports; \
      console.log(Object.values(m).filter(e => e.batch === 2).length)"

Reconciliation that starts from a stale figure omits a handler. Every one of
the 23 is `inline: true`, `optionsUnresolved: null` and `secrets-bound` —
checked, not assumed.

### What closing this gate required — done

1. ~~Map destructured `require()` bindings~~ — #2263.
2. ~~Treat `require("./x").y` as a delegation~~ — #2263. This is what hid
   `apiTrackVisit`'s `128MiB`.
3. ~~Read the factory~~ — #2290 (index.js and module factories), this PR
   (module-local factories with argument binding, and the v1 chain).
4. ~~Re-derive `classification` after following~~ — #2263 and #2290, 51
   escalations, all `mechanical → secrets-bound` on `inline: false` exports, so
   batch membership never moved.
5. **Keep the ratchet at 0.** It may not go up without a named reason written
   into `scripts/functions-unresolved-baseline.json`.

**Closure criterion, as stated on 2026-08-09: every export either resolved, or
exempted by name with the guarding test named. There are no exemptions —
everything is resolved.**

### Where the reader stops, and why

Consistent with the extractor's founding decision — *"deliberately NOT a JS
evaluator"* — but no longer a surprise waiting to be found:

- ~~**An option whose VALUE is a bare identifier is frozen as that
  identifier.**~~ **CLOSED.** All 21 `region: <identifier>` rows now hold real
  values — 17 `REGION` and, across an import hop, 4
  `PASSKEY_REGIONAL_REGION`. Both halves are mutation-verified.
- **A bare-identifier value that is a factory PARAMETER stays a token, on
  purpose.** Ten rows remain: nine `secrets`/`enforceAppCheck` shorthands and
  one `opsAlertSecrets`, every one of them a parameter of the factory rather
  than a declaration. The reader declines to invent a value for them, and it
  does not need to — the ARGUMENT is frozen verbatim in `target`, so changing
  which secrets are handed in is caught. The one thing still invisible is a
  factory rewriting how it assembles a local (`const secrets = [a]; if (b)
  secrets.push(b)`), which the resolver refuses to read precisely because
  reporting the initializer would assert `[a]` when the value may be `[a, b]`.
  A confidently wrong answer is worse than a vague one.

### What #2263 also found: "resolved" was not the same as "read"

Closing shapes 1 and 2 surfaced a defect in the follower that predates the gate
and is worse than the gate itself, because it does not look like a gap.
`optionsUnresolved: null` with `options: {}` reads as *followed successfully,
this function declares no options* — and the guard then defends an empty set
for ever. Two source shapes produced it:

- **The options are an identifier.** `onSchedule(HOURLY_MONITOR_OPTS, …)`.
  Eighteen exports, eleven of them in `agents/cron.js`, several binding eight
  secrets apiece. The follower read only object literals.
- **The options are spread in.** `{document: "quizzes/{quizId}", ...COMMON_OPTS}`.
  A spread has no `:`, so the parser committed nothing for it and
  `onQuizWritten` recorded its document path and *nothing else* — its
  `africa-south1` pin, the one option CLAUDE.md calls routing-critical, was
  outside the guard.

A third shape joined them in #2290 — a **shorthand property** (`{secrets,
timeoutSeconds: 300}`) also has no `:`, so `generateVisualNotes` recorded a
timeout and a memory limit and NO secrets binding: populated enough to look
like a clean read. A fourth was a comment sitting between `onCall(` and its
options object, which left the reader looking at `//`. Both were caught by the
test written for the first two, which is the point of writing it.

Only three rows were visibly affected on `main` (`pastPapersIndexOnWrite`,
`rebuildPastPapersIndexCron` empty; `onQuizWritten` partial) because the other
fifteen were unreachable anyway — so the mechanical fix would have converted
fifteen honest blind spots into false greens. Both shapes are now resolved
(identifiers against their `const`, spreads expanded recursively), an
identifier that cannot be resolved is reported unresolved rather than
flattened, and two tests pin it: one scans the manifest for resolved-but-empty
and unexpanded-spread rows, the other drives a synthetic module through the
follower with a positive and a negative control.

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

Status as of 2026-08-14. Re-derive rather than trusting these marks — the
manifest is the authority for 1, and a test run is the authority for 2.

1. ✅ **MET.** `functions/index.js` reduced to exports; every inline handler in a
   domain module; drift guard green throughout. Derive:
   `node -e "const m=require('./scripts/functions-manifest.json').exports;
   console.log(Object.values(m).filter(e=>e.inline).length)"` → 1, which is
   `setUserRole`'s v1 builder chain, whose handler is already modular
   (see the 2026-08-14 ledger entry).
2. ✅ **MET on the final state** (2026-08-14): payment-lifecycle emulator +
   webhook-signature suites green, alongside the full node and Vitest suites and
   a production build.
3. ⬜ **OPEN.** Audit burn-down complete (separate PRs, external review
   restored). Untouched by any extraction batch, by the rule that these never
   ride along with a relocation.
4. ⬜ **OPEN.** **Backup/restore drill re-run** — architecture.md §1129 re-arms
   the restore rehearsal after Phase 5, by original instruction. This is an exit
   criterion, recorded early rather than discovered at completion. It needs
   production access, so it is owner-side.

**Phase 5 is therefore NOT closed.** Two of four criteria remain, and neither is
an extraction.
