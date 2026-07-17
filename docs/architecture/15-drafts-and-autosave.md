# 15 — Drafts & Autosave

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.

There are **three distinct draft systems**, not one. Most teacher studios use the modern universal manager; three surfaces sit outside it with real work-loss exposure.

| System | Files | Storage | Cross-device | Users |
|---|---|---|---|---|
| **Universal Draft Manager** (modern) | `src/hooks/draft/*` | IndexedDB + localStorage mirror + Firestore `drafts/{uid}/items/{draftId}` | Yes | 14 teacher studios |
| **Assessment draft** (legacy) | `useAssessmentDraft.js` | localStorage + Firestore `assessmentDrafts/{uid}` **singleton** | Yes (1 at a time) | AssessmentStudio |
| **Create-quiz draft** (legacy) | `useCreateQuizDraft.js` | localStorage **only** | **No** | admin CreateQuizV2 |
| **Quiz session** (learner runtime) | `useQuizPersistence.js` | localStorage only | No | QuizRunnerV2 |

## Universal Draft Manager

Front door `useDraftManager({studioId, uid, draftId, descriptor, state, debounceMs=2500, cloud})` (`src/hooks/draft/useDraftManager.js`). Status machine `idle|saving|saved|offline|local-only|error`.

- **Autosave debounced 2500 ms**; skips no-op saves (content fingerprint) and empty forms (`descriptor.isNonEmpty`).
- On mount: sweep expired → `loadDraftMerged` picks the freshest of local vs cloud (last-write-wins) → offers `<DraftRecoveryPrompt>`. `clear()` on save-to-library.
- **Crash/unload safety:** holds a `beginCriticalWork()` token while dirty → `beforeunload` warning + PWA-update deferral (`src/utils/criticalWork.js`).

Core (`draftCore.js`): `DRAFT_TTL=7d` (hand-built studios 30–200d); `REMOTE_MAX_CHARS=900 KiB` (bigger = **local-only, not cloud-mirrored**); `MAX_VERSIONS=10` ring; `sanitizeRuntime()` strips `blob:` URLs + upload flags; `isLiveDraft()` rejects stale/schema-mismatched/empty (a schema bump safely invalidates old drafts).

Local store (`draftIdbStore.js`): IndexedDB primary (`zedexams-drafts`, keyed `studioId:uid:draftId`); localStorage mirror = synchronous last-gasp (payload only) for `beforeunload`. Degrades to no-op in private mode/quota/old WebView. Powers the Recovery Centre.

Cloud + cross-tab (`draftCloudSync.js` + `draftTabLock.js`): one doc **per draft**, payload as JSON string; `runTransaction` guarded on `savedAt` (stale can't clobber fresh — defuses offline replay). Cross-tab `BroadcastChannel` heartbeat elects one `owner` per draft; `shadow` tabs save locally but suppress cloud writes.

### Studios on the shared system

- **Input-form** (`useStudioInputDraft`, kill-switch `featureFlags.universalDrafts`): Worksheet, Notes, Homework, Rubric, Scheme of Work, Flashcards.
- **Bespoke** (`useDraftManager` + `handBuilt.js`): Record of Work, Mark Schedule, Class Timetable, Weekly Forecast, SBA Mark Tracker, SBA Year Planner, Settings Timetable, SBA Task, **Lesson Plan** (input slices only; AI output never restored — restore via `restoreLessonPlan.js` precise setter ordering).
- **Recovery Centre** `/teacher/drafts` (`RecoveryCentre.jsx` + `draftDashboard.js`) lists merged local+cloud drafts, resume/discard, sync pill.

## Draft flow

```mermaid
flowchart TD
    EDIT[Studio edit] -->|debounce 2500ms| SAVE[useDraftManager.save]
    SAVE --> IDB[(IndexedDB)]
    SAVE --> LS[(localStorage mirror)]
    SAVE -->|owner tab, <=900KiB| CLOUD[(drafts/uid/items txn savedAt-guarded)]
    SAVE -.>|>900KiB| LOCALONLY[local-only status]
    MOUNT[Studio mount] --> MERGE[loadDraftMerged local vs cloud]
    MERGE --> PROMPT[DraftRecoveryPrompt]
    EDIT -->|dirty| CRIT[beginCriticalWork → beforeunload guard]
```

## Gaps — where work can be lost

| ID | Severity | Finding |
|---|---|---|
| DRAFT-1 | **High** | **Admin CreateQuizV2 — localStorage only:** no cloud, no cross-device, no cross-tab, **not in Recovery Centre, and NO `beforeunload` guard** (confirmed absent). Device switch / storage clear mid-build = lost, silently. |
| DRAFT-2 | Medium | **EditQuizV2 — no autosave draft at all:** relies on the saved Firestore quiz doc, so **unsaved in-progress edits to an existing quiz are lost on refresh/crash**. No `beforeunload`. |
| DRAFT-3 | Medium | **AssessmentStudio — singleton cloud draft** `assessmentDrafts/{uid}`: only ONE unsaved paper at a time (a 2nd overwrites the 1st). Not in Recovery Centre, no version ring, no cross-tab lock (relies on the txn guard). It does have its own `beforeunload` + cross-device. |
| DRAFT-4 | Medium | **Learner quiz sessions — localStorage only, per-device.** Same-device recovery is robust (recovers a lapsed exam and auto-submits), but a **device switch mid-exam loses the attempt**. |
| DRAFT-5 | Low | **Kill-switch:** `featureFlags.universalDrafts !== false` — an admin can disable autosave for the 6 input-form studios platform-wide; while off they have no draft protection. |
| DRAFT-6 | Low | **>900 KiB drafts are local-only system-wide** — image-heavy papers/large plans silently don't follow the teacher across devices (status shows `local-only`). |

**Consolidation opportunity:** `assessmentDraftCore.js`/`useAssessmentDraft.js` and `useCreateQuizDraft.js` re-implement the save/load/merge/strip/TTL that `draftCore.js` generalises — `draftCore`'s own header says it "generalises" the assessment version. Migrating CreateQuizV2, EditQuizV2, and AssessmentStudio onto the universal manager closes DRAFT-1/2/3 at once. See [`21-duplication-register.md`](./21-duplication-register.md) (D10).
