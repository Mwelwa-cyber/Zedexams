import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FireIcon,
  SparklesIcon,
  StarIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid'
import { useAuth } from '../../contexts/AuthContext'
import { GAME_BADGES } from '../../data/gameBadges'
import { getFallbackGames } from '../../data/gamesSeed'
import { getTodaysChallenge, getMyStreak } from '../../utils/dailyChallengeService'
import { getMyGameBadges } from '../../utils/gameBadgesService'
import {
  SUBJECTS,
  getMyHistory,
  listGames,
  subscribeToGlobalLeaderboard,
} from '../../utils/gamesService'
import DailyChallengeCard from './DailyChallengeCard'
import GamesShell from './GamesShell'
import {
  GameBadgeCard,
  GameDiscoveryCard,
  GamesSectionHeading,
  ProgressBar,
  SubjectProgressCard,
  buildSubjectProgress,
  getGameStatusBadge,
} from './gamesUi'

/**
 * /games — main discovery hub for the public Games experience.
 * Keeps the existing read-only data flow and reorganises the UI around
 * challenge, progress, recommendations, and playful discovery.
 */
export default function GamesHub() {
  const { currentUser } = useAuth()
  const [state, setState] = useState({
    loading: true,
    games: [],
    challenge: null,
    history: [],
    badgesById: {},
    streak: { streak: 0, longestStreak: 0, signedIn: false },
    leaderboardRows: [],
  })

  useEffect(() => {
    document.title = 'Games — ZedExams'
    setMeta('Play Zambian CBC-aligned learning games with daily challenges, subject progress, badges, and live leaderboard climbing.')
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setState((prev) => ({ ...prev, loading: true }))
      // Use allSettled so a single Firestore failure (e.g. badges read denied,
      // streak doc missing, leaderboard index still building) cannot freeze
      // the whole hub on the loading skeleton.
      const results = await Promise.allSettled([
        listGames(),
        getTodaysChallenge(),
        getMyHistory(40),
        getMyGameBadges(),
        getMyStreak(),
      ])
      if (cancelled) return

      const value = (i, fallback) => (results[i].status === 'fulfilled' ? results[i].value : fallback)
      const liveGames  = value(0, [])
      const challenge  = value(1, null)
      const history    = value(2, [])
      const badgeState = value(3, { byId: {} })
      const streak     = value(4, { streak: 0, longestStreak: 0, signedIn: !!currentUser })

      setState((prev) => ({
        ...prev,
        loading: false,
        games: liveGames.length ? liveGames : getFallbackGames(),
        challenge,
        history,
        badgesById: badgeState?.byId || {},
        streak,
      }))
    }

    load()
    return () => { cancelled = true }
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) {
      setState((prev) => ({ ...prev, leaderboardRows: [] }))
      return undefined
    }

    const unsub = subscribeToGlobalLeaderboard({ window: 'all', max: 25 }, (next) => {
      setState((prev) => ({ ...prev, leaderboardRows: next?.rows || [] }))
    })
    return () => unsub()
  }, [currentUser])

  const totalPoints = state.history.reduce((sum, row) => sum + (Number(row.score) || 0), 0)
  const level = Math.max(1, Math.floor(totalPoints / 120) + 1)
  const levelProgress = Math.round(((totalPoints % 120) / 120) * 100)
  const currentRank = currentUser
    ? state.leaderboardRows.findIndex((row) => row.userId === currentUser.uid) + 1
    : 0
  const earnedBadgeIds = new Set(Object.keys(state.badgesById || {}))
  const recommendedGames = buildRecommendedGames(state.games, state.challenge?.game, state.history)
  const featuredGameId = recommendedGames[0]?.id || state.challenge?.game?.id || null
  const popularGames = buildPopularGames(state.games, new Set(recommendedGames.map((game) => game.id)))

  const subjectCards = SUBJECTS.map((subject) => {
    const progress = buildSubjectProgress(subject.slug, state.games, state.history)
    return {
      subject,
      progress,
      helperText: progress.totalGames
        ? progress.plays
          ? `${progress.plays} plays recorded across ${progress.totalGames} game${progress.totalGames === 1 ? '' : 's'}.`
          : `Start here with ${progress.totalGames} game${progress.totalGames === 1 ? '' : 's'} ready to play.`
        : 'This subject card is ready for the next game pack.',
    }
  })

  return (
    <GamesShell crumbs={[]}>
      <DailyChallengeCard
        challenge={state.challenge}
        streak={state.streak}
        loading={state.loading}
        hideGrade
      />

      <section className="mb-10">
        <div className="relative mb-6 overflow-hidden rounded-[28px] border-2 border-amber-100 bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 p-5 shadow-[0_18px_50px_-24px_rgba(251,146,60,0.45)] sm:p-6">
          <div aria-hidden="true" className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-amber-200/40 blur-2xl" />
          <div aria-hidden="true" className="absolute -bottom-10 -left-8 h-36 w-36 rounded-full bg-rose-200/40 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4 sm:gap-5">
              <div aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-gradient-to-br from-amber-400 to-orange-500 text-4xl shadow-[0_10px_26px_-8px_rgba(249,115,22,0.55)] sm:h-20 sm:w-20 sm:text-5xl">
                🦁
              </div>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                  {currentUser ? 'Welcome back, champion!' : 'Hey there, player!'}
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-700 sm:text-base">
                  Pick a game below. Tap. Play. Win. 🎉
                </p>
              </div>
            </div>
            <Link
              to="/games/leaderboard"
              className="inline-flex items-center justify-center gap-2 self-start rounded-full bg-white px-4 py-2.5 text-sm font-black text-slate-900 shadow-sm ring-2 ring-white transition hover:-translate-y-0.5 active:scale-[0.98] sm:self-auto"
            >
              <TrophyIcon className="h-4 w-4 text-amber-500" />
              Leaderboard
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={SparklesIcon}
            title="Level"
            value={`Lv ${level}`}
            accent="from-amber-500 to-orange-500"
            support={currentUser ? `${levelProgress}% to Lv ${level + 1}` : 'Sign in to level up!'}
            progress={currentUser ? levelProgress : 18}
          />
          <StatCard
            icon={FireIcon}
            title="Streak"
            value={`${state.streak.streak || 0} day${state.streak.streak === 1 ? '' : 's'}`}
            accent="from-rose-500 to-orange-500"
            support={
              state.streak.signedIn
                ? state.streak.streak
                  ? 'On fire! Play today to keep it.'
                  : 'Win once to start a streak!'
                : 'Sign in to save your streak.'
            }
          />
          <StatCard
            icon={StarIcon}
            title="Points"
            value={totalPoints.toLocaleString()}
            accent="from-sky-500 to-cyan-500"
            support={currentUser ? 'Earn more in every round!' : 'Sign in to keep points.'}
          />
          <StatCard
            icon={TrophyIcon}
            title="Rank"
            value={currentUser ? (currentRank ? `#${currentRank}` : 'Rising') : 'Guest'}
            accent="from-emerald-500 to-teal-500"
            support={
              currentUser
                ? currentRank
                  ? 'You’re on the board!'
                  : 'Finish a round to join!'
                : 'Sign in to climb the board.'
            }
          />
        </div>
      </section>

      <section className="mb-12">
        <GamesSectionHeading
          eyebrow="⭐ Just for you"
          title="Play these next!"
          description="Fresh games picked for you to try today."
        />
        {state.loading ? (
          <SkeletonCardGrid featured />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {recommendedGames.map((game, index) => (
              <GameDiscoveryCard
                key={game.id}
                game={game}
                badge={getGameStatusBadge(game, index, featuredGameId)}
                variant={index === 0 ? 'featured' : 'standard'}
                showRating
                hideGrade
              />
            ))}
          </div>
        )}
      </section>

      <section className="mb-12">
        <GamesSectionHeading
          eyebrow="🎨 Subjects"
          title="What do you want to play?"
          description="Tap a subject to see all its games."
        />
        {state.loading ? (
          <SkeletonSubjectGrid />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {subjectCards.map(({ subject, progress, helperText }) => (
              <SubjectProgressCard
                key={subject.slug}
                subject={subject}
                gamesCount={progress.totalGames}
                progress={progress.progress}
                href={`/games/g/${pickGradeForSubject(state.games, subject.slug)}/${subject.slug}`}
                showComingSoon={progress.totalGames === 0}
                helperText={helperText}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mb-12 grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <GamesSectionHeading
            eyebrow="🏆 Badges"
            title="Collect them all!"
            description="Win games to unlock shiny badges."
            action={
              <Link to="/my-badges" className="text-sm font-black text-slate-700 transition hover:text-slate-900">
                See all badges
              </Link>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {(state.loading ? GAME_BADGES.slice(0, 4) : GAME_BADGES.slice(0, 4)).map((badge) => (
              <GameBadgeCard
                key={badge.id}
                badge={badge}
                earned={!state.loading && earnedBadgeIds.has(badge.id)}
                compact
              />
            ))}
          </div>
        </div>

        <div>
          <GamesSectionHeading
            eyebrow="🔥 Hot right now"
            title="Loved by players"
            description="Everyone’s playing these!"
          />
          {state.loading ? (
            <SkeletonCardGrid />
          ) : (
            <div className="grid gap-4">
              {popularGames.map((game, index) => (
                <GameDiscoveryCard
                  key={game.id}
                  game={game}
                  badge={getGameStatusBadge(game, index + 1, featuredGameId)}
                  showRating
                  hideGrade
                />
              ))}
            </div>
          )}
        </div>
      </section>

    </GamesShell>
  )
}

function StatCard({ icon, title, value, support, accent, progress = null }) {
  const Icon = icon

  return (
    <div className="rounded-[20px] border border-white/80 bg-white/88 p-5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.18)] backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{title}</p>
          <h3 className="mt-3 text-3xl font-black tracking-tight text-slate-900">{value}</h3>
        </div>
        <span className={`inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${accent} text-white shadow-[0_20px_40px_-24px_rgba(15,23,42,0.32)]`}>
          <Icon className="h-6 w-6" />
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{support}</p>
      {progress != null && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <ProgressBar value={progress} gradient={accent} />
        </div>
      )}
    </div>
  )
}

function SkeletonCardGrid({ featured = false }) {
  return (
    <div className={`grid gap-4 ${featured ? 'lg:grid-cols-3' : ''}`}>
      {Array.from({ length: featured ? 3 : 3 }).map((_, index) => (
        <div
          key={index}
          className={`rounded-[20px] border border-slate-100 bg-white/80 p-5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)] ${featured && index === 0 ? 'lg:col-span-2 sm:p-7' : ''}`}
        >
          <div className="h-12 w-12 rounded-full bg-slate-100 animate-pulse" />
          <div className="mt-5 h-7 w-3/4 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="mt-3 h-4 w-full rounded-full bg-slate-100 animate-pulse" />
          <div className="mt-2 h-4 w-5/6 rounded-full bg-slate-100 animate-pulse" />
          <div className="mt-5 flex gap-2">
            <div className="h-8 w-24 rounded-full bg-slate-100 animate-pulse" />
            <div className="h-8 w-24 rounded-full bg-slate-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SkeletonSubjectGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-[20px] border border-slate-100 bg-white/80 p-5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)]">
          <div className="h-12 w-12 rounded-full bg-slate-100 animate-pulse" />
          <div className="mt-5 h-7 w-2/3 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="mt-3 h-4 w-full rounded-full bg-slate-100 animate-pulse" />
          <div className="mt-5 h-2.5 w-full rounded-full bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

function buildRecommendedGames(games, challengeGame, history) {
  const playedIds = new Set(history.map((row) => row.gameId))
  const subjectCounts = history.reduce((acc, row) => {
    const key = String(row.subject || '').toLowerCase()
    if (!key) return acc
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const favouriteSubject = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  const score = (game) => {
    let total = 0
    if (challengeGame?.id && game.id === challengeGame.id) total += 100
    if (!playedIds.has(game.id)) total += 18
    if (favouriteSubject && game.subject === favouriteSubject) total += 8
    if ((game.difficulty || '').toLowerCase() === 'easy') total += 6
    if ((game.type || '').toLowerCase() === 'memory_match') total += 4
    total += Number(game.points) || 0
    return total
  }

  return games
    .slice()
    .sort((a, b) => score(b) - score(a))
    .slice(0, 3)
}

function buildPopularGames(games, excludeIds) {
  const pool = games.filter((game) => !excludeIds.has(game.id))
  const selected = []
  const usedSubjects = new Set()

  for (const game of pool.sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0))) {
    const subject = String(game.subject || '').toLowerCase()
    if (selected.length >= 3) break
    if (usedSubjects.has(subject) && selected.length < 2) continue
    selected.push(game)
    usedSubjects.add(subject)
  }

  return selected.length ? selected : games.slice(0, 3)
}

function pickGradeForSubject(games, subjectSlug) {
  const first = games.find((game) => String(game.subject || '').toLowerCase() === subjectSlug)
  return first?.grade || 1
}

function setMeta(content) {
  let tag = document.querySelector('meta[name="description"]')
  if (!tag) {
    tag = document.createElement('meta')
    tag.name = 'description'
    document.head.appendChild(tag)
  }
  tag.content = content
}
