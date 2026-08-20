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
 *  6. THE CATALOGUE IS GRADE-SCOPED TOO (2026-08-19, second pass). It had
 *     the same cross-grade fallback the daily quiz had — "the learner's
 *     grade, ELSE any pack of this mechanic" — which is how a Grade 7
 *     learner's hub came to offer "Meaning Match · Mathematics ·
 *     Fractions, Decimals & Percent", a Grade 6 pack, playable, scoring to
 *     the same leaderboard as everyone playing their own grade. Now:
 *     `listGames({ grade })`, a grade-scoped seed fallback, and
 *     `buildCatalogue`, which refuses another grade's pack outright and
 *     returns the mechanic with `game: null` so the row can say so. Read
 *     that function before widening any of it.
 *  7. THE CATALOGUE IS THE GAMES THAT EXIST (2026-08-19, third pass). The
 *     grade scope in 6 was right; the shape it was built on was not. The
 *     hub walked the four mechanics and took ONE pack each, so it rendered
 *     at most four game rows however many games there were — and `/games`
 *     is the only browse surface left, the `/games/g/:grade` routes having
 *     become redirects. An admin adding a game to a mechanic that already
 *     had one saw nothing change, and the 27 `timed_quiz` packs (every
 *     "Spell It Right", every subject quiz) were unreachable by browsing
 *     at all, while learner search happily listed them. Now every playable
 *     pack at the learner's grade gets a row, the four mechanics still
 *     leading in the mockup's order. See `buildCatalogue`.
 *
 * ── 2026-08-20: the door back to Race Zed ──────────────────────────────
 *
 * `/games/duel` had no entry point left anywhere in the app. #2496 removed
 * its hero card for a reason that still holds — two coral race heroes made
 * the live learner-vs-learner one read as the bot's variant — but it did so
 * on the strength of "/games/duel is untouched and still reachable", and
 * nothing linked to it afterwards. At the same time the one card that DID
 * carry Zed's name opened the daily challenge, so a learner who tapped
 * "Play with Zed" landed somewhere else and reported the button as broken.
 * #2525 fixed the name; this restores the destination, one rank down as a
 * row rather than a hero, so the live race keeps the only race hero. See
 * `zedRaceRow` for who sees the row and what it is careful not to claim.
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
  buildCatalogue,
  dailyHeroCopy,
  gameMetaLine,
  gameStatusPill,
  isRecentlyAdded,
  resolveLearnerGrade,
  unavailableRowCopy,
  zedRaceRow,
} from '../lib/gamesHubCore'
import { GAME_BADGES } from '../../../data/gameBadges'
import {
  CATALOGUE_MECHANICS,
  PLAYABLE_GAME_TYPES,
  RETIRED_GAME_TYPES,
  getFallbackGames,
} from '../../../data/gamesSeed'
import { loadDeletedGameIds } from '../../../utils/gameTombstones'
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
    // Permanently deleted game ids; null until the first load resolves.
    deletedIds: null,
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
        // Grade-scoped in the QUERY, like the daily challenge beside it.
        // The catalogue rule below refuses another grade's pack anyway, so
        // this is not the guarantee — it is what stops the hub reading
        // every grade's games to throw all but one away.
        listGames({ grade }),
        getTodaysChallenge({ grade }),
        getMyHistory(40),
        getMyGameBadges(),
        getMyStreak(),
        // Games an admin permanently deleted. The seed fallback below ships
        // in the bundle, so without this list a deleted game keeps its card
        // on the hub — deleting the Firestore doc removes it from the LIVE
        // list only. Fail-open by construction (an unreadable list is an
        // empty set), because the fallback exists for exactly the outage
        // that would make this read fail.
        loadDeletedGameIds(),
      ])
      if (cancelled) return

      const value = (i, fallback) => (results[i].status === 'fulfilled' ? results[i].value : fallback)
      // A live Firestore doc can still carry a retired mechanic — filter
      // here so the hub never advertises a game that opens on a
      // retirement card (the seed fallback already filters itself).
      const liveGames = value(0, []).filter((g) => !RETIRED_GAME_TYPES.has(g?.type))
      const deletedIds = value(5, null)
      setState((prev) => ({
        ...prev,
        loading: false,
        deletedIds,
        // The LIVE list, as it came back. The bundled fallback is not
        // folded in here any more: `buildCatalogue` takes both pools and
        // backs a type from the seed only when the live collection has no
        // pack of that type for this grade. Two fallback rules — one here
        // ("live is empty") and one there ("this mechanic is empty") — is
        // how the hub came to have two different answers to which pool a
        // row came from.
        games: liveGames,
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

  // The catalogue: EVERY game this learner can play, at their grade and
  // no other, with the mockup's four mechanics leading — see
  // `buildCatalogue`, which owns that rule and the bug it replaced (the
  // hub used to render at most four rows however many games existed).
  //
  // `playableTypes` is what admits the `timed_quiz` packs — 27 of the 47
  // bundled games, and whatever an admin has added since. They have an
  // engine (`PlayGame` renders `TimedQuizGame`) and learner search already
  // lists them, so the hub refusing to browse them was the odd one out.
  const catalogue = useMemo(() => buildCatalogue({
    mechanics: CATALOGUE_MECHANICS,
    playableTypes: PLAYABLE_GAME_TYPES,
    games: state.games,
    // The seeded pool backs a TYPE the live collection has no pack of for
    // this grade, so it is the second place a deleted game could come
    // back — hence `exclude`.
    seeded: getFallbackGames({ grade, exclude: state.deletedIds }),
    grade,
  }), [state.games, state.deletedIds, grade])

  const challengeGame = state.challenge?.game || null
  const streakDays = Number(state.streak?.streak) || 0
  // The card names the game it opens (and the destination's own word,
  // "challenge"), so tapping it lands on a screen the learner
  // recognises — see dailyHeroCopy for the two names this replaced.
  const daily = dailyHeroCopy({
    hasChallenge: !!challengeGame,
    streakDays,
    gameTitle: challengeGame?.title,
  })
  // The practice race, one rank below the live card rather than beside it.
  // `zedRaceRow` owns why it is a row, why it is not also gated on being
  // signed in, and why it does not try to predict a fieldable race.
  const zedRace = zedRaceRow({ challengesAllowed })

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

      {/* Today’s challenge — one rotating game, NOT the /daily quiz. */}
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
          eyebrow={daily.eyebrow}
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

      {/* Race Zed — the practice race, subordinate to the live card by
          design. It is a ROW because two coral heroes made the real
          opponent look like a variant of the bot (#2496); it is here at
          all because that removal's own promise ("/games/duel is still
          reachable") stopped being true the moment nothing linked to it.
          Gated on challengesAllowed ALONE — a signed-out visitor gets no
          live card, so this is their only race. See zedRaceRow. */}
      {zedRace && (
        <Link to="/games/duel" className="lhx-gh-practice">
          <span className="lhx-gh-practice-ic" aria-hidden="true">🤖</span>
          <span className="lhx-gh-practice-body">
            <b>{zedRace.title}</b>
            <span>{zedRace.sub}</span>
          </span>
          <span className="lhx-gh-practice-chev" aria-hidden="true">›</span>
        </Link>
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
            {/* `entry.key` rather than `entry.type`: a type can now own
                more than one row, so the type is no longer a unique key —
                React would collapse a grade's second Meaning Match onto
                its first, which is the same disappearance in a different
                layer. `entry.name` rather than the doc's title: the
                catalogue decides when a row speaks for its mechanic and
                when it must speak for its own pack. */}
            {catalogue.map((entry) => (entry.game ? (
              <GameCard
                key={entry.key}
                name={entry.name}
                game={entry.game}
                best={bestByGame.get(entry.game.id) || 0}
              />
            ) : (
              // The icon is the MECHANIC's, not the pack's — TYPE_SKIN is
              // keyed by type — so a grade with no pack still shows the
              // game it is waiting for rather than a generic tile.
              <UnavailableRow
                key={entry.key}
                name={entry.name}
                grade={grade}
                icon={TYPE_SKIN[entry.type]?.emoji}
                skin={TYPE_SKIN[entry.type]?.cls}
              />
            )))}
            {/* Map Quest — the mockup's fifth row. No engine at all yet,
                as against a mechanic that has one but no pack for this
                grade, so it states its own subject and its own reason.
                The mockup draws it with a New pill; New is what the other
                rows use for a game a learner CAN open, and a row that
                looks openable and is not is worse than one that says what
                it is. */}
            <UnavailableRow
              name="Map Quest"
              icon="🗺️"
              skin="g-map"
              meta={gameMetaLine('Social Studies', 'Maps')}
            />
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

/**
 * A row for something the learner cannot open yet.
 *
 * Two callers with the same shape and different reasons: a catalogue
 * mechanic with no pack for this grade (`grade` given, copy from
 * `unavailableRowCopy`), and the Map Quest teaser, which has no engine at
 * all and states its own subject (`meta` given).
 *
 * It is a row rather than an omission on purpose — see `buildCatalogue`.
 * Structurally identical to `GameCard` so the list keeps one row height;
 * `aria-disabled` and the absence of a link are what say it does not open.
 */
function UnavailableRow({ name, grade, icon, skin, meta }) {
  const copy = grade == null ? null : unavailableRowCopy(grade)
  return (
    <div className="lhx-game" aria-disabled="true">
      <span className={`lhx-game-icon ${skin || 'g-math'}`} aria-hidden="true">{icon || '🎮'}</span>
      <span className="lhx-game-main">
        <b>{name}</b>
        <span>{meta ?? copy.meta}</span>
      </span>
      <span className="lhx-game-end">
        <span className="lhx-game-pill is-soon">{copy?.pill ?? 'Soon'}</span>
        <span className="lhx-game-chev" aria-hidden="true">›</span>
      </span>
    </div>
  )
}

/**
 * One game row: icon, name, one meta line, one status pill, chevron.
 *
 * `name` is decided by `buildCatalogue`, not here. The card used to call
 * `mechanicName(game)` itself, which was right while a mechanic could own
 * only one row and wrong the moment it can own several — four Grade 4
 * quizzes would all have printed "Game", and two Meaning Match packs would
 * both have printed "Meaning Match". Only the catalogue knows how many
 * packs a mechanic has, so only the catalogue can choose between the
 * mechanic's name and the pack's own title.
 */
function GameCard({ name, game, best }) {
  const subjectKey = String(game.subject || '').toLowerCase()
  const skin = TYPE_SKIN[game.type] || SUBJECT_SKIN[subjectKey] || { emoji: '🎮', cls: 'g-math' }
  const subjectLabel = SUBJECTS.find((s) => s.slug === subjectKey)?.label || 'Game'
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
