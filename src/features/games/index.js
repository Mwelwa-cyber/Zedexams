/**
 * Public surface of the Games feature — `/games` and everything under it.
 *
 * Migrated out of `src/components/games/` on 2026-08-14 under docs/architecture.md
 * Phase 4, following docs/MIGRATION_TEMPLATE.md. It is a move: no behaviour
 * changed, no module was split, and the only edits to the moved files are the
 * import specifiers that a change of depth forces.
 *
 * ── The freeze, and why this move is not a reading of it ────────────────
 *
 * `components/games/` is named by path in architecture.md §14's owner freeze,
 * which holds until the Phase 3 Assessment Engine rollout flags reach 100%.
 * They have not. This migration proceeds on an explicit owner instruction of
 * 2026-08-14 releasing games from that clause — the third such ruling, after
 * `components/papers/` and the Assessment Paper Studio, and like both of those
 * it is a decision about ONE surface rather than a re-reading of the clause.
 * **The freeze itself did not lift.** `components/quiz/`, `views/PaperBlocks`,
 * `views/AssessmentPaperView`, `admin/PastPaperStudio`, `admin/CreateQuizV2`
 * and `DailyExamRunner` are untouched by this PR and remain fully frozen.
 *
 * What the freeze protects is preserved by construction: the Phase 3 cutover
 * lives INSIDE `components/TimedQuizGame.jsx`, which reads
 * `useAssessmentEngineFlag('game')` and still carries both paths. Both of its
 * specs — `TimedQuizGame.engine.spec.jsx` and `TimedQuizGame.legacy.spec.jsx`
 * — moved with it and are unchanged apart from their mock paths, so the
 * rollback path is still the one the flag selects, tested from both sides.
 *
 * ── What this front door exports, and what it deliberately does not ─────
 *
 * Two names, because two are what the rest of `src/` consumes today:
 *
 *   • `GameBadgeCard`    — `learnerDashboard/BadgesPage`
 *   • `getSubjectMascot` — `features/dailyExams/DailyExamsHub`
 *
 * Every name added here lands in the bundle of every consumer that imports
 * anything from this feature, so the list stays at what is actually consumed
 * rather than what might be one day — the game engines, the shell, the
 * leaderboards, the Web Audio layer and the `*Core` modules are used only
 * inside the feature, and stay inside it until something outside asks.
 *
 * `getSubjectMascot` is re-exported from `lib/subjectMascots` and NOT from
 * `components/gamesUi`, which is where `DailyExamsHub` used to reach it (the
 * UI barrel re-exports it). Same function, but `lib/subjectMascots` imports
 * nothing at all.
 *
 * ── Two components went to `src/shared/components/`, and the bundle is why ─
 *
 * `GameStickerStyles` and `Confetti` started this migration inside the feature
 * and are not in it. The first draft exported both from here, and the measured
 * result was the exact failure the flashcards front door documents: Rollup
 * groups a front door's re-exports into one chunk that statically imports all
 * of them, so a page that wanted the sticker stylesheet — 149 lines with NO
 * imports — gained an edge to `gamesUi` → `gamesService` → the Firebase
 * client. **+75 kB each on GradeHub, SubjectDrillDown and ExamResultsPage**,
 * three learner routes that render no game.
 *
 * Both pass §14.6 cleanly (`GameStickerStyles` imports nothing, `Confetti`
 * imports React) and both are shared by surfaces outside games — the quizzes
 * hub and two dashboard pages for one, the exam-results celebration for the
 * other. A component several areas share belongs below all of them, which is
 * the rule that sent the PDF viewers to `shared/components/` out of the papers
 * migration. Re-measured after the move: **+124 bytes across the whole bundle**
 * and no route gained a chunk it did not already have. The one new chunk in the
 * build is this front door itself, 58 bytes, shared by the two pages that were
 * already reaching `gamesUi` before the migration.
 *
 * The lesson generalises, so it is written here rather than in a commit
 * message: tree-shaking answers the question "how many bytes land in this
 * chunk", and a front door's cost is a different question — "what does
 * importing one name make the browser fetch".
 *
 * ── The one file left behind in `src/components/games/` — RETIRED ───────
 *
 * `components/games/GameStickerStyles.jsx` survived this migration as a
 * one-line re-export shim onto the shared component, because its single
 * consumer was `components/quiz/QuizList.jsx` and `components/quiz/` was still
 * frozen. The migration went AROUND that file rather than editing one import
 * line inside it, exactly as #2342 did for `UpgradeModal`.
 *
 * **It is gone.** The quiz migration, hours later the same day, moved
 * `QuizList` into `features/quiz/pages/` — so it imports
 * `shared/components/GameStickerStyles` directly, the shim lost its only
 * consumer, and `src/components/games/` is empty and removed. The shim's own
 * docblock named exactly that as its retirement condition; it was retired by
 * the event it predicted rather than by the freeze lifting, which is the
 * argument for writing retirement conditions down at all.
 *
 * `pages/PlayGame.jsx` keeps importing the `UpgradeModal` shim rather than
 * `features/subscription`, even though PlayGame is no longer frozen. The chunk
 * measurement #2342 recorded still holds: the front door would put the status
 * banner, `PremiumGate` and `RenewalBanner` into the chunk of a page that
 * renders one upgrade modal. Repointing it is that shim's retirement work, not
 * this one's.
 *
 * THE FIVE PAGES ARE DELIBERATELY NOT EXPORTED. `pages/GamesHub`,
 * `pages/SubjectSelector`, `pages/GameList`, `pages/PlayGame` and
 * `pages/GlobalLeaderboard` are reached only by `lazy(() => import(…))` in
 * App.jsx, under the route-mount exception Phase 1 recorded. Re-exporting a
 * page here would put eight game engines, the Web Audio layer and the
 * assessment engine's renderer into the chunk of anything that wanted one
 * sticker stylesheet — and two of those callers are learner dashboard pages.
 *
 * ── The five `src/utils/` modules that did NOT travel, and why ──────────
 *
 * A util moves into a feature when the feature is its only consumer. These
 * are not, so they stay in `src/utils/` and the feature reaches back to them
 * by relative path, which the layering allows (a feature may import anything
 * below it):
 *
 *   • ~~`gamesService.js`~~ — MOVED 2026-08-14 into `services/`, see below.
 *   • `gamesIntelligence.js` — `gamesService.js` reaches it through a DYNAMIC
 *     `await import('./gamesIntelligence')`, which no lint rule inspects. It
 *     was moved into this feature and moved back for that reason: a util the
 *     legacy tree still imports would have turned one recorded debt line into
 *     a new one, and this list only shrinks.
 *   • `gameBadgesService.js` — also read by `learnerDashboard/BadgesPage`.
 *   • `gameProgress.js` — also read by `utils/gamesService.js`.
 *   • `gameScorePayload.js` — read by `utils/gamesService.js` and the replay
 *     harness; no file in this feature imports it at all.
 *
 * `gameSounds.js` DID travel, into `lib/`, because the eleven files that
 * import it were all games files.
 *
 * ── §14.2 IS NOW SATISFIED: `services/gamesService.js` ──────────────────
 *
 * The paragraph that stood here recorded §14.2 ("services/ is the only place a
 * feature touches Firebase") as KNOWN DEBT, blocked on the freeze, and named
 * its own clearing condition: *"It arrives with `gamesService.js`, when the
 * freeze lifts."* The freeze lifted on 2026-08-14 — the owner ruling releasing
 * the whole remaining freeze list — so the debt is paid rather than restated.
 *
 * `admin/GamesSeedAdmin.jsx` came with it, as `pages/GamesSeedAdmin.jsx`. It
 * was never a *consumer* of this feature; it is the admin page that seeds the
 * `games` collection this feature reads, which is the same argument the fifth
 * ruling made for `CreateQuizV2` being a PAGE of the quiz editor rather than a
 * consumer of it. Like the other five pages it is NOT exported here — it is
 * route-mounted lazily at `/admin/games-seed`.
 *
 * ── `listGames` is exported, and the bundle cost was measured ───────────
 *
 * `hooks/useLearnerSearch` was the one consumer of `gamesService` outside this
 * feature, and it does not disappear when the freeze does. It now reads
 * `listGames` through this front door, which is the pattern that hook already
 * used for its notes source — it pulls `fetchLearnerNotes` from the notes
 * feature's front door the same way — so this is the established shape rather
 * than a new one.
 *
 * The front-door cost rule above ("what does importing one name make the
 * browser fetch") was re-measured for this export rather than assumed, because
 * that rule is exactly what would make it a mistake. **Measured, not asserted**
 * — two `vite build --mode smoke` runs across the move:
 *
 *   • Whole bundle: 25,374,073 → 25,374,026 bytes, **−47**.
 *   • `LearnerSearch` chunk: 6,974 → 7,002, **+28 bytes**, and its static
 *     import list is unchanged in kind — it reached the `gamesService` chunk
 *     before this move and reaches that same chunk now. It did **not** gain
 *     `gamesUi` (+18 kB), which is the regression this rule exists to catch.
 *   • The 47,779-byte `gamesSeed` chunk was regrouped under the
 *     `firestoreTimeout` chunk name (378 → 48,157). Identical bytes, different
 *     grouping — moving `GamesSeedAdmin` reordered the module graph. Nothing
 *     was added or dropped, which is what the −47 net confirms.
 *
 * **The mechanism is worth stating precisely, because the obvious guess is
 * wrong.** The barrel is NOT tree-shaken per-consumer: the emitted front-door
 * chunk is literally `import"./gamesService.js";import"./gamesUi.js";` — it
 * eagerly pulls both, exactly as the `GameStickerStyles` measurement above
 * predicted. What saves the search hook is that Rollup never routed it through
 * that chunk: it resolved the re-export at build time and gave the consumer a
 * **direct edge to the source chunk**, bypassing the barrel. So the safety here
 * comes from the re-export being resolvable to one module, not from the barrel
 * being cheap. A consumer that does land on the barrel chunk still pays for
 * every name it re-exports — which is why the five pages stay unexported.
 */

export { GameBadgeCard } from './components/gamesUi'

export { getSubjectMascot } from './lib/subjectMascots'

export { listGames } from './services/gamesService'
