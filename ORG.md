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

V1 covers Content + QA/Eng only. Growth and Support are deliberately out of
scope until the queue and approval flow are proven.

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

### QA / Engineering Department

#### Quill — QA Smoke Runner
- **Mission:** Refresh `.auth-qa-report.json` and `.authoring-qa-report.json`
  every night; surface regressions as queued `agentJobs`.
- **Schedule:** `every day 02:00` (Africa/Lusaka).
- **Wraps:** `scripts/check-file-integrity.mjs`,
  `scripts/test-question-schema.mjs`, the Playwright harness in
  `.playwright-cli/`.

#### Rex — Code Reviewer
- **Mission:** Review every PR diff for repo conventions, schema/rule
  changes, secrets, and Anthropic cost regressions.
- **Trigger:** GitHub Action on `pull_request: [opened, synchronize]`.
- **Outputs:** PR review comment via `gh pr review`.
- **Wraps:** Anthropic API directly (Sonnet 4.5) with `ANTHROPIC_API_KEY`
  GitHub repo secret.

#### Ledger — Release Notes
- **Mission:** On push to `main`, summarize merged PRs into a CHANGELOG PR.
- **Trigger:** GitHub Action on `push: branches: [main]`.
- **Outputs:** PR titled `chore: changelog for <date>` updating
  `docs/CHANGELOG.md`.
- **Wraps:** `@octokit/rest` (already a `functions/` dep).

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
- **Notable exception:** like Rex and Ledger, Mendi runs in CI rather than
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
  alert email to `ADMIN_EMAILS` and a GitHub **`bug`** issue, which **Mendi**
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
| GitHub PR (Rex) | Opens automatically on PR open / sync. |
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

## Cost Budget (per agent, per day)

| Agent | Daily Anthropic input/output cap | Notes |
|---|---|---|
| Aria | 1,000,000 / 200,000 tokens | Heaviest agent; serves real briefs |
| Cala | 200,000 / 50,000 tokens | KB grounding only |
| Reva | 300,000 / 100,000 tokens | Editorial review |
| Pubo | 0 / 0 tokens | No LLM call; deterministic write |
| Quill | 50,000 / 10,000 tokens | Mostly script orchestration |
| Rex | 200,000 / 50,000 tokens | One review per PR |
| Ledger | 50,000 / 20,000 tokens | One run per push to main |
| Mendi | 500,000 / 100,000 tokens | One multi-turn fix per bug issue |
| Vigil | 50,000 / 20,000 tokens | One small Haiku call only on failed hours |
| Vex | 100,000 / 30,000 tokens | One Haiku call per Verify & publish |

Caps are enforced via `functions/teacherTools/usageMeter.js` keyed by a
synthetic ownerUid `agent:<id>` so per-agent spend is auditable in
`usageMeters/`.

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
