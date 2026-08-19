/**
 * /games — the learner Games hub.
 *
 * Built to `docs/learner/zedexams-games-hub-mockup.html`. Renders inside
 * LearnerLayout (the 4-tab shell) in the `.lhx` design system: a 52px bar,
 * the two hero cards, the level strip, the achievements shelf and the
 * "Your games" list.
 *
 * ── What the 2026-08-19 pass changed, and why ───────────────────────────
 *
 * The backend is untouched — XP, levels, badges, daily-challenge scoring
 * and the leaderboard are exactly as they were and stay server-validated.
 * This is presentation, plus one real bug:
 *
 *  1. NOTHING RENDERS UNDER THE FIXED CHROME. The bottom nav is opaque and
 *     the scroll body reserves nav + Ask Zed + safe-area at its foot (both
 *     in learnerTheme.css, both global — the bug was general to the learner
 *     surface, not local to this page). "Your games", the Leaderboard link
 *     and the first game card used to render THROUGH the nav.
 *  2. THE GRADE. The daily hero read the grade of whatever game the
 *     unscoped rotation landed on ("TODAY'S QUIZ · GRADE 3") while the
 *     challenge card beside it read the learner's ("Grade 7"). Both now
 *     come from `resolveLearnerGrade`, ONE function, rendered as a pill on
 *     both heroes so a future mismatch is visible side by side; and the
 *     quiz itself is grade-scoped in the query (`getTodaysChallenge({
 *     grade })`). A grade with no quiz today gets the empty state — never
 *     another grade's quiz.
 *  3. FIXED-HEIGHT ROWS. Every one-line string is nowrap + ellipsis and a
 *     game card carries ONE meta line (`subject · topic`) instead of two
 *     wrapping chips, which is what made Meaning Match ~40px taller than
 *     Punctuation Pro. A long game name truncates; it never reflows a card.
 *  4. NO EMPTY PROGRESS BARS. A best score is not a completion percentage
 *     — Word Builder's bar read full at "Best 120" and three of five games
 *     drew a 0%-filled track beside "Not played yet". Status is one pill:
 *     Play / Best <n> / New (`gameStatusPill`).
 *  5. NO PAGE HEADER. Games is a bottom-nav TAB, so a back chevron was the
 *     wrong affordance and "Games / Play, score, level up!" spent ~110px
 *     saying nothing. The 52px bar carries the title, the streak chip and
 *     the leaderboard button — which is also where the duplicate "🏆
 *     Leaderboard" link from the "Your games" row went.
 *
 * Data flow is otherwise unchanged: listGames + today's challenge + history
 * + badges + streak, all through Promise.allSettled so one Firestore
 * failure never freezes the hub, with the seed catalogue as the fallback.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { duelAllowed } from '../lib/duelAccess'
import {
  dailyHeroCopy,
  gameMetaLine,
  gameStatusPill,
  isRecentlyAdded,
  resolveLearnerGrade,
} from '../lib/gamesHubCore'
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
import { currentLevel, normalizeProgress } from '../lib/numberPathCore'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { readJson } from '../../../shared/utils/safeStorage'
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

/** Local Number Path progress — the level it labels its meta line with. */
function readPathProgress(gameId) {
  return normalizeProgress(readJson(`zx:number-path:${gameId}`))
}

export default function GamesHub() {
  const { currentUser, userProfile } = useAuth()
  const [state, setState] = useState({
    loading: true,
    games: [],
    challenge: null,
    history: [],
    badgesById: {},
    streak: { streak: 0, longestStreak: 0, signedIn: false },
  })

  // ONE answer to "which grade is this learner in", read by both hero
  // pills AND by the daily-quiz query, so the label and the quiz cannot
  // disagree. See gamesHubCore for the bug this replaced.
  const grade = resolveLearnerGrade(userProfile)

  // Shared with the /games/duel route, so the card cannot offer a race the
  // page then refuses.
  const challengesAllowed = duelAllowed(currentUser, userProfile)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setState((prev) => ({ ...prev, loading: true }))
      const results = await Promise.allSettled([
        listGames(),
        getTodaysChallenge({ grade }),
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
  }, [currentUser, grade])

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

  // The catalogue is EXACTLY the four mechanics, one card each, in the
  // mockup's order: per mechanic, the learner's-grade doc when one exists,
  // else any active doc of that mechanic, else the bundled seed pack for
  // it. timed_quiz never lists — it plays through the daily card and the
  // duel only.
  //
  // The seed step is what keeps all four on screen. Before it, a mechanic
  // the live `games` collection had not been seeded with simply vanished
  // from the hub — which is how Punctuation Pro came to be missing from a
  // catalogue the code describes as "exactly four". A seed-backed card is
  // playable: PlayGame falls back to the same bundled doc by id.
  const visibleGames = useMemo(() => {
    const seeded = getFallbackGames()
    const pick = (pool, type) => {
      const ofType = pool.filter((g) => g?.type === type)
      if (!ofType.length) return null
      return ofType.find((g) => Number(g.grade) === grade) || ofType[0]
    }
    return CATALOGUE_MECHANICS
      .map(({ type }) => pick(state.games, type) || pick(seeded, type))
      .filter(Boolean)
  }, [state.games, grade])

  const challengeGame = state.challenge?.game || null
  const streakDays = Number(state.streak?.streak) || 0
  const daily = dailyHeroCopy({ hasQuiz: !!challengeGame, streakDays })

  return (
    <div className="lhx-gh">
      <SeoHelmet
        title="Games"
        description="Play Zambian CBC-aligned learning games with daily challenges, XP levels, badges and the leaderboard."
        path="/games"
      />
      <GamesHubTour />

      {/* The tab bar. No back chevron: Games IS a tab, so "back" has no
          destination a learner asked for. */}
      <div className="lhx-gh-bar">
        <h1 className="lhx-gh-title">Games</h1>
        <span className="lhx-gh-streak" title={streakDays > 0 ? `${streakDays}-day streak` : 'No streak yet'}>
          <span aria-hidden="true">🔥</span>
          <span className="lhx-sr-only">Streak: </span>
          {streakDays}
        </span>
        <Link to="/games/leaderboard" className="lhx-gh-icon-btn" aria-label="Leaderboard">
          <span aria-hidden="true">🏆</span>
        </Link>
      </div>

      {/* Today's quiz. */}
      {state.loading ? (
        <Skeleton height={68} className="lhx-skel" style={{ borderRadius: 20 }} />
      ) : (
        <HeroCard
          as={challengeGame ? Link : 'div'}
          to={challengeGame ? '/games/daily' : undefined}
          variant="quiz"
          avatar={(
            <img
              src="/images/characters/poses/zed-waving.webp"
              alt=""
              width="34"
              height="34"
              loading="lazy"
            />
          )}
          eyebrow="Today's quiz"
          grade={grade}
          title={daily.title}
          sub={daily.sub}
          action={daily.action}
        />
      )}

      {/* The LIVE challenge — real same-grade matchmaking on the server
          model (#2465). Signed-in only: the queue is written as the
          learner's own doc. */}
      {challengesAllowed && currentUser && (
        <HeroCard
          as={Link}
          to="/games/duel/live"
          variant="race"
          avatar={<span aria-hidden="true">⚔️</span>}
          eyebrow="Live challenge"
          grade={grade}
          title="Race a learner"
          sub="5 quick questions"
          action="Play"
        />
      )}

      {/* Level strip. */}
      <div className="lhx-lvl">
        <div className="lhx-lvl-top">
          <div className="lhx-lvl-badge" aria-hidden="true">{progress.rank?.emoji || '🎓'}</div>
          <div className="lhx-lvl-name">
            <b>Level {progress.level}</b>
            <span>{progress.rank?.title || 'Learner'}</span>
          </div>
          <div className="lhx-lvl-xp">
            {currentUser ? `${progress.pointsToNext} XP to Level ${progress.level + 1}` : 'Sign in to earn XP'}
          </div>
        </div>
        <div className="lhx-lvl-track"><i style={{ width: `${progress.progress}%` }} /></div>
      </div>

      {/* Achievements. */}
      <section>
        <div className="lhx-gh-sect">
          <h2 className="lhx-gh-sect-title">Achievements</h2>
          {/* The count doubles as the door to the Sticker Collection. */}
          <Link to="/games/stickers" className="lhx-gh-sect-link">{earnedCount} of {GAME_BADGES.length} ›</Link>
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
        <div className="lhx-gh-sect">
          <h2 className="lhx-gh-sect-title">Your games</h2>
        </div>
        {state.loading ? (
          <div className="lhx-gh-list">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={68} className="lhx-skel" style={{ borderRadius: 18 }} />
            ))}
          </div>
        ) : (
          <div className="lhx-gh-list">
            {visibleGames.map((game) => (
              <GameCard key={game.id} game={game} best={bestByGame.get(game.id) || 0} />
            ))}
            {visibleGames.length === 0 && (
              <p className="lhx-gh-endcap">No games yet — check back soon!</p>
            )}
            {/* Map Quest — the mockup's fifth row. It is NOT playable yet,
                so it is a div rather than a link and its pill reads
                "Soon". The mockup draws it with a New pill; New is what
                the other rows use for a game a learner CAN open, and a
                row that looks openable and is not is worse than a row
                that says what it is. Same 68px height as the rest. */}
            <div className="lhx-game" aria-disabled="true">
              <span className="lhx-game-icon g-map" aria-hidden="true">🗺️</span>
              <span className="lhx-game-main">
                <b>Map Quest</b>
                <span>{gameMetaLine('Social Studies', 'Maps')}</span>
              </span>
              <span className="lhx-game-end">
                <span className="lhx-game-pill is-soon">Soon</span>
                <span className="lhx-game-chev" aria-hidden="true">›</span>
              </span>
            </div>
            <p className="lhx-gh-endcap">More games unlock as you level up 🎉</p>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * One hero card. `as` is Link or a plain div, because the empty daily state
 * is a statement rather than a destination — a card that says "no quiz
 * today" must not be tappable into a page that says it again.
 *
 * The classes are `lhx-gh-hero*`, not `lhx-hero*`: learnerTheme.css already
 * owns `.lhx-hero`, `.lhx-hero-title` and `.lhx-hero-sub` for Home's hero
 * panel. Sharing those names made this card inherit Home's centred,
 * column layout depending on which stylesheet the bundler emitted last —
 * a collision that looked like a CSS bug and was a naming one.
 */
function HeroCard({ as: Tag, to, variant, avatar, eyebrow, grade, title, sub, action }) {
  const props = Tag === 'div' ? {} : { to }
  return (
    <Tag className={`lhx-gh-hero lhx-gh-hero-${variant}`} {...props}>
      <span className="lhx-gh-hero-avatar" aria-hidden="true">{avatar}</span>
      <span className="lhx-gh-hero-body">
        <span className="lhx-gh-hero-eyebrow">
          {eyebrow}
          <span className="lhx-gh-hero-grade">Grade {grade}</span>
        </span>
        <span className="lhx-gh-hero-title">{title}</span>
        <span className="lhx-gh-hero-sub">{sub}</span>
      </span>
      {action && <span className="lhx-gh-hero-btn">{action}</span>}
    </Tag>
  )
}

/** One game row: icon, name, one meta line, one status pill, chevron. */
function GameCard({ game, best }) {
  const subjectKey = String(game.subject || '').toLowerCase()
  const skin = TYPE_SKIN[game.type] || SUBJECT_SKIN[subjectKey] || { emoji: '🎮', cls: 'g-math' }
  const subjectLabel = SUBJECTS.find((s) => s.slug === subjectKey)?.label || 'Game'
  // The card is named for the MECHANIC (see CATALOGUE_MECHANICS); the
  // doc's own title names its content pack and belongs on the play
  // surface, where that pack is what the learner is looking at.
  const name = mechanicName(game)
  // Number Path has a level path, so its own progress is the honest second
  // half of the meta line; every other mechanic names its CBC topic.
  const topic = game.type === 'number_target'
    ? `Level ${currentLevel(readPathProgress(game.id))}`
    : game.cbc_topic || ''
  const status = gameStatusPill({ best, isNew: isRecentlyAdded(game.createdAt, Date.now()) })

  return (
    <Link to={`/games/play/${game.id}`} className="lhx-game">
      <span className={`lhx-game-icon ${skin.cls}`} aria-hidden="true">{skin.emoji}</span>
      <span className="lhx-game-main">
        <b>{name}</b>
        <span>{gameMetaLine(subjectLabel, topic)}</span>
      </span>
      <span className="lhx-game-end">
        <span className={`lhx-game-pill is-${status.kind}`}>{status.label}</span>
        <span className="lhx-game-chev" aria-hidden="true">›</span>
      </span>
    </Link>
  )
}
