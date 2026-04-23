import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  GRADES, listGames, getMyHistory, subscribeToGlobalLeaderboard,
  gradeByValue, subjectBySlug, SUBJECTS,
} from '../../utils/gamesService'
import { getMyStreak } from '../../utils/dailyChallengeService'
import { getMyGameBadges } from '../../utils/gameBadgesService'
import { GAME_BADGES, BADGE_TIER_STYLES } from '../../data/gameBadges'
import { getFallbackGames } from '../../data/gamesSeed'
import { useAuth } from '../../contexts/AuthContext'
import GamesShell from './GamesShell'
import DailyChallengeCard from './DailyChallengeCard'
import {
  getLearnerProfile, computeRecommendations, computeSubjectProgress,
  ensureTodayGoal, MASTERY_LEVELS,
} from '../../utils/gamesIntelligence'
import {
  subjectTheme, gameTypeMeta, STAT_ICON,
  ClockIcon, PlayIcon, LockClosedIcon, StarIcon, TrophyIcon, CheckBadgeIcon,
  ArrowRightIcon, RocketLaunchIcon, AcademicCapIcon, SparklesIcon, FireIcon,
} from './gameIcons'

/**
 * /games — a polished, gamified dashboard.
 *
 * Uses the existing Firestore helpers — this component only composes the
 * presentation layer. If live reads fail, the fallback seed keeps the UI
 * filled so the page never looks empty.
 */
export default function GamesHub() {
  const { currentUser, userProfile } = useAuth()
  const firstName = userProfile?.displayName?.split(' ')[0] ?? null

  const [games, setGames] = useState(null)
  const [history, setHistory] = useState([])
  const [streak, setStreak] = useState({ streak: 0, longestStreak: 0, signedIn: false })
  const [badges, setBadges] = useState({ byId: {} })
  const [topScorers, setTopScorers] = useState([])
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    document.title = 'Free CBC Learning Games — ZedExams'
    setMeta('Play free Zambian CBC-aligned primary school games (Grade 1 to Grade 6). Quizzes, memory match, spelling and live leaderboard.')
  }, [])

  // Load games once — prefer live, fall back to bundled seed.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const live = await listGames()
      if (cancelled) return
      setGames(live.length ? live : getFallbackGames())
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Signed-in user data (history, streak, badges, learner profile). Silent on failure.
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    Promise.all([
      getMyHistory(10),
      getMyStreak(),
      getMyGameBadges(),
      getLearnerProfile(currentUser.uid),
    ]).then(([h, s, b, p]) => {
      if (cancelled) return
      setHistory(h || [])
      setStreak(s || { streak: 0, longestStreak: 0, signedIn: true })
      setBadges(b || { byId: {} })
      setProfile(p || null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [currentUser])

  // Top learners today — tiny leaderboard preview.
  useEffect(() => {
    const unsub = subscribeToGlobalLeaderboard({ window: 'today', max: 8 }, ({ rows }) => {
      const seen = new Map()
      for (const r of (rows || [])) {
        const key = r.userId || r.displayName || r.id
        const prev = seen.get(key)
        if (!prev || (r.score || 0) > (prev.score || 0)) seen.set(key, r)
      }
      setTopScorers(Array.from(seen.values()).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5))
    })
    return () => unsub?.()
  }, [])

  const stats = useMemo(() => computeStats({ history, streak, badges }), [history, streak, badges])
  const popular       = useMemo(() => pickPopular(games), [games])
  const subjectCounts = useMemo(() => countBySubject(games), [games])

  const fallbackGrade = Number(userProfile?.grade) || null
  const intel = useMemo(
    () => computeRecommendations({ profile, games, fallbackGrade }),
    [profile, games, fallbackGrade],
  )
  const continueItem = useMemo(() => {
    if (intel.continueLearning) {
      return {
        ...intel.continueLearning.game,
        gameId: intel.continueLearning.game.id,
        accuracy: intel.continueLearning.accuracy,
      }
    }
    return pickContinue(history, games)
  }, [intel, history, games])
  const recommended = useMemo(() => {
    if (intel.recommended.length) return intel.recommended.map((r) => r.game)
    return pickRecommendedFallback({ games, history, userProfile })
  }, [intel, games, history, userProfile])
  const dailyGoal      = useMemo(() => ensureTodayGoal(profile), [profile])
  const subjectProgress = useMemo(
    () => computeSubjectProgress(profile, subjectCounts || {}),
    [profile, subjectCounts],
  )

  return (
    <GamesShell crumbs={[]}>
      <DailyChallengeCard />

      <WelcomeBar name={firstName} signedIn={!!currentUser} />

      <StatsRow stats={stats} signedIn={!!currentUser} />

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 sm:gap-6 mt-6">
        <ContinueLearning item={continueItem} signedIn={!!currentUser} />
        <DailyGoalCard goal={dailyGoal} signedIn={!!currentUser} />
      </div>

      {!!currentUser && intel.practiceAgain.length > 0 && (
        <PracticeAgainRow items={intel.practiceAgain} />
      )}

      {!!currentUser && (profile?.weakTopics?.length || 0) > 0 && (
        <WeakAreasStrip topics={profile.weakTopics} />
      )}

      <RecommendedGames games={recommended} />

      {!!currentUser && intel.moveForward.length > 0 && (
        <MoveForwardRow items={intel.moveForward} />
      )}

      {!!currentUser && hasSubjectPlays(subjectProgress) && (
        <SubjectProgressStrip rows={subjectProgress} />
      )}

      <LeaderboardPreview rows={topScorers} />

      <SubjectsStrip counts={subjectCounts} />

      <BadgesStrip earnedIds={Object.keys(badges.byId || {})} signedIn={!!currentUser} />

      <GradePicker />

      <PopularGames games={popular} />

      <MotivationalFooter />
    </GamesShell>
  )
}

/* ───────────── Sections ───────────── */

function WelcomeBar({ name, signedIn }) {
  return (
    <section className="text-center mb-6 mt-2">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-amber-200 text-[11px] font-black uppercase tracking-wider text-amber-800 mb-3 shadow-sm">
        <SparklesIcon className="w-3.5 h-3.5" />
        <span>CBC-aligned · Grade 1 to 6</span>
      </div>
      <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-black leading-tight max-w-3xl mx-auto">
        {signedIn && name ? (
          <>Welcome back, <span className="text-amber-600">{name}</span> — ready to level up?</>
        ) : (
          <>Learn, Practice, Compete &amp; <span className="text-amber-600">Achieve</span></>
        )}
      </h1>
      <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-xl mx-auto">
        {signedIn
          ? 'Every score is saved to your history and powers your streaks, badges and leaderboard rank.'
          : 'Free CBC games for Zambian pupils. Sign in to save your scores, earn badges and climb the leaderboard.'}
      </p>
    </section>
  )
}

function StatsRow({ stats, signedIn }) {
  const cards = [
    {
      key: 'level',
      Icon: STAT_ICON.level,
      value: stats.level,
      label: 'Level',
      sub: `${stats.xpInLevel}/${stats.xpPerLevel} XP to next`,
      progress: Math.round((stats.xpInLevel / stats.xpPerLevel) * 100),
      tint: 'from-emerald-50 to-teal-50',
      ring: 'border-emerald-200',
      tileBg: 'bg-gradient-to-br from-emerald-400 to-teal-500',
      bar: 'bg-gradient-to-r from-emerald-400 to-teal-500',
      accent: 'text-emerald-700',
    },
    {
      key: 'streak',
      Icon: STAT_ICON.streak,
      value: `${stats.streak} days`,
      label: 'Streak',
      sub: stats.streak > 0 ? 'Keep it up!' : 'Play today to start',
      tint: 'from-rose-50 to-orange-50',
      ring: 'border-rose-200',
      tileBg: 'bg-gradient-to-br from-rose-400 to-orange-500',
      accent: 'text-rose-600',
    },
    {
      key: 'points',
      Icon: STAT_ICON.points,
      value: stats.points,
      label: 'Points',
      sub: `${stats.plays} games played`,
      tint: 'from-amber-50 to-yellow-50',
      ring: 'border-amber-200',
      tileBg: 'bg-gradient-to-br from-amber-400 to-yellow-500',
      accent: 'text-amber-700',
    },
    {
      key: 'rank',
      Icon: STAT_ICON.rank,
      value: stats.rank,
      label: 'Rank',
      sub: signedIn ? 'Top 10% this week' : 'Sign in to rank',
      tint: 'from-indigo-50 to-sky-50',
      ring: 'border-indigo-200',
      tileBg: 'bg-gradient-to-br from-indigo-400 to-sky-500',
      accent: 'text-indigo-700',
    },
  ]
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((c) => (
        <div
          key={c.key}
          className={`rounded-2xl border ${c.ring} bg-gradient-to-br ${c.tint} p-4 shadow-sm hover:shadow-md transition`}
        >
          <div className="flex items-center justify-between">
            <span className={`w-10 h-10 rounded-2xl ${c.tileBg} text-white flex items-center justify-center shadow-sm`}>
              <c.Icon className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{c.label}</span>
          </div>
          <p className="font-display text-2xl sm:text-3xl font-black mt-3 text-slate-900">{c.value}</p>
          <p className={`text-[11px] font-bold mt-0.5 ${c.accent}`}>{c.sub}</p>
          {c.progress != null && (
            <div className="mt-2 h-1.5 rounded-full bg-white/70 overflow-hidden">
              <div
                className={`h-full ${c.bar} rounded-full transition-[width] duration-700`}
                style={{ width: `${Math.max(5, Math.min(100, c.progress))}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

function ContinueLearning({ item, signedIn }) {
  if (!item) {
    return (
      <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
        <SectionHeading title="Continue Learning" note="Pick up where you left off" />
        <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 p-5 text-slate-600">
          <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-200 to-slate-300 text-white flex items-center justify-center shrink-0">
            <PlayIcon className="w-6 h-6" />
          </span>
          <div className="flex-1">
            <p className="font-bold text-slate-700">
              {signedIn ? 'No recent games yet — try a daily challenge!' : 'Sign in to keep your progress across devices.'}
            </p>
            <p className="text-xs text-slate-500">Your last game will appear here.</p>
          </div>
          <Link to="/games#grades" className="hidden sm:inline-flex px-3 py-2 rounded-xl text-xs font-black text-white bg-slate-900 hover:bg-slate-800 transition">Browse</Link>
        </div>
      </section>
    )
  }
  const grade = gradeByValue(item.grade)
  const subject = subjectBySlug(item.subject)
  const theme = subjectTheme(item.subject)
  const progress = Math.min(100, Math.max(5, Math.round(item.accuracy || item.progress || 60)))
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeading title="Continue Learning" note="Last played" />
      <div className="flex items-center gap-3 sm:gap-4">
        <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br ${theme.gradient} text-white flex items-center justify-center shadow-md`}>
          <theme.icon className="w-7 h-7 sm:w-8 sm:h-8" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-slate-900 truncate">{item.title || item.gameTitle || 'Game'}</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {grade && <MiniChip>{grade.label}</MiniChip>}
            {subject && <MiniChip tone={theme.chip}>{subject.label}</MiniChip>}
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px] font-black text-slate-500 mb-1">
              <span>You're {progress}% there</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${theme.gradient} rounded-full transition-[width] duration-700`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
        <Link
          to={`/games/play/${item.gameId || item.id}`}
          className="shrink-0 hidden sm:inline-flex items-center gap-1 px-4 py-2.5 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-md transition"
        >
          Continue <ArrowRightIcon className="w-4 h-4" />
        </Link>
      </div>
      <Link
        to={`/games/play/${item.gameId || item.id}`}
        className="sm:hidden mt-3 inline-flex w-full items-center justify-center gap-1 px-4 py-2.5 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500"
      >
        Continue <ArrowRightIcon className="w-4 h-4" />
      </Link>
    </section>
  )
}

function LeaderboardPreview({ rows }) {
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-black flex items-center gap-2">
          <TrophyIcon className="w-5 h-5 text-amber-500" />
          Top Learners Today
        </h3>
        <Link to="/games/leaderboard" className="text-xs font-black text-amber-700 hover:text-amber-900 inline-flex items-center gap-0.5">
          View all <ArrowRightIcon className="w-3 h-3" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyLeaderboard />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <LbRow key={(r.userId || r.id) + i} row={r} rank={i + 1} />
          ))}
        </ul>
      )}
      <Link
        to="/games/leaderboard"
        className="mt-3 inline-flex w-full items-center justify-center gap-1 px-3 py-2 rounded-xl text-xs font-black text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition"
      >
        Open full leaderboard <ArrowRightIcon className="w-3 h-3" />
      </Link>
    </section>
  )
}

function LbRow({ row, rank }) {
  const medal =
    rank === 1 ? 'bg-gradient-to-br from-amber-400 to-yellow-500 text-white' :
    rank === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white' :
    rank === 3 ? 'bg-gradient-to-br from-orange-400 to-amber-600 text-white' :
                 'bg-slate-100 text-slate-600'
  const highlight = rank <= 3 ? 'bg-gradient-to-r from-amber-50 to-white border-amber-100' : 'bg-white border-slate-100'
  return (
    <li className={`flex items-center gap-3 p-2 rounded-xl border ${highlight}`}>
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${medal}`}>
        {rank <= 3 ? <TrophyIcon className="w-3.5 h-3.5" /> : rank}
      </span>
      <span className="flex-1 min-w-0 text-sm font-bold text-slate-800 truncate">{row.displayName || 'Anonymous'}</span>
      <span className="text-sm font-black text-slate-900">{Number(row.score || 0).toLocaleString()}</span>
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">pts</span>
    </li>
  )
}

function EmptyLeaderboard() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 p-4 text-center">
      <p className="text-sm font-bold text-slate-600">No scores yet today</p>
      <p className="text-xs text-slate-500">Play a game and be the first on the board!</p>
    </div>
  )
}

function RecommendedGames({ games }) {
  if (!games || games.length === 0) return null
  return (
    <section className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-xl font-black flex items-center gap-2">
          <SparklesIcon className="w-5 h-5 text-amber-500" />
          Recommended for You
        </h3>
        <Link to="/games#grades" className="text-xs font-black text-amber-700 hover:text-amber-900 inline-flex items-center gap-0.5">
          See all <ArrowRightIcon className="w-3 h-3" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {games.map((g, i) => (
          <RecommendedCard
            key={g.id}
            game={g}
            badge={i === 0 ? 'Recommended' : i === 1 ? 'Popular' : 'New'}
            featured={i === 0}
          />
        ))}
      </div>
    </section>
  )
}

function RecommendedCard({ game, badge, featured }) {
  const subject = subjectBySlug(game.subject)
  const grade = gradeByValue(game.grade)
  const theme = subjectTheme(game.subject)
  const type = gameTypeMeta(game.type)
  const badgeStyle = {
    Recommended: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    Popular:     'bg-rose-100 text-rose-800 border-rose-200',
    New:         'bg-sky-100 text-sky-800 border-sky-200',
  }[badge] || 'bg-slate-100 text-slate-700 border-slate-200'

  if (featured) {
    return (
      <Link
        to={`/games/play/${game.id}`}
        className={`group relative sm:col-span-2 rounded-[20px] border ${theme.ring} bg-gradient-to-br ${theme.soft} p-5 shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] transition overflow-hidden`}
      >
        <div aria-hidden="true" className={`absolute -top-16 -right-16 w-56 h-56 rounded-full opacity-30 ${theme.blob} blur-2xl`} />
        <div aria-hidden="true" className={`absolute -bottom-10 -left-10 w-40 h-40 rounded-full opacity-20 ${theme.blob} blur-2xl`} />
        <div className="relative flex flex-col sm:flex-row sm:items-start gap-4">
          <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${theme.gradient} text-white flex items-center justify-center shadow-md shrink-0`}>
            <theme.icon className="w-8 h-8" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-display font-black text-slate-900 text-lg sm:text-xl leading-tight">{game.title}</h4>
              <span className={`shrink-0 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeStyle}`}>
                {badge}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {grade && <MiniChip>{grade.label}</MiniChip>}
              {subject && <MiniChip tone={theme.chip}>{subject.label}</MiniChip>}
              <MiniChip tone="bg-white text-slate-700 border-slate-200">
                <type.icon className="w-3 h-3 mr-0.5" />
                {type.label}
              </MiniChip>
            </div>
            {game.description && <p className="text-sm text-slate-700 mt-2 line-clamp-2">{game.description}</p>}
            <div className="mt-4 flex items-center justify-between text-xs font-black">
              <span className="inline-flex items-center gap-3 text-slate-600">
                <span className="inline-flex items-center gap-1"><ClockIcon className="w-3.5 h-3.5" />{game.timer}s</span>
                <span className="inline-flex items-center gap-1"><StarIcon className="w-3.5 h-3.5 text-amber-500" />{game.points} pts</span>
              </span>
              <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-white bg-gradient-to-r ${theme.gradient} shadow-sm group-hover:translate-x-0.5 transition`}>
                Play <ArrowRightIcon className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link
      to={`/games/play/${game.id}`}
      className="group relative rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] transition overflow-hidden"
    >
      <div aria-hidden="true" className={`absolute -top-10 -right-10 w-36 h-36 rounded-full opacity-20 ${theme.blob} blur-2xl`} />
      <div className="relative flex items-start gap-3">
        <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${theme.gradient} text-white flex items-center justify-center shadow-sm shrink-0`}>
          <theme.icon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-black text-slate-900 text-sm leading-tight line-clamp-2">{game.title}</h4>
            <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${badgeStyle}`}>
              {badge}
            </span>
          </div>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {grade && <MiniChip>{grade.label}</MiniChip>}
            {subject && <MiniChip tone={theme.chip}>{subject.label}</MiniChip>}
          </div>
        </div>
      </div>
      <div className="relative mt-3 flex items-center justify-between text-[11px] font-black">
        <span className="inline-flex items-center gap-2 text-slate-500">
          <span className="inline-flex items-center gap-0.5"><ClockIcon className="w-3 h-3" />{game.timer}s</span>
          <span className="inline-flex items-center gap-0.5"><StarIcon className="w-3 h-3 text-amber-500" />{game.points}</span>
        </span>
        <span className="text-amber-600 group-hover:translate-x-1 transition inline-flex items-center gap-0.5">
          Play <ArrowRightIcon className="w-3 h-3" />
        </span>
      </div>
    </Link>
  )
}

function SubjectsStrip({ counts }) {
  return (
    <section className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-xl font-black">Explore by Subject</h3>
        <span className="text-xs font-bold text-slate-500 hidden sm:inline">Four CBC-aligned tracks</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {SUBJECTS.map((s) => {
          const theme = subjectTheme(s.slug)
          const count = counts?.[s.slug] ?? null
          const empty = count === 0
          const progress = count == null ? 30 : Math.min(100, Math.max(5, count * 15))
          return (
            <div
              key={s.slug}
              className={`group relative rounded-[20px] border ${theme.ring} bg-gradient-to-br ${theme.soft} p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition overflow-hidden`}
            >
              <div aria-hidden="true" className={`absolute -top-8 -right-8 w-28 h-28 rounded-full opacity-25 ${theme.blob} blur-2xl`} />
              <div className="relative">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${theme.gradient} text-white flex items-center justify-center shadow-sm mb-3`}>
                  <theme.icon className="w-6 h-6" />
                </div>
                <p className="font-display font-black text-slate-900 text-base leading-tight">{s.label}</p>
                <p className={`text-[11px] font-bold ${empty ? 'text-slate-500' : theme.text} mt-0.5`}>
                  {count == null ? 'Loading…' : empty ? 'Coming soon' : `${count} ${count === 1 ? 'game' : 'games'}`}
                </p>
                {!empty && (
                  <div className="mt-2.5 h-1.5 rounded-full bg-white/70 overflow-hidden">
                    <div
                      className={`h-full ${theme.bar} rounded-full transition-[width] duration-700`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function BadgesStrip({ earnedIds, signedIn }) {
  const ids = new Set(earnedIds)
  const show = GAME_BADGES.slice(0, 6)
  return (
    <section className="mt-6 sm:mt-8 rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-black flex items-center gap-2">
          <SparklesIcon className="w-5 h-5 text-amber-500" />
          Your Badges
        </h3>
        <Link to="/badges" className="text-xs font-black text-amber-700 hover:text-amber-900 inline-flex items-center gap-0.5">
          View all <ArrowRightIcon className="w-3 h-3" />
        </Link>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {show.map((b) => {
          const earned = signedIn && ids.has(b.id)
          const style = BADGE_TIER_STYLES[b.tier] || BADGE_TIER_STYLES.bronze
          return (
            <div
              key={b.id}
              className={`relative rounded-2xl border-2 p-3 text-center transition ${
                earned
                  ? `${style.bg} ${style.border} shadow-[0_4px_20px_-8px_rgba(251,191,36,0.45)]`
                  : 'bg-slate-50 border-slate-200'
              }`}
              title={earned ? b.description : `Locked — ${b.hint}`}
            >
              <div className={`text-3xl leading-none mb-1.5 ${earned ? '' : 'opacity-40 grayscale'}`} aria-hidden="true">{b.icon}</div>
              <p className={`text-[11px] font-black leading-tight ${earned ? style.text : 'text-slate-500'}`}>{b.name}</p>
              {!earned && (
                <span className="mt-1 inline-flex items-center gap-0.5 text-[9px] font-bold text-slate-400">
                  <LockClosedIcon className="w-2.5 h-2.5" /> Locked
                </span>
              )}
            </div>
          )
        })}
      </div>
      {!signedIn && (
        <p className="text-xs text-slate-500 mt-3 text-center">
          <Link to="/login" className="font-black text-amber-700 hover:text-amber-900">Sign in</Link> to earn and keep your badges.
        </p>
      )}
    </section>
  )
}

function GradePicker() {
  const bands = [
    {
      key: 'lower',
      label: 'Lower Primary',
      note: 'Grades 1 – 3',
      tint: 'from-amber-100 via-rose-50 to-orange-100',
      ring: 'border-amber-200',
      accent: 'from-amber-400 to-orange-500',
      Icon: AcademicCapIcon,
    },
    {
      key: 'middle',
      label: 'Middle Primary',
      note: 'Grades 4 – 6',
      tint: 'from-emerald-100 via-teal-50 to-cyan-100',
      ring: 'border-emerald-200',
      accent: 'from-emerald-400 to-teal-500',
      Icon: RocketLaunchIcon,
    },
  ]
  return (
    <section id="grades" className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-xl font-black">Pick a Grade</h3>
        <span className="text-xs font-bold text-slate-500 hidden sm:inline">Choose your level to start playing</span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {bands.map((band) => {
          const grades = GRADES.filter((g) => g.band === band.key)
          return (
            <div
              key={band.key}
              className={`rounded-[20px] border ${band.ring} bg-gradient-to-br ${band.tint} p-4 sm:p-5 shadow-sm`}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-600">{band.note}</p>
                  <h4 className="font-display text-base sm:text-lg font-black text-slate-900">{band.label}</h4>
                </div>
                <span className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${band.accent} shadow-md flex items-center justify-center text-white`}>
                  <band.Icon className="w-5 h-5" />
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {grades.map((g, idx) => (
                  <Link
                    key={g.value}
                    to={`/games/g/${g.value}`}
                    className="group bg-white rounded-2xl border border-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition flex flex-col items-center justify-center py-4 sm:py-5 text-center"
                  >
                    <span className={`w-8 h-8 mb-1 rounded-full bg-gradient-to-br ${band.accent} text-white text-[11px] font-black flex items-center justify-center shadow-sm`}>
                      G{g.value}
                    </span>
                    <span className="font-display text-2xl sm:text-3xl font-black text-slate-900 leading-none">{g.value}</span>
                    <span className="mt-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                      {idx === 0 && band.key === 'lower' ? 'Start here' : 'Grade'}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PopularGames({ games }) {
  if (!games || games.length === 0) return null
  return (
    <section className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-xl font-black flex items-center gap-2">
          <StarIcon className="w-5 h-5 text-amber-500" />
          Popular Games
        </h3>
        <span className="text-xs font-bold text-slate-500 hidden sm:inline">Loved by learners this week</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {games.map((g, i) => (
          <PopularCard key={g.id} game={g} variant={i % 3} />
        ))}
      </div>
    </section>
  )
}

function PopularCard({ game, variant = 0 }) {
  const subject = subjectBySlug(game.subject)
  const grade = gradeByValue(game.grade)
  const theme = subjectTheme(game.subject)
  const type = gameTypeMeta(game.type)
  const ratingOffset = (game.id?.length || 0) % 3
  const rating = 4 + (ratingOffset === 0 ? 0.6 : ratingOffset === 1 ? 0.8 : 0.9)
  const patterns = [
    `bg-gradient-to-br ${theme.soft}`,
    `bg-gradient-to-tr ${theme.soft}`,
    `bg-gradient-to-b ${theme.soft}`,
  ]
  return (
    <Link
      to={`/games/play/${game.id}`}
      className="group rounded-[20px] border border-slate-200 bg-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition overflow-hidden flex flex-col"
    >
      <div className={`relative aspect-[4/3] ${patterns[variant]} flex items-center justify-center overflow-hidden`}>
        <div aria-hidden="true" className={`absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-40 ${theme.blob} blur-xl`} />
        <div aria-hidden="true" className={`absolute -bottom-4 -left-4 w-20 h-20 rounded-full opacity-30 ${theme.blob} blur-xl`} />
        <div className={`relative w-16 h-16 rounded-2xl bg-gradient-to-br ${theme.gradient} text-white flex items-center justify-center shadow-md`}>
          <theme.icon className="w-8 h-8" />
        </div>
        <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 text-[10px] font-black px-1.5 py-0.5 rounded-full bg-white/95 text-amber-800 shadow-sm border border-amber-100">
          <StarIcon className="w-3 h-3 text-amber-500" />
          {rating.toFixed(1)}
        </span>
        <span className="absolute top-2 left-2 inline-flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-white/95 text-slate-700 shadow-sm border border-white">
          <type.icon className="w-2.5 h-2.5" />
          {type.label}
        </span>
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <h4 className="font-black text-sm leading-tight text-slate-900 line-clamp-2">{game.title}</h4>
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {grade && <MiniChip>{grade.label}</MiniChip>}
          {subject && <MiniChip tone={theme.chip}>{subject.label}</MiniChip>}
        </div>
        <div className="mt-auto pt-2 flex items-center justify-between text-[11px] font-black">
          <span className="inline-flex items-center gap-0.5 text-slate-500">
            <StarIcon className="w-3 h-3 text-amber-500" />
            {game.points} pts
          </span>
          <span className={`${theme.text} group-hover:translate-x-0.5 transition inline-flex items-center gap-0.5`}>
            Play <ArrowRightIcon className="w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  )
}

function MotivationalFooter() {
  const pillars = [
    { label: 'Learn',    Icon: AcademicCapIcon, tint: 'from-sky-400 to-blue-500' },
    { label: 'Practice', Icon: SparklesIcon,    tint: 'from-amber-400 to-orange-500' },
    { label: 'Compete',  Icon: TrophyIcon,      tint: 'from-rose-400 to-pink-500' },
    { label: 'Achieve',  Icon: StarIcon,        tint: 'from-emerald-400 to-teal-500' },
  ]
  return (
    <section className="mt-8 rounded-[20px] border border-slate-200 bg-gradient-to-r from-indigo-50 via-white to-amber-50 p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
        <div className="flex-1">
          <p className="text-[11px] font-black uppercase tracking-wider text-indigo-600 mb-1">Daily Motto</p>
          <h4 className="font-display text-lg sm:text-xl font-black text-slate-900">
            Practice a little every day, achieve big tomorrow!
          </h4>
          <p className="text-sm text-slate-600 mt-1">Small wins stack up. Come back each day to keep your streak and unlock new badges.</p>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {pillars.map((p) => (
            <div key={p.label} className="rounded-2xl bg-white border border-slate-200 shadow-sm p-3 text-center">
              <div className={`w-9 h-9 mx-auto rounded-xl bg-gradient-to-br ${p.tint} text-white flex items-center justify-center shadow-sm`}>
                <p.Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
              </div>
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-700 mt-2">{p.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ───────────── Intelligence sections ───────────── */

function DailyGoalCard({ goal, signedIn }) {
  if (!signedIn) {
    return (
      <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
        <SectionHeading title="Daily Goal" note="Sign in to unlock" />
        <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 p-4 text-slate-600">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-slate-200 to-slate-300 text-white flex items-center justify-center shrink-0">
            <CheckBadgeIcon className="w-5 h-5" />
          </span>
          <div className="flex-1">
            <p className="font-bold text-slate-700">A little challenge every day</p>
            <p className="text-xs text-slate-500">Sign in to pick today's goal.</p>
          </div>
        </div>
      </section>
    )
  }
  if (!goal) return null
  const progress = Math.min(100, Math.round(((goal.progress || 0) / (goal.target || 1)) * 100))
  const done = !!goal.completed
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <SectionHeading title="Today's Goal" note={done ? 'Completed' : 'In progress'} />
      <div className={`flex items-center gap-3 rounded-2xl border p-4 ${done ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <span className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center shadow-sm shrink-0 ${done ? 'bg-gradient-to-br from-emerald-400 to-teal-500' : 'bg-gradient-to-br from-amber-400 to-orange-500'}`}>
          {done ? <CheckBadgeIcon className="w-6 h-6" /> : <StarIcon className="w-6 h-6" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`font-black text-sm leading-tight ${done ? 'text-emerald-900' : 'text-amber-900'}`}>
            {goal.label}
          </p>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px] font-black mb-1">
              <span className={done ? 'text-emerald-800' : 'text-amber-800'}>{goal.progress || 0} / {goal.target}</span>
              <span className={done ? 'text-emerald-700' : 'text-amber-700'}>{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/70 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-700 ${done ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
                style={{ width: `${Math.max(5, progress)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      {done && (
        <p className="mt-3 text-xs font-bold text-emerald-700 text-center">Awesome — come back tomorrow for a new goal.</p>
      )}
    </section>
  )
}

function PracticeAgainRow({ items }) {
  return (
    <section className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-xl font-black flex items-center gap-2">
          <FireIcon className="w-5 h-5 text-rose-500" />
          Practice Again
        </h3>
        <span className="text-xs font-bold text-slate-500 hidden sm:inline">Keep building confidence</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {items.map((p) => (
          <PracticeCard key={p.game.id} item={p} />
        ))}
      </div>
    </section>
  )
}

function PracticeCard({ item }) {
  const { game, weakTopic, label, reason } = item
  const theme = subjectTheme(game.subject)
  return (
    <Link
      to={`/games/play/${game.id}`}
      className={`group relative rounded-[20px] border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-orange-50 p-4 shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] transition overflow-hidden`}
    >
      <div aria-hidden="true" className="absolute -top-10 -right-10 w-36 h-36 rounded-full opacity-30 bg-rose-300 blur-2xl" />
      <div className="relative flex items-start gap-3">
        <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${theme.gradient} text-white flex items-center justify-center shadow-md shrink-0`}>
          <theme.icon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border bg-rose-100 text-rose-800 border-rose-200">
            <FireIcon className="w-2.5 h-2.5" />
            Weak topic
          </span>
          <h4 className="font-black text-slate-900 text-sm leading-tight mt-1 line-clamp-2">{game.title}</h4>
          <p className="text-[11px] font-bold text-rose-800 mt-0.5">{label}</p>
          {weakTopic && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-black text-slate-500">
              <span>Avg {weakTopic.avgAccuracy}%</span>
              <span>·</span>
              <span className="capitalize">{weakTopic.mastery}</span>
            </div>
          )}
          <p className="text-xs text-slate-600 mt-1 line-clamp-2">{reason}</p>
        </div>
      </div>
      <div className="relative mt-3 flex items-center justify-between text-[11px] font-black">
        <span className="inline-flex items-center gap-2 text-slate-500">
          <span className="inline-flex items-center gap-0.5"><ClockIcon className="w-3 h-3" />{game.timer}s</span>
          <span className="inline-flex items-center gap-0.5"><StarIcon className="w-3 h-3 text-amber-500" />{game.points}</span>
        </span>
        <span className="text-rose-700 group-hover:translate-x-1 transition inline-flex items-center gap-0.5">
          Practice <ArrowRightIcon className="w-3 h-3" />
        </span>
      </div>
    </Link>
  )
}

function WeakAreasStrip({ topics }) {
  return (
    <section className="mt-6 rounded-[20px] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-black flex items-center gap-2">
          <SparklesIcon className="w-5 h-5 text-amber-600" />
          Topics to Improve
        </h3>
        <span className="text-xs font-bold text-amber-800 hidden sm:inline">A little practice makes a big difference</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {topics.map((t) => {
          const theme = subjectTheme(t.subject)
          return (
            <span
              key={t.key}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black border ${theme.chip} shadow-sm`}
              title={`${t.plays} ${t.plays === 1 ? 'play' : 'plays'} · ${t.avgAccuracy}% avg accuracy`}
            >
              <theme.icon className="w-3.5 h-3.5" />
              <span className="capitalize">{t.topic}</span>
              <span className="opacity-70">· {t.avgAccuracy}%</span>
            </span>
          )
        })}
      </div>
      <p className="text-xs text-slate-600 mt-3">
        These topics could use a little more practice — you're already on your way.
      </p>
    </section>
  )
}

function MoveForwardRow({ items }) {
  return (
    <section className="mt-6 sm:mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-xl font-black flex items-center gap-2">
          <RocketLaunchIcon className="w-5 h-5 text-emerald-500" />
          Ready for More
        </h3>
        <span className="text-xs font-bold text-slate-500 hidden sm:inline">You're doing great — try something new</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {items.map((m) => (
          <Link
            key={m.game.id}
            to={`/games/play/${m.game.id}`}
            className="group relative rounded-[20px] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4 shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99] transition overflow-hidden"
          >
            <div aria-hidden="true" className="absolute -top-10 -right-10 w-36 h-36 rounded-full opacity-30 bg-emerald-300 blur-2xl" />
            <div className="relative flex items-start gap-3">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${subjectTheme(m.game.subject).gradient} text-white flex items-center justify-center shadow-md shrink-0`}>
                <RocketLaunchIcon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border bg-emerald-100 text-emerald-800 border-emerald-200">
                  <CheckBadgeIcon className="w-2.5 h-2.5" />
                  Mastered the basics
                </span>
                <h4 className="font-black text-slate-900 text-sm leading-tight mt-1 line-clamp-2">{m.game.title}</h4>
                <p className="text-xs text-slate-700 mt-1 font-bold">{m.label}</p>
                <p className="text-xs text-slate-600 line-clamp-2">{m.reason}</p>
              </div>
              <ArrowRightIcon className="w-5 h-5 text-emerald-600 group-hover:translate-x-1 transition shrink-0 mt-1" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function SubjectProgressStrip({ rows }) {
  return (
    <section className="mt-6 sm:mt-8 rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-black flex items-center gap-2">
          <AcademicCapIcon className="w-5 h-5 text-indigo-500" />
          Your Subject Progress
        </h3>
        <span className="text-xs font-bold text-slate-500 hidden sm:inline">Based on your recent plays</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {rows.map((r) => {
          const theme = subjectTheme(r.subject)
          const label = subjectBySlug(r.subject)?.label || r.subject
          const hasPlays = r.plays > 0
          const masteryIdx = MASTERY_LEVELS.indexOf(r.mastery)
          const masteryStyle = [
            'bg-slate-100 text-slate-700 border-slate-200',
            'bg-amber-100 text-amber-800 border-amber-200',
            'bg-sky-100 text-sky-800 border-sky-200',
            'bg-emerald-100 text-emerald-800 border-emerald-200',
          ][Math.max(0, masteryIdx)]
          return (
            <div
              key={r.subject}
              className={`rounded-2xl border ${theme.ring} bg-gradient-to-br ${theme.soft} p-4 shadow-sm`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-9 h-9 rounded-xl bg-gradient-to-br ${theme.gradient} text-white flex items-center justify-center shadow-sm`}>
                  <theme.icon className="w-5 h-5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-900 text-sm truncate">{label}</p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    {hasPlays ? `${r.plays} ${r.plays === 1 ? 'play' : 'plays'}` : 'Not played yet'}
                  </p>
                </div>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${masteryStyle}`}>
                {r.mastery}
              </span>
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10px] font-black text-slate-500 mb-1">
                  <span>Accuracy</span>
                  <span>{r.avgAccuracy}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/70 overflow-hidden">
                  <div
                    className={`h-full ${theme.bar} rounded-full transition-[width] duration-700`}
                    style={{ width: `${Math.max(5, r.avgAccuracy || 0)}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function hasSubjectPlays(rows) {
  return (rows || []).some((r) => r.plays > 0)
}

/* ───────────── Small helpers ───────────── */

function SectionHeading({ title, note }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-display text-lg font-black">{title}</h3>
      {note && <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{note}</span>}
    </div>
  )
}

function MiniChip({ children, tone = 'bg-slate-100 text-slate-600 border-slate-200' }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${tone}`}>
      {children}
    </span>
  )
}

function computeStats({ history, streak, badges }) {
  const plays = history.length
  const points = history.reduce((sum, h) => sum + (Number(h.score) || 0), 0)
  const xpPerLevel = 200
  const level = Math.max(1, Math.floor(points / xpPerLevel) + 1)
  const xpInLevel = points % xpPerLevel
  const rank = points >= 500 ? 'A+' : points >= 200 ? 'B' : points > 0 ? 'C' : '—'
  return {
    level,
    xpInLevel,
    xpPerLevel,
    streak: streak?.streak || 0,
    points: points.toLocaleString(),
    rawPoints: points,
    plays,
    badgesCount: Object.keys(badges?.byId || {}).length,
    rank,
  }
}

function countBySubject(games) {
  if (!games) return null
  const acc = { mathematics: 0, english: 0, science: 0, social: 0 }
  for (const g of games) {
    if (g.active === false) continue
    if (acc[g.subject] != null) acc[g.subject] += 1
  }
  return acc
}

function pickContinue(history, games) {
  if (!history || history.length === 0 || !games) return null
  const last = history[0]
  if (!last?.gameId) return null
  const match = games.find((g) => g.id === last.gameId)
  if (!match) return { ...last, title: last.gameTitle || 'Recent Game', progress: last.accuracy || 50 }
  return { ...match, gameId: match.id, accuracy: last.accuracy }
}

function pickRecommendedFallback({ games, history, userProfile }) {
  if (!games || games.length === 0) return []
  const playedIds = new Set((history || []).map((h) => h.gameId))
  const playedSubjects = new Set((history || []).map((h) => h.subject))
  const profileGrade = Number(userProfile?.grade) || null

  const scored = games
    .filter((g) => g.active !== false)
    .map((g) => {
      let score = 0
      if (profileGrade && Number(g.grade) === profileGrade) score += 3
      if (playedSubjects.has(g.subject)) score += 1
      if (!playedIds.has(g.id)) score += 1
      score += g.difficulty === 'easy' ? 0.5 : 0
      return { g, score: score + Math.random() * 0.4 }
    })
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, 3).map((x) => x.g)
}

function pickPopular(games) {
  if (!games || games.length === 0) return []
  return games
    .filter((g) => g.active !== false)
    .slice()
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
    .slice(0, 5)
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
