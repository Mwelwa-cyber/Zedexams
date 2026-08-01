# Changelog

All notable changes to ZedExams. Curated by Ledger (release-notes agent)
on every push to `main`. Newest entries at the top.

## Unreleased

### Changed
- **Sign-up is now a sequence of screens, and the age question comes before
  every sign-up method.** It used to sit inside the email form while "Sign up
  with Google" sat above it, so a learner who tapped Google created an account
  with no declared age at all — and an age screen one button avoids is, for
  Play's Families policy, not an age screen. Both methods now live on a screen
  that comes after it, and the guard is a rule (`signupFlowCore.resolveStep`)
  rather than a conditional in a component, so a deep link, a refresh and the
  back button all hit the same check. A learner's first age answer is held for
  24 hours per device: backing out and returning shows it pre-filled and
  read-only.
- **Teachers and parents are no longer asked their date of birth.** It fed no
  feature and no compliance requirement. They confirm they are 18 or older with
  a checkbox, stored as `ageConfirmed18Plus: true` — a boolean, never a date.
  Firestore rules now refuse a `dob` on a teacher or parent document, so a
  stale client cannot reintroduce the field. **Existing teacher and parent
  documents are not migrated**: any `dob` already stored on one stays there
  until an account-data cleanup is run separately. Privacy Policy updated to
  say date of birth is collected from learners only.
- **The guardian hand-off moved to after account creation.** A learner under 18
  now gets an account immediately, usable in limited mode, and is then asked
  for a guardian's email — so nothing on that screen can cost them the account
  and skipping it leaves a working one behind. The consent plumbing (hashed
  single-use token, POST-only approve/decline, TTL, once-a-day resend) is
  unchanged; this is a new entry point into it.

### Fixed
- **Parent sign-up could never write its own user document.** The Firestore
  create rule's role allow-list was `['learner', 'teacher']` while the sign-up
  page has offered a Parent role since the parent portal shipped.
- **`isMinor` is now derived server-side.** A new `learnerAgeOnUserCreated`
  trigger (africa-south1, alongside the database) re-derives it from the
  declared date of birth using the shared consent core, so the flag the
  guardian gate reads is never the one the client wrote. Rules additionally
  refuse to create a learner document with no date of birth — without that, a
  crafted signup produced a learner whose consent status read as `unknown`,
  the permissive migration state, and therefore full capabilities.

## 2026-07-08 — Android closed testing (v1.2.8)

Features bundled into the Android closed-testing App Bundle since v1.2.7.
Short tester-facing blurb lives in `distribution/whatsnew/whatsnew-en-US`.

### Added
- **Global learner search** across quizzes, notes, past papers, and games
  from a single search bar. (#1642)
- **Real offline reading for learner notes** — downloaded notes stay readable
  without a connection. (#1640)
- **Family portal**: parent↔child linking backend plus the parent portal UI
  and learner family-code panel. (#1634, #1635)
- **Real dark-mode toggle** and Midnight theme coverage across the learner
  app — notes reader + library, sticker surfaces, settings badges and
  toasts. (#1628, #1636, #1637, #1639)
- **Learner Settings redesigned** as a premium AI dashboard, with Settings
  surfaced directly in the account menu. (#1616, #1623)
- **Schemes of Work studio upgrade**: spec term shape, quality checklist,
  default revision weeks. (#1619)

### Fixed
- Spurious logout on reload and the blank-white auth loading screen. (#1617)
- Scanned quiz/paper import cutting off mid-upload. (#1614)
- Overlapping bottom bars in the assessment/exam-paper studio, and sideways
  scrolling on learner pages when the subscription banner shows. (#1638, #1641)
- Android edge-to-edge: bottom nav bar cleared on the learner dashboard. (#1612)
- `noteProgress` permission error on first note open. (#1622)
- Syllabus term division dumping the whole syllabus into Term 1. (#1626)
- Play Billing purchase-verification config failures are now diagnosed and
  alerted instead of failing silently. (#1627)

### Performance
- GradeHub memoization and capped unbounded teacher/admin list
  queries. (#1630, #1632, #1633)

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
