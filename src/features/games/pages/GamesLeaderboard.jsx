/**
 * GamesLeaderboard — `/games/leaderboard`.
 *
 * The weekly, grade-scoped board that replaced `GlobalLeaderboard`. That one
 * ranked raw `scores` ROWS: one row per round played, so a learner who
 * played four rounds took four places on it, there was no grade scope, its
 * "This Week" tab was a rolling seven days rather than a week, and it printed
 * whatever was in `scores.displayName` — which on the live board included an
 * email address.
 *
 * What this renders instead is one row per LEARNER per ISO week within their
 * own grade, from `gamesLeaderboards/{grade}/weeks/{weekId}/entries/{uid}` —
 * a rollup only the `gameScoreOnCreate` trigger can write. So the Daily
 * Challenge's promise, "points from your plays count on this week's
 * leaderboard", is now literally what happens: a finished round writes a
 * `scores` row, the trigger folds it into this week's entry, and the two
 * listeners below show it land.
 *
 * ── Where the numbers come from ──────────────────────────────────────────
 *
 * Nothing on this page is computed from the prototype. The grade is the
 * learner's profile (`resolveLearnerGrade`, the same function the games hub
 * and the daily challenge scope themselves by, so the three cannot
 * disagree). The points and rank are the board. The STREAK is
 * `dailyStreaks/{uid}` via `getMyStreak` — deliberately the same document
 * the Daily Challenge screen reads and `recordDailyPlay` writes, because two
 * streak counters would eventually disagree in front of a child who had been
 * told the number matters.
 *
 * ── Shell ────────────────────────────────────────────────────────────────
 *
 * Rendered inside `LearnerLayout`, like `/games` and `/games/daily`. The old
 * board mounted the legacy `GamesShell` chrome ("ZedExams Games · PLAY •
 * LEARN • LEVEL UP"), which is why it looked like a different application
 * from the Daily Challenge screen that links to it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../gamesProto.css'
import '../gamesLeaderboard.css'
import { useAuth } from '../../../contexts/AuthContext'
import { getMyStreak } from '../../../utils/dailyChallengeService'
import { resolveLearnerGrade } from '../lib/gamesHubCore'
import {
  subscribeToWeeklyBoard,
  subscribeToMyWeekEntry,
  getMyWeeklyRank,
  getLastWeekTop,
} from '../services/gamesLeaderboardService'
import {
  BOARD_STATE,
  avatarFor,
  buildFooterNote,
  buildHeaderStats,
  buildPinnedCard,
  buildResetPill,
  describeRow,
  formatPoints,
  labelFor,
  medalFor,
  podiumLayout,
  previousWeekId,
  rankEntries,
  resolveBoardState,
  resolveLastWeekWinner,
  splitBoard,
  weekIdFor,
} from '../lib/gamesLeaderboardCore'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function GamesLeaderboard() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const uid = currentUser?.uid || null
  const grade = resolveLearnerGrade(userProfile)

  // The week is resolved ONCE per mount. Re-deriving it on every render
  // would rebuild both listeners every second on the one night of the week
  // it changes, and a learner sitting on the page at Lusaka midnight on
  // Sunday gets the new board on their next navigation — which is the
  // moment it becomes true for them.
  const weekId = useMemo(() => weekIdFor(new Date()), [])
  const lastWeek = useMemo(() => previousWeekId(new Date()), [])
  const resetPill = useMemo(() => buildResetPill(new Date()), [])

  const [board, setBoard] = useState({ entries: null, error: null })
  const [mine, setMine] = useState(null)
  const [myRank, setMyRank] = useState(null)
  const [streak, setStreak] = useState(0)
  const [winner, setWinner] = useState(null)
  const [retryToken, setRetryToken] = useState(0)

  /* ── the board ──────────────────────────────────────────────────── */

  useEffect(() => {
    if (!uid) return undefined
    setBoard({ entries: null, error: null })
    return subscribeToWeeklyBoard({ grade, weekId }, setBoard)
  }, [uid, grade, weekId, retryToken])

  // The learner's own row, separately, because a learner outside the top 50
  // is not in the query above and their header would otherwise read "—"
  // beside a board showing everyone else's live points.
  useEffect(() => {
    if (!uid) return undefined
    return subscribeToMyWeekEntry({ grade, weekId, uid }, ({ entry }) => setMine(entry))
  }, [uid, grade, weekId, retryToken])

  /* ── the streak: the Daily Challenge's, not a second one ────────── */

  useEffect(() => {
    if (!uid) { setStreak(0); return undefined }
    let cancelled = false
    getMyStreak()
      .then((s) => { if (!cancelled) setStreak(Number(s?.streak) || 0); return null })
      .catch(() => { /* a missing streak is 0, never a broken header */ })
    return () => { cancelled = true }
  }, [uid, retryToken])

  /* ── last week's winner ─────────────────────────────────────────── */

  useEffect(() => {
    if (!uid) return undefined
    let cancelled = false
    getLastWeekTop({ grade, weekId: lastWeek })
      .then((rows) => { if (!cancelled) setWinner(resolveLastWeekWinner(rows)); return null })
      .catch(() => { /* advisory: no crown is a fine outcome */ })
    return () => { cancelled = true }
  }, [uid, grade, lastWeek, retryToken])

  /* ── the rank, counted rather than downloaded ───────────────────── */

  const ranked = useMemo(() => rankEntries(board.entries, uid), [board.entries, uid])
  const { podium, rest } = useMemo(() => splitBoard(ranked.rows), [ranked.rows])

  // A learner inside the fetched page already has an exact rank from the
  // list; only one outside it needs the count query. Guarded on the POINTS
  // value so a board update that does not move the learner does not re-ask.
  const myPoints = Number(mine?.points) || 0
  const countedFor = useRef(null)
  useEffect(() => {
    if (!uid) return undefined
    if (ranked.viewer) { setMyRank(ranked.viewer.rank); return undefined }
    if (!mine) { setMyRank(null); return undefined }
    const key = `${weekId}:${myPoints}`
    if (countedFor.current === key) return undefined
    countedFor.current = key
    let cancelled = false
    getMyWeeklyRank({ grade, weekId, points: myPoints })
      .then((r) => { if (!cancelled) setMyRank(r); return null })
      .catch(() => { if (!cancelled) setMyRank(null) })
    // Without this, a count that resolves after the learner's points have
    // moved writes the rank they USED to hold back over the newer one.
    return () => { cancelled = true }
  }, [uid, grade, weekId, myPoints, mine, ranked.viewer])

  const retry = useCallback(() => {
    countedFor.current = null
    setRetryToken((n) => n + 1)
  }, [])

  /* ── what to draw ───────────────────────────────────────────────── */

  const state = resolveBoardState({
    loading: board.entries == null,
    signedIn: Boolean(uid),
    error: board.error,
    rowCount: ranked.rows.length,
  })

  const stats = buildHeaderStats({ viewerEntry: mine, viewerRank: myRank, streak })
  const pinned = buildPinnedCard({ viewerEntry: mine, viewerRank: myRank })
  const footer = buildFooterNote(grade)

  return (
    <div className="lhx-lb">
      <SeoHelmet title="Leaderboard" path="/games/leaderboard" noIndex />

      <div className="lhx-back-row">
        <button
          type="button"
          className="lhx-back-btn"
          aria-label="Back to Games"
          onClick={() => navigate('/games')}
        >
          ‹
        </button>
        <div className="lhx-back-title">Leaderboard</div>
      </div>

      {state === BOARD_STATE.SIGNED_OUT && <SignedOutPanel />}
      {state === BOARD_STATE.ERROR && <ErrorPanel onRetry={retry} />}
      {state === BOARD_STATE.LOADING && <BoardSkeleton />}

      {(state === BOARD_STATE.READY || state === BOARD_STATE.EMPTY) && (
        <>
          <Hero grade={grade} stats={stats} />

          <div className="lhx-lb-meta">
            <div className="lhx-lb-meta-card lhx-lb-meta-reset">
              <span className="lhx-lb-meta-em" aria-hidden="true">🗓</span>
              <span>
                {resetPill.label} · <b>{resetPill.detail}</b>
              </span>
            </div>
            {/* No previous winner → no card at all. "Last week: —" is a
                puzzle, and an invented name is worse than both. */}
            {winner && (
              <div className="lhx-lb-meta-card lhx-lb-meta-winner">
                <span className="lhx-lb-meta-em" aria-hidden="true">👑</span>
                <span>
                  Last week: <b>{winner.name}</b>
                </span>
              </div>
            )}
          </div>

          {state === BOARD_STATE.EMPTY ? (
            <EmptyPanel />
          ) : (
            <>
              <Podium rows={podium} />

              {rest.length > 0 && (
                <>
                  <h2 className="lhx-lb-h2">Everyone else</h2>
                  <ul className="lhx-lb-list">
                    {rest.map((row, index) => (
                      <Row key={row.uid} row={row} emphatic index={index} />
                    ))}
                  </ul>
                </>
              )}

              <p className="lhx-lb-note">
                {footer[0]}
                <br />
                {footer[1]}
              </p>
            </>
          )}

          {pinned && (
            <div className="lhx-lb-pinned">
              <ul className="lhx-lb-list">
                <Row
                  row={{ uid, rank: pinned.rank, points: pinned.points, isViewer: true }}
                  rankLabel={pinned.rankLabel}
                  pinned
                />
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── pieces ────────────────────────────────────────────────────────── */

function Hero({ grade, stats }) {
  return (
    <header className="lhx-lb-hero">
      <div className="lhx-lb-hero-top">
        <span aria-hidden="true" style={{ fontSize: 22 }}>🏆</span>
        <div style={{ minWidth: 0 }}>
          <h1 className="lhx-lb-hero-title">Leaderboard</h1>
          <p className="lhx-lb-hero-sub">Grade {grade} · This week</p>
        </div>
      </div>
      <div className="lhx-lb-stats">
        {stats.map((stat) => (
          <div className="lhx-lb-stat" key={stat.key}>
            <div className="lhx-lb-stat-v">
              {/* The flame is decoration; the number is the fact. Reading
                  "fire 3" aloud is not a streak. */}
              {stat.emoji && <span aria-hidden="true">{stat.emoji} </span>}
              {stat.value}
            </div>
            <div className="lhx-lb-stat-l">{stat.label}</div>
          </div>
        ))}
      </div>
    </header>
  )
}

function Avatar({ row }) {
  const { letter, tone } = avatarFor(row)
  return (
    <span className={`lhx-lb-avatar lhx-lb-avatar-${tone}`} aria-hidden="true">
      {row?.isViewer ? '⭐' : letter}
    </span>
  )
}

function Podium({ rows }) {
  const layout = podiumLayout(rows)
  if (!layout.length) return null
  return (
    // A list, not a row of divs: three ranked people in an order that
    // matters. `aria-label` says what the order IS, because the visual
    // order (2 · 1 · 3) is not the ranking order.
    <ol className="lhx-lb-podium" aria-label="Top three this week">
      {layout.map((row) => {
        const medal = medalFor(row.rank)
        return (
          <li
            key={row.uid}
            className={`lhx-lb-pod lhx-lb-pod-${row.rank}${row.isViewer ? ' is-viewer' : ''}`}
          >
            <Avatar row={row} />
            <span className="lhx-lb-pod-name">{labelFor(row)}</span>
            <span className="lhx-lb-pod-pts">{formatPoints(row.points)}</span>
            <span className="lhx-lb-pod-block">
              <span aria-hidden="true">{medal ? medal.emoji : row.rank}</span>
            </span>
            <span className="lhx-sr-only">{describeRow(row)}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Row({ row, rankLabel, emphatic = false, pinned = false, index = 0 }) {
  return (
    <li
      className={`lhx-lb-row${row.isViewer ? ' is-viewer' : ''}`}
      // Staggered entrance, capped so row 40 is not a two-second wait.
      style={{ animationDelay: `${Math.min(index, 8) * 26}ms` }}
    >
      <span className="lhx-lb-rank" aria-hidden="true">{rankLabel ?? row.rank}</span>
      <Avatar row={row} />
      <span className="lhx-lb-name" aria-hidden="true">
        {labelFor(row, { emphatic: emphatic && row.isViewer })}
      </span>
      <span className="lhx-lb-pts" aria-hidden="true">{formatPoints(row.points)}</span>
      {/* One string for a screen reader instead of three boxes whose reading
          order is a layout accident. The pinned card says what it IS, since
          it repeats a row that may already be above. */}
      <span className="lhx-sr-only">
        {pinned ? `Your position. ${describeRow(row)}` : describeRow(row)}
      </span>
    </li>
  )
}

/* ── states ────────────────────────────────────────────────────────── */

function EmptyPanel() {
  return (
    <div className="lhx-lb-panel">
      <div className="lhx-lb-panel-em" aria-hidden="true">🏆</div>
      <h2>The leaderboard is waiting for its first scores</h2>
      <p>Play today’s challenge to get the week started — your points land here.</p>
      <Link to="/games/daily" className="lhx-btn lhx-btn-primary">
        Play today’s challenge
      </Link>
    </div>
  )
}

function ErrorPanel({ onRetry }) {
  return (
    // No Firestore code, no index-building explanation, no stack. A learner
    // can act on "try again"; they can do nothing with FAILED_PRECONDITION,
    // which is what the old board showed them.
    <div className="lhx-lb-panel" role="alert">
      <div className="lhx-lb-panel-em" aria-hidden="true">📡</div>
      <h2>We couldn’t load the board</h2>
      <p>Check your connection and try again — your points are safe.</p>
      <button type="button" className="lhx-btn lhx-btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

function SignedOutPanel() {
  return (
    <div className="lhx-lb-panel">
      <div className="lhx-lb-panel-em" aria-hidden="true">🏆</div>
      <h2>Sign in to see your grade’s board</h2>
      <p>The leaderboard ranks everyone in your grade for the week, so it needs to know yours.</p>
      <Link to="/login?redirect=/games/leaderboard" className="lhx-btn lhx-btn-primary">
        Sign in
      </Link>
    </div>
  )
}

/* Sized to the real board so nothing jumps when the data lands. */
function BoardSkeleton() {
  return (
    <div className="lhx-lb" aria-busy="true" aria-label="Loading the leaderboard">
      <div className="lhx-lb-skel lhx-lb-skel-hero" />
      <div className="lhx-lb-meta">
        <div className="lhx-lb-skel lhx-lb-skel-meta" />
        <div className="lhx-lb-skel lhx-lb-skel-meta" />
      </div>
      <div className="lhx-lb-podium">
        <div className="lhx-lb-skel lhx-lb-skel-pod" />
        <div className="lhx-lb-skel lhx-lb-skel-pod lhx-lb-skel-pod-1" />
        <div className="lhx-lb-skel lhx-lb-skel-pod" />
      </div>
      <div className="lhx-lb-list">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="lhx-lb-skel lhx-lb-skel-row" />
        ))}
      </div>
    </div>
  )
}
