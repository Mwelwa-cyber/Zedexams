# AI Development Guide

Binding standards for every AI session (Claude Code, subagents, CI agents) working in this
repository. `CLAUDE.md` is loaded at session start and points here; that makes this guide part
of every session's instructions. It is a **standing standard**, not a snapshot — if reality and
this guide diverge, fix one of them in the same PR.

Enforced in CI by `npm run test:ai-dev-guide` (checks this file exists, keeps its required
sections, and stays referenced from `CLAUDE.md`).

---

## 0. Definition of Ready

A change is **not ready to start** because the request is understood. It is ready when the
facts it depends on have been *read* rather than recalled:

1. **Every symbol you will call has been read at its definition** — signature, return shape,
   one live call site (`grep -rn "export .*<name>" src/ functions/`). Import paths especially:
   directories here have moved (`src/schemas/` → `src/shared/schemas/`,
   `src/components/{admin,quiz,teacher}/` → feature folders), so a path that resolves from
   memory fails at build.
2. **You searched for the thing before writing it.** A duplicate passes its own tests, drifts
   from the original, and surfaces later as a bug. Check whether the file is one of the
   re-export shims onto `functions/shared/assessment` before adding a rule to it — that forks
   the export gate, and `test:shim-guard` fails the build for it.
3. **The guards already pinning that area have been read** — `grep -rl "<module>" scripts/
   src/ functions/ --include="*test*" --include="*spec*"`. Many are text-level guards asserting
   a shape. One that already asserts what you are about to change is a recorded decision; find
   out what it was rather than discovering it from red CI.
4. **A bug has been reproduced before it is fixed.** Error, stack, `file:line`. An unreproduced
   failure is a guess and a guess repairs the symptom. If it cannot be reproduced locally, say
   so explicitly and name what the fix rests on instead.
5. **Mirrors and layering checked** — the constant pairs in §3.4, and the one-way layering
   (`app → features → engines/curriculum → shared/services/config`) enforced by
   `test:import-boundaries`, which resolves dynamic `import()` too.

Scope these to what the change **touches**, not to the repo: a copy edit needs the file read; a
new Firestore field needs the rules, the readers, the writers and the index. The cheap habit
that prevents most rework is reading the whole file you are editing, not the lines around the
edit.

**Assumptions are stated, never carried silently.** Anything you could not verify goes in the
plan, the PR description, or the reply — silence reads as verification, which is what makes a
later correction land as a reversal. **Two corrections on the same change mean the mental model
is wrong, not the line:** stop editing, re-read the source, then continue. A third patch on top
of a guess is how a one-line fix becomes a PR that has to be unpicked.

## 1. Definition of Done

A change is **not done** when it compiles. It is done when all of these hold:

1. `npm run lint` passes.
2. `npm run build` passes.
3. The **relevant** test scripts pass (see §4 for which ones), and any new logic or bug fix
   ships with its own test in the same commit.
4. For user-facing changes: the affected flow was actually exercised end-to-end (run the app
   or the smoke suite; don't declare a UI change done on lint + build alone).
5. The work is on a feature branch, pushed, and has an open PR — never a direct push to `main`.

Never report "done and verified" unless the verification actually ran. If a step was skipped,
say so explicitly in the PR description.

## 2. Coding standards

- **Match the surrounding code.** Same idiom, naming, comment density, and error-handling style
  as the file you're editing. Don't reformat code you aren't changing.
- **Lint config is law.** `eslint.config.js` (flat config) documents the rationale for every
  rule inline. Don't add `eslint-disable` without a one-line reason; don't weaken rules to make
  a PR pass.
- **Routes are lazy.** New routes in `src/app/App.jsx` use `React.lazy()` + `<Suspense>`. Never
  import a page component eagerly. The saved reading theme applies on public routes too, so a
  new public surface must be legible in Midnight (`npm run contrast:routes` gates the key ones).
- **Comments state constraints, not narration.** Write a comment only for something the code
  can't show (a race, an external contract, a deliberate quirk). No "this fixes the bug where…"
  changelog comments.
- **No hard-coded session facts.** Today's date, the operator's email, and model IDs from the
  session header must never be baked into code, tests, or fixtures.
- **Secrets never touch the tree.** Backend keys live as Firebase Functions secrets; frontend
  config is `VITE_*` env vars. `npm run test:secret-hygiene` guards this — keep it passing.
- **Fail closed on trust boundaries.** Anything gating money, publishing, or user data (webhook
  signatures, review verdicts, App Check, usage meters) errs to *deny* on failure, like Qix's
  `needs_admin` fallback and Bonga's HMAC check.
- **Payments and activation are idempotent.** Any path that credits a subscription must go
  through the shared idempotent activation flow — webhooks get retried, reconcilers re-run.

## 3. Schema rules

There are four distinct schema layers. Know which one you're touching:

1. **Client domain schemas — `src/shared/schemas/*.js` (Zod).** Quiz, attempt, result, class records,
   visual assets. Changing a shape here means: update the parallel checks in
   `scripts/test-quiz-attempt-schemas.mjs`, run `npm run test:schema` +
   `npm run test:schemas-domain`, and audit every producer/consumer of that shape.
2. **LLM output schemas — `functions/teacherTools/<tool>Schema.js`.** These describe what the
   model must return, not Firestore docs. Changing one means re-checking the paired
   `<tool>Prompt.js` and the tool's runner, and running that tool's `*.test.js`.
3. **Firestore document shapes.** There is no central registry — the schema *is* the code that
   reads/writes the collection. Any new field or collection requires reviewing
   `firestore.rules` (and `npm run test:rules-text`), and any new query pattern requires the
   composite index in `firestore.indexes.json` **deployed before** the code that needs it
   (`npx firebase deploy --only firestore:indexes` is the one allowed direct deploy).
4. **Mirrored constants.** Some pairs must stay in lockstep — verify both sides when touching
   either:
   - `src/config/curriculum.js` ↔ `functions/teacherTools/cbcKnowledge.js` / `cbcTopics.js`
   - `src/utils/playBillingCatalog.js` ↔ `PLAY_PRODUCT_TO_PLAN` in
     `functions/googlePlayBilling.js` (guarded by `test:play-catalog-mirror`)
   - `src/config/agents.js` ↔ `ORG.md` (agent roster)

**Schema changes are migrations, not edits.** Existing Firestore docs won't have your new
field; readers must tolerate its absence (default it) and writers must not corrupt old docs.

## 4. Test rules

Two suites, split strictly by filename — they never collide:

| Suite | Files | Runner | Use for |
|---|---|---|---|
| Node scripts | `*.test.js`, `scripts/test-*.mjs` | plain `node`, throw on failure | pure logic, parsers, schemas, Cloud Functions helpers |
| Vitest | `*.spec.{js,jsx}` | `npm run test:unit` (jsdom) | React components, hooks, behaviour via `@testing-library/react` |

Hard rules:

1. **Every bug fix ships a regression test in the same commit.** This is the ratchet that stops
   the same bug shipping twice. No exceptions for "trivial" fixes — trivial fixes get trivial
   tests.
2. **New pure logic gets a node test.** Add the test file, then add a `test:<name>` npm script
   whose command starts with `node`. **Never edit `test:all` by hand** —
   `scripts/run-all-tests.mjs` auto-discovers every `node`-command `test:*` script.
3. **New React behaviour gets a `*.spec.jsx`.** Vitest collects it automatically; no script
   registration needed.
4. **Testable logic lives in pure modules.** Follow the `*Core.js` split
   (`metaWhatsAppCore.js`, `googlePlayBillingCore.js`): keep Firestore/model I/O in the shim,
   put decisions in a pure module that tests under plain `node` with no firebase-functions
   dependency. If you can't test it without mocking Firebase, restructure it first.
5. **Run what you touched before pushing.** Minimum ladder:
   - always: `npm run lint && npm run build`
   - logic/schema changes: the specific `test:*` scripts for the touched area
   - anything broad or pre-merge-critical: `npm run test:all` and `npm run test:unit`
   - route/render/layout changes: `npm run smoke`
6. **Tests must be deterministic.** No network, no live Firebase, no wall-clock or locale
   dependence, no reliance on the session's date/email.
7. **Never delete or weaken a failing test to get green.** A failing test is either a real bug
   (fix the code) or a wrong expectation (fix the test *and say why* in the commit message).

## 5. Firebase & Cloud Functions rules

- **Region pinning:** Firestore-triggered functions (`onDocument*`, storage-cleanup, agent
  dispatcher) set `region: "africa-south1"`. HTTP/callable functions stay in `us-central1`.
- **New `/api/*` endpoints** need both the export in `functions/index.js` **and** a rewrite in
  `firebase.json` — the rewrite is what makes SSE work without CORS.
- **Offline is a first-class state.** Multi-tab IndexedDB persistence can fail (old Safari,
  private mode, quota); code paths must survive a fresh-fetch round-trip and queued writes.
- **Agents get circuit breakers.** Any new scheduled/triggered agent honours an
  `agentControl/{agentId}.paused` kill-switch and records failures through
  `functions/agents/circuitBreaker.js`.
- **AI calls are metered and budgeted.** New model calls route through the existing clients
  (`aiService.js`, `openaiClient.js`, `geminiClient.js`) so cost tracking, `usageMeter.js`
  caps, and the treasury budget gate apply. Never instantiate a raw SDK client in a feature.

## 6. Git & deploy discipline

- Work on the designated feature branch; **never** push to `main` directly, even one-liners.
- Commit messages describe the *why* in the subject; keep commits scoped to one concern.
- PRs merge via `gh pr merge --auto --squash` and CI's required checks — never bypass.
- **Off-limits, always:** `firebase deploy --only hosting` and `firebase deploy --only
  functions` from a workstation. CI owns production deploys.
- Index deploys (`--only firestore:indexes`) land **before** the code that queries them.

## 7. Documentation rules

- Don't create new root `*.md` reports/plans/audits unless explicitly asked — findings go in
  the PR description or conversation. Committed status docs need a
  `> Snapshot as of YYYY-MM-DD — verify before acting` header.
- `BUG_REPORT.md` is the single "what's broken" doc — prune it, don't fork it.
- **When architecture changes, update `CLAUDE.md` in the same PR** — a stale CLAUDE.md poisons
  every future session. Same for this guide: it must always describe the repo as it is.
