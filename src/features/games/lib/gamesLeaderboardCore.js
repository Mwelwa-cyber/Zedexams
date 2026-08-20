/**
 * src/features/games/lib/gamesLeaderboardCore.js
 *
 * Everything the games weekly board DECIDES, with no React and no Firebase,
 * so it tests under plain `node` (`test:games-leaderboard`) and the page
 * stays a renderer.
 *
 * The board it replaced had no logic worth extracting: it read the top 25
 * `scores` ROWS and printed them. That is why a learner who played four
 * rounds took four places on it, why there was no grade scope, why "This
 * Week" was a rolling seven days rather than a week, and why nobody could
 * be told when it resets. Everything below exists because one of those had
 * to become answerable.
 */

import {
  weekIdFor,
  previousWeekId,
  daysUntilWeekReset,
  lusakaDayString,
} from '../../../shared/utils/lusakaWeek.js'

export { weekIdFor, previousWeekId, daysUntilWeekReset, lusakaDayString }

/** How many ranked rows the page fetches. Podium + "Everyone else". */
export const BOARD_PAGE_SIZE = 50

/**
 * ── THE RANKING RULE ─────────────────────────────────────────────────────
 *
 * **Competition ranking on points** — 1, 2, 2, 4. Two learners on 140 points
 * are both 2nd and the next learner is 4th, which is what a child expects
 * from a race and what makes "#10" mean the same thing in the header, in the
 * list and on the pinned card at the bottom.
 *
 * That last property is the reason it is competition ranking and not the
 * ordinal position in the sorted array. A learner outside the fetched page
 * has their rank resolved by a Firestore COUNT of the entries with strictly
 * more points than theirs (the page never downloads the grade to find out —
 * see §32 of the brief). `1 + count(points > mine)` is competition ranking
 * by definition, so the two agree by construction; an ordinal position would
 * have made the pinned card disagree with the list the moment two learners
 * tied, and only then, which is the kind of bug that is never reproduced.
 *
 * ORDER within a tie is still fully deterministic, because Firestore's
 * result order is not and a board that reshuffles tied learners on every
 * refresh looks broken:
 *
 *   points desc → plays asc → lastPlayedAt asc → uid asc
 *
 * Fewer rounds for the same points goes first (it took less play to get
 * there), then whoever reached the week earlier, then the uid as the final
 * total order. Only the ORDER uses this; the number shown is the rank.
 */
export function compareEntries(a, b) {
  const byPoints = pointsOf(b) - pointsOf(a)
  if (byPoints !== 0) return byPoints

  const byPlays = playsOf(a) - playsOf(b)
  if (byPlays !== 0) return byPlays

  const byTime = millisOf(a) - millisOf(b)
  if (byTime !== 0) return byTime

  return String(a?.uid || '').localeCompare(String(b?.uid || ''))
}

function pointsOf(entry) {
  const n = Number(entry?.points)
  return Number.isFinite(n) ? n : 0
}

function playsOf(entry) {
  const n = Number(entry?.plays)
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY
}

/**
 * `lastPlayedAt` as millis. An entry with no readable timestamp sorts LAST
 * among equals rather than first — the same choice `dailyQuizCore.rankEntries`
 * makes about a missing elapsed time, and for the same reason: a missing
 * value must never be an advantage, or it becomes worth having.
 */
function millisOf(entry) {
  const raw = entry?.lastPlayedAt
  if (!raw) return Number.POSITIVE_INFINITY
  if (typeof raw.toMillis === 'function') return raw.toMillis()
  if (typeof raw.seconds === 'number') return raw.seconds * 1000
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

/**
 * Order the fetched entries and stamp each with its competition rank and
 * whether it is the viewer's.
 *
 * Rows with no uid are dropped rather than rendered: a board row that cannot
 * be identified cannot be de-duplicated against the viewer's own row, and
 * would show a learner a stranger highlighted as themselves.
 */
export function rankEntries(entries, viewerUid = null) {
  const sorted = [...(entries || [])].filter((e) => e && e.uid).sort(compareEntries)

  let rank = 0
  let previousPoints = null
  const rows = sorted.map((entry, index) => {
    const points = pointsOf(entry)
    if (points !== previousPoints) {
      rank = index + 1          // ← competition ranking: the gap after a tie
      previousPoints = points
    }
    return {
      uid: entry.uid,
      displayName: entry.displayName || null,
      points,
      plays: playsOf(entry) === Number.POSITIVE_INFINITY ? 0 : playsOf(entry),
      rank,
      isViewer: Boolean(viewerUid) && entry.uid === viewerUid,
    }
  })

  return { rows, viewer: rows.find((r) => r.isViewer) || null }
}

/**
 * Split ranked rows into the podium and the list beneath it.
 *
 * The podium takes the first three ROWS, not everyone whose rank is ≤ 3 —
 * a five-way tie on the top score is five learners at rank 1, and a podium
 * with five blocks on it is not a podium. The two beyond the third block
 * appear at the top of "Everyone else", still reading "1", which is true.
 *
 * Fewer than three players is not a broken podium, it is a shorter one:
 * `podium` simply has one or two entries and the renderer draws the blocks
 * it was given. A board with one learner on it is the first week of a new
 * grade and must look deliberate.
 */
export function splitBoard(rows) {
  const all = rows || []
  return { podium: all.slice(0, 3), rest: all.slice(3) }
}

/**
 * The order the three podium blocks are DRAWN in: 2nd, 1st, 3rd — left,
 * tall centre, right. Kept here rather than in JSX so a two-person podium
 * ("2nd" does not exist yet) is decided once and tested.
 *
 * With two learners the layout is 1st then 2nd, left to right, because a
 * silver block standing alone beside an empty gap reads as a missing winner.
 * With one, it is just the winner.
 */
export function podiumLayout(podium) {
  const p = podium || []
  if (p.length >= 3) return [p[1], p[0], p[2]]
  return p
}

/** Medal for a competition rank. Ranks beyond three have no medal. */
export function medalFor(rank) {
  if (rank === 1) return { emoji: '🥇', label: 'First place', tone: 'gold' }
  if (rank === 2) return { emoji: '🥈', label: 'Second place', tone: 'silver' }
  if (rank === 3) return { emoji: '🥉', label: 'Third place', tone: 'bronze' }
  return null
}

/**
 * The circular avatar for a learner: one letter and a stable colour.
 *
 * The colour is a hash of the uid rather than of the NAME, so two learners
 * both showing "Learner" (a name that could not be published safely) are
 * still visually distinct, and a learner's colour does not change the week
 * they correct the spelling of their own name.
 */
export const AVATAR_TONES = Object.freeze(['pink', 'amber', 'sky', 'green', 'violet', 'coral', 'teal'])

export function avatarFor({ uid, displayName }) {
  const letter = String(displayName || '').trim().charAt(0).toUpperCase() || '?'
  let hash = 0
  for (const ch of String(uid || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return { letter, tone: AVATAR_TONES[hash % AVATAR_TONES.length] }
}

/**
 * What a row is CALLED on screen.
 *
 * The viewer is "You", never their own name. Not decoration: the row is the
 * one thing on the page a learner has to find at a glance, and a name they
 * have to read and match is slower than a word that can only mean them. It
 * also means the page never renders the viewer's own name back at them,
 * which is one fewer place a display name can be shoulder-surfed.
 *
 * Everyone else is the safe public form the SERVER wrote. `stripUnsafeName`
 * is a second line of defence over rows written before the rollup existed,
 * or by a future writer that forgets — this file cannot fix a bad name, but
 * it can refuse to print one.
 */
export function labelFor(row, { emphatic = false } = {}) {
  if (row?.isViewer) return emphatic ? 'You — that’s you!' : 'You'
  return stripUnsafeName(row?.displayName)
}

/**
 * Refuse to print a name that carries an account identity.
 *
 * Deliberately NOT a copy of the server's `publicLearnerName`: that one
 * FORMATS ("Chanda Mwale" → "Chanda M."), and formatting on the client too
 * would be a second implementation of a policy, which is how the two drift.
 * This one only ever REJECTS, so the worst it can do is show "Learner" for a
 * row it did not understand — never a different name from the one the server
 * decided on.
 */
export function stripUnsafeName(raw) {
  const name = String(raw || '').trim()
  if (!name) return 'Learner'
  if (name.includes('@')) return 'Learner'
  if (/\S+\.[a-z]{2,}(\s|$)/i.test(name)) return 'Learner'
  return name.slice(0, 24)
}

/** "96 pts" — one place, so the podium and the list cannot disagree. */
export function formatPoints(points) {
  const n = Math.max(0, Math.floor(Number(points) || 0))
  return `${n.toLocaleString('en-GB')} pts`
}

/**
 * The reset pill: "Resets Monday · 3 days".
 *
 * The number is computed from the Lusaka clock by the same module the week
 * id comes from, so the pill and the board boundary cannot disagree — the
 * failure this replaces is a hard-coded "3 days" in a prototype, and the
 * one after that would have been a countdown derived from the DEVICE's
 * timezone while the server filed points against Zambia's.
 */
export function buildResetPill(now = new Date()) {
  const days = daysUntilWeekReset(now)
  return {
    label: 'Resets Monday',
    days,
    detail: days === 1 ? '1 day' : `${days} days`,
  }
}

/**
 * "👑 Last week: Chanda M." — or nothing at all.
 *
 * Returns null when the previous week has no entries, which is the true
 * state in a grade's first week and after any week nobody played. The page
 * renders nothing rather than a placeholder: an invented winner is worse
 * than an absent line, and "Last week: —" is a puzzle rather than a fact.
 *
 * The winner is resolved with the SAME comparator the live board uses, so
 * a tie last week is broken the way it would have been shown at the time.
 */
export function resolveLastWeekWinner(entries) {
  const sorted = [...(entries || [])].filter((e) => e && e.uid && pointsOf(e) > 0).sort(compareEntries)
  const top = sorted[0]
  if (!top) return null
  return {
    uid: top.uid,
    name: stripUnsafeName(top.displayName),
    points: pointsOf(top),
  }
}

/**
 * The three header stats, from real data or honestly blank.
 *
 * `null` is rendered as an em dash, and the cases are different on purpose:
 * a learner with no entry this week has NO RANK — they are not last, they
 * have not played — whereas their points genuinely are zero. Showing "#0"
 * or a guessed rank would be a claim about a position that does not exist.
 */
export function buildHeaderStats({ viewerEntry, viewerRank, streak }) {
  const points = viewerEntry ? pointsOf(viewerEntry) : 0
  const rankValue = viewerEntry && Number.isFinite(Number(viewerRank)) ? Number(viewerRank) : null
  const streakDays = Math.max(0, Math.floor(Number(streak) || 0))
  return [
    { key: 'rank', label: 'Your rank', value: rankValue ? `#${rankValue}` : '—' },
    { key: 'points', label: 'Your points', value: String(points) },
    { key: 'streak', label: 'Streak', value: `${streakDays}`, emoji: '🔥' },
  ]
}

/**
 * Does the pinned "your position" card at the bottom get drawn?
 *
 * Yes whenever the learner has a row on the board — including when that row
 * is already visible above. The reference design shows both, and it is the
 * right call on a phone: the list scrolls, the header has scrolled away, and
 * the card is the summary the learner leaves the page with. It is NOT
 * duplication of an unseen thing; it is the same fact where the thumb is.
 *
 * No entry at all → no card. A learner who has not played this week is shown
 * the invitation to play instead, which is the useful thing to say.
 */
export function buildPinnedCard({ viewerEntry, viewerRank }) {
  if (!viewerEntry) return null
  const rank = Number.isFinite(Number(viewerRank)) ? Number(viewerRank) : null
  return {
    rank,
    rankLabel: rank ? `#${rank}` : '—',
    points: pointsOf(viewerEntry),
    pointsLabel: formatPoints(pointsOf(viewerEntry)),
  }
}

/** The states the page can be in. There is no state that renders nothing. */
export const BOARD_STATE = Object.freeze({
  LOADING: 'loading',
  SIGNED_OUT: 'signed-out',
  ERROR: 'error',
  EMPTY: 'empty',
  READY: 'ready',
})

/**
 * Which one, from what is known.
 *
 * ORDER IS THE WHOLE FUNCTION. A failed read is never reported as an empty
 * board — an empty board is a claim that nobody in the grade has played this
 * week, and a query that failed supports no claim at all. That is the same
 * rule `DailyQuizLeaderboard` states in a comment and the old games board
 * broke: `subscribeToGlobalLeaderboard`'s error path called back with
 * `{rows: [], error}`, so a subscription failure arrived as an empty array
 * with an error beside it and any renderer checking length first showed
 * "The board is wide open".
 */
export function resolveBoardState({ loading, signedIn, error, rowCount }) {
  if (!signedIn) return BOARD_STATE.SIGNED_OUT
  if (error) return BOARD_STATE.ERROR
  if (loading) return BOARD_STATE.LOADING
  if (!rowCount) return BOARD_STATE.EMPTY
  return BOARD_STATE.READY
}

/**
 * The two supportive lines under the list.
 *
 * The grade is dynamic because the board is, and because the sentence is a
 * claim: "everyone in Grade 7 gets the same challenge each day" is only true
 * of the grade the learner is actually ranked in.
 */
export function buildFooterNote(grade) {
  const g = Number(grade)
  const who = Number.isFinite(g) && g > 0 ? `Grade ${g}` : 'your grade'
  return [
    `Everyone in ${who} gets the same challenge each day.`,
    'The board resets every Monday. 🎉',
  ]
}

/**
 * A screen reader's version of a row: "Rank 4, Luyando S., 161 points."
 *
 * Built here rather than assembled in JSX because the visual row splits rank,
 * name and points into three boxes whose reading order is a layout accident.
 * One string, said once, in the order a person would say it.
 */
export function describeRow(row) {
  const name = labelFor(row)
  const medal = medalFor(row?.rank)
  const place = medal ? `${medal.label}, ` : `Rank ${row?.rank}, `
  return `${place}${name}, ${Math.max(0, Math.floor(Number(row?.points) || 0))} points.`
}
