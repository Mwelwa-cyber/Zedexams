# Learner audit — coverage

> Snapshot as of 2026-08-19 — verify before acting.
> Phases 0 and 1 of the learner-experience audit. Phase 2 (evidence matrix) is
> **blocked** — see "Gaps" at the bottom. Nothing here is a design opinion.

## Phase 0 — the documents §0 told me to read

Five of the six named documents **do not exist** in this repo:

| Named in the audit prompt | State |
|---|---|
| `docs/learner/learner.html` | **absent** |
| `docs/learner/zedexams-learner-prototype-v3.html` | **absent** — the committed prototype is `zedexams-learner-prototype.html`, and `README.md` states it is **v26**, not v3 |
| `docs/learner/LEARNER_REDESIGN_SCOPE.md` | **absent** |
| `docs/learner/ZedExams_ClaudeCode_Prompts.md` | present (last touched 2026-08-17) |
| `docs/learner/ZedExams_Prompt_FixLearnerLive.md` | **absent** |
| `docs/learner/ZedExams_Prompt_FixFamilyLive.md` | **absent** |

### Staleness verdict

- **`ZedExams_ClaudeCode_Prompts.md` — STALE AS A TASK LIST, and it says so itself.**
  Its own header and `README.md` both warn it is "a PLAN, not a record" and that
  much of it has shipped. Read as a to-do list it re-opens closed work. This
  matches the prompt's own warning that the playbook has been caught describing
  systems that shipped months ago.
- **`README.md` — current** (2026-08-19). It is the only doc that describes what
  actually shipped versus what the mockups show, including the three places the
  age-screen mockup deliberately does *not* win.
- **The prototype is newer than the prompt assumes.** The prompt calls the design
  target "v3"; the committed reference is v26. Anyone auditing against a v3
  mental model will report already-fixed items as findings.

## Phase 1 — learner surface inventory

### Route table (from `src/app/App.jsx`, not from route names)

All 27 routes below are wrapped in `ProtectedRoute` → `LearnerOnlyRoute`.
Line numbers are `src/app/App.jsx`.

| Line | Route | Extra guards | Legacy `<Navbar />` |
|---|---|---|---|
| 737 | `/setup` | — | |
| 739 | `/dashboard` | `LearnerSetupGate` | |
| 740 | `/dashboard-preview` | — (deliberately unguarded preview) | |
| 741 | `/subjects/:subjectId` | — | |
| 745 | `/timetable` | — | |
| 748 | `/notes` | `LearnerGate` | |
| 751 | `/notifications` | — | |
| 753 | `/progress` | — | |
| 754 | `/study-plan` | — | |
| 758 | `/exams/leaderboard` | — | |
| 760 | `/dashboard/classic` | — | |
| 777 | `/my-stats` | — | **yes** |
| 778 | `/calendar` | — | **yes** |
| 782 | `/timetable/pdf` | — | |
| 783 | `/exams` | — | |
| 784 | `/exam/:examId` | — | |
| 785 | `/exam-results/:attemptId` | — | |
| 786 | `/quizzes` | — | **yes** |
| 792 | `/quiz/:quizId` | — | |
| 793 | `/results/:resultId` | — | **yes** |
| 795 | `/search` | — | **yes** |
| 797 | `/notes/reader-preview` | — | |
| 798 | `/notes/:id` | `LearnerGate` | **yes** |
| 809 | `/lessons/:lessonId` | `LearnerGate` | **yes** |
| 810 | `/my-results` | — | **yes** |
| 811 | `/my-badges` | — | **yes** |
| 823 | `/guardian` | — | |

Learner-reachable but **not** `LearnerOnlyRoute`-wrapped (shared or redirect):
`/papers`, `/papers/:paperId`, `/papers/:paperId/quiz`, `/papers/:paperId/practice`,
`/games` and its eight sub-routes, `/settings/*`, `/profile`, `/my-papers`,
`/my-subscription`, `/subscription` (→ redirect), `/ask-zed`, `/ask-a-grown-up`,
`/guardian-unlock`, `/notes/:id`, `/welcome`, `/register`, `/login`, `/offline`.

### Navigation

`src/features/learnerHome/components/LearnerBottomNav.jsx:15-20` declares exactly
the locked IA — **Home · Papers · Notes · Games** — as a bottom bar on phones and a
left sidebar from 1000px. This is correct and should be protected.

The legacy `src/components/layout/Navbar.jsx` is still mounted on the **9 routes
marked above**. It offers eight destinations (`Navbar.jsx:52-59`): Home, Papers,
Notes, Games, **Lessons, Quizzes, Exams, Results**, plus a second list
(`:62-65`) labelling `/quizzes` as **"Practise"**. Four of those destinations are
outside the locked four-tab IA. (§8.10 — confirmed still live.)

### Feature directories owning learner surfaces

`learnerHome`, `learnerDashboard`, `learnerOnboarding`, `learnerProgress`,
`learnerSearch`, `learnerSettings`, `notes`, `papers`, `games`, `quiz`,
`dailyExams`, `examTimetable`, `subscription`, `zedChat`, `notifications`,
`accountSettings`.

## Telemetry baseline (PostHog project 416847, unique users)

Last 30 days, verified independently rather than taken from the brief:

| Event | Users | Brief said |
|---|---|---|
| `learner_dashboard_viewed` | 99 | 83 |
| `profile_opened` | 54 | 44 |
| `paywall_shown` | **23** | — |
| `client_error` | 23 | 21 |
| `subject_opened` | 21 | 17 |
| `game_started` | 16 | — |
| `past_papers_opened` | 10 | — |
| `note_opened` | 9 | 7 |
| `route_not_found` | 5 | — |
| `quiz_started` | 4 | 3 |
| `quiz_completed` | 3 | — |
| `notes_opened` (hub) | 3 | — |
| `lock_tapped` | 1 | — |

The brief's shape is confirmed. The number the brief did not carry is
`paywall_shown` — **23 unique users, more than the 9 who opened a note.**

## §8 — already-known items, confirmed or not

| # | Item | State |
|---|---|---|
| 1 | Session does not survive cold load | **Live.** Sentry `PYTHON-K` and `PYTHON-N` both last seen 1 day ago. New `PYTHON-P` ("stored session rescued", first seen 2h ago) shows the `authSessionGuard` mitigation is now firing. |
| 3 | "Term 1" year-round | **Not a code defect.** `learnerHomeCore.resolveActiveTerm` (`:36-43`) resolves school → calendar → saved → 1. Symptom implies both school and calendar terms are unset in production data. Needs a runtime check to confirm which. |
| 5 | Learner 404 on `/subscription` | **Fixed as a 404** — `App.jsx:837` now redirects to `/my-subscription`. But `/my-subscription` is a plan surface reachable by a learner; see the compliance section. |
| 9 | Upgrade banner on learner settings | **Live, and wider than reported.** Two components, not one. |
| 10 | `Navbar.jsx` lists Practise/Exams/Results | **Live.** `Navbar.jsx:52-65`, on the 9 routes marked above. |

Items 2, 4, 6, 7, 8 require runtime access and are unconfirmed — see Gaps.

## Compliance: purchase surfaces reaching learners

`zedexams.com/child-safety` promises an unapproved under-18 learner gets no
purchases. `src/services/entitlements/useUnlockFlow.js` is the **only** code path
that honours this — it routes `under18` to `GuardianAskSheet` with no pricing
import. Every other purchase surface bypasses it:

| Surface | Age check | Evidence |
|---|---|---|
| `learnerSettings/panels/PremiumPanel.jsx` | **none** | imports `PLANS` from the checkout catalogue at `:20` and `UpgradeModal` at `:21`; renders prices directly. The only `isMinor` read anywhere in `learnerSettings/` is in `ProfilePanel.jsx:63` and concerns a date-of-birth field. |
| `learnerSettings/components/DashboardCards.jsx` → `PremiumCard` | **none** | `:16` imports `UpgradeModal`; `:332-355` renders plan + benefits + upgrade. |
| `learnerSettings/sections.js` | **none** | registers the `premium` section unconditionally (`:78-85`). |
| `subscription/components/QuizLimitPopup.jsx` | **none** | `:76` emits `paywall_shown` with a hard-coded `plan_target: 'learner'` and **no `age_band`**. Mounted at `App.jsx:969`. |

`paywall_shown` carries `age_band` and `role` from `useUnlockFlow` and
`MomentOfWinModal` only. Segmented over 90 days:

- `under18 / learner / contextual-sheet` — 1 user (the compliant path).
- **32 users with no `age_band` at all**, i.e. through surfaces that never
  consulted age. Of these, by `plan_target`/`reason`:
  - **`learner` / `welcome-back` — 21 users**
  - **`learner` / `quiz-preview-limit` — 3 users**
  - `pro`/`max`/`teacher` reasons — 11 users (out of learner scope)

### `welcome-back` is served from a stale bundle

`resolveUpgradeScenario` (`subscription/lib/upgradeScenarios.js:107-139`) handles
only `feature-locked`, `monthly-limit`, `daily-cap`, `max-feature`. The string
`welcome-back` **does not exist anywhere in the repo**, and CLAUDE.md records the
mount-time "Your Premium has ended" interstitial as "deleted outright… must not
come back in any form."

It is still firing on learner accounts: 5, 5, 5, 7, 3, **6** unique users per week
for the weeks of 2026-07-05 through 2026-08-09, and 1 so far in the partial week
of 2026-08-16. Code that no longer exists cannot emit it, so these learners are
running a **cached older bundle** — which is the same root cause as §8.6's
stale-deploy dynamic-import failures.

## Gaps — what I could not reach, and why

**Phase 2 (the §4 evidence matrix) has not been run.** Two independent blockers:

1. **`zedexams.com` is blocked by the organisation's egress policy** — the proxy
   answers 403 to CONNECT. Per the proxy's own guidance this must be reported,
   not routed around. The Lydia and Paco credentials are therefore unusable
   against production from this session.
2. **No `.env`.** Only `.env.example` and `.env.smoke` (deliberately fake) are
   committed. Without the real `VITE_FIREBASE_*` values the app cannot boot
   against project `examsprepzambia`, so no learner screen can be reached
   locally either.

`identitytoolkit.googleapis.com` and `firestore.googleapis.com` **are** reachable
and `localhost` bypasses the proxy, so supplying the six public `VITE_FIREBASE_*`
values unblocks a full local run. `npm install` has already been completed here.

Consequently **not yet audited**: all 11 viewports and continuous resize; the
brand-new / guardian-unapproved / heavy / loading / error / offline states; dark
mode; reduced motion; 200% zoom; keyboard-only and screen-reader passes;
throttled-network and any performance number. No screenshot exists in
`docs/audit/screenshots/`, and no finding in this audit is yet `CONFIRMED` by
observation — everything above is `LIKELY` (code) or `CONFIRMED` (telemetry).
