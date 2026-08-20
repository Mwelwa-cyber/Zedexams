# Learner-side UI audit — Phase 1

> Snapshot as of 2026-08-19 — verify before acting.
>
> Audit only. No feature code was written in this run, and no one-line crash
> fix was needed (§F.5: nothing stopped a route rendering).
>
> **Findings have been worked since. §4 carries two dated status blocks —
> read those before acting on any row in the table, and note that one row
> (L-24) is corrected there rather than closed.** The route inventory in §2
> is also stale in two places: `/papers` and `/notes/:id` no longer carry
> their own chrome.

Scope: the learner surface only — `/dashboard`, `/subjects/*`, `/notes*`,
`/papers*`, `/games*`, `/quizzes`, `/quiz/*`, `/exams*`, `/results/*`,
`/settings/*`, `/search`, `/progress`, `/study-plan`, `/profile`,
`/timetable*`, `/notifications`, `/guardian`, onboarding + auth.
Not `/teacher/*`, `/family/*`, `/admin/*`.

---

## 1. Method, and what it could actually reach

**Route inventory** was read from the router source (`src/app/App.jsx`,
`src/app/routes/`), not from any list — §2 below.

**Screenshots**: 31 PNGs at 390 / 768 / 1440, plus Night at 390 and 360 for the
two densest learner screens, committed under `audit/`. Captured against a real
headless Chromium (`/opt/pw-browsers/chromium`) driving a production build
(`vite build --mode smoke`) served by `vite preview`. Cookie consent and the
onboarding tours were pre-dismissed in `localStorage` so the shots show the
pages rather than the overlays; one first-visit shot informs L-19. Night was
seeded through the app's real key (`examprep:theme = midnight`,
`src/contexts/ThemeContext.jsx:11`), so it exercises the same pre-paint path a
returning dark-theme learner takes.

### What could NOT be captured, and why

**§F.2 asks for captures signed in as a real Grade 6 learner and a real Grade 7
learner. Neither was possible in this environment, and one of the two is not
possible at all.**

| Blocker | Detail |
|---|---|
| No production `.env` | Only `.env.example` and `.env.smoke` (fake public config) are in the repo. Firebase Auth cannot complete a sign-in against a fake API key, so every `ProtectedRoute` learner route redirects to `/login`. Confirmed: `audit/dashboard-signedout__390.png`, `audit/notes-signedout__390.png` both render the login screen. |
| No learner credentials | None were supplied, and none should be committed. |
| **Grade 6 does not exist on the learner side** | `LEARNER_GRADES = [7]` (`src/config/curriculum.js:80`). A Grade 6 learner is routed to `GradeWaitlistScreen` by `resolveLearnerGradeAccess`, so "sign in as a Grade 6 learner and audit the app" describes a state the product does not have. The two-grade grade-filtering comparison §F.2 asks for cannot be run until a second grade opens. |

The repo's own tooling already records this constraint: `scripts/test-route-contrast.mjs:20-31`
explains that role-gated routes "are behind real Firebase auth, so a browser
walk cannot reach them" and renders fixtures instead.

**What that leaves.** Five learner routes are reachable signed out and were
captured for real — `/games`, `/games/leaderboard`, `/papers`, `/login`,
`/register` (plus `/pricing` as compliance evidence). `/games` is inside the
learner shell and public, so the shell, the 4-tab bar and the Night palette are
all measured, not inferred. Everything else in the table below is derived from
source with a `file:line`, and every such row is marked `source` in the Width
column. **No row in this table is an unevidenced impression** (§F.3).

**To unblock Phase 2's verification**: one Grade 7 learner account on a
staging Firebase project plus its `.env`, and — before any grade-filtering
claim can be tested — a second open grade in `LEARNER_GRADES`.

### Automated checks that DID run against the built app

At 390, 360, 768 and 1440, across the six capturable routes:

- **Horizontal overflow: 0px on every route at every width, including 360.**
  (`audit/capture-report.json` → `overflow`.)
- **Nothing rendered under the bottom nav** on `/games` and `/papers` at 390
  after scrolling to the end: measured nav rect vs. every leaf text node,
  zero intersections.
- **Console errors**: one per page load on every route — a 404 for a static
  asset, not a JS exception. Under the smoke config the Firebase network calls
  fail silently rather than throwing, so this figure is *not* comparable to the
  21 client errors PostHog counted on production, and no conclusion about
  PYTHON-N or the live error rate is drawn from it.

---

## 2. Route inventory (from the router source)

`shell` is what actually mounts the chrome. Three distinct chromes exist today.

| Route | Source file | Shell | Colour | Loading | Empty | Error |
|---|---|---|---|---|---|---|
| `/dashboard` | `features/learnerHome/pages/LearnerHomePage.jsx` | **LearnerLayout** (lhx) | tokens | ✓ | ✓ | ✓ |
| `/dashboard-preview` | same | LearnerLayout | tokens | ✓ | ✓ | ✓ |
| `/subjects/:subjectId` | `learnerHome/pages/LearnerSubjectPage.jsx` | LearnerLayout | tokens | ✓ | ✓ | ✓ |
| `/notes` | `notes/pages/LearnerNotesList.jsx` | LearnerLayout | tokens | ✓ | ✓ | ✓ |
| `/notifications` | `notifications/pages/LearnerNotificationsPage.jsx` | LearnerLayout | tokens | ✓ | ✓ | ✗ |
| `/progress` | `learnerProgress/pages/MyProgressPage.jsx` | LearnerLayout | tokens | ✓ | ✓ | ✓ |
| `/study-plan` | `learnerProgress/pages/StudyPlanPage.jsx` | LearnerLayout | tokens | ✓ | ✓ | ✓ |
| `/timetable` | `examTimetable/pages/ExamTimetablePage.jsx` | LearnerLayout | 1 hex | ✓ | ✓ | ✓ |
| `/exams/leaderboard` | `dailyExams/pages/LearnerLeaderboardPage.jsx` | LearnerLayout | **11 hex** | ✓ | ✓ | ✓ |
| `/games` | `games/pages/GamesHub.jsx` | LearnerLayout | 1 hex | ✓ | ✓ | ✗ |
| `/games/stickers` | `games/pages/StickerCollection.jsx` | LearnerLayout | tokens | ✓ | ✗ | ✓ |
| `/games/daily` | `games/pages/DailyIntro.jsx` | LearnerLayout | tokens | ✓ | ✗ | ✓ |
| `/profile` | `learnerHome/pages/LearnerProfilePage.jsx` | LearnerShell | tokens | ✓ | ✗ | ✓ |
| `/settings/*` | `learnerSettings/pages/LearnerSettingsRoute.jsx` | LearnerShell | tokens | ✗ | ✓ | ✓ |
| `/setup` | `learnerOnboarding/pages/LearnerSetupPage.jsx` | bare (deliberate) | tokens | ✗ | ✗ | ✓ |
| `/guardian` | `learnerHome/pages/GuardianZonePage.jsx` | bare (deliberate) | tokens | ✓ | ✓ | ✓ |
| `/papers` | `papers/pages/PastPapersHub.jsx` | **own chrome + own pill nav** | 2 hex | ✓ | ✓ | ✓ |
| `/papers/:paperId` | `papers/pages/PastPaperViewer.jsx` | own chrome | tokens | ✓ | ✓ | ✓ |
| `/papers/:paperId/practice` | `papers/pages/PastPaperPractice.jsx` | own chrome | 1 hex | ✓ | ✗ | ✓ |
| `/papers/:paperId/quiz` | `papers/pages/PublicQuizRunner.jsx` | own chrome | 3 hex | ✓ | ✓ | ✓ |
| `/my-papers` | `papers/pages/MyPapersHistory.jsx` | own chrome | tokens | ✓ | ✓ | ✓ |
| `/games/leaderboard` | `games/pages/GlobalLeaderboard.jsx` | **NO nav at all** | tokens | ✓ | ✓ | ✓ |
| `/games/play/:gameId` | `games/pages/PlayGame.jsx` | bare (deliberate) | tokens | ✓ | ✗ | ✓ |
| `/games/duel`, `/duel/live` | `games/pages/Duel*.jsx` | bare (deliberate) | tokens | ✓ | — | ✓ |
| `/quizzes` | `quiz/pages/QuizList.jsx` | **legacy Navbar** | **7 hex** | ✓ | ✓ | ✓ |
| `/quiz/:quizId` | `quiz/pages/QuizRunnerV2.jsx` | bare | **14 hex** | ✓ | ✓ | ✓ |
| `/results/:resultId` | `quiz/pages/QuizResultsV2.jsx` | legacy Navbar | 3 hex | ✓ | ✗ | ✓ |
| `/notes/:id` | `notes/pages/LearnerNoteRead.jsx` | **legacy Navbar + lhx page** | tokens | ✓ | ✗ | ✓ |
| `/lessons/:lessonId` | `lessons/pages/LessonPlayer.jsx` | legacy Navbar | — | ✓ | — | ✓ |
| `/search` | `learnerSearch/pages/LearnerSearch.jsx` | legacy Navbar | tokens | ✓ | ✓ | ✗ |
| `/my-results` | `learnerDashboard/pages/MyResults.jsx` | legacy Navbar | 4 hex | ✓ | ✓ | ✓ |
| `/my-badges` | `learnerDashboard/pages/BadgesPage.jsx` | legacy Navbar | tokens | ✓ | ✗ | ✓ |
| `/my-stats`, `/calendar`, `/offline` | `learnerDashboard/*`, `offline/*` | legacy Navbar | — | ✓ | — | ✓ |
| `/exams` | `dailyExams/pages/DailyExamsHub.jsx` | legacy Navbar | tokens | ✓ | ✗ | ✓ |
| `/exam/:examId` | `dailyExams/pages/DailyExamRunner.jsx` | bare | **9 hex** | ✓ | ✓ | ✓ |
| `/exam-results/:attemptId` | `dailyExams/pages/ExamResultsPage.jsx` | bare | tokens | ✓ | ✓ | ✓ |
| `/timetable/pdf` | `learnerDashboard/pages/TimetableViewerPage.jsx` | bare | — | ✓ | — | ✓ |
| `/dashboard/classic` | `learnerDashboard/pages/GradeHub.jsx` | legacy | — | ✓ | — | ✓ |

**Totals: 12 routes in the learner shell · 2 in `LearnerShell` · 10 under the
legacy `Navbar` · 13 self-chromed or bare.** Loading/empty/error columns were
produced by `scripts`-free static scan and spot-verified by reading each page.

---

## 3. Where reality contradicts the prompt (§A, §B, §C)

Recording these is part of §F's output, and they change what Phase 2 should do.

### §A — 8 of the 13 listed ground-truth files are not in this repository

Present: `docs/learner/README.md`, `ZedExams_ClaudeCode_Prompts.md`,
`ZedExams_Learner_App_Build_Spec.md`, `zedexams-learner-prototype.html`,
`zedexams-parent-prototype.html`, `zedexams-games-hub-mockup.html`,
`zedexams-age-screen-mockup.html`, `zedexams-guardian-email-mockup.html`, plus
ten playable game prototypes and three Zambia data files.

**Absent** (no file, and no deletion in `git log --diff-filter=D -- docs/learner/*`):
`ZedExams_Prompt_FixLearnerLive.md` (the 18 Aug audit, its 16 findings and
F1–F6), `ZedExams_Prompt_FixGamesHub.md` (8x-G), `ZedExams_Fix_SettingsAccount.md`,
`ZedExams_Prompt_LoaderSystem.md`, `zx-loader.css`, `ZxLoader.jsx`,
`ZedExams_ParentLearner_Connection.md`, `ZedExams_Prompts_Profile_Delete.md`,
`LEARNER_REDESIGN_SCOPE.md`, `learner.html`/`onboarding.html`/`parent.html`,
`assets/`, `avatar_pack/` + `avatars.manifest.json`,
`zedexams-profile-delete-mockup.html`, `zedexams-loader-kit.html`.

Consequence: the "Already covered by" column can only cite documents that
exist, and §G's "fixes already written" for passes B, C and F **are not
written anywhere I can read**. Those passes need their fixes specified before
they can be implemented, or the missing documents supplied.

### §B — most of it has already shipped

| §B item | State |
|---|---|
| B.1 4-tab nav Home·Papers·Notes·Games | **Shipped** — `LearnerBottomNav.jsx:15-20`. |
| B.2 "Tab removal is the LAST change in the sequence" | **Already done, first.** `/learn` and `/practice` redirect to `/dashboard` (`App.jsx:767-768`). The sequencing instruction is moot. |
| B.2 "`Navbar.jsx` still lists Practise/Exams/Results — a known loose end" | Still true, and larger than described: the learner menu is **8 items** including a `/lessons` entry that redirects to `/notes` (`Navbar.jsx:52-59`, `App.jsx:808`). See L-08, L-09. |
| B.3 indigo/purple target | **Partly shipped.** `/dashboard`, `/subjects`, `/notes`, `/games`, `/progress`, `/notifications` are on the indigo `lhx` system; `/papers` is on a *terracotta* variant of it; `/quizzes`, `/quiz/:id`, `/games/leaderboard`, `/exam/:id` are still cream/orange. Three systems, side by side — L-03, L-06, L-07, and `audit/games__390.png` vs `audit/papers__390.png` vs `audit/games-leaderboard__390.png`. |
| B.4 "notes and games deleted and rebuilt" | Both rebuilt already (`features/notes`, `features/games`; `GamesHub.jsx:20-60` documents the grade-scoping rebuild, merged in `70cbccb`). |
| B.6 `ZxLoader` (Bars) | **No such component.** The shipped loading system is `src/shared/styles/zxLoading.css` + `TopLine`/`PageLoader`/`FullScreenLoader`/`Skeleton`, with `.zx-spin` as the canonical spinner. Adopting a *new* `ZxLoader` would be a second implementation, which §C.4 forbids. See L-17. |

### §C — the corrections are right, but incomplete

`#app` is indeed not the scroll container, the app is Capacitor-wrapped, and
auto-hiding chrome exists (`src/hooks/useHideOnScroll.js`, used by all three
navs). Add: **playbook PROMPT 7 says "rewards, NOT a games leaderboard", yet
`/games/leaderboard` ships and is linked** — so L-05/L-07's fix may be
retirement rather than restyling. That is a decision for the gate, not for me.

### §D — one rule is named for a helper that does not exist, one has no guard

- **`canSeePricing(user)` does not exist.** The equivalent is
  `mayShowPrice(profile)` (`src/services/entitlements/planState.js`), it does
  default closed (`profile?.isMinor === false ? ADULT : UNDER_18`, line 97), and
  it *is* enforced on arrival (`MySubscriptionRoute.jsx:31-34`). **The §D
  compliance rule is substantively met.** I found no live learner-reachable
  price (L-24 is dead code). Renaming it would be churn; Phase 2's pass B
  should verify coverage under the existing name, not introduce a second helper.
- **There is no CI hex grep.** `audit:colors` exists (`package.json:826`) but is
  not a `test:*` script, so `scripts/run-all-tests.mjs` never runs it and it is
  in no CI job. "The CI hex grep must stay green" describes a guard that has
  never run. See L-18.

### §E — four of the six "known true right now" items are already fixed

| §E claim | State on 2026-08-19 |
|---|---|
| Session does not survive a cold load (PYTHON-N) | **Fixed today** — `src/firebase/authSessionGuard.js` + `authBootVerdict.js` ship. Not re-verifiable here (needs real auth). |
| Notes library is one note; 24 topics read "Note coming soon" | **Content gap unverifiable from the repo** (Firestore), but the *UI* defect it produces is live and is L-02. |
| Every learner shows Term 1 in mid-August | **Live, root cause found — L-01.** |
| `/papers` un-migrated, old theme, own top bar, floating pill nav, wrong grade | **Half fixed**: it is on the new theme with a Night variant (`papersTheme.css`). **Still true**: own top bar, own floating pill nav (L-03), grade ignores the profile (L-15). |
| Games hub serves a Grade 3/4 daily quiz to a Grade 6/7 learner | **Fixed** — `GamesHub.jsx:133-153` scopes both the label and the query to one resolved grade. |
| `/settings?section=account` shows a "Max" plan, invoices, payment history | **Fixed** — `?section=` is gone; `account` now redirects to `/settings/profile` and `premium` to the index (`learnerSettings/lib/settingsRoutes.js:56-80`). |

---

## 4. Findings

> **Status, 2026-08-20:** the two P0s are FIXED, and so is L-09. L-08 is
> PARTLY fixed — **five** routes still carry the legacy chrome (10 → 9 when
> the note reader came off, 9 → 5 when the five superseded pages were
> retired), held by a shrink-only ratchet (`test:learner-chrome`).
>
> **Five pre-redesign pages are gone** (owner's call: delete rather than
> re-skin). `/dashboard/classic`, `/my-stats`, `/my-results`, `/my-badges`
> and `/calendar` are redirects to `/dashboard`, `/progress`, `/progress`,
> `/profile` and `/timetable`. One thing is genuinely lost and is named
> rather than implied: the per-attempt results LIST. `/progress` reports
> mastery and weak topics, not "every quiz I have taken"; an individual
> result is still at `/results/:resultId`.
>
> **One correction to this table.** L-08 said the retired IA was "one tap
> away on every self-chromed page", which understated it in one direction
> and overstated it in another. `/my-stats`, `/my-results`, `/my-badges`,
> `/calendar` and `/dashboard/classic` have **no inbound link from any
> live learner surface** — the two buttons in `learnerSettings`'
> `ProgressPanel` and the one in `DashboardCards` render only in the
> non-bare settings dashboard, which `LearnerSettingsRoute` never mounts,
> so they are dead code. The legacy `Navbar`'s own menu was the only live
> route to those five screens, and `/notes/:id` was the busiest page
> carrying it. That is why L-09 was the whole of the problem rather than
> one instance of it.



> **Status, 2026-08-20 (second pass).** Nine more findings are closed, and
> one is corrected rather than closed.
>
> **Closed: L-03, L-04, L-10, L-11, L-12, L-14, L-16, L-19, L-21, L-22,
> L-25, L-26**, plus the learner-facing half of L-17.
>
> - **L-10 · L-11 · L-12 · L-26 (the palette).** The root cause under most
>   of them was one token doing two jobs with two different floors, not a
>   colour chosen too light: `--lhx-orange` was a bar FILL and the 13px
>   percentage beside it; `--lhx-green` was a fill, an ink, AND the ground
>   under white button text. So the fix is mostly splitting — `SUBJECT_INKS`
>   beside `SUBJECT_TONES`, `--lhx-green-btn` beside `--lhx-green`,
>   `--lhx-nav-label` for the tab bar. `papersTheme.css` had drifted the
>   same way and is brought along; the two are now asserted equal where
>   they overlap. **This closes L-18 too, in a stronger form than it asked
>   for:** `test:learner-contrast` measures ratios rather than grepping for
>   hexes, so it cannot be satisfied by a hex that is merely *declared*.
> - **L-03 · L-04 · L-25.** `shared/constants/learnerTabs.js` is the one
>   declaration; `/papers` mounts inside `LearnerLayout`. `test:learner-tabs`
>   guards all three of the ways that can rot.
> - **L-14.** `resolveArchiveGrade` — `?grade=` outranks all, then the
>   learner's own grade if the archive holds it; the toggle turns on
>   `isLearner`, not "is signed in".
> - **L-16.** The heroes already led by the time this ran (the audit
>   predates that change), but Level + Achievements still sat between them
>   and the games. `progressBlockMode` now decides: full blocks above for a
>   learner with progress, one line below for one without.
> - **L-19 · L-21 · L-22.** 44px targets and the banner lifted clear of the
>   tab bar; the games hero subtitle wraps instead of clipping; the papers
>   chip row fades at its scrolling edge.
>
> **Corrected: L-24.** The finding says `PremiumPanel` "renders four prices"
> and calls it a §D risk. It does not. `PremiumPanel.jsx:84` gates on
> `!userProfile || !mayShowPrice(userProfile)` and renders the
> "Ask a grown-up" hand-off; the four prices are reachable only by an adult
> whose profile positively says `isMinor === false`, which is the intended
> behaviour and is what `PremiumPanel.spec.jsx` pins. It IS dead code — no
> route produces `forceSection='premium'` — but deleting a correctly
> guarded, tested screen buys no safety, so it is left in place and the
> risk framing is withdrawn.
>
> **L-06 is worked, and its diagnosis was wrong in a way worth recording.**
> The row reads "still the retired cream/orange neo-brutalist system, with
> the colours written into class strings". Measured, that is not what a
> learner meets:
>
> - `QuizResultsV2` was already 49 `theme-*` utilities deep and
>   `QuizRunnerV2`'s own root and error states were too — the pages
>   followed the reading palette in the large.
> - The cream/orange the row names is `.quiz-theme-mathematics`, one of
>   **seven per-subject mascot palettes** (Maths Fox / Story Owl / Science
>   Turtle / …) that the runner applies as `quiz-theme-${mascot.slug}`.
>   That is a designed feature, not retired styling — and the audit could
>   not have seen which, because the runner is auth-gated and this row was
>   derived from source.
>
> **And the feature is dead in production.** Because the class is built
> from a variable, Tailwind's content scanner never sees the literal and
> tree-shakes all seven palettes out of the bundle: none of them appears
> in any file under `dist/assets/`, and loading the built CSS in Chromium
> against a `.quiz-theme-mathematics` root resolves `--bg` to the reading
> theme's value rather than the palette's `#fcf7f3`. There is no
> `safelist` in `tailwind.config.js`. **This is an owner's decision and
> is deliberately left open** — reviving it colours every quiz by subject,
> deleting it discards the idea. `test:quiz-surface-theme` asserts only
> that the two halves live or die together, so the repo cannot stay in
> today's state of a className selecting nothing.
>
> **What WAS broken, reproduced in Chromium against the real built CSS:**
> the runner's question cards were drawn in hardcoded literals layered on
> a root that did follow the theme. `bg-white` and `text-slate-900` invert
> in Night (index.css remaps them, scoped to `.force-light-theme` and
> `.zx-card-shared`); **`bg-orange-50` was in neither list**, so every
> question card's header strip rendered near-white ink on cream — **1.03:1**
> — for every Midnight learner. Fixed by putting the surface on
> `.quiz-proto` and giving those literals classes that read the palette.
> Also fixed on the way: the score ring's three hexes (amber at **1.56:1**
> against its own track), the two celebration toasts (**2.26:1** white on
> `bg-orange-400`), and orange meaning both "accent" and "wrong".
>
> **`QuizList` is deliberately NOT migrated.** It renders inside
> `.force-light-theme`, whose Midnight remap does cover its vocabulary,
> and `gamesDarkSurface.test.js` requires that container to stay. It is a
> palette difference from the rest of the learner side, not a defect —
> moving it means converting its literals first, then changing that guard.
>
> **Still open: L-05, L-07, L-13, L-15, L-23**, and L-17 outside the
> learner surface. The largest by far is **L-06** — the quiz runner and
> quiz list are still the retired cream/orange system, and they are the
> destination the whole funnel points at.
>
> **One gap this pass did NOT close, and it is worth naming rather than
> leaving to be rediscovered:** white button labels on the brand coral and
> indigo GRADIENTS measure 2.2–3.5:1. That is the app's primary call to
> action. It is not in `test:learner-contrast` because repainting the
> locked prototype's identity colours is an owner's decision, not a fix to
> make inside a test — the test says so in its own header.


| ID | Route | Width | Severity | What breaks (one line) | Evidence (file:line or screenshot) | Suspected source file | Already covered by | Proposed fix (≤2 lines) |
|---|---|---|---|---|---|---|---|---|
| L-01 ✅ | `/dashboard`, `/subjects/:id` | source | **P0 — fixed** | Between 8 Aug and 6 Sep (today) `getActiveTerm()` returns null, so the learner's whole home + every subject page silently scopes to **Term 1** — January's topics, in August. | `src/utils/moeCalendar.js:265-275` returns null outside a term window; T2 closes `2026-08-07` (`:38`), T3 opens `2026-09-07` (`:55`); `learnerHomeCore.js:40` falls through to `{term:1}`; `useLearnerDashboard.js:134-138` supplies it. Reproduced: `node -e "getActiveTerm(new Date('2026-08-19')) → null"`. | `src/features/learnerHome/lib/learnerHomeCore.js` | — | **Fixed**: `getMostRecentTerm` (new, additive — `getActiveTerm` is untouched because the teacher/attendance surfaces need its answer) feeds a `holidayTerm` rung above `savedTerm`. `test:moe-calendar`, `test:learner-home`. |
| L-02 ✅ | `/subjects/:id` | source | **P0 — fixed** | A topic with no note renders as a focusable button whose tap does nothing at all — no toast, no reason, no focus change; with the library near-empty that is up to 24 dead taps between Home and a note. | `LearnerSubjectPage.jsx:281` `if (!topic.noteTarget) return`; `:376` sets `aria-disabled` but never `disabled` and keeps `onClick` (`:384`). | `src/features/learnerHome/pages/LearnerSubjectPage.jsx` | — | **Fixed**: a row with no destination is no longer a button at all (not `disabled` — a disabled control still claims to be one). The quiz fallback was NOT taken: the subject page has no quiz surface by design, so that is an owner decision. |
| L-03 | `/papers` | 360/390/768/1440 | **P1** | The Papers tab leaves the learner shell: different top bar, and a second, differently-shaped 4-tab bar drawn as a floating pill over the cards — the nav changes form between two adjacent tabs. | `audit/papers__390.png` vs `audit/games__390.png`; `App.jsx:615` (outside the `LearnerLayout` group at `:713`); `PastPapersHub.jsx:493-527` own `BottomNav`, `:699-715` own header. | `src/features/papers/pages/PastPapersHub.jsx` | — | Mount `/papers*` inside the `LearnerLayout` route group and delete `PastPapersHub`'s `BottomNav` and top bar. |
| L-04 | all learner routes | source | **P1** | Three separate implementations of the same four tabs, free to drift: `LearnerBottomNav`, `MobileBottomNav`, and `PastPapersHub.BottomNav`. | `LearnerBottomNav.jsx:15-20`; `MobileBottomNav.jsx:12-17`; `PastPapersHub.jsx:496-503`. | `src/features/learnerHome/components/LearnerBottomNav.jsx` | — | One component, one `ITEMS` array; the other two import it or are deleted with their host chrome. |
| L-05 | `/games/leaderboard` | 390/768/1440 | **P1** | The page renders **no navigation of any kind** — a learner who follows the Leaderboard link has no way back except the browser/hardware back button. | `audit/games-leaderboard__390.png`; measured nav query returned `null` where `/games` returns `Learner navigation`; `App.jsx:717` (outside the layout group). | `src/features/games/pages/GlobalLeaderboard.jsx` | `docs/learner/ZedExams_ClaudeCode_Prompts.md` PROMPT 7 ("rewards, NOT a games leaderboard") | Decide at the gate: retire the route per PROMPT 7, or mount it in `LearnerLayout`. Do not restyle a screen that may not survive. |
| L-06 | `/quizzes`, `/quiz/:id` | source | **P1** | The quiz library and the quiz runner — the funnel's destination — are still the retired cream/orange neo-brutalist system, with the colours written into class strings. | `QuizList.jsx:147,433,573` `bg-[#D97757]`, `:209` `bg-[#FCF7F3]`, `:648` `text-[#0E5E70]`; `QuizRunnerV2.jsx:204,224,1035,1167,2263-2264` `shadow-[0_2px_0_#0F1B2D]`, `'#D97757'`. 21 hardcoded colour values across the two files (`#D97757`, `#0F1B2D`, `#FCF7F3`, `#0E5E70`, `#FBBF24`, `#10B981`). | `src/features/quiz/pages/QuizRunnerV2.jsx` | `docs/learner/README.md` §Ground rules ("never hardcode a colour") | Re-skin both onto `lhx` tokens; the runner is the higher-value half and should go first. |
| L-07 | `/games/leaderboard` | 390 | **P1** | A third visual system on the learner side — thick black borders and hard drop-shadows under an orange gradient header — sitting one tap from the indigo games hub. | `audit/games-leaderboard__390.png` beside `audit/games__390.png`. | `src/features/games/pages/GlobalLeaderboard.jsx` | — | Fold into L-05's decision; if it stays, re-skin onto `lhx` tokens. |
| L-08 ◐ | 5 routes under `Navbar` | source | **P1 — partly fixed** | The legacy header still offers the retired IA — an 8-item learner menu including Lessons, Quizzes, Exams and Results — so the tabs §B removed are one tap away on every self-chromed page. | `Navbar.jsx:52-59`; mounted at `App.jsx:777,786,793,795,798,809,810,811,826`. | `src/components/layout/Navbar.jsx` | §B.2 names this as a known loose end | **Partly fixed**: `/notes/:id` is off it (L-09) and `scripts/test-learner-chrome.mjs` now fails both ways — a new Navbar mount, and a listed route that came off without the list shrinking. Five entries left: `/quizzes`, `/results/:resultId`, `/search`, `/lessons/:lessonId`, `/offline`. |
| L-09 ✅ | `/notes/:id` | source | **P1 — fixed** | The note reader — the single screen the whole funnel exists to reach — renders the legacy `Navbar` *on top of* an `lhx` page, so it carries two headers and two navigations at once. | `App.jsx:798` mounts `<Navbar/>`; `LearnerNoteRead.jsx:31` renders `<div className="lhx">` with `lhx-back-row` at `:34`. | `src/app/App.jsx:798` | — | **Fixed**: the `Navbar` is gone. NOT moved into `LearnerLayout` — that would draw the 4-tab bar over an immersive reader; `ReaderEngine` and all three fallback states already carry their own back route to /notes. |
| L-10 | all `lhx` routes | source | **P1** | `--lhx-muted` — the token behind every subtitle, "X of Y topics done" and topic sub-list — measures **3.15:1** on a white card and **2.75:1** on the page background. Fails AA (4.5:1). Used 48 times. | `learnerTheme.css:34` `#8a8fb5`; computed against `--lhx-card #ffffff` and `--lhx-bg #edeffd`. | `src/shared/styles/learnerTheme.css` | `docs/learner/README.md` §Ground rules | Darken to ≥4.5:1 on both surfaces (about `#6b709c`), or reserve the current value for ≥18.66px text only. |
| L-11 | all `lhx` routes | source | **P1** | `--lhx-faint` is the colour of the **inactive bottom-nav labels** at 10.5px: **2.16:1** on card, **1.89:1** on the page. Three of the four tab labels are effectively unreadable. | `learnerTheme.css:35` `#a9aed6`; used by `.lhx-nav-item` `:782`. | `src/shared/styles/learnerTheme.css` | `docs/learner/README.md` §Ground rules | Give the nav its own label colour at ≥4.5:1; keep `--lhx-faint` for non-text decoration only. |
| L-12 | all `lhx` routes | source | **P1** | The **active** tab label is `--lhx-coral-text` at **2.83:1**, and it has no Night override, so "which tab am I on" is carried by a colour that fails AA in both looks. | `learnerTheme.css:44` `#ff6b3d`; `.lhx-nav-item.is-active` `:786`; overrides exist for muted/faint (`:147-148`) but not for this token. | `src/shared/styles/learnerTheme.css` | — | Deepen the active label (keep the bright coral for the 4px indicator, which is not text) and add the Night override. |
| L-13 | `/games/leaderboard` | 390-night | **P1** | In Night the "Sign in to save scores" card stays a light cream panel on the dark page, and the selected segment ("All Time") loses its selected state entirely. | `audit/games-leaderboard__390-night.png` beside `audit/games-leaderboard__390.png`. | `src/features/games/pages/GlobalLeaderboard.jsx` | `docs/learner/README.md` §Ground rules ("Night mode via design tokens only") | Covered by L-05/L-07's re-skin; do not patch the two colours in isolation. |
| L-14 | `/papers` | 360/390/768/1440 | **P1** | The Papers hub ignores the learner's profile grade entirely and always opens on Grade 7, offering a Grade 7 / Grade 12 toggle — grade browsing on a child surface. | `PastPapersHub.jsx:557-559` reads `?grade=` then defaults; `userProfile.grade` is never read; toggle at `:417-422`. | `src/features/papers/pages/PastPapersHub.jsx` | `docs/learner/README.md` §Ground rules ("Content auto-filters to the learner's profile grade — no grade browsing on the child UI") | Default from `userProfile.grade` and hide the toggle for a signed-in learner; keep it for signed-out SEO traffic. |
| L-15 | `/dashboard` | 390 | **P1** | "My subjects" — the only route from Home to a note — is the **last** of five blocks, below the exam countdown, Continue, Today's Quiz and Explore. | `LearnerHomePage.jsx:43-49` (render order). Fold position not measured (auth-gated); flagged as the funnel's most likely hierarchy cost. | `src/features/learnerHome/pages/LearnerHomePage.jsx` | — | Verify fold position with a signed-in capture first; if subjects sit below the fold, raise them above Explore. |
| L-16 | `/games` | 390 | **P1** | The games hub opens with two blocks that hold nothing — "Level 1 · Rookie" with an empty meter and "Achievements 0 of 10" with four padlocks — before the games themselves; two of the first four games then read "Coming soon for Grade 7". | `audit/games__390.png`; measured heading tops at 390×844 — `Games` 22px, `Achievements` 280px, `Your games` **431px**, so more than half the first screen sits above the games. | `src/features/games/pages/GamesHub.jsx` | — | Lead with playable games; collapse Level and Achievements into one row until the learner has earned something. |
| L-17 | 15 learner files | source | **P1** | 23 uses of Tailwind's `animate-spin` alongside the app's own `.zx-spin`, including the note reader's only loading state — two spinners on two tempos, which is the exact failure `zxLoading.css` was written to end. | `LearnerNoteRead.jsx:90`; `QuizRunnerV2.jsx`, `DailyExamRunner.jsx` + 12 files under `features/notes/`; canonical spinner at `zxLoading.css:115-127`. | `src/shared/styles/zxLoading.css` | §D "One loader" | Replace `animate-spin` with `.zx-spin`; note the target is the **existing** system, not a new `ZxLoader` (§B.6 is stale). |
| L-18 | — | source | **P1** | The colour guard §D relies on has never run: `audit:colors` is not a `test:*` script, so `run-all-tests.mjs` skips it and no CI job invokes it. | `package.json:826`; `run-all-tests.mjs` discovers `test:*` only. | `package.json` | §D "The CI hex grep must stay green" | Add `test:learner-colors` scoped to the learner surface with the current count as a shrink-only ratchet. |
| L-19 | first visit, all routes | 390 | **P2** | A child's first screen is a cookie-consent panel pinned at `z-[80]` **over** the 4-tab bar, whose two buttons measure 32px tall — below the 44px target §H requires. | `CookieConsentBanner.jsx:53` (`fixed bottom-0 z-[80]` vs the nav's `z-40`), `:73` and `:80` (`px-3 py-1.5 text-xs` → 32px); measured in-browser at 390 as `No thanks` 86×32, `Accept` 64×32. | `src/components/ui/CookieConsentBanner.jsx` | — | Raise both buttons and the inline links to 44px, and lift the panel clear of the tab bar rather than over it. |
| L-20 | `/games/leaderboard` | 390 | **P2** | The header truncates the product's own name to "ZedExa…" and its subtitle to "PLAY • LE…". | `audit/games-leaderboard__390.png`. | `src/features/games/pages/GlobalLeaderboard.jsx` | — | Shorten the header for phones rather than ellipsising the brand. |
| L-21 | `/games` | 360/390 | **P2** | The Today's Quiz hero clips its own call to action: "🔥 Play today to start a st…". | `audit/games__390.png`, `audit/games__360.png`; measured `scrollWidth` 213 vs `clientWidth` 199 — clipped by 14px. | `src/features/games/pages/GamesHub.jsx` | — | Allow two lines, or write a subtitle that fits 390px. |
| L-22 | `/papers` | 360/390 | **P2** | The quick-filter row scrolls horizontally but shows no affordance — the fourth chip is cut mid-word at the right edge with no fade or arrow. | `audit/papers__390.png` (page overflow is 0; the clipping is inside the scroller). | `src/features/papers/pages/PastPapersHub.jsx` | — | Add an edge fade or wrap the chips; the row is currently indistinguishable from a rendering bug. |
| L-23 | `/quizzes`, `/lessons` menu entry | source | **P2** | The legacy menu's "Lessons" item leads to `/lessons`, which redirects to `/notes` — the same destination as the "Notes" item two rows above it. | `Navbar.jsx:56` vs `:54`; `App.jsx:808`. | `src/components/layout/Navbar.jsx` | — | Drop the Lessons entry; it duplicates Notes. Subsumed by L-08. |
| L-24 | `/settings/*` | source | **P2** | `PremiumPanel` renders four prices and is still lazily reachable from the settings chunk graph, though no learner route mounts it — dead code that a future edit could re-expose. | `PremiumPanel.jsx:100,112,119,123`; `LearnerSettings.jsx:46`; unreachable per `LearnerSettingsRoute.jsx:78-88` and `settingsRoutes.js:74-79`. | `src/features/learnerSettings/panels/PremiumPanel.jsx` | §D "No child ever sees a price" | Delete the panel and its lazy entry; the learner path to a plan is `/ask-a-grown-up`. |
| L-25 | all learner routes | source | **P2** | The two bottom navs disagree on i18n: `MobileBottomNav` resolves labels via `t('nav.*')`, `LearnerBottomNav` hardcodes English. | `MobileBottomNav.jsx:13-16` vs `LearnerBottomNav.jsx:16-19`. | `src/features/learnerHome/components/LearnerBottomNav.jsx` | — | Resolved by L-04's consolidation. |
| L-26 | all `lhx` routes | source | **P3** | Bottom-nav labels are 10.5px — below the 12px floor the rest of the system uses, on the app's most-used control. | `learnerTheme.css:782`. | `src/shared/styles/learnerTheme.css` | — | Raise to 11–12px; the 44px target box already has the room. |

---

## 5. Counts

| Severity | Count | Already covered by an existing doc |
|---|---|---|
| **P0** | 2 | 0 |
| **P1** | 16 | 6 (§B.2 · §D ×2 · `README.md` §Ground rules ×3, one of them also PROMPT 7) |
| **P2** | 7 | 1 (§D) |
| **P3** | 1 | 0 |
| **Total** | **26** | **7** |

No finding was deleted for lack of evidence, because none was written without
it: every row cites a `file:line`, a committed screenshot, or a reproduced
computation.

**Not counted as findings, recorded in §3**: four of §E's six "known true"
items are already fixed, eight of §A's ground-truth documents do not exist, and
§B.6's `ZxLoader` describes a component the repo does not have.

---

## 6. Artefacts

- `audit/*.png` — 31 screenshots (390 · 360 · 768 · 1440, Night at 390).
- `audit/capture-report.json` — per-route overflow, scroll height, sub-44px
  target list, console errors, shell detected, page title.
