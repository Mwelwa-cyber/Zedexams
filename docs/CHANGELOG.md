# Changelog

All notable changes to ZedExams. Curated by Ledger (release-notes agent)
on every push to `main`. Newest entries at the top.

## Unreleased

## 2026-07-05 — Android closed testing (v1.2.5)

Features bundled into the Android closed-testing App Bundle. Short
tester-facing blurb lives in `distribution/whatsnew/whatsnew-en-US`.

### Added
- **Central Question Bank + Qix AI reviewer.** Every question a teacher
  creates or imports lands in the bank and is reviewed in the background by
  Qix — deterministic exact/near-text dedup plus embedding-based semantic
  duplicate detection, then an AI quality + grade-fit review. Clean passes
  flow into the shared Master Bank. (#1375, #1386)
- **Smart generation reuses the Master Bank first.** Quiz, assessment, and
  exam-paper generation now source vetted questions from the Master Bank
  before calling the model, and auto-capture newly generated questions back
  into the bank. (#1377, #1379, #1382, #1383, #1384, #1388)
- **AI Lesson Plan Studio.** Generate, then manually or AI-edit plans, save
  them to the teacher library, reuse them as templates via the Template Bank,
  preview output formats, and ground plans on the teacher's own past plans.
  Auto-fills teacher name and school. (#1369, #1370, #1374, #1385)
- **Redesigned teacher dashboard** as an intelligent AI workspace. (#1394)
- **Admin question import** into the Question Bank, with one-click
  "Import existing questions" and "Approve all into the Master Bank", plus
  backfill tooling that regrades existing quiz + exam questions by syllabus.
  (#1389, #1395, #1400, #1402)
- **Test Paper Import improvements**: rebuild a scanned table as an editable
  typed table, keep and render every detected figure on multi-figure
  questions, and per-item status chips (Ready / Needs review / Failed) with a
  confidence score. (#1372, #1390, #1393)
- **Play Store release notes** wired into the closed-testing AAB workflow via
  `distribution/whatsnew/`.

### Fixed
- Re-grade imported quiz and exam-paper questions to their true grade, fixing
  mixed-grade imports. (#1404, #1408)
- Numerous Lesson Plan Studio fixes: curriculum coverage, mobile layout,
  downloads/print, class picker (ECE Nursery & Reception), and empty-output
  schema alignment. (#1373, #1378, #1401, #1403, #1405, #1406)
- Bound diagram image-generation network calls so a hung provider can't hang
  the function. (#1387)
- Scanned-paper diagram cleaning hardened against CORS canvas taint, with a
  same-origin image-proxy fallback. (#1376, #1380)

## 2026-06-13

### Added
- Admin interface now shows actionable agent alignment status and controls. (#583)

### Fixed
- Cala agent alignment system now properly tracks and enforces behavioral constraints. (#583)

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
