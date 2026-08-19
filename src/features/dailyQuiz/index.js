/**
 * features/dailyQuiz — the Daily Quiz: five questions a day per grade,
 * everyone in the grade getting the same five, ranked on a weekly board.
 *
 * This REPLACED the Daily Exam rotation in 2026-08. That system pinned one
 * whole 50+ question exam paper per grade per day and, when the picker found
 * nothing to pin, Home said "No quiz today" with nothing behind it.
 *
 * ── The pages are deliberately NOT exported ──────────────────────────
 *
 * Route tables mount them with `lazy(() => import('…/pages/DailyQuizPage'))`.
 * A page in a front door lands in the chunk of every consumer — and one
 * consumer here is Home, which is the most latency-sensitive screen in the
 * product. The same rule the flashcards reference migration records.
 *
 * What IS exported is the read path and the pure view logic, because Home's
 * card needs both.
 */
export {
  getTodaysQuiz,
  answerDailyQuizQuestion,
  getWeeklyBoard,
  getMyWeekEntry,
  weekIdFor,
} from './services/dailyQuizService'

export {
  DAILY_CARD_STATE,
  buildDailyCard,
  buildPips,
  buildResultSummary,
  buildWeekSummary,
  canPlay,
  rankEntries,
} from './lib/dailyQuizCore'
