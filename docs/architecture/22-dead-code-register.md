# 22 — Dead Code & Legacy Register

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.
> **Nothing was deleted during this audit.** These are removal *candidates* with evidence. Verify each with a full `git log`/grep (some may be script-run ops tools or reserved for in-flight work) before removing.
>
> **Rows added after the audit date carry their own date and the migration that
> found them.** A Wave 4 migration proves a file unreachable as a side effect of
> asking where it goes — that evidence is worth recording when it is fresh, but
> it does not license removal outside Phase 6 (§13, §14 rule 11). The register
> is where the evidence waits for the phase that is allowed to act on it.

## R1 — Zero-import files (highest confidence)

Grep of the basename across `src`/`functions`/`scripts` + vite/vitest config returned no real importers:

| File | Evidence |
|---|---|
| `src/components/admin/agents/AgentDirectory.jsx` | no importer |
| `src/components/dashboard/ClassesQuickCard.jsx` | no importer |
| `src/components/lessons/LessonLibrary.jsx` | no importer |
| `src/components/teacher/classes/AssignmentDrilldown.jsx` | no importer |
| `src/components/ui/SubjectScroller.jsx` | no importer |
| `src/editor/components/AnswerOptions.jsx` | no importer |
| `src/features/notes/components/AdminGuard.jsx` | no importer (also overlaps guards, D4) |
| `src/features/notes/routes/adminRoutes.jsx` | route module never wired into `App.jsx` |
| `src/features/teacherSettings/components/fields/ChipMultiSelect.jsx` | no importer |
| `src/hooks/useStudyPlanData.js` | no importer |
| `src/utils/grade4ModuleSeed.js` | no importer |
| `src/utils/quizToDocx.js` | not imported (siblings `homeworkToDocx`/`fullLessonToDocx` are) |
| `src/components/quiz/QuizRichText.jsx` | "legacy"-commented (in `editor/extensions/MathInline.js`), no import |
| `src/editor/components/QuizPreview.jsx` | "legacy"-commented (in `main.jsx`), no import |
| `src/components/teacher/TeacherGlassHeader.jsx` | **Added 2026-08-13** (`teacherShell` PR B, §13). Zero importers, measured by resolving every relative import in `src/` to a real path — including bare side-effect and dynamic `import()` forms. Superseded V1 chrome; the mobile header that renders is `MobileChrome.jsx`'s. Every remaining mention repo-wide is a prose comment (`ReminderPanel`, `TeacherTopBar`, `useClickAway`, `useTeacherReminders`, four `teacherSettings.css` comments) — swept for path-as-string references across `scripts/`, `package.json`, `.github/`, `docs/` and every JSON/YAML/config, which import analysis cannot see. |
| `src/components/teacher/TeacherBottomNav.jsx` | **Added 2026-08-13** (`teacherShell` PR B, §13). Zero importers, same sweep. Superseded V1 pair with the above; the bottom nav that renders is `MobileChrome.jsx`'s `MobileBottomNav`, a different component. It is `teacherNav.js`'s only consumer besides `TeacherTopBar`, so removing it is what would let `teacherNav.js` travel — **deliberately not done here**: the owner upheld the Phase 6 rule rather than waive it, and `teacherNav.js` stays in `src/components/teacher/` until then, which costs nothing (a feature may import legacy outward). |

## R2 — Test-only imports (module imported solely by its own test)

- `src/utils/activityBankCore.js`
- `src/utils/roles.js` (only `roles.spec.js`)
- `src/utils/studioHtmlToDocx.js` (only its spec) — *note:* still a candidate to be wired as the shared export helper (D7), so confirm intent before removing.

## R3 — Legacy `tool:'exam_paper'` — render-only, generation retired

`generateExamPaper` is retired (no export; `index.js:2436` confirms). **Keep (render-only for legacy library docs):** `utils/aiPaperToSections.js` (also live for assessment — dual-use), `LibraryItemDetail.jsx`, `PublicShareView.jsx`, `views/AssessmentPaperView.jsx`, `teacherLibraryService.js:755`. **Still-live (current Max-tier feature, NOT the retired path):** `teacherPlans.js` `exam_paper` limits + `MAX_ONLY_TOOLS`, `examPaperLibrary.js`. Vestigial sample: `src/data/studioSamples.js:164`.

## R4 — Retired Full Lesson studio — render-only remnants

No `generateFullLesson` anywhere in `functions/`. Alive only for viewing legacy `tool:'full_lesson'` library docs via `LibraryItemDetail.jsx`: `src/components/teacher/views/FullLessonView.jsx`, `src/utils/fullLessonToDocx.js`, `src/utils/fullLessonToPdf.js`. **Keep** (backward-compat); no generation surface remains.

## R5 — Decommissioned image providers (Recraft/Kie) — NO removable files

Backend clients/secrets already deleted (`functions/kieClient.js`/`recraftClient.js` don't exist; `RECRAFT_API_KEY`/`KIE_API_KEY` intentionally unbound). All ~17 surviving `recraft`/`kie` references are **live style-selector wire values** routing to gpt-image-1 (`generateDiagram.ALLOWED_PROVIDERS`, `visualStudioMeta.js`, `PictureBankPicker.jsx`, `DiagramFixupPanel.jsx`, `AssessmentSlideOvers.jsx`) or dead-provider test guards (`deadProviderSecrets.test.js`). **Keep all.**

## R6 — One-off scripts in `scripts/` (expected; candidates for an archive sweep)

Not imported by the app. ~9 backfills (`backfill-*`, `migrate-backfill-*`), ~7 migrations (`migrate-2013-curriculum`, `migrate-grade6-to-grade7`, `migrate-normalize-subjects`, `migrate-questions-to-v3`, `migrate-repair-question-bank-previews`, `migrate-sanitize-generations`, `migrate-strip-blob-image-urls`), ~18 `repair-*`/`fix-*` per-subject syllabus repairs, cleanups (`cleanup-*`, `dedupe-quiz-questions`, `normalize-child-codes`, `delete-orphaned-user-doc`), ~8 `seed-*`, admin grants (`grant-premium.mjs`, `grant-superadmin.mjs`). Candidates for `scripts/archive/` — **verify none are re-runnable ops tools first.**

## R7 — Orphaned Firestore collections (from [`11`](./11-firestore-data-model.md))

Declared in rules/indexes, only touched by `accountDeletion.js` or nowhere:

- **Old agent pipeline** (superseded by `agentJobs`/`agentControl`/`aiGenerations`): `aiAgentTasks`, `aiAgentLogs`, `aiTaskSteps`, `aiGeneratedContent`, `aiGeneratedContentVersions`, `aiSupervisorLogs`, `aiLiveAgentStates`, `aiAgentControls` (rules 2356–2497 + 8 indexes).
- `generatedContent` (superseded by `aiGenerations`) + indexes.
- `assessmentStandards`, `learnerWeaknessProfiles`, `curriculumUpdateReports`, `teacherApplications`, `schoolLicences`, `leaderboards`, `learnerProgress` — rules/indexes present, no live writer found.
- **Stale `papers` collection** — 8 composite indexes; live code uses `pastPapers` + `pastPapersIndex`.
- **Cleanup backlog:** dropping the stale `papers` and dead agent/`generatedContent` indexes cuts index-maintenance cost and collision risk. Confirm each via full `git log`/grep first.

## R8 — Clean (no action)

- **Commented-out production code:** NONE — scan for 3+ consecutive commented code lines returned zero (matches were prose comments only).
- **Feature flags:** only `featureFlags.universalDrafts` (default ON, consumed in 6+ studios) — a live kill-switch, not abandoned. No orphaned/off flags.
- **Naming:** no `*V1*/*Old*/*Legacy*/*.bak` files in `src/`; the `*V2` quiz files have no surviving V1 siblings.

## Removal approach

1. Start with **R1 zero-import files** — lowest risk (delete + `npm run build` + `npm run lint` proves nothing referenced them).
2. Then **R7 orphaned indexes/rules** (deploy `firestore:indexes` after confirming no writer).
3. **R6 scripts** → move to `scripts/archive/`, don't delete.
4. Leave **R3/R4/R5** (legacy-render / live-selector) in place — they serve back-compat or are live.
