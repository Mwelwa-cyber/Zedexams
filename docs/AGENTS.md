# Agents — Operator Runbook

How to operate the ZedExams agent stack day-to-day. For the *why*
(mission, principles, org chart) see `ORG.md` at the repo root.

## Where agents live

| Layer | Files | Used for |
|---|---|---|
| Claude Code subagents | `.claude/agents/*.md` | Manual, dev-time invocation from your terminal |
| Cloud Functions runners | `functions/agents/runners/*.js` *(Phase 2)* | Auto-run when a job lands in `agentJobs` |
| Cron Functions | `functions/agents/cron.js` *(Phase 2/3)* | `nightlyQaSmoke`, `weeklyCbcAlignmentAudit` |
| GitHub Actions | `.github/workflows/agent-*.yml` *(Phase 3)* | PR review (Rex), changelog (Ledger), CBC audit |
| Admin dashboard | `src/components/admin/agents/` | Approve/reject jobs, pause agents, view runs |

## Day-to-day: as the human owner

### Approving a job
1. Open `/admin/agents`.
2. Filter by **Awaiting approval**.
3. Click a job to read input + output side-by-side.
4. Hit **Approve & Publish** (Pubo runs) or **Reject** with a reason.

### Pausing an agent
Set `agentControl/{agentId}.paused = true` in Firestore (admin SDK only).
The dispatcher will refuse to enqueue new work for that agent until cleared.
A future tab in `/admin/agents` will surface a one-click toggle.

### Investigating a failure
- `agentJobs.status = failed` carries `error: <message>`.
- Three failures in 60 minutes auto-pause the agent.
- Logs: Firebase Console → Functions → `agentJobsDispatcher`.

## Day-to-day: invoking from Claude Code

```
/agents                               # list available subagents
Use the content-author subagent to draft a Grade 6 Maths lesson plan
on adding fractions, term 2, ~60 min. Then ask the cbc-alignment
subagent to verify it.
```

## Phase 1 verification (now)

1. `npm run dev`
2. Sign in as admin.
3. Open `/admin/agents` — confirm the 7 agent cards render and tabs work.
4. Run `node scripts/seed-agent-jobs.mjs` (admin SDK; needs
   `GOOGLE_APPLICATION_CREDENTIALS`) to drop 3 sample jobs into
   `agentJobs`. Confirm they appear in the queue.
5. Click a job → detail view renders input/output (read-only in Phase 1).

## Phase 2 verification (Content live)

1. Submit a brief from a teacher account (UI in a follow-up PR).
2. Watch `agentJobs` doc transition `queued → running → awaiting_approval`.
3. Click **Approve & Publish** in `/admin/agents`.
4. Confirm a new doc in `aiGenerations` with matching `publishedRefs`.

## Phase 3 verification (QA/Eng + Actions)

1. Open a draft PR touching `firestore.rules`. Within ~60s, Rex posts a
   review comment.
2. Trigger `nightlyQaSmoke` manually:
   ```
   gcloud scheduler jobs run firebase-schedule-nightlyQaSmoke
   ```
   Confirm `.auth-qa-report.json` updates and a summary `agentJobs` doc
   appears.

## Secrets & keys

| Name | Where | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | Firebase secret (`defineSecret`) | Aria, Cala (resolve), Reva |
| `ANTHROPIC_API_KEY` | GitHub repo secret | Rex (PR review), Ledger |
| `GOOGLE_APPLICATION_CREDENTIALS` | Local dev only | `scripts/seed-agent-jobs.mjs` |

Never echo raw Anthropic responses in logs. `aiService.callAnthropic`
already redacts.

## Adding a new agent

1. Add a card to `src/config/agents.js`.
2. Drop a `.claude/agents/<id>.md` definition.
3. (If autonomous) add a runner under `functions/agents/runners/<id>.js`
   and route it from `functions/agents/dispatcher.js`.
4. Update `ORG.md` (org chart + agent card + cost budget).
5. Add a row to the Owner-Of matrix.
