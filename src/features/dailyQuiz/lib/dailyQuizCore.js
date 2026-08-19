/**
 * src/features/dailyQuiz/lib/dailyQuizCore.js
 *
 * Pure view logic for the Daily Quiz. No React, no Firebase — so it tests
 * under plain node (`test:daily-quiz-view`) and the screens stay thin.
 *
 * The server owns every decision that matters (which five questions, whether
 * they count, what the score is). What is left here is what the learner is
 * TOLD, and the rules about that are real ones:
 *
 *   - a card that cannot say what state it is in renders nothing rather
 *     than rendering a guess;
 *   - "no quiz today" with nothing to tap is never one of the states.
 */

/** The states Home's card can be in. There is no "missing" — see below. */
export const DAILY_CARD_STATE = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  PRACTICE: 'practice',
  DONE: 'done',
  UNAVAILABLE: 'unavailable',
})

/**
 * What Home's Today's Quiz card says.
 *
 * `UNAVAILABLE` is the honest failure state — the call failed, so we do not
 * know whether there is a quiz. It offers the archive, which is a real place,
 * rather than a Play button that would be refused.
 *
 * What this deliberately CANNOT produce is the old bug: a card reading "No
 * quiz today" with nothing behind it. A thin bank becomes PRACTICE (five
 * questions that do not count, clearly labelled) and a failed read becomes
 * UNAVAILABLE (an honest "we could not load it"). Neither is a dead end.
 */
export function buildDailyCard(payload, { loading = false, error = null } = {}) {
  if (loading) {
    return { state: DAILY_CARD_STATE.LOADING, title: 'Today’s Quiz', sub: 'Loading…', cta: null }
  }
  if (error || !payload) {
    return {
      state: DAILY_CARD_STATE.UNAVAILABLE,
      title: 'Today’s Quiz',
      sub: 'We could not load it just now — tap to try again',
      cta: 'Open',
    }
  }

  const total = payload.questions?.length || 0

  if (payload.alreadyPlayed && payload.result) {
    const r = payload.result
    return {
      state: DAILY_CARD_STATE.DONE,
      title: 'Today’s Quiz',
      sub: r.ranked
        ? `${r.credited} out of ${r.total} · +${r.points} points`
        : `${r.credited} out of ${r.total} · practice`,
      cta: r.ranked ? 'Ranks' : 'Review',
      done: true,
    }
  }

  if (!payload.ranked) {
    return {
      state: DAILY_CARD_STATE.PRACTICE,
      title: 'Practise five',
      sub: 'No ranked quiz today — these don’t count towards the board',
      cta: 'Play',
      ranked: false,
      total,
    }
  }

  return {
    state: DAILY_CARD_STATE.READY,
    title: 'Today’s Quiz',
    sub: `${total} questions · once a day`,
    cta: 'Play',
    ranked: true,
    total,
  }
}

/**
 * Progress pips: one per question, coloured once answered.
 *
 * `marks` is sparse on purpose — a question not yet reached has no entry, and
 * that is different from one answered wrong. Collapsing the two would show a
 * learner five red pips before they had answered anything.
 */
export function buildPips(total, marks, currentIndex) {
  const out = []
  for (let i = 0; i < total; i += 1) {
    if (marks[i] === 1) out.push('good')
    else if (marks[i] === 0) out.push('bad')
    else if (i === currentIndex) out.push('on')
    else out.push('idle')
  }
  return out
}

/**
 * The result screen's headline. Reads the server's numbers rather than
 * recomputing them — a client that re-derives a score will eventually
 * disagree with the board, and the learner believes the screen.
 */
export function buildResultSummary(result) {
  if (!result) return null
  const { credited = 0, total = 0, points = 0, allCorrect = false, ranked = false } = result
  return {
    emoji: credited >= Math.ceil(total * 0.8) ? '🎉' : '💪',
    headline: `${credited} out of ${total}`,
    points,
    // A practice set says so instead of quietly showing zero points, which
    // reads as a failure rather than as a set that was never scored.
    pointsLine: ranked
      ? `+${points} points added to this week`
      : 'Practice — this one doesn’t count towards the board',
    bonus: ranked && allCorrect,
    ranked,
  }
}

/**
 * Whether the learner may still answer. The server refuses a second attempt
 * regardless; this stops the client offering one.
 */
export function canPlay(payload) {
  if (!payload) return false
  if (payload.alreadyPlayed) return false
  return (payload.questions?.length || 0) > 0
}

/**
 * Days played this week, out of seven — NOT a burning streak.
 *
 * A streak that resets to zero tells a child they have ruined something for
 * missing one day. Missing a day here costs that day's points and nothing
 * else, so the number never goes down.
 */
export function buildWeekSummary(entry) {
  const daysPlayed = Number(entry?.daysPlayed) || 0
  return {
    daysPlayed: Math.min(daysPlayed, 7),
    outOf: 7,
    points: Number(entry?.points) || 0,
    label: `${Math.min(daysPlayed, 7)}/7`,
  }
}

/**
 * Rank rows for the weekly board, plus the viewer's own row.
 *
 * Ties break on total elapsed time — recorded quietly, never shown as a
 * countdown, per the games rule. A learner with no time recorded sorts last
 * among equals rather than first: absence of evidence is not speed.
 */
export function rankEntries(entries, viewerUid) {
  const rows = [...(entries || [])]
    .filter((e) => e && e.uid)
    .sort((a, b) => {
      const byPoints = (Number(b.points) || 0) - (Number(a.points) || 0)
      if (byPoints !== 0) return byPoints
      const at = Number(a.totalElapsedMs)
      const bt = Number(b.totalElapsedMs)
      const av = Number.isFinite(at) && at > 0 ? at : Number.POSITIVE_INFINITY
      const bv = Number.isFinite(bt) && bt > 0 ? bt : Number.POSITIVE_INFINITY
      if (av !== bv) return av - bv
      return String(a.uid).localeCompare(String(b.uid))
    })
    .map((e, i) => ({ ...e, position: i + 1, isViewer: e.uid === viewerUid }))

  return { rows, viewer: rows.find((r) => r.isViewer) || null }
}

/**
 * ISO week id, `YYYY-Www`.
 *
 * A CLIENT MIRROR of `weekIdFor` in functions/dailyQuiz/dailyQuizService.js,
 * and it has to stay one: the board a learner opens must be the board the
 * server wrote their points into. `test:daily-quiz-week` compares the two
 * across several years of dates rather than trusting that two copies of the
 * same three lines agree — they are exactly the kind of thing that disagrees
 * only in the last week of December.
 *
 * It lives here rather than in the service because the service imports
 * Firebase, which a plain-node mirror test cannot load.
 */
export function weekIdFor(date = new Date()) {
  const key = typeof date === 'string' ? date : date.toISOString().slice(0, 10)
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay() || 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7)
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
