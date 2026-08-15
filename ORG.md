# ZedExams Operating Model — The AI Agent Company

> Internal operating model. ZedExams runs as a small company of AI agents,
> each one accountable for a department. A human owner (you) holds final
> approval on every customer-visible action.

## Mission

Make Zambian Competence-Based Curriculum (CBC) learning and assessment
delightful, affordable, and trustworthy — by letting AI agents do the
repeatable work (drafting lesson plans, grading, generating questions, QA)
while a human owner approves what reaches learners and teachers.

## Operating Principles

1. **Human-in-the-loop.** Every artifact that ships to learners, teachers,
   parents, or social channels passes through `awaiting_approval` first.
2. **KB-grounded.** Content agents must cite the verified CBC knowledge base
   (`functions/teacherTools/cbcKnowledge.js`). No hallucinated outcomes.
3. **Cost-bounded.** Each agent has a daily Anthropic token cap enforced in
   `usageMeter.js`. Crossing 80% of cap pauses the agent.
4. **Reversible.** Published artifacts can be soft-deleted by an admin.
   No agent has destructive privileges.
5. **One queue.** All agent work flows through the `agentJobs` Firestore
   collection. No side channels, no shadow state.

## Org Chart

```
                       ┌──────────────────────┐
                       │   Human Owner (you)  │
                       └──────────┬───────────┘
                                  │ approves / pauses / sets policy
            ┌─────────────────────┴─────────────────────┐
            │                                           │
   ┌────────▼─────────┐                       ┌─────────▼──────────┐
   │  Content Dept.   │                       │   QA / Eng Dept.   │
   │                  │                       │                    │
   │  Aria   (Author) │                       │  Quill  (QA Smoke) │
   │  Cala   (CBC)    │                       │  Rex    (Code Rev) │
   │  Reva   (Review) │                       │  Ledger (Releases) │
   │  Pubo   (Publish)│                       │  Vex    (Quiz QA)  │
   │                  │                       │  Mendi  (Bug Fix)  │
   │                  │                       │  Vigil  (Monitor)  │
   └──────────────────┘                       └────────────────────┘
```

The chart above is the V1 skeleton. The company has since grown to five
departments — Revenue, Support and Growth shipped once the queue and
approval flow were proven. Current authoritative roster (mirrored for the
HQ in `src/utils/companyOrg.js`):

| Department | Agents | Trigger |
|---|---|---|
| **Content** | Aria, Cala, Reva, Pubo, Qix, Compass, Gate | agentJobs pipeline + cron + questionBank trigger |
| **QA & Engineering** | Vex, Quill, Vigil, Marshal, Rex, Ledger, Mendi | sync / cron / CI / on-demand (Rex) |
| **Revenue** | Till | hourly cron (Lenco reconcile) |
| **Support** | Echo, Bonga | 2-hourly cron (feedback triage) + WhatsApp webhook |
| **Growth** | Anchor, Dawn | weekly cron / on-demand managed agent |

Finance is not a department of agents but a *function*: the nightly
`ai-cost-daily-summary` cron feeds the Treasury, and the revenue-linked
budget governor (below) is the company's CFO.

## Agent Cards

### Content Department

#### Aria — Content Author
- **Mission:** Draft a CBC-aligned artifact (lesson plan, worksheet, scheme
  of work, rubric, flashcards, notes) from a brief.
- **Inputs:** `{ tool, grade, subject, topic, term, brief }`
- **Outputs:** `agentJobs.output.draft` — JSON shaped by the matching tool
  schema in `functions/teacherTools/*Schema.js`.
- **Wraps:** existing `runLessonPlan`, `runWorksheet`, `runFlashcards`,
  `runSchemeOfWork`, `runRubric`, `runNotes`.
- **Escalates to:** Cala when draft is ready.
- **Human owner:** Content lead.

#### Cala — CBC Alignment Officer
- **Mission:** Validate Aria's draft against the verified Zambian CBC KB;
  flag drift, attach citations, mark gaps.
- **Inputs:** Draft + `{ topic, grade }`.
- **Outputs:** `{ aligned: bool, citations: [...], gaps: [...] }`.
- **Wraps:** `functions/teacherTools/cbcKnowledge.js` `resolveCbcContext()`.
- **Escalates to:** Reva when alignment is good; back to Aria on gaps.

#### Reva — Content Reviewer
- **Mission:** Pedagogy + tone + age-appropriateness review. Suggests edits
  but never auto-applies them.
- **Inputs:** Aligned draft.
- **Outputs:** `{ verdict: 'approve' | 'revise' | 'reject', edits, severity }`.
- **Wraps:** `functions/aiService.js` `callAnthropic()` (Sonnet 4.5).
- **Escalates to:** sets parent job status to `awaiting_approval` so the
  human owner can decide in `/admin/agents`.

#### Pubo — Publisher
- **Mission:** On admin approval, write the final artifact into
  `aiGenerations` and any cross-collections (e.g. `quizzes`).
- **Inputs:** Approved `agentJobs` doc.
- **Outputs:** `aiGenerations` doc + `agentJobs.publishedRefs`.
- **Wraps:** the existing admin-SDK write path used by the teacher tool
  Cloud Functions. Pubo is the **only** agent with publish privileges.

#### Qix — Question Bank Reviewer
- **Mission:** Review every captured question for the Central Question Bank —
  deterministic dedup (exact/near-text + semantic embedding) then a Haiku
  quality + curriculum/grade-fit review — and gate it into the Master Bank.
  Fail-closed to `needs_admin` on any error; a dedup hit short-circuits with
  no model call.
- **Inputs:** a `questionBank/{id}` doc at `reviewStatus: 'pending_review'`.
- **Outputs:** `{ reviewStatus, masterEligible, duplicateOf, aiReview }`;
  verdicts surface in `/admin/question-review`.
- **Wraps:** `functions/agents/questionReview.js` + `questionDedupCore.js` +
  `questionEmbeddingCore.js` (Anthropic Haiku). Runs off the `questionBank`
  trigger, **not** `agentJobs` (per-question volume would drown the feed).
  Circuit breaker: `agentControl/qix.paused`.

### QA / Engineering Department

#### Quill — QA Smoke Runner
- **Mission:** Refresh `.auth-qa-report.json` and `.authoring-qa-report.json`
  (local run outputs — untracked/gitignored since Phase 6, 2026-08-15) every
  night; surface regressions as queued `agentJobs`.
- **Schedule:** `every day 02:00` (Africa/Lusaka).
- **Wraps:** `scripts/check-file-integrity.mjs`,
  `scripts/test-question-schema.mjs`, `npm run smoke`.

#### Rex — Code Reviewer
- **Mission:** Review a PR diff for repo conventions, schema/rule changes,
  secrets, and Anthropic cost regressions.
- **Trigger:** On demand only — invoke the `code-reviewer` subagent with a
  diff. There is no automatic per-PR run.
- **Outputs:** Review notes back to whoever invoked him.
- **Wraps:** `.claude/agents/code-reviewer.md`.
- **Why there is no GitHub Action (2026-08):** there was one, on
  `pull_request: [opened, synchronize]` — so it billed the Anthropic API on
  *every push to a PR branch*, not once per PR. It was never a required
  check, so it could not block a bad merge, and four of its five checks are
  already enforced deterministically by required CI: secrets by
  `test:secret-hygiene`, rules/indexes by `test:rules-text`, the
  `callAnthropic`-without-`usageMeter` cost regression by
  `test:ai-provider-inventory` (which auto-discovers new provider-backed
  endpoints, so it is *stronger* than reading a diff), and conventions by
  `test:ai-dev-guide`. Paying per push for a weaker copy of free checks is
  what got cut. Rex himself still exists — he is just called when wanted.

#### Ledger — Release Notes
- **Mission:** Once a day, summarize the PRs that landed on `main` into a
  CHANGELOG PR.
- **Trigger:** GitHub Action on `schedule: 0 20 * * *` (22:00 Africa/Lusaka),
  plus `workflow_dispatch`. **Not** per-push: the branch, PR title and section
  heading are all keyed to the date, so a second run the same day only
  rewrites the same document.
- **Outputs:** PR titled `chore: changelog for <date>` updating
  `docs/CHANGELOG.md`.
- **Wraps:** `@octokit/rest` + `scripts/agents/releaseNotesCore.mjs`.
  **No model, no secret** — the workflow holds no Anthropic key.
- **Why deterministic (2026-08).** It was measured before the model was
  dropped: only 39% of this repo's commits carry a conventional prefix, and 15
  of those 21 were Dependabot, so ~15% of human commits are machine-
  classifiable. But the unprefixed 61% are already well-formed sentences
  ("Move the admin shell into src/features/adminShell") — the model was mostly
  paraphrasing good prose into different good prose. Ledger now buckets what
  carries a prefix, prints the rest VERBATIM under `Changed`, and collapses
  Dependabot to one line. The draft PR states how many entries were classified
  versus merely listed, so a human knows where to look. For a release that
  genuinely wants polished prose, invoke the `release-notes` subagent on the
  drafted section — that runs on a session, not on an API key.
- **Was silently a no-op until 2026-08.** It collected work with
  `git log --merges`, but this repo squash-merges, so `main` carries no merge
  commits — the query returned empty every run and it exited before its API
  call. Zero changelog PRs merged in the 21 days before the fix. It now walks
  `--first-parent` over an exact range (the commit that last touched the
  changelog `..HEAD`, so an entry is never restated) and drops its own
  changelog commits. Selection rules are pure and tested:
  `scripts/agents/releaseNotesCore.mjs`, `npm run test:release-notes`.

#### Mendi — Bug Fixer
- **Mission:** Turn a reported breakage into a permanent fix plus the
  regression test that stops it recurring. Fixes the root cause, never the
  symptom; leaves the codebase more defensive than it was found.
- **Trigger:** GitHub Action on `issues: [labeled]` (the `bug` label) or a
  `/mendi` comment from a maintainer.
- **Outputs:** A **draft** PR with the fix + a regression test, linked back
  on the issue. Never pushes to `main`.
- **Wraps:** `anthropics/claude-code-action` (Sonnet) driven by the
  `.claude/agents/bug-fixer.md` contract, with `ANTHROPIC_API_KEY` GitHub
  repo secret.
- **Notable exception:** like Ledger, Mendi runs in CI rather than
  through the `agentJobs` queue — it needs real file/Bash tools to reproduce,
  edit, and verify, which a queued runner can't provide. Every change still
  lands behind human review as a draft PR.

#### Vigil — Site Monitor
- **Mission:** Every hour, sweep four surfaces and catch breakage before a
  learner does: **pages** (hosting origin + key routes respond, not 5xx),
  **Firebase** (Firestore reads + Storage bucket reachable), **images** (a
  sample of content image URLs resolve), and **quizzes** (a sample of
  published quizzes pass the same structural checks Vex enforces).
- **Trigger:** Scheduled Cloud Function `hourlyMonitor` (`every 1 hours`,
  Africa/Lusaka).
- **Outputs:** An `agentJobs` rollup (`output.vigil`) the `/admin/agents`
  dashboard surfaces. On failure it asks Haiku for likely causes + fixes,
  then escalates — **de-duplicated to once per failure per 24h** — via an
  alert email to `OPS_ALERT_EMAILS` and a GitHub **`bug`** issue, which **Mendi**
  can pick up and turn into a draft fix PR.
- **Wraps:** `functions/agents/runners/monitor.js`; Anthropic Haiku 4.5 for
  the (failure-only) fix suggestions. Deterministic checks run free every
  hour; tokens are spent only when something is actually wrong.
- **Notable exception:** like the other QA/Eng agents that need to reach out
  of Firestore, Vigil runs as a cron rather than through the `agentJobs`
  queue, but it still writes its result there for visibility.

#### Vex — Quiz Verifier
- **Mission:** Pre-publish quality check on quizzes — answer accuracy,
  grade fit, clarity, grammar, options quality, and CBC alignment.
  Returns a 0–100 Quality Score with a tiered blockers / warnings list.
- **Trigger:** Synchronous callable `verifyQuiz`, invoked by the quiz
  editor when an admin clicks **Verify & publish**.
- **Outputs:** `{ verdict, overallScore, scores, summary, blockers[], warnings[] }`
  returned directly to the caller — no Firestore writes, no audit doc.
- **Wraps:** `functions/agents/runners/vex.js` (Anthropic Haiku 4.5)
  layered on top of deterministic structural checks (empty / duplicate
  / out-of-range options).
- **Notable exception:** Vex is the **only** agent that does not flow
  through the `agentJobs` queue. Quiz authors expect Grammarly-style
  instant feedback; queueing breaks that loop. Cost is metered through
  the existing `aiUsage/{uid}_{day}` per-user daily limit.

#### Marshal — Operations Supervisor
- **Mission:** The watchdog for the watchdogs. Every hour, confirm each
  scheduled agent actually ran within its expected window, and surface stuck
  jobs (running/queued far too long), tripped `agentControl` breakers, and
  recent failures — rolled into one company-health verdict.
- **Schedule:** `every 1 hours` (`hourlyAgentSupervisor`, Africa/Lusaka).
- **Watches (fixed-cadence rollups only):** Vigil, Till (hourly), Echo (2h),
  Quill (daily), Cala-audit, Compass, Anchor (weekly). Event-driven /
  on-demand agents (the content Gate, Dawn, the Aria-Reva pipeline, Vex) have
  no fixed cadence and are deliberately not freshness-checked.
- **Outputs:** an `agentJobs` rollup (`output.marshal`, status
  `awaiting_approval` when something is wrong so it joins the approvals badge),
  surfaced as the health strip on `/admin/company`.
- **Wraps:** `functions/agents/runners/marshal.js` — deterministic, no LLM, no
  secrets, only indexed reads. `assessFleet` is pure + unit-tested
  (`marshal.test.js`). db injected.

## Handoff: Lesson-Plan Pipeline

```
teacher submits brief
        │
        ▼
   agentJobs (queued, agentId=aria)
        │  dispatcher trigger
        ▼
   Aria runs ─► writes output.draft ─► enqueues child {agentId=cala}
        │
        ▼
   Cala validates ─► writes output.alignment ─► enqueues {agentId=reva}
        │
        ▼
   Reva reviews ─► sets parent status=awaiting_approval
        │
        ▼  (admin clicks Approve in /admin/agents)
        │
   Pubo runs ─► writes aiGenerations doc ─► sets agentJobs.status=done
                                            with publishedRefs
```

## Invocation Cheatsheet

| Where | How to invoke |
|---|---|
| Claude Code (dev workstation) | `Use the content-author subagent to draft a Grade 6 Maths lesson on fractions.` |
| App (teacher-facing brief form) | Posts to `agentJobs` collection; dispatcher does the rest. |
| PR review (Rex) | On demand: `Use the code-reviewer subagent on this diff.` No automatic per-PR run. |
| GitHub issue (Mendi) | Add the `bug` label, or comment `/mendi`. Opens a draft fix PR. |
| Cron (Quill nightly, weekly Cala audit, Vigil hourly) | Scheduled Firebase Function. |

## Escalation Paths

- **Agent error:** dispatcher sets `status=failed, error=<msg>`. Surfaced in
  `/admin/agents` with a Retry button. Three failures in one hour pauses
  the agent via `agentControl/{agentId}.paused = true`.
- **Cost cap hit:** `usageMeter.js` returns 429-style; agent goes to
  `awaiting_approval` so a human can lift the cap or wait until tomorrow.
- **Bad output published:** admins soft-delete via the existing
  `aiGenerations` admin update rule. The originating `agentJobs` doc keeps
  the audit trail.

## Owner-Of Matrix

| Area | Owning agent | Human reviewer |
|---|---|---|
| `functions/teacherTools/*` runners | Aria | Content lead |
| `functions/teacherTools/cbcKnowledge.js` | Cala | Curriculum lead |
| Editorial voice / tone | Reva | Content lead |
| `aiGenerations` writes | Pubo | Admin on duty |
| `.auth-qa-report.json`, `.authoring-qa-report.json` | Quill | Eng lead |
| PR reviews | Rex | Eng lead |
| `docs/CHANGELOG.md` | Ledger | Eng lead |
| Bug fixes (draft PRs) | Mendi | Eng lead |
| Site health (pages, Firebase, images, quizzes) | Vigil | Eng lead |
| Cloud Functions error volume (Cloud Logging) | `functionErrorWatch` (not an agent) | Eng lead |

## Cost Budget (per agent, per day)

| Agent | Daily Anthropic input/output cap | Notes |
|---|---|---|
| Aria | 1,000,000 / 200,000 tokens | Heaviest agent; serves real briefs |
| Cala | 200,000 / 50,000 tokens | KB grounding only |
| Reva | 300,000 / 100,000 tokens | Editorial review |
| Pubo | 0 / 0 tokens | No LLM call; deterministic write |
| Quill | 50,000 / 10,000 tokens | Mostly script orchestration |
| Rex | n/a — no API spend | Subagent only; runs on the caller's session, not the agents key |
| Ledger | 0 / 0 tokens | No LLM call; deterministic assembly from commit subjects |
| Mendi | 500,000 / 100,000 tokens | One multi-turn fix per bug issue |
| Vigil | 50,000 / 20,000 tokens | One small Haiku call only on failed hours |
| Vex | 100,000 / 30,000 tokens | One Haiku call per Verify & publish |
| Qix | 200,000 / 40,000 tokens | One Haiku review per new question; dedup hits skip the call |
| Bonga | 200,000 / 60,000 tokens | One Haiku reply per inbound WhatsApp message |

Caps are enforced via `functions/teacherTools/usageMeter.js` keyed by a
synthetic ownerUid `agent:<id>` so per-agent spend is auditable in
`usageMeters/`.

## Treasury & Self-Funding

> How the company pays for its own API. Model: `functions/treasury.js`
> (pure, node-tested in `functions/treasury.test.js`), mirrored on the
> client in `src/utils/treasury.js`. Read-out: **/admin/company** ("AI
> Company HQ").

The company has exactly one material running cost — AI API spend
(Anthropic / OpenAI / Gemini), tracked in USD by `aiCostTracking.js`
(`aiUsage/{date}`, `aiUsageMonthly/{month}`). It has exactly one income —
subscriptions in ZMW through Lenco (`payments/{id}`, `amountZMW`). The
agents exist to make those subscriptions worth buying.

**The self-funding rule.** The company may spend at most a fixed
*reinvestment fraction* of the revenue it has **actually earned this
month** on model calls:

```
revenueUsd       = month-to-date ZMW revenue ÷ assumed ZMW/USD rate
derivedBudgetUsd = revenueUsd × reinvestRatio        (default 30%)
```

Because the existing month-to-date budget gate in `aiCostTracking.js`
(`getBudgetStatus` → `callAnthropic` / `callClaude`) already refuses new
AI calls once spend reaches the ceiling, pointing that ceiling at
`derivedBudgetUsd` instead of a fixed env number makes spend *structurally
incapable of outrunning income*. The company self-funds.

**Key numbers the HQ surfaces** (all from `computeTreasury`):

| Metric | Meaning |
|---|---|
| Self-funding ratio | `revenueUsd / apiCostUsd` — must stay ≥ 1× to be sustainable |
| Gross margin | revenue minus AI cost, as a % of revenue |
| Derived AI budget | the revenue-linked ceiling above |
| Budget headroom / runway | how much / how many days of spend remain under the ceiling at today's burn |
| Status | `idle` · `bootstrapping` · `healthy` · `tight` (≥80%) · `over` (governor would pause) |

**Assumptions, made explicit.** The ZMW/USD rate only puts ZMW revenue on the
same axis as USD spend, and is editable in the HQ. A daily cron
(`dailyFxRefresh`) fetches the live rate and writes it to `settings/fxRate`;
the budget path reads that **cached** value (never a live network call, so an
FX outage can't block AI) and falls back to `AI_TREASURY_ZMW_PER_USD` / 26
whenever the doc is missing, stale (> 8 days), or out of the sane 5–100 band.
The fetched value is range-checked before it's written, and a bad fetch leaves
the last good rate untouched (`functions/fxRate.test.js`).

**Arming the governor (off by default).** The governor is **wired** into
`aiCostTracking.getBudgetStatus()` (tested in
`functions/aiBudgetRevenueLinked.test.js`) but dormant: `AI_BUDGET_MODE`
defaults to `static`, so production behaviour is unchanged until the owner
arms it. Both ceiling paths fail open, and a $0 derived ceiling (no revenue,
no floor) falls back to the static budget so arming can never brick AI. To
switch the static `AI_MONTHLY_BUDGET_USD` ceiling over to the revenue-linked
one, set on the Cloud Functions runtime:

| Env var | Default | Effect |
|---|---|---|
| `AI_BUDGET_MODE` | `static` | `revenue_linked` arms the self-funding ceiling |
| `AI_REVENUE_REINVEST_RATIO` | `0.30` | fraction of revenue spendable on AI |
| `AI_TREASURY_ZMW_PER_USD` | `26` | FX assumption for the read-out |
| `AI_BUDGET_FLOOR_USD` | `0` | minimum AI budget for the pre-revenue bootstrap |

## Company HQ (`/admin/company`)

A single admin surface that renders the whole company at a glance: the
Treasury read-out above, the org chart across all five departments (live
paused/active state from `agentControl`), and a recent-activity feed from
`agentJobs`. It reads live Firestore data and falls back to a clearly
labelled **Preview** (representative seed numbers) when a month has no real
revenue or spend yet, so the HQ is legible from day one. Read-only —
agent pause/resume controls stay in `/admin/agents`.

## Changelog of the Org Itself

- **2026-05-08** — Operating model bootstrapped. Roster: Aria, Cala, Reva,
  Pubo, Quill, Rex, Ledger. Phase 1 skeleton landed.
- **2026-05-09** — Vex (Quiz Verifier) added to QA / Eng. Synchronous
  pre-publish quality check on quizzes; explicitly off the `agentJobs`
  pipeline so teachers get Grammarly-style instant feedback.
- **2026-06-02** — Mendi (Bug Fixer) wired into QA / Eng. Runs in CI via
  `anthropics/claude-code-action` on the `bug` label / `/mendi` comment,
  driven by the existing `.claude/agents/bug-fixer.md` contract; opens a
  draft fix PR for human review.
- **2026-06-02** — Vigil (Site Monitor) added to QA / Eng. Hourly
  `hourlyMonitor` cron checks pages, Firebase, images, and quizzes; suggests
  fixes (Haiku) and escalates failures via email + a GitHub `bug` issue
  (→ Mendi), de-duplicated to once per failure per 24h. Closes the
  detect → fix loop.
- **2026-06-20** — Treasury & self-funding model landed. `functions/treasury.js`
  (pure, node-tested) + `src/utils/treasury.js` mirror compute the
  revenue-linked AI budget (`revenueUsd × reinvestRatio`) so the company can
  pay for its own API out of the subscriptions it earns. New **/admin/company**
  ("AI Company HQ") surfaces the Treasury read-out, the five-department org
  chart with live `agentControl` state, and a recent-activity feed; it reads
  live data and falls back to a labelled Preview. Roster doc refreshed to the
  real five departments (Revenue/Support/Growth + Compass/Gate/Echo/Anchor/Dawn).
  The governor ships **dormant** — arm it with `AI_BUDGET_MODE=revenue_linked`.
- **2026-06-21** — Revenue-linked governor **wired** into
  `aiCostTracking.getBudgetStatus()`: with `AI_BUDGET_MODE=revenue_linked`
  the monthly AI ceiling becomes `monthRevenueUsd × reinvestRatio` (read from
  `payments`, cached 5 min) instead of the static `AI_MONTHLY_BUDGET_USD`.
  Defaults to `static` (no behaviour change); both paths fail open and a $0
  ceiling falls back to the static budget so arming can't brick AI. Covered by
  `functions/aiBudgetRevenueLinked.test.js` (13 assertions).
- **2026-06-21** — Marshal (Operations Supervisor) added to QA / Eng — the
  watchdog for the watchdogs. Hourly `hourlyAgentSupervisor` cron confirms each
  fixed-cadence scheduled agent ran within its window and surfaces stuck jobs,
  tripped breakers and recent failures into one company-health verdict, shown
  as the health strip on `/admin/company`. Deterministic, no LLM/secrets, only
  indexed reads; `assessFleet` is pure + unit-tested
  (`functions/agents/runners/marshal.test.js`, 23 assertions).
- **2026-08-10** — Sift (Server Error Watch) added and then RETIRED the same
  day, without ever being relied on. It was built for #2230's second half in
  parallel with #2235, which had already shipped `functionErrorWatch` for the
  same purpose; both reached `main` and production ran two Cloud Logging error
  watchers alerting through the same two channels. `functionErrorWatch` is the
  survivor — it landed first, runs every 5 minutes against a 7-minute window
  (vs. Sift's hourly/75-minute), alerts on a SINGLE memory kill, and carries the
  `sendTestFunctionErrorAlert` drill that proves the whole path end-to-end. It
  is a monitoring function, not an agent, so it holds no roster entry; it is
  registered in `docs/architecture/13-cloud-functions-register.md`. The reasoning
  for watching Cloud Logging rather than adding Sentry to `functions/` survives
  in CLAUDE.md, retargeted. Lesson worth keeping: check for an in-flight PR
  against an issue before building, not only the issue and the branch.
- **2026-06-21** — Daily FX auto-refresh for the treasury. A new
  `dailyFxRefresh` cron fetches the live ZMW/USD rate and writes
  `settings/fxRate`; the budget governor + `/admin/company` read that cached
  value (never a live network call) and fall back to `AI_TREASURY_ZMW_PER_USD`
  / 26 when it's missing, stale, or out of band. Range-checked before write; a
  bad fetch keeps the last good rate. `functions/fxRate.js` +
  `functions/fxRate.test.js` (29 assertions).
