/**
 * features/dailyExams — RETIRED, and kept only for history.
 *
 * ── What this feature was, and what replaced it ──────────────────────
 *
 * The Daily Exam was ZedExams' daily quiz until 2026-08: the
 * `autoPickDailyExams` cron promoted one whole published exam paper
 * (questionCount >= 50) per grade into the day's slot each morning, learners
 * sat it at `/exam/:examId`, and the weekly board was folded out of the
 * resulting `exam_attempts`.
 *
 * It was replaced by `features/dailyQuiz` — five questions a day, built from
 * the approved question bank, the same five for every learner in the grade.
 * The reason for the swap was the failure this feature could not fix from
 * inside: when the picker found no eligible paper for a grade, Home said
 * "No quiz today" and there was nothing behind it. A rotation over whole
 * papers has no smaller unit to fall back to; a five-question quiz built
 * from a bank has one, and its read path builds the day on the spot when
 * the cron misses.
 *
 * This is the retirement the previous docblock predicted in as many words:
 * *"When the Daily Quiz rework lands it still retires this runner
 * wholesale."* It did.
 *
 * ── What is left, and why exactly this much ──────────────────────────
 *
 * `ExamResultsPage` (`/exam-results/:attemptId`) and the `ExamCelebrations`
 * it renders. Nothing else — the hub, the runner, the weekly board, its
 * service and its pure core are all deleted.
 *
 * The results page stays because a learner's past attempts are THEIR
 * record, and the attempt link is the only way back to one. Retiring a
 * mechanism must not delete the history it produced: `exam_attempts` keeps
 * its documents, its rules and its reader. It is deliberately NOT
 * redirected to the new quiz the way `/exams` and `/exam/:examId` are —
 * those are entry points to a mechanism that no longer exists, and a
 * redirect is the right answer for them; this is a specific past result,
 * and sending it somewhere else would silently lose it.
 *
 * Nothing new is ever written here: no function promotes a daily exam any
 * more, so this collection only shrinks.
 *
 * ── The front door stays empty ───────────────────────────────────────
 *
 * The one remaining page is reached only by `lazy(() => import(…))` in
 * App.jsx, under the route-mount exception. Re-exporting it "for
 * completeness" would put the Firebase client and the leaderboard
 * subscription into the chunk of anything that imported one name from here.
 */

export {}
