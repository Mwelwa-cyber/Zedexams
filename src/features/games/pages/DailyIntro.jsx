/**
 * DailyIntro — the prototype's view-daily-intro: the Zed-hosted screen a
 * learner sees before playing today's challenge, with the facts that make
 * the daily loop legible (same challenge for everyone, points count on the
 * weekly board, the streak, once-a-day counting) and the two doors: Play
 * and See the leaderboard.
 *
 * Every fact is one the system enforces, with two corrections from the
 * mockup's wording:
 * - "5 quick questions" is absent — the rotation can pick ANY mechanic
 *   (Number Target, Word Builder, …), so the hero names the actual game
 *   instead of promising a question count it may not have.
 * - "Just once a day" is stated as what recordDailyPlay actually does:
 *   the STREAK counts once per day. Replays are allowed; they simply
 *   don't double-count.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { getTodaysChallenge, getMyStreak } from '../../../utils/dailyChallengeService'
import { resolveLearnerGrade } from '../lib/gamesHubCore'
import { SectionSkeleton } from '../../learnerHome'
import SeoHelmet from '../../../shared/components/SeoHelmet'

function todayLabel(d = new Date()) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function DailyIntro() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  // The SAME grade the hub scoped its daily card to. If these two ever
  // disagreed, the card would open on a different quiz than the one it
  // advertised — see gamesHubCore.
  const grade = resolveLearnerGrade(userProfile)
  const [state, setState] = useState({ loading: true, game: null, streak: 0 })

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([getTodaysChallenge({ grade }), getMyStreak()]).then(([c, s]) => {
      if (cancelled) return
      setState({
        loading: false,
        game: c.status === 'fulfilled' ? c.value?.game || null : null,
        streak: s.status === 'fulfilled' ? Number(s.value?.streak) || 0 : 0,
      })
      return null
    }).catch(() => { /* allSettled never rejects; satisfies promise/catch-or-return */ })
    return () => { cancelled = true }
  }, [currentUser, grade])

  const { loading, game, streak } = state

  return (
    <div>
      <SeoHelmet title="Today's Challenge" path="/games/daily" noIndex />
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Games" onClick={() => navigate('/games')}>‹</button>
        <div className="lhx-back-title">Today’s Challenge</div>
      </div>

      {loading ? (
        <div className="lhx-card"><SectionSkeleton lines={5} height={52} /></div>
      ) : !game ? (
        <div className="lhx-card" style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ fontWeight: 800 }}>We couldn’t load today’s challenge.</p>
          <Link to="/games" className="lhx-btn lhx-btn-soft">Back to Games</Link>
        </div>
      ) : (
        <>
          <div className="lhx-dq-hero">
            <img src="/images/characters/poses/zed-waving.webp" alt="" aria-hidden="true" />
            <div className="lhx-dq-date">{todayLabel()}</div>
            <div className="lhx-dq-title">{game.title}</div>
            <div className="lhx-dq-sub">Today’s challenge · hosted by Zed</div>
          </div>

          <div className="lhx-dq-facts">
            <div className="lhx-dq-fact"><span className="em" aria-hidden="true">🎯</span><div>Everyone gets the <b>same challenge</b> today — a new one is picked every day.</div></div>
            <div className="lhx-dq-fact"><span className="em" aria-hidden="true">🏆</span><div>Points from your plays count on <b>this week’s leaderboard</b>.</div></div>
            <div className="lhx-dq-fact">
              <span className="em" aria-hidden="true">🔥</span>
              <div>
                {streak > 0
                  ? <>Play every day to keep your streak — now <b>{streak} {streak === 1 ? 'day' : 'days'}</b>.</>
                  : 'Play today to start a streak.'}
              </div>
            </div>
            <div className="lhx-dq-fact"><span className="em" aria-hidden="true">⏱️</span><div>Your streak counts <b>once a day</b> — come back tomorrow to keep it going.</div></div>
          </div>

          <button
            type="button"
            className="lhx-btn lhx-btn-primary"
            style={{ width: '100%' }}
            onClick={() => navigate(`/games/play/${game.id}`)}
          >
            ▶&nbsp; Play today’s challenge
          </button>
          <div style={{ height: 10 }} />
          <Link to="/games/leaderboard" className="lhx-btn lhx-btn-white" style={{ width: '100%' }}>
            🏆&nbsp; See the leaderboard
          </Link>
        </>
      )}
    </div>
  )
}
