// src/features/learnerHome/pages/LearnerProfilePage.jsx
//
// /profile for learners — the prototype-v6 "My Profile" view (learner
// redesign step 10), rendered inside the learner shell so the four-tab
// nav stays visible, exactly as the mockup keeps it.
//
// Everything on screen is real data:
//   - hero: display name, grade · term · school, guardian chip (rendered
//     ONLY when a guardian actually approved — an adult learner or a
//     migration-era account shows no chip rather than a false claim)
//   - level / streak / badges tiles + the XP bar: the learner ladder in
//     /learnerStats (gamificationCore levelFromXp) and the game-badge
//     shelf in badges/{uid}
//   - "This week": quizzes / games / topics counted over the last 7 days
//     (useWeeklySummary)
// The old shared ProfilePage remains for teachers/admins — see
// src/app/routes/ProfileRoute.jsx.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useAuth } from '../../../contexts/AuthContext'
import useLearnerStats from '../../../hooks/useLearnerStats'
import useWeeklySummary from '../hooks/useWeeklySummary'
import { getMyGameBadges } from '../../../utils/gameBadgesService'
import { GAME_BADGES } from '../../../data/gameBadges'
import { resolveLearnerAccess } from '../../../utils/guardianConsent'
import { getActiveTerm } from '../../../utils/moeCalendar'
import { resolveActiveTerm, firstNameOf } from '../lib/learnerHomeCore'
import CharacterAvatar from '../../../shared/components/CharacterAvatar'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import LearnerShell from '../components/LearnerShell'

export default function LearnerProfilePage() {
  const { currentUser, userProfile, logout } = useAuth()
  const navigate = useNavigate()
  const uid = currentUser?.uid

  const { stats, level } = useLearnerStats(uid)
  const week = useWeeklySummary(uid)

  const [earnedBadges, setEarnedBadges] = useState(null) // null = loading
  useEffect(() => {
    let alive = true
    getMyGameBadges()
      .then((r) => { if (alive) setEarnedBadges(r?.byId || {}) })
      .catch(() => { if (alive) setEarnedBadges({}) })
    return () => { alive = false }
  }, [uid])

  const streak = Number(stats?.currentStreak) || 0
  const earnedCount = earnedBadges ? Object.keys(earnedBadges).length : 0

  // Earned first (catalogue order), then locked — the mockup's shelf.
  const shelf = useMemo(() => {
    const earned = GAME_BADGES.filter((b) => earnedBadges?.[b.id])
    const locked = GAME_BADGES.filter((b) => !earnedBadges?.[b.id])
    return [...earned, ...locked]
  }, [earnedBadges])

  const guardianVerified = useMemo(
    () => resolveLearnerAccess(userProfile).reason === 'guardian-approved',
    [userProfile],
  )

  const activeTerm = useMemo(() => {
    const calendarActive = getActiveTerm()
    return resolveActiveTerm({ calendarTerm: calendarActive?.term?.number ?? null }).term
  }, [])

  const subLine = [
    userProfile?.grade ? `Grade ${userProfile.grade}` : null,
    activeTerm ? `Term ${activeTerm}` : null,
    userProfile?.school || null,
  ].filter(Boolean).join(' · ')

  const firstName = firstNameOf(userProfile?.displayName)

  async function handleSignOut() {
    try { await logout() } catch { /* signed out anyway */ }
    navigate('/login')
  }

  return (
    <LearnerShell>
      <SeoHelmet title="My Profile" path="/profile" noIndex />
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Home" onClick={() => navigate('/dashboard')}>‹</button>
        <div className="lhx-back-title" style={{ flex: 1 }}>My Profile</div>
        <button type="button" className="lhx-pill" aria-label="Settings" onClick={() => navigate('/settings')}>
          <span aria-hidden="true">⚙️</span>
        </button>
      </div>

      <div className="lhx-prof-hero">
        <div className="lhx-prof-ava">
          {userProfile?.avatarCharacter ? (
            <CharacterAvatar characterId={userProfile.avatarCharacter} className="w-full h-full" />
          ) : (
            <span aria-hidden="true">{(firstName || 'Z').charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="lhx-prof-name">{userProfile?.displayName || 'Learner'}</div>
        {subLine && <div className="lhx-prof-sub">{subLine}</div>}
        {guardianVerified && <div className="lhx-prof-verify">✅ Guardian verified</div>}
      </div>

      <div className="lhx-prof-stats">
        <div className="lhx-prof-stat"><b>{level?.level ?? 1}</b><span>LEVEL</span></div>
        <div className="lhx-prof-stat"><b>🔥 {streak}</b><span>DAY STREAK</span></div>
        <div className="lhx-prof-stat"><b>{earnedCount}</b><span>BADGES</span></div>
      </div>

      <div className="lhx-prof-xp">
        <div className="lhx-prof-xp-top">
          <span>Level {level?.level ?? 1} · {level?.title || 'Beginner'}</span>
          <span>
            {level?.nextLevel
              ? `${level.totalXp} / ${level.nextLevel.threshold} XP`
              : `${level?.totalXp ?? 0} XP`}
          </span>
        </div>
        <div className="lhx-prof-xp-bar" role="progressbar" aria-valuenow={level?.progress ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the next level">
          <i style={{ width: `${level?.progress ?? 0}%` }} />
        </div>
        {level?.nextLevel && (
          <div style={{ fontSize: '11.5px', color: 'var(--lhx-muted)', fontWeight: 700, marginTop: 8 }}>
            {level.xpRemaining} XP to Level {level.nextLevel.level} 🚀
          </div>
        )}
      </div>

      <section aria-label="Achievements">
        <div className="lhx-section-head">
          <h2 className="lhx-section-title">Achievements</h2>
        </div>
        <div className="lhx-badge-shelf">
          {shelf.map((b) => {
            const earned = Boolean(earnedBadges?.[b.id])
            return (
              <div key={b.id} className="lhx-badge-chip">
                <div className={`lhx-badge-medal ${earned ? '' : 'is-locked'}`} aria-hidden="true">
                  {earned ? b.icon : '🔒'}
                </div>
                <div className="lhx-badge-name">{b.name}</div>
              </div>
            )
          })}
        </div>
      </section>

      <section aria-label="This week">
        <div className="lhx-section-head">
          <h2 className="lhx-section-title">This week</h2>
        </div>
        <div className="lhx-prof-stats">
          <div className="lhx-prof-stat"><b>{week.quizzes}</b><span>QUIZZES</span></div>
          <div className="lhx-prof-stat"><b>{week.games}</b><span>GAMES</span></div>
          <div className="lhx-prof-stat"><b>{week.topics}</b><span>TOPICS</span></div>
        </div>
      </section>

      <div>
        <button
          type="button"
          className="lhx-btn lhx-btn-block"
          style={{ background: 'var(--lhx-card)', color: 'var(--lhx-indigo-text)', boxShadow: 'var(--lhx-shadow)' }}
          onClick={() => navigate('/settings')}
        >
          ⚙️&nbsp; Settings
        </button>
        <div style={{ height: 10 }} />
        <button
          type="button"
          className="lhx-btn lhx-btn-block"
          style={{ background: 'var(--lhx-card)', color: 'var(--lhx-red)', boxShadow: 'var(--lhx-shadow)' }}
          onClick={handleSignOut}
        >
          ↩︎&nbsp; Sign out
        </button>
      </div>
    </LearnerShell>
  )
}
