/**
 * /games — the prototype-v3 games hub (learner redesign step 4).
 *
 * Renders inside LearnerLayout (the 4-tab shell) in the `.lhx` design
 * system: back row, the indigo TODAY'S QUIZ card, the orange LIVE
 * CHALLENGE card, the XP/level card, the achievements shelf, and the
 * "Your games" card list with the 🏆 leaderboard link — the mockup's
 * view-games, screen for screen.
 *
 * Three hero cards, not four. The "CHALLENGE MODE · Race Zed!" card —
 * the solo race against our own bot — was removed on 2026-08-18 to match
 * the mockup: with real same-grade matchmaking shipped (#2465), two race
 * cards stacked on top of each other made the live one look like a
 * variant of the practice one. /games/duel is untouched and still
 * reachable; only the hub entry point is gone.
 *
 * Data flow is UNCHANGED from the old hub (locked scope — reskin on the
 * kept games backend): listGames + today's challenge + history + badges
 * + streak, all via Promise.allSettled so a single Firestore failure
 * never freezes the hub, with the seed catalogue as the fallback. The
 * games list is scoped to the learner's grade when it matches any game
 * (the prototype hub is single-grade); the grade lanes at the bottom
 * keep every other grade reachable through the existing /games/g routes.
 *
 * One deliberate wording difference from the mockup: its daily card
 * reads "5 questions · keep your streak", and the daily rotation can
 * pick ANY mechanic — Number Path has rounds, not questions. The sub
 * line therefore states the streak, which is true of every pick, for
 * the same reason DailyIntro drops that phrase.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { duelAllowed } from '../lib/duelAccess'
import { GAME_BADGES } from '../../../data/gameBadges'
import {
  CATALOGUE_MECHANICS,
  RETIRED_GAME_TYPES,
  getFallbackGames,
  mechanicName,
} from '../../../data/gamesSeed'
import { getTodaysChallenge, getMyStreak } from '../../../utils/dailyChallengeService'
import { getMyGameBadges } from '../../../utils/gameBadgesService'
import { SUBJECTS, getMyHistory, listGames } from '../services/gamesService'
import { levelInfo } from '../../../utils/gameProgress'
import {
  challengeMatchesGrade,
  gameMetaLine,
  gameStatusPill,
  pickGameForGrade,
  resolveLearnerGrade,
} from '../lib/gamesHubCore'
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

export default function GamesHub() {
  const { currentUser, userProfile } = useAuth()
  // ONE answer to "what grade is this learner", read by the daily-quiz
  // query, the daily hero's pill, the live-challenge card's pill and the
  // catalogue scoping. They used to answer it separately — the hero from
  // whatever game the rotation picked, the challenge card from the profile
  // with a hard-coded `|| 7` — which is how one screen showed "GRADE 3"
  // and "Grade 7" for the same child. null means signed out: no grade to
  // scope by and none to claim.
  const learnerGrade = resolveLearnerGrade(userProfile)
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
        getTodaysChallenge({ grade: learnerGrade }),
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
  }, [currentUser, learnerGrade])

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
  // (step 8), in the mockup's order: per mechanic, the learner's-grade
  // doc when one exists, else any active doc of that mechanic, else the
  // bundled seed pack for it. timed_quiz never lists — it plays through
  // the daily card and the duel only.
  //
  // The seed step is what keeps all four on screen. Before it, a mechanic
  // the live `games` collection had not been seeded with simply vanished
  // from the hub — which is how Punctuation Pro came to be missing from a
  // catalogue the code describes as "exactly four". A seed-backed card is
  // playable: PlayGame falls back to the same bundled doc by id.
  const visibleGames = useMemo(() => {
    const seeded = getFallbackGames()
    return CATALOGUE_MECHANICS
      .map(({ type }) =>
        pickGameForGrade(state.games, type, learnerGrade) ||
        pickGameForGrade(seeded, type, learnerGrade))
      .filter(Boolean)
  }, [state.games, learnerGrade])

  // Refused rather than shown if it is not this learner's grade — see
  // challengeMatchesGrade. The query is already scoped; this is the second
  // gate, because an admin date-override names a game id and knows nothing
  // about who is looking.
  const rawChallenge = state.challenge?.game || null
  const challengeGame = challengeMatchesGrade(rawChallenge, learnerGrade) ? rawChallenge : null
  const streakDays = Number(state.streak?.streak) || 0

  return (
    <div>
      <SeoHelmet
        title="Games"
        description="Play Zambian CBC-aligned learning games with daily challenges, XP levels, badges and the leaderboard."
        path="/games"
      />
      <GamesHubTour />

      {/* Games is a bottom-nav TAB, so a back chevron was the wrong
          affordance — there is nothing to go back to. The old block spent
          ~110px on a title and a slogan; this is 52px and carries the two
          controls the screen actually needs. */}
      <div className="ghx-topbar">
        <h1 className="ghx-topbar-title">Games</h1>
        {streakDays > 0 && (
          <span className="ghx-streak-chip" aria-label={`${streakDays} day streak`}>
            <span aria-hidden="true">🔥</span> {streakDays}
          </span>
        )}
        <Link to="/games/leaderboard" className="ghx-icon-btn" aria-label="Leaderboard">
          <span aria-hidden="true">🏆</span>
        </Link>
      </div>

      {/* Daily challenge — the prototype's indigo hero card. */}
      {state.loading ? (
        <Skeleton height={96} className="lhx-skel" style={{ borderRadius: 24 }} />
      ) : challengeGame && (
        <Link to="/games/daily" className="lhx-daily">
          <div className="lhx-daily-emoji" aria-hidden="true">
            <img
              src="/images/characters/poses/zed-waving.webp"
              alt=""
              style={{ width: 56, height: 56, objectFit: 'contain', filter: 'drop-shadow(0 5px 7px rgba(0,0,0,.25))' }}
            />
          </div>
          <div className="lhx-daily-body">
            <div className="lhx-daily-label">
              Today&apos;s quiz
              {learnerGrade != null && <span className="ghx-grade-pill">Grade {learnerGrade}</span>}
            </div>
            <div className="lhx-daily-name">Play with Zed</div>
            <div className="lhx-daily-sub">
              {streakDays > 0 ? `${streakDays}-day streak — keep it going 🔥` : 'Play today to start a streak 🔥'}
            </div>
          </div>
          <span className="lhx-play-pill">Play</span>
        </Link>
      )}

      {/* The LIVE challenge — real matchmaking on the server model
          (#2465), so this card is no longer withheld: the opponent is a
          real same-grade learner, the questions provably shared, the
          scores server-graded. Signed-in only: the queue is written as
          the learner's own doc. */}
      {challengesAllowed && currentUser && (
      <Link to="/games/duel/live" className="lhx-duel-card">
        <div className="lhx-daily-emoji" aria-hidden="true">⚔️</div>
        <div className="lhx-daily-body">
          <div className="lhx-daily-label">
            Live challenge
            {learnerGrade != null && <span className="ghx-grade-pill">Grade {learnerGrade}</span>}
          </div>
          <div className="lhx-daily-name">Race a learner</div>
          {/* "same questions, server keeps score" was reassurance written
              for an adult reviewer, not an 11-year-old — and it pushed the
              card to three lines. Fairness is still the promise; the server
              is how we keep it, and that belongs in no UI string. */}
          <div className="lhx-daily-sub">5 quick questions</div>
        </div>
        <span className="lhx-play-pill">Play</span>
      </Link>
      )}

      {/* Level strip. 78px, not the 150px billboard it replaces — that
          spent a card's worth of height on one number, and put the XP
          figure on its own line below the level it refers to. Here they
          sit on one row, which is also what lets the strip be short. */}
      <div className="ghx-level">
        <div className="ghx-level-top">
          <div className="ghx-level-badge" aria-hidden="true">{progress.rank?.emoji || '🎓'}</div>
          <div className="ghx-level-name">
            <b>Level {progress.level}</b>
            <span>{progress.rank?.title || 'Learner'}</span>
          </div>
          <div className="ghx-level-xp">
            {currentUser
              ? `${progress.pointsToNext} XP to Level ${progress.level + 1}`
              : 'Sign in to earn XP'}
          </div>
        </div>
        <div className="ghx-track"><i style={{ width: `${progress.progress}%` }} /></div>
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
        </div>
        {state.loading ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={68} className="lhx-skel" style={{ borderRadius: 18 }} />
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
            {/* Map Quest — the mockup's teaser. Not playable yet, so it is
                a div, not a link: a card that navigates nowhere is worse
                than one that says it is not ready. Same shape and height as
                a real card so the list stays uniform. */}
            <div className="ghx-game is-soon" aria-disabled="true">
              <div className="ghx-game-icon g-map" aria-hidden="true">🗺️</div>
              <div className="ghx-game-main">
                <b>Map Quest</b>
                <span>Social Studies · Maps</span>
              </div>
              <div className="ghx-game-end">
                <span className="ghx-pill ghx-pill--new">New</span>
                <span className="ghx-chev" aria-hidden="true">›</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * One game card: icon, name, one meta line, one status pill.
 *
 * Fixed height by construction — every string on it is one line with
 * ellipsis, so a long game name truncates instead of reflowing the card.
 * The two wrapping chips this replaces are what made Meaning Match ~40px
 * taller than Punctuation Pro, and the progress bar they sat under
 * measured nothing it claimed to (see gameStatusPill).
 */
function GameCard({ game, best }) {
  const subjectKey = String(game.subject || '').toLowerCase()
  const skin = TYPE_SKIN[game.type] || SUBJECT_SKIN[subjectKey] || { emoji: '🎮', cls: 'g-math' }
  const subjectLabel = SUBJECTS.find((s) => s.slug === subjectKey)?.label || 'Game'
  // The card is named for the MECHANIC (see CATALOGUE_MECHANICS); the
  // doc's own title names its content pack and belongs on the play
  // surface, where that pack is what the learner is looking at.
  const name = mechanicName(game)
  const meta = gameMetaLine(subjectLabel, game.cbc_topic)
  const status = gameStatusPill(game, best, { now: Date.now() })

  return (
    <Link to={`/games/play/${game.id}`} className="ghx-game">
      <div className={`ghx-game-icon ${skin.cls}`} aria-hidden="true">{skin.emoji}</div>
      <div className="ghx-game-main">
        <b>{name}</b>
        <span>{meta}</span>
      </div>
      <div className="ghx-game-end">
        <span className={`ghx-pill ghx-pill--${status.kind}`}>{status.label}</span>
        <span className="ghx-chev" aria-hidden="true">›</span>
      </div>
    </Link>
  )
}
