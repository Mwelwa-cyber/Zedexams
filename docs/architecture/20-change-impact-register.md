# 20 — Change-Impact Register & File Ownership

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.

Use this before modifying any shared system: it lists what depends on it and which tests to run first.

## Change-impact register

| Shared system | Main files | Direct dependants | Indirect dependants | Tests before change | Risk |
|---|---|---|---|---|---|
| **Curriculum resolver** | `config/curriculum.js`, `config/teacherTaxonomy.js`, `curriculumSelectorConstants.js`, `paperTaxonomy.js`, `cbcKnowledge.js` + 13 server allowlists | All studios, quiz/exam pickers, learner dashboard, past papers, class register, games | Every AI generation (grade/subject grounding), export headers | `test:schema`, `test:schemas-domain`, studio selector specs, (missing: `test:curriculum-canon`) | **Very High** — 4 vocabularies, drifted allowlists ([`06`](./06-curriculum-architecture.md)) |
| **Grade resolver** | `curriculum.js` GRADES/ALL_GRADES + ~20 copies | dropdowns platform-wide | quiz publish, results filters | schema + dropdown render | High (duplicated) |
| **Subject resolver** | `curriculum.js` SUBJECTS, `teacherTaxonomy.js` SUBJECT_GRADE_MAP + copies | studios, quiz, library | AI subject fit | schema + KB | High |
| **Teaching assignments / Profile** | `teachingProfileCore.js`, `teachingProfileService.js`, `useActiveAssignmentSync.js`, `activeAssignmentSyncCore.js` | 8 selector studios, TeacherDashboard | studio pre-fill, weekly targets | assignment-sync spec | Medium ([`07`](./07-teaching-profile.md)) |
| **Authentication / roles** | `contexts/AuthContext.jsx`, `ProtectedRoute.jsx`, `authGuard.js`, `permissions.js` | every authed component + CF | route guards, paywall, admin | `permissions.spec`, rules-emulator | **Very High** ([`10`](./10-authentication-and-roles.md)) |
| **Role system** | `permissions.js` (isAdmin/isSuperAdmin) | guards, admin panels, feature gating | navigation | `permissions.spec`, `navigation.spec` | High (8 inline re-impls, D3) |
| **Draft manager** | `hooks/draft/*` (`draftCore.js`) | 14 studios | Recovery Centre | draft specs | Medium ([`15`](./15-drafts-and-autosave.md)) |
| **AI client (server)** | `aiService.js`, `teacherTools/anthropicClient.js`, `aiBudgetReservation.js`, `aiCostTracking.js` | all AI functions | budget gate, cost dashboard | `aiService.test`, budget tests | High ([`09`](./09-ai-architecture.md)) |
| **AI client (frontend)** | `utils/teacherTools.js`, `aiAssistant.js`, `aiLogic.js` | all studios, Zed chat | — | teacherTools/aiAssistant tests | Medium (48-file `getFunctions` dup, D13) |
| **Credit / usage system** | `teacherTools/usageMeter.js`, `useTeacherUsage.js`, `useGenerationGate.js`, `teacherPlans.js` | all studios | paywall routing | `UsageMeter.spec`, `useGenerationGate.spec` | High |
| **Subscription / entitlement** | `subscriptionConfig.js`, `subscriptionStatus.js`, `teacherPlans.js`, `permissions.js`, `AuthContext` snapshot | paywalls, studios, content gates | pricing display | `useSubscription.spec`, subscription node tests | High (triplicated `toDateValue`, D8) |
| **Payment system** | `plans.js`, `subscriptionActivation.js`, `lencoWebhookProcessor.js`, `googlePlayBilling.js`, `paymentInitiationCore.js` | upgrade flows, Till, admin payments | user premium fields | `lencoService.test`, `subscriptionActivation.test`, `test:play-catalog-mirror` | **Very High** ([`14`](./14-payment-and-subscriptions.md)) |
| **Document exporter** | `assessmentToDocx.js`, `htmlToPdf.js`, `saveBlob.js`, `fetchImageBytes.js` + ~40 per-tool | every studio download | CORS/image proxy | export node tests + `.spec` | Medium ([`16`](./16-document-generation.md)) |
| **Calendar resolver** | `moeCalendar.js`, `calendarResolver.js`, `attendanceCalendarResolver.js` | scheme/weekly/attendance/lesson-plan | term/week math (7 sites) | attendance + calendar tests | Medium (2 parallel resolvers, D11) |
| **Timetable model** | `curriculumFramework.js` | ClassTimetableStudio, timetable exports | conflict engine | timetable specs | Medium |
| **Syllabus parser** | `parseSyllabusUpload.js`, `syllabiCurriculumData.js`, `curriculum-data*.json` | KB, studios (topic lists) | all grounded AI | KB/import tests | High (framework fallback → 2023, [`06`](./06-curriculum-architecture.md) §E) |
| **Question model** | `schemas/quiz.js`, `documentEngine/*`, `questionBank` | quiz/assessment/import/Qix | grading, exports | `test:schema`, `test:importer` | High |
| **Quiz renderer** | `QuizRunnerV2.jsx`, `useQuizPersistence.js`, `editor/*` | daily exams, past-paper quiz | results | quiz runner specs | Medium |
| **Firestore rules** | `firestore.rules` | all client reads/writes | every feature | `test:rules-text`, `test:rules-emulator` | **Very High** |
| **Storage rules** | `storage.rules` | all uploads/reads | exports, images | `test:storage-rules-*` | High |

## File-ownership register (high-impact files)

| File | Responsibility | Used by | Reads | Writes | Risk if changed | Recommended owner |
|---|---|---|---|---|---|---|
| `src/App.jsx` | Router, guards, app chrome | whole app | — | — | Very High (all routing) | Frontend lead |
| `src/contexts/AuthContext.jsx` | Auth state, role, subscription snapshot | every authed surface | `users/{uid}` | auth state | Very High | Auth owner |
| `src/config/curriculum.js` | Learner grade/subject/topic canon | learner + some studios | — | — | Very High | Curriculum owner |
| `src/config/teacherTaxonomy.js` | Teacher grade×subject×curriculum authority | studios, validation | — | — | Very High | Curriculum owner |
| `functions/index.js` | All CF exports (~167) | all callers | many | many | Very High | Backend lead |
| `functions/aiService.js` | Anthropic/OpenAI client + daily limit | all AI functions | `aiDailyLimits` | usage | High | AI owner |
| `functions/aiCostTracking.js` / `aiBudgetReservation.js` | Budget gate + rollups | every model client | budget buckets | `aiUsage*` | High | AI owner |
| `functions/subscriptionActivation.js` | Idempotent entitlement grant | Lenco + Play + admin | `payments` | `users`, `payments` | Very High | Payments owner |
| `functions/plans.js` | Server price catalogue | payment initiation | — | — | Very High | Payments owner |
| `firestore.rules` | Data authorization | all client access | — | — | Very High | Security owner |
| `storage.rules` | Blob authorization | all uploads | — | — | High | Security owner |
| `src/hooks/draft/draftCore.js` | Universal draft engine | 14 studios | drafts | drafts | Medium | Studios owner |
| `src/utils/teacherTools.js` | Client CF wrappers | all studios | — | CF calls | Medium | Studios owner |
| `functions/agents/dispatcher.js` | Content pipeline | agentJobs | `agentJobs`, `aiGenerations` | same | High | Agents owner |
| `vite.config.js` | Build, PWA, chunking, SW tokens | build/CI | env | `dist/` | High | Build owner |
| `firebase.json` | Hosting rewrites/headers/CSP | prod routing | — | — | Very High | DevOps owner |

## How to read this

Before editing a "Very High" file, run the listed tests plus `npm run lint && npm run build`. For curriculum/rules/payments changes, also run the emulator suites locally (`test:rules-emulator`, `test:storage-rules-emulator`) — they are not in `test:all`. See [`23-risk-register.md`](./23-risk-register.md) for the prioritised risk view.
