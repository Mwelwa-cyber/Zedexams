// src/features/dailyExams/lib/learnerLeaderboardCore.js
//
// The weekly, per-grade daily-quiz leaderboard — every decision it makes,
// as pure functions with no Firebase, no DOM and no React.
//
// WHERE THE SCORES COME FROM, and why the ranking may be computed here.
// The golden rule for this surface is "every ranked or awarded score is
// server-side; never trust a client score". That is satisfied UPSTREAM of
// this module rather than inside it: `exam_attempts` scores are written
// only by the submitDailyExam Cloud Function through the admin SDK, and
// firestore.rules pins it shut from the client side — a create must be
// `in_progress` with `score == null` and `percentage == null`, and
// `allow update: if false` denies every client write outright. So a
// learner cannot mint or edit a scored attempt at all.
//
// What this module does is ORDER data the learner is already allowed to
// read. Sorting a public, server-written result set is a rendering
// decision, not a scoring one — the same thing the per-day board has
// always done by putting `orderBy` in its query. Nothing here is
// persisted, so a tampered client changes only what that one learner
// sees on their own screen, and their points on everybody else's board
// remain whatever the grader wrote.
//
// WEEK BOUNDARIES are Monday-start local time, matching the prototype's
// "resets Monday" copy. Attempt dates are the 'YYYY-MM-DD' local keys the
// exam service already writes, so the week window is a plain string range
// — lexicographic order and calendar order agree for that format, which
// is what lets the service ask for a week in ONE query.

/** Milliseconds in a day — the week maths is calendar-based, not clock-based. */
const DAY_MS = 24 * 60 * 60 * 1000

/** How many rows sit on the podium. Rank 4+ renders in the list below it. */
export const PODIUM_SIZE = 3

// ── date keys ────────────────────────────────────────────────────────────────

/**
 * The 'YYYY-MM-DD' key for a date, in LOCAL time.
 *
 * Deliberately not `toISOString().slice(0,10)`: that converts to UTC first,
 * so for a learner in a positive-offset zone late in the evening it names
 * tomorrow. Zambia is UTC+2 with no DST, so an ISO key would roll the board
 * over at 22:00 local every night.
 */
export function dateKey(date) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local midnight on the Monday of the week containing `date`. */
export function startOfWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  // getDay(): 0=Sun … 6=Sat. Sunday belongs to the week that STARTED six
  // days earlier, so it maps to -6 rather than +1.
  const shift = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + shift)
  return d
}

/** Local midnight on the Monday that ENDS the week containing `date`. */
export function endOfWeek(date) {
  const monday = startOfWeek(date)
  const next = new Date(monday)
  next.setDate(next.getDate() + 7)
  return next
}

/**
 * A stable id for the week, used to name a board and to notice that the
 * week has turned over. Format: `YYYY-MM-DD` of the week's Monday — the
 * boundary itself, so it sorts chronologically and needs no ISO-week
 * numbering rules (which disagree with each other across the year end).
 */
export function weekId(date) {
  return dateKey(startOfWeek(date))
}

/**
 * The window a week's attempts fall in, plus the reset countdown the
 * prototype's "🔄 Resets Monday · 3 days" chip renders.
 *
 * `daysToReset` counts whole days remaining and is never 0: on Monday
 * itself the board has just reset and runs a full 7 days. Rounding UP is
 * what makes the copy honest — with 6 hours left, "1 day" is true and
 * "0 days" would read as already reset.
 */
export function weekWindow(now = new Date()) {
  const start = startOfWeek(now)
  const end = endOfWeek(now)
  const lastDay = new Date(end)
  lastDay.setDate(lastDay.getDate() - 1)

  return {
    weekId: weekId(now),
    startKey: dateKey(start),
    endKey: dateKey(lastDay),
    startsAt: start,
    resetsAt: end,
    daysToReset: Math.max(1, Math.ceil((end.getTime() - new Date(now).getTime()) / DAY_MS)),
  }
}

/** The window for the week BEFORE the one containing `now` (last week's champion). */
export function previousWeekWindow(now = new Date()) {
  const start = startOfWeek(now)
  const lastWeek = new Date(start)
  lastWeek.setDate(lastWeek.getDate() - 1)
  return weekWindow(lastWeek)
}

// ── names ────────────────────────────────────────────────────────────────────

/**
 * A board-safe name: first name plus a surname INITIAL ("Chanda Mwale" →
 * "Chanda M."), exactly the prototype's format.
 *
 * This is a child-privacy rule, not a layout one. The board is readable by
 * every signed-in learner in the grade, so a full surname there is child
 * PII on a public surface — Play Families forbids it and the build spec
 * says name/avatar only. Truncating at RENDER is the belt to the braces of
 * not storing it: `displayName` on an attempt is whatever the account
 * carries, so the guarantee has to hold no matter what is in that field.
 */
export function boardName(displayName) {
  const raw = String(displayName ?? '').trim().replace(/\s+/g, ' ')
  if (!raw) return 'Learner'
  const parts = raw.split(' ')
  if (parts.length === 1) return parts[0]
  const initial = parts[parts.length - 1].charAt(0).toUpperCase()
  return `${parts[0]} ${initial}.`
}

/** The single letter shown in a learner's avatar circle. */
export function avatarLetter(displayName) {
  const name = boardName(displayName)
  return name.charAt(0).toUpperCase() || '?'
}

// ── aggregation + ranking ────────────────────────────────────────────────────

/**
 * Fold a week of submitted attempts into one row per learner.
 *
 * POINTS = the sum of `score` (raw marks the grader awarded) across the
 * week. Marks rather than percentages because the board is a week-long
 * accumulation and the learner-facing word is "points": a learner who sat
 * four papers should out-point one who sat two, which averaging would
 * erase. The daily locks already cap this at one attempt per subject per
 * day, so it cannot be farmed by re-sitting.
 *
 * Attempts with no `userId` are dropped — a row that cannot be attributed
 * cannot be ranked, and inventing an owner for it would be worse.
 */
export function aggregateWeek(attempts = []) {
  const byUser = new Map()

  for (const a of attempts) {
    if (!a || !a.userId) continue
    const cur = byUser.get(a.userId) || {
      userId: a.userId,
      displayName: a.displayName || '',
      points: 0,
      percentageTotal: 0,
      attempts: 0,
      days: new Set(),
    }
    cur.points += Number(a.score) || 0
    cur.percentageTotal += Number(a.percentage) || 0
    cur.attempts += 1
    if (a.attemptDate) cur.days.add(a.attemptDate)
    // Keep the longest name seen: attempts written before a learner set a
    // display name carry the fallback, and the fuller one is the better label.
    if ((a.displayName || '').length > cur.displayName.length) cur.displayName = a.displayName
    byUser.set(a.userId, cur)
  }

  return Array.from(byUser.values()).map((u) => ({
    userId: u.userId,
    displayName: u.displayName,
    points: u.points,
    percentageTotal: u.percentageTotal,
    attempts: u.attempts,
    activeDays: u.days.size,
  }))
}

/**
 * Sort rows into ranked board order and mark the viewer's own row.
 *
 * Ties break on total percentage (accuracy beats volume when the marks
 * land equal), then on attempts ASC (fewer sittings for the same points is
 * the better week), then on userId so the order is TOTALLY deterministic.
 * Without that last key two learners level on every measure could swap
 * places between renders, which reads as the board glitching.
 */
export function rankBoard(rows = [], myUid = null) {
  return [...rows]
    .sort((a, b) =>
      (b.points - a.points)
      || (b.percentageTotal - a.percentageTotal)
      || (a.attempts - b.attempts)
      || String(a.userId).localeCompare(String(b.userId)),
    )
    .map((row, i) => ({
      ...row,
      rank: i + 1,
      me: Boolean(myUid) && row.userId === myUid,
      name: row.userId === myUid ? 'You' : boardName(row.displayName),
      letter: row.userId === myUid ? '⭐' : avatarLetter(row.displayName),
    }))
}

/**
 * Make sure the viewer has a row even when they have not scored this week.
 *
 * A learner opening the board before their first quiz must see themselves
 * at 0 points at the bottom, not be absent from their own leaderboard —
 * "you are not on this list" is the one message this screen should never
 * send a child.
 */
export function withMyRow(rows = [], me) {
  if (!me || !me.userId) return rows
  if (rows.some((r) => r.userId === me.userId)) return rows
  return [
    ...rows,
    {
      userId: me.userId,
      displayName: me.displayName || '',
      points: 0,
      percentageTotal: 0,
      attempts: 0,
      activeDays: 0,
    },
  ]
}

/**
 * Split a ranked board into the pieces the screen renders.
 *
 * `podium` comes back in DISPLAY order — 2nd, 1st, 3rd — because the
 * podium is a physical metaphor: the winner stands in the middle on the
 * tallest block. Returning it pre-ordered keeps that decision here, where
 * it is testable, instead of as an index shuffle in the JSX.
 *
 * A short board is not padded. Two learners produce a two-column podium,
 * which is honest; a placeholder third would invent a competitor.
 *
 * `showPin` drives the sticky "you" row, and is true only when the viewer
 * ranks BELOW the podium — on the podium they can already see themselves,
 * so pinning would show the same learner twice for no gain.
 *
 * `isEmpty` asks whether anyone has SCORED, not whether any rows exist.
 * The two differ because `withMyRow` guarantees the viewer a row: without
 * this, a learner opening the board before their first quiz of the week
 * was the only row on it, and therefore rank 1 — crowned gold, on a
 * podium, with 0 points. An unplayed week has no champion; it has an
 * invitation.
 */
export function splitBoard(ranked = []) {
  if (!ranked.some((r) => r.points > 0)) {
    return { podium: [], rest: [], me: ranked.find((r) => r.me) || null, showPin: false, isEmpty: true }
  }

  const top = ranked.slice(0, PODIUM_SIZE)
  // [1,0,2] → silver, gold, bronze. Filtered so a 1- or 2-row board keeps
  // whatever it has rather than emitting holes.
  const podium = [1, 0, 2].map((i) => top[i]).filter(Boolean)
  const rest = ranked.slice(PODIUM_SIZE)
  const me = ranked.find((r) => r.me) || null

  return {
    podium,
    rest,
    me,
    showPin: Boolean(me) && me.rank > PODIUM_SIZE,
    isEmpty: ranked.length === 0,
  }
}

/**
 * The whole board in one call: aggregate → guarantee the viewer's row →
 * rank → split. This is the function the screen uses, so the ordering of
 * those four steps is fixed in one tested place.
 */
export function buildBoard({ attempts = [], me = null } = {}) {
  const ranked = rankBoard(withMyRow(aggregateWeek(attempts), me), me?.userId ?? null)
  return { ...splitBoard(ranked), ranked }
}

/**
 * Last week's champion, for the "👑 Last week: Chanda M." chip.
 * Returns null when nobody played — the chip is then not rendered at all,
 * rather than rendered empty.
 */
export function championOf(attempts = []) {
  const ranked = rankBoard(aggregateWeek(attempts))
  const top = ranked[0]
  if (!top || top.points <= 0) return null
  return { userId: top.userId, name: boardName(top.displayName), points: top.points }
}
