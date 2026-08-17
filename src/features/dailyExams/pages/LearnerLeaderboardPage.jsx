// src/features/dailyExams/pages/LearnerLeaderboardPage.jsx
//
// /exams/leaderboard — the prototype-v23 weekly daily-quiz board, inside
// the learner shell (the four-tab nav stays visible; the board is a
// browsable destination, not an immersive view).
//
// It replaces the earlier filter-driven page, and the two differences are
// requirements rather than trims:
//
//   · GRADE IS NOT SELECTABLE. Content on the child UI is auto-filtered to
//     the learner's own grade from their profile — a grade picker is grade
//     browsing, which the build spec rules out. A Grade 7 learner competes
//     with Grade 7.
//   · THE BOARD IS WEEKLY, NOT DAILY. Points accumulate Monday to Sunday
//     and reset, so one bad morning does not sink the week and a learner
//     who joins on Thursday can still climb.
//
// Names are truncated to a first name plus a surname initial by
// `boardName` in the core — this surface is readable by every learner in
// the grade, so a full name here would be child PII on a shared screen.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useAuth } from '../../../contexts/AuthContext'
import useLearnerStats from '../../../hooks/useLearnerStats'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'
import { buildBoard, championOf } from '../lib/learnerLeaderboardCore'
import { fetchWeeklyBoardData } from '../services/weeklyLeaderboardService'

/** Avatar tints, in the prototype's order. Indexed by rank so a learner
 *  keeps the same colour as they move up and down the board. */
const AV_COLORS = [
  '#ffb43a', '#ff7fa6', '#6db2f5', '#7ee0a3', '#a68bf5',
  '#ff9868', '#5b63dd', '#2ec06a', '#f97c6c',
]
const tintFor = (rank) => AV_COLORS[(rank - 1) % AV_COLORS.length]
const ME_TINT = 'linear-gradient(135deg, #ff9057, #ff5c39)'
const MEDALS = ['🥇', '🥈', '🥉']

function PodiumColumn({ row }) {
  return (
    <div className={`lhx-pod lhx-pod-${row.rank}`}>
      <div
        className="lhx-pod-av"
        style={{ background: row.me ? ME_TINT : tintFor(row.rank) }}
        aria-hidden="true"
      >
        {row.letter}
      </div>
      <div className="lhx-pod-name">{row.name}</div>
      <div className="lhx-pod-pts">{row.points} pts</div>
      <div className="lhx-pod-bar" aria-hidden="true">{MEDALS[row.rank - 1]}</div>
    </div>
  )
}

function BoardRow({ row }) {
  return (
    <div className={`lhx-board-row${row.me ? ' is-me' : ''}`}>
      <div className="lhx-board-rank">{row.rank}</div>
      <div
        className="lhx-board-av"
        style={{ background: row.me ? 'rgba(255,255,255,.3)' : tintFor(row.rank) }}
        aria-hidden="true"
      >
        {row.letter}
      </div>
      <div className="lhx-board-name">{row.me ? "You — that's you!" : row.name}</div>
      <div className="lhx-board-pts">{row.points} pts</div>
    </div>
  )
}

export default function LearnerLeaderboardPage() {
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const uid = user?.uid || null
  const grade = userProfile?.grade ? String(userProfile.grade) : null
  // The streak lives on learnerStats/{uid}, not the profile — the same
  // doc the profile screen and the Guardian Zone read, so the number in
  // this header is the one the learner sees everywhere else.
  const { stats } = useLearnerStats(uid)

  const [state, setState] = useState({ loading: true, error: null, data: null })

  useEffect(() => {
    let cancelled = false
    if (!grade) {
      setState({ loading: false, error: null, data: null })
      return undefined
    }
    setState((s) => ({ ...s, loading: true, error: null }))

    fetchWeeklyBoardData({ grade })
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, data }) })
      .catch((err) => {
        if (cancelled) return
        // A read failure is reported as a failure. Falling back to an empty
        // board would tell a learner nobody played this week, which is a
        // different — and wrong — statement about their classmates.
        console.error('[leaderboard] week read failed', err)
        setState({ loading: false, error: 'We could not load the board just now.', data: null })
      })

    return () => { cancelled = true }
  }, [grade])

  const board = useMemo(() => {
    if (!state.data) return null
    return buildBoard({
      attempts: state.data.attempts,
      me: uid ? { userId: uid, displayName: userProfile?.displayName || '' } : null,
    })
  }, [state.data, uid, userProfile?.displayName])

  const champion = useMemo(
    () => (state.data ? championOf(state.data.previousAttempts) : null),
    [state.data],
  )

  const win = state.data?.window
  const streak = Number(stats?.currentStreak) || 0
  const myPoints = board?.me?.points ?? 0
  const myRank = board?.me?.rank ?? null

  return (
    <>
      <SeoHelmet title="Leaderboard · ZedExams" noIndex />

      <div className="lhx-lb-head">
        <div className="lhx-back-row">
          <button type="button" className="lhx-back-btn" aria-label="Go back" onClick={() => navigate(-1)}>‹</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lhx-back-title">🏆 Leaderboard</div>
            <div className="lhx-lb-sub">
              {grade ? `Grade ${grade} · This week` : 'This week'}
            </div>
          </div>
        </div>

        <div className="lhx-lb-stats">
          <div className="lhx-lb-stat">
            <div className="lhx-lb-stat-num">{myRank ? `#${myRank}` : '—'}</div>
            <div className="lhx-lb-stat-lab">YOUR RANK</div>
          </div>
          <div className="lhx-lb-stat">
            <div className="lhx-lb-stat-num">{myPoints}</div>
            <div className="lhx-lb-stat-lab">YOUR POINTS</div>
          </div>
          <div className="lhx-lb-stat">
            <div className="lhx-lb-stat-num">🔥 {streak}</div>
            <div className="lhx-lb-stat-lab">STREAK</div>
          </div>
        </div>
      </div>

      {/* No grade on the profile: the board cannot be scoped, and guessing
          one would put a learner on strangers' board. Setup fixes it. */}
      {!grade && !state.loading && (
        <div className="lhx-board-note" style={{ marginTop: 24 }}>
          Tell us your grade and you&apos;ll join your class&apos;s board.
          <br />
          <button type="button" className="lhx-lb-chip" style={{ marginTop: 12, cursor: 'pointer' }} onClick={() => navigate('/setup')}>
            Finish setting up →
          </button>
        </div>
      )}

      {state.error && (
        <div className="lhx-board-note" style={{ marginTop: 24 }}>{state.error}</div>
      )}

      {state.loading && grade && (
        <div style={{ marginTop: 18 }}>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <div style={{ height: 12 }} />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <div style={{ height: 10 }} />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      )}

      {board && !state.loading && (
        <>
          <div className="lhx-lb-strip">
            <div className="lhx-lb-chip">
              🔄 Resets <b>Monday</b> · {win.daysToReset} {win.daysToReset === 1 ? 'day' : 'days'}
            </div>
            {/* Rendered only when last week actually had a winner — an
                empty crown chip is worse than no chip. */}
            {champion && (
              <div className="lhx-lb-chip">👑 Last week: <b>{champion.name}</b></div>
            )}
          </div>

          {board.isEmpty ? (
            <div className="lhx-board-note" style={{ marginTop: 28 }}>
              Nobody in Grade {grade} has played yet this week.
              <br />
              Take today&apos;s quiz and you&apos;ll be first on the board. 🎉
            </div>
          ) : (
            <>
              <div className="lhx-podium">
                {board.podium.map((row) => <PodiumColumn key={row.userId} row={row} />)}
              </div>

              {board.rest.length > 0 && (
                <>
                  <div className="lhx-section-title">Everyone else</div>
                  {board.rest.map((row) => <BoardRow key={row.userId} row={row} />)}
                </>
              )}

              <div className="lhx-board-note">
                Everyone in Grade {grade} gets the same quiz each day.
                <br />
                The board resets every Monday. 🎉
                {/* The read cap is disclosed rather than applied quietly: a
                    board ranked from a truncated week looks identical to a
                    complete one, and a learner should not be told they are
                    #9 out of a set that was cut off. */}
                {state.data?.truncated && (
                  <>
                    <br />
                    <span style={{ opacity: 0.8 }}>Showing the busiest part of a very active week.</span>
                  </>
                )}
              </div>

              {board.showPin && (
                <div className="lhx-lb-pin">
                  <div className="lhx-lb-pin-rank">#{board.me.rank}</div>
                  <div className="lhx-board-av" style={{ background: 'rgba(255,255,255,.3)' }} aria-hidden="true">⭐</div>
                  <div className="lhx-lb-pin-name">You</div>
                  <div className="lhx-lb-pin-pts">{board.me.points} pts</div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}
