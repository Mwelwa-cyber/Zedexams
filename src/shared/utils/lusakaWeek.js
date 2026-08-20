/**
 * src/shared/utils/lusakaWeek.js
 *
 * The calendar every weekly leaderboard in this product is keyed on: the
 * Zambian wall clock, and the ISO week that starts on its Monday.
 *
 * ── Why it lives here rather than in a feature ───────────────────────────
 *
 * TWO features read it — `features/dailyQuiz` (the five-question board) and
 * `features/games` (the games board) — and a module two features share
 * belongs below both of them, which is the same rule that sent the PDF
 * viewers to `shared/components/`. It imports nothing, so it loads under
 * plain `node` for the mirror test.
 *
 * ── There is a third copy, and it is deliberate ──────────────────────────
 *
 * `functions/dailyQuiz/dailyQuizService.js#weekIdFor` and
 * `functions/lusakaTime.js` are the SERVER halves. Cloud Functions is
 * CommonJS inside `functions/` (which the CLI uploads on its own) and this is
 * ESM inside `src/`; neither can import the other. So they are two
 * implementations of one rule, and `test:daily-quiz-week` +
 * `test:games-leaderboard-mirror` are what keep them one — walking several
 * years day by day rather than spot-checking today, because ISO weeks
 * disagree only in the last week of December, which a spot check passes
 * every time except the one week it matters.
 *
 * Zambia is UTC+02:00 year-round with no DST, so a fixed offset is exact and
 * needs no timezone database.
 */

export const LUSAKA_UTC_OFFSET_MS = 2 * 60 * 60 * 1000

/**
 * Lusaka wall-clock parts for an instant.
 *
 * A container running in UTC that derives "today" from `new Date()` is still
 * on YESTERDAY between 00:00 and 01:59 Lusaka time — which is exactly the
 * window a learner playing late at night falls into.
 */
export function lusakaParts(date = new Date()) {
  const shifted = new Date(date.getTime() + LUSAKA_UTC_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    /** ISO weekday: Monday 1 … Sunday 7. */
    weekday: shifted.getUTCDay() || 7,
  }
}

/** The Lusaka calendar date as `YYYY-MM-DD` — the day key everything uses. */
export function lusakaDayString(date = new Date()) {
  const p = lusakaParts(date)
  return [p.year, String(p.month).padStart(2, '0'), String(p.day).padStart(2, '0')].join('-')
}

/**
 * ISO week id, `YYYY-Www`.
 *
 * ISO weeks start on Monday, which is what makes "the board resets every
 * Monday" a property of the key rather than a promise the copy makes. A
 * Sunday belongs to the week that is ENDING, so the board a learner opens on
 * Sunday evening is still that week's.
 *
 * Accepts a `YYYY-MM-DD` key (already in Lusaka terms) or a `Date` — a Date
 * is converted through `lusakaDayString` first, so 00:30 Lusaka on a Monday
 * lands in the new week rather than in the UTC Sunday it still is.
 */
export function weekIdFor(date = new Date()) {
  const key = typeof date === 'string' ? date : lusakaDayString(date)
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay() || 7          // Sunday → 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day) // the week's Thursday decides its year
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7)
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** The `YYYY-MM-DD` key `days` after `key`. */
export function shiftDayKey(key, days) {
  const [y, m, d] = String(key).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** The week id of the week BEFORE the one `date` falls in. */
export function previousWeekId(date = new Date()) {
  const key = typeof date === 'string' ? date : lusakaDayString(date)
  return weekIdFor(shiftDayKey(key, -7))
}

/**
 * Whole days from `date` until the board resets — i.e. until the next Lusaka
 * Monday 00:00.
 *
 * Counted in DAYS rather than hours because that is what the pill says, and a
 * learner reading "resets Monday · 3 days" on a Friday wants the number of
 * sleeps, not a rounded duration. Monday itself returns 7: the board reset
 * this morning and the next one is a week away, which is true and is never
 * "0 days" (a countdown at zero reads as "any moment now" on a day when
 * nothing is about to happen).
 *
 * Sunday returns 1 — one more sleep.
 */
export function daysUntilWeekReset(date = new Date()) {
  const { weekday } = lusakaParts(date)
  return 8 - weekday
}
