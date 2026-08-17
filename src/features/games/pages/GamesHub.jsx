/**
 * /games — the prototype-v3 games hub (learner redesign step 4).
 *
 * Renders inside LearnerLayout (the 4-tab shell) in the `.lhx` design
 * system: back row, the indigo daily-challenge card, the XP/level card,
 * the achievements shelf, and the "Your games" card list with the 🏆
 * leaderboard link — the prototype's view-games, screen for screen.
 *
 * Data flow is UNCHANGED from the old hub (locked scope — reskin on the
 * kept games backend): listGames + today's challenge + history + badges
 * + streak, all via Promise.allSettled so a single Firestore failure
 * never freezes the hub, with the seed catalogue as the fallback. The
 * games list is scoped to the learner's grade when it matches any game
 * (the prototype hub is single-grade); the grade lanes at the bottom
 * keep every other grade reachable through the existing /games/g routes.
 *
 * The prototype's LIVE CHALLENGE duel card is deliberately absent — its
 * opponent was faked client-side, and shipping a pretend matchmaker is
 * a product decision that has not been made.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { duelAllowed } from '../lib/duelAccess'
import { GAME_BADGES } from '../../../data/gameBadges'
import { CATALOGUE_GAME_TYPES, RETIRED_GAME_TYPES, getFallbackGames } from '../../../data/gamesSeed'
import { getTodaysChallenge, getMyStreak } from '../../../utils/dailyChallengeService'
import { getMyGameBadges } from '../../../utils/gameBadgesService'
import { SUBJECTS, getMyHistory, listGames } from '../services/gamesService'
import { levelInfo } from '../../../utils/gameProgress'
import { TOTAL_LEVELS, currentLevel, normalizeProgress } from '../lib/numberPathCore'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { GamesHubTour } from '../../../shared/components/learnerTours'
import Skeleton from '../../../shared/components/Skeleton'

const SUBJECT_SKIN = {
  mathematics: { emoji: '🔢', cls: 'g-math' },
  english:     { emoji: '🔤', cls: 'g-word' },
  science:     { emoji: '🔬', cls: 'g-sci' },
  social:      { emoji: '🗺️', cls: 'g-map' },
}

// The rebuilt prototype mechanics carry their prototype icons; every
// other game falls back to its subject's skin.
const TYPE_SKIN = {
  number_target: { emoji: '🔢', cls: 'g-math' },
  word_builder:  { emoji: '🔤', cls: 'g-word' },
  memory_match:  { emoji: '🧠', cls: 'g-sci' },
  punctuation:   { emoji: '✒️', cls: 'g-gold' },
}

/** Local Number Path progress for the level tag + bar on its game card. */
function readPathProgress(gameId) {
  try {
    return normalizeProgress(JSON.parse(window.localStorage.getItem(`zx:number-path:${gameId}`)))
  } catch {
    return normalizeProgress(null)
  }
}

export default function GamesHub() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const [state, setState] = useState({
    loading: true,
    games: [],
    challenge: null,
    history: [],
    badgesById: {},
    streak: { streak: 0, longestStreak: 0, signedIn: false },
  })

  // Shared with the /games/duel route, so the card cannot offer a race the
  // page then refuses.
  const challengesAllowed = duelAllowed(currentUser, userProfile)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setState((prev) => ({ ...prev, loading: true }))
      const results = await Promise.allSettled([
        listGames(),
        getTodaysChallenge(),
        getMyHistory(40),
        getMyGameBadges(),
        getMyStreak(),
      ])
      if (cancelled) return

      const value = (i, fallback) => (results[i].status === 'fulfilled' ? results[i].value : fallback)
      // A live Firestore doc can still carry a retired mechanic — filter
      // here so the hub never advertises a game that opens on a
      // retirement card (the seed fallback already filters itself).
      const liveGames = value(0, []).filter((g) => !RETIRED_GAME_TYPES.has(g?.type))
      setState((prev) => ({
        ...prev,
        loading: false,
        games: liveGames.length ? liveGames : getFallbackGames(),
        challenge: value(1, null),
        history: value(2, []),
        badgesById: value(3, { byId: {} })?.byId || {},
        streak: value(4, { streak: 0, longestStreak: 0, signedIn: !!currentUser }),
      }))
    }

    load()
    return () => { cancelled = true }
  }, [currentUser])

  const totalPoints = state.history.reduce((sum, row) => sum + (Number(row.score) || 0), 0)
  const progress = levelInfo(totalPoints)
  const earnedIds = new Set(Object.keys(state.badgesById || {}))
  const earnedCount = GAME_BADGES.filter((b) => earnedIds.has(b.id)).length

  // Best saved score per game, from the same history rows the XP uses.
  const bestByGame = useMemo(() => {
    const map = new Map()
    for (const row of state.history) {
      if (!row?.gameId) continue
      map.set(row.gameId, Math.max(map.get(row.gameId) || 0, Number(row.score) || 0))
    }
    return map
  }, [state.history])

  // The mockup's catalogue is EXACTLY the four mechanics, one card each
  // (step 8): per type, the learner's-grade doc when one exists, else
  // any active doc of that type. timed_quiz never lists — it plays
  // through the daily card and the duel only.
  const profileGrade = Number(userProfile?.grade)
  const scopedToGrade = state.games.some((g) => Number(g.grade) === profileGrade)
  const visibleGames = useMemo(() => {
    const order = ['number_target', 'word_builder', 'memory_match', 'punctuation']
    return order
      .map((type) => {
        const ofType = state.games.filter((g) => g.type === type && CATALOGUE_GAME_TYPES.has(g.type))
        if (!ofType.length) return null
        return ofType.find((g) => Number(g.grade) === profileGrade) || ofType[0]
      })
      .filter(Boolean)
  }, [state.games, profileGrade])

  const challengeGame = state.challenge?.game || null
  const streakDays = Number(state.streak?.streak) || 0

  return (
    <div>
      <SeoHelmet
        title="Games"
        description="Play Zambian CBC-aligned learning games with daily challenges, XP levels, badges and the leaderboard."
        path="/games"
      />
      <GamesHubTour />

      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Home" onClick={() => navigate('/dashboard')}>‹</button>
        <div>
          <div className="lhx-back-title">Games</div>
          <div className="lhx-back-sub">
            {scopedToGrade ? `Grade ${profileGrade} · play, score, level up!` : 'Play, score, level up!'}
          </div>
        </div>
      </div>

      {/* Daily challenge — the prototype's indigo hero card. */}
      {state.loading ? (
        <Skeleton height={96} className="lhx-skel" style={{ borderRadius: 24 }} />
      ) : challengeGame && (
        <Link to={`/games/play/${challengeGame.id}`} className="lhx-daily">
          <div className="lhx-daily-emoji" aria-hidden="true">
            <img
              src="/images/characters/poses/zed-waving.webp"
              alt=""
              style={{ width: 56, height: 56, objectFit: 'contain', filter: 'drop-shadow(0 5px 7px rgba(0,0,0,.25))' }}
            />
          </div>
          <div className="lhx-daily-body">
            <div className="lhx-daily-label">
              TODAY'S CHALLENGE{Number(challengeGame.grade) ? ` · GRADE ${challengeGame.grade}` : ''}
            </div>
            <div className="lhx-daily-name">{challengeGame.title}</div>
            <div className="lhx-daily-sub">
              {streakDays > 0 ? `${streakDays}-day streak — keep it going 🔥` : 'Play today to start a streak 🔥'}
            </div>
          </div>
          <span className="lhx-play-pill">Play</span>
        </Link>
      )}

      {/* Race Zed! — the honest duel (the prototype's LIVE CHALLENGE
          card, reframed: the opponent is openly our robot).

          Removed, not padlocked, when a guardian has switched live
          challenges off: a locked card invites the "how do I unlock this"
          conversation with the parent who just deliberately locked it. */}
      {challengesAllowed && (
      <Link to="/games/duel" className="lhx-duel-card">
        <div className="lhx-daily-emoji" aria-hidden="true">⚔️</div>
        <div className="lhx-daily-body">
          <div className="lhx-daily-label">CHALLENGE MODE</div>
          <div className="lhx-daily-name">Race Zed!</div>
          <div className="lhx-daily-sub">5 quick questions · beat our robot before the clock does</div>
        </div>
        <span className="lhx-play-pill">Play</span>
      </Link>
      )}

      {/* XP / level card. */}
      <div className="lhx-xp">
        <div className="lhx-xp-top">
          <div className="lhx-xp-badge" aria-hidden="true">{progress.rank?.emoji || '🎓'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lhx-xp-lvl">Level {progress.level} {progress.rank?.title || 'Learner'}</div>
            <div className="lhx-xp-sub">
              {currentUser
                ? `${progress.pointsToNext} XP to Level ${progress.level + 1}`
                : 'Sign in to earn XP and badges'}
            </div>
          </div>
        </div>
        <div className="lhx-xp-bar"><i style={{ width: `${progress.progress}%` }} /></div>
      </div>

      {/* Achievements shelf. */}
      <section>
        <div className="lhx-section-head">
          <h2 className="lhx-section-title">Achievements</h2>
          {/* The count doubles as the door to the Sticker Collection —
              the prototype's view-stickers full-page grid. */}
          <Link to="/games/stickers" className="lhx-view-all">{earnedCount} / {GAME_BADGES.length} ›</Link>
        </div>
        <div className="lhx-badge-shelf">
          {GAME_BADGES.map((badge) => {
            const earned = earnedIds.has(badge.id)
            return (
              <div
                key={badge.id}
                className={`lhx-badge ${earned ? 'is-earned' : 'is-locked'}`}
                title={earned ? badge.description : badge.hint}
              >
                <div className="lhx-badge-ic" aria-hidden="true">{earned ? badge.icon : '🔒'}</div>
                <div className="lhx-badge-nm">{badge.name}</div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Your games. */}
      <section>
        <div className="lhx-section-head">
          <h2 className="lhx-section-title">Your games</h2>
          <Link to="/games/leaderboard" className="lhx-view-all">🏆 Leaderboard</Link>
        </div>
        {state.loading ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={90} className="lhx-skel" style={{ borderRadius: 24 }} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {visibleGames.map((game) => (
              <GameCard key={game.id} game={game} best={bestByGame.get(game.id) || 0} />
            ))}
            {visibleGames.length === 0 && (
              <p className="lhx-back-sub">No games yet — check back soon!</p>
            )}
            {/* Map Quest — the mockup's teaser card. Not playable yet;
                rendered honestly as coming soon rather than as a link. */}
            <div className="lhx-gc" aria-disabled="true" style={{ cursor: 'default' }}>
              <div className="lhx-gc-icon g-map" aria-hidden="true">🗺️</div>
              <div className="lhx-gc-body">
                <div className="lhx-gc-name">Map Quest</div>
                <div className="lhx-gc-tags">
                  <span className="lhx-gc-tag t-subj">Social Studies</span>
                  <span className="lhx-gc-tag t-new">NEW</span>
                </div>
                <div className="lhx-gc-progress">
                  <div className="lhx-gc-bar" aria-hidden="true"><i style={{ width: '0%' }} /></div>
                  <div className="lhx-gc-best">Coming soon</div>
                </div>
              </div>
              <div className="lhx-gc-chev" aria-hidden="true">›</div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/** One prototype game card: icon, name, tags, progress bar, best score. */
function GameCard({ game, best }) {
  const subjectKey = String(game.subject || '').toLowerCase()
  const skin = TYPE_SKIN[game.type] || SUBJECT_SKIN[subjectKey] || { emoji: '🎮', cls: 'g-math' }
  const subjectLabel = SUBJECTS.find((s) => s.slug === subjectKey)?.label || 'Game'
  const isPath = game.type === 'number_target'
  const pathProgress = isPath ? readPathProgress(game.id) : null

  const created = game.createdAt?.toMillis?.() || game.createdAt || 0
  // Boolean() matters: a seed game has no createdAt, and `0 && …` is 0 —
  // which React renders as a literal "0" chip beside the subject tag.
  const isNew = Boolean(created && Date.now() - created < 1000 * 60 * 60 * 24 * 30)

  const levelTag = isPath ? `Level ${currentLevel(pathProgress)}` : null
  const barPct = isPath
    ? Math.round((normalizeProgress(pathProgress).completed / TOTAL_LEVELS) * 100)
    : best > 0
      ? Math.min(100, Math.round((best / ((Number(game.points) || 100) * 2)) * 100))
      : 0

  return (
    <Link to={`/games/play/${game.id}`} className="lhx-gc">
      <div className={`lhx-gc-icon ${skin.cls}`} aria-hidden="true">{skin.emoji}</div>
      <div className="lhx-gc-body">
        <div className="lhx-gc-name">{game.title}</div>
        <div className="lhx-gc-tags">
          <span className="lhx-gc-tag t-subj">{subjectLabel}</span>
          {levelTag && <span className="lhx-gc-tag t-level">{levelTag}</span>}
          {isNew && <span className="lhx-gc-tag t-new">NEW</span>}
        </div>
        <div className="lhx-gc-progress">
          <div className="lhx-gc-bar" aria-hidden="true"><i style={{ width: `${barPct}%` }} /></div>
          <div className="lhx-gc-best">{best > 0 ? `Best ${best}` : 'Not played yet'}</div>
        </div>
      </div>
      <div className="lhx-gc-chev" aria-hidden="true">›</div>
    </Link>
  )
}
