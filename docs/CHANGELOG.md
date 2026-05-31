# Changelog

All notable changes to ZedExams. Curated by Ledger (release-notes agent)
on every push to `main`. Newest entries at the top.

## Unreleased

## 2026-05-31

### Added
- Admin interface now shows actionable alignment status for agents. (#583)

### Fixed
- CALA agent alignment with CBC requirements now properly enforced. (#583)

## 2026-05-24

### Added
- Admin interface for managing AI agents with actionable controls. (#583)

### Fixed
- CALA-CBC alignment issues to ensure proper integration. (#583)

### Added
- AI agents Phase 5: completes the operating model.
  - Admin pause toggle on `/admin/agents/:agentId` flips
    `agentControl/{agentId}.paused`. Dispatcher already honors this;
    no Firestore-console writes needed.
  - Weekly Cala audit (`weeklyCbcAlignmentAudit`, Sunday 03:00
    Africa/Lusaka). Samples up to 20 recent `aiGenerations` and
    re-runs Cala on each. Summary `agentJobs` doc lands in
    `awaiting_approval` if drift is detected, otherwise `done`.
- AI agents Phase 4b: Aria now drives all six teacher tools (lesson
  plan, worksheet, flashcards, rubric, scheme of work, lesson notes).
  Refactored each generator to expose a `run*` helper alongside the
  existing HTTPS callable factory; the dispatcher invokes those helpers
  directly. Teacher brief form expanded to all six artifacts.
- AI agents Phase 4: teacher-facing brief form. Teachers can submit a
  CBC lesson plan or worksheet brief at `/teacher/agents/new`; the
  job runs Aria → Cala → Reva and lands in `awaiting_approval` for
  admin review. A live status page (`/teacher/agents/:jobId`) shows
  pipeline phase, output from each agent, and the final published
  artifact. `agentJobs` create rule tightened to teachers and admins.
- AI agents Phase 3: nightly Quill QA smoke (Cloud Function cron,
  Africa/Lusaka 02:00) walks Firestore for stuck jobs, recent
  failures, and KB freshness — writes a summary `agentJobs` doc.
  GitHub Actions: Rex reviews every PR (open/sync) and posts a single
  comment; Ledger drafts a CHANGELOG PR on every push to `main`.
- AI agents Phase 2: Cloud Function dispatcher wires the Content
  pipeline end-to-end. Aria → Cala → Reva run on `agentJobs` create
  (Aria currently supports `lesson_plan` and `worksheet`); after Reva
  the job sits in `awaiting_approval`. Admin clicks Approve in
  `/admin/agents`; Pubo flips the reserved `aiGenerations` doc from
  private to public. Per-agent circuit breaker via
  `agentControl/{agentId}.paused`.
- AI agent operating model (Phase 1 skeleton): `ORG.md`, runbook in
  `docs/AGENTS.md`, seven Claude Code subagent definitions in
  `.claude/agents/`, `/admin/agents` dashboard, `agentJobs` Firestore
  collection with rules + composite index.
