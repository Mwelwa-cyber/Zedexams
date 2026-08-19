/**
 * DailyQuizLeaderboard — the weekly board at `/daily/leaderboard`.
 *
 * Everyone in a grade sits the same five questions on the same day, which is
 * the only reason this board means anything: a personalised daily quiz
 * cannot be ranked, because you would be comparing a child who drew easy
 * questions with one who drew hard ones.
 *
 * Two rules the copy has to keep:
 *   - ties break on how quickly the quiz was finished, RECORDED QUIETLY and
 *     never shown as a countdown while the child plays;
 *   - only guardian-approved learners appear here, per /child-safety. A
 *     learner who is not approved still plays and still keeps their score.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getWeeklyBoard, getMyWeekEntry, weekIdFor } from '../services/dailyQuizService'
import { rankEntries, buildWeekSummary } from '../lib/dailyQuizCore'
import { useAuth } from '../../../contexts/AuthContext'
import '../dailyQuiz.css'

const TOP_N = 10

export default function DailyQuizLeaderboard() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const grade = userProfile?.grade
  const weekId = useMemo(() => weekIdFor(new Date()), [])

  const [entries, setEntries] = useState([])
  const [mine, setMine] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!grade) { setLoading(false); return undefined }
    ;(async () => {
      try {
        const [board, own] = await Promise.all([
          getWeeklyBoard({ grade, weekId }),
          getMyWeekEntry({ grade, weekId, uid: currentUser?.uid }),
        ])
        if (cancelled) return
        setEntries(board)
        setMine(own)
      } catch (err) {
        console.error('weekly board load failed', err)
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [grade, weekId, currentUser?.uid])

  const { rows, viewer } = useMemo(
    () => rankEntries(entries, currentUser?.uid),
    [entries, currentUser?.uid],
  )
  const week = buildWeekSummary(mine || viewer)

  return (
    <div className="dq">
      <div className="dq-stats">
        <div className="dq-stat">
          <div className="dq-stat-v">{week.label}</div>
          <div className="dq-stat-l">Days this week</div>
        </div>
        <div className="dq-stat">
          <div className="dq-stat-v">{week.points}</div>
          <div className="dq-stat-l">Points this week</div>
        </div>
        <div className="dq-stat">
          <div className="dq-stat-v">{viewer ? `#${viewer.position}` : '—'}</div>
          <div className="dq-stat-l">Grade {grade || '—'} rank</div>
        </div>
      </div>

      <div className="dq-card">
        <div className="dq-kicker">Grade {grade || '—'} · {weekId}</div>

        {loading && <p style={{ fontSize: 13.5 }}>Loading the board…</p>}

        {!loading && error && (
          // A failed read is never rendered as an empty board — an empty
          // board is a claim that nobody has played.
          <p style={{ fontSize: 13.5 }}>
            We couldn’t load the board just now. Check your connection and try again.
          </p>
        )}

        {!loading && !error && rows.length === 0 && (
          <p style={{ fontSize: 13.5, color: 'var(--lhx-muted)' }}>
            Nobody has played yet this week. Be the first.
          </p>
        )}

        {!loading && !error && rows.slice(0, TOP_N).map((r) => (
          <div key={r.uid} className={`dq-lb-row${r.isViewer ? ' is-viewer' : ''}`}>
            <div className="dq-lb-pos">{r.position}</div>
            <div className="dq-lb-name">{r.isViewer ? 'You' : (r.displayName || 'Learner')}</div>
            <div className="dq-lb-points">{r.points}</div>
          </div>
        ))}

        {/* The viewer's own row, when they are below the visible top. */}
        {!loading && !error && viewer && viewer.position > TOP_N && (
          <>
            <div style={{ textAlign: 'center', color: 'var(--lhx-faint)', fontWeight: 900, padding: 6 }}>
              · · ·
            </div>
            <div className="dq-lb-row is-viewer">
              <div className="dq-lb-pos">{viewer.position}</div>
              <div className="dq-lb-name">You</div>
              <div className="dq-lb-points">{viewer.points}</div>
            </div>
          </>
        )}
      </div>

      <div className="dq-card">
        <div className="dq-kicker">How points work</div>
        <div style={{ fontSize: 13, lineHeight: 1.65 }}>
          10 points a correct answer · 10 bonus for all five.<br />
          Ties are broken by how quickly the quiz was finished — recorded quietly, never shown as a
          countdown.<br />
          The board resets <b>Sunday midnight</b>. Only learners whose parent or guardian has said
          it’s OK appear here.
        </div>
      </div>

      <button type="button" className="dq-btn dq-btn-ghost" onClick={() => navigate('/daily')}>
        Back to today’s quiz
      </button>
    </div>
  )
}
