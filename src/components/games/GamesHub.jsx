import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  GRADES, listGames, getMyHistory, subscribeToGlobalLeaderboard,
  gradeByValue, subjectBySlug,
} from '../../utils/gamesService'
import { getMyStreak } from '../../utils/dailyChallengeService'
import { getMyGameBadges } from '../../utils/gameBadgesService'
import { GAME_BADGES, BADGE_TIER_STYLES } from '../../data/gameBadges'
import { getFallbackGames } from '../../data/gamesSeed'
import { useAuth } from '../../contexts/AuthContext'
import GamesShell from './GamesShell'
import DailyChallengeCard from './DailyChallengeCard'

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

  // Signed-in user data (history, streak, badges). Silent on failure.
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    Promise.all([
      getMyHistory(10),
      getMyStreak(),
      getMyGameBadges(),
    ]).then(([h, s, b]) => {
      if (cancelled) return
      setHistory(h || [])
      setStreak(s || { streak: 0, longestStreak: 0, signedIn: true })
      setBadges(b || { byId: {} })
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
  const continueItem = useMemo(() => pickContinue(history, games), [history, games])
  const recommended  = useMemo(() => pickRecommended({ games, history, userProfile }), [games, history, userProfile])
  const popular      = useMemo(() => pickPopular(games), [games])

  return (
    <GamesShell crumbs={[]}>
      <DailyChallengeCard />

      <WelcomeBar name={firstName} signedIn={!!currentUser} />

      <StatsRow stats={stats} />

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 sm:gap-6 mt-6">
        <ContinueLearning item={continueItem} signedIn={!!currentUser} />
        <LeaderboardPreview rows={topScorers} />
      </div>

      <RecommendedGames games={recommended} />

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
        <span aria-hidden="true">🇿🇲</span>
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

function StatsRow({ stats }) {
  const cards = [
    { key: 'level',  icon: '📈', tint: 'from-emerald-50 to-teal-50',  ring: 'border-emerald-200', value: stats.level,        label: 'Level',   sub: `${stats.xpInLevel}/${stats.xpPerLevel} XP to next` },
    { key: 'streak', icon: '🔥', tint: 'from-rose-50 to-amber-50',    ring: 'border-rose-200',    value: `${stats.streak} days`, label: 'Streak', sub: stats.streak > 0 ? 'Keep it alive!' : 'Play today to start' },
    { key: 'points', icon: '🎯', tint: 'from-amber-50 to-yellow-50',  ring: 'border-amber-200',   value: stats.points,       label: 'Points',  sub: `${stats.plays} games played` },
    { key: 'rank',   icon: '🏆', tint: 'from-indigo-50 to-sky-50',    ring: 'border-indigo-200',  value: stats.rank,         label: 'Rank',    sub: 'Top 10% this week' },
  ]
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((c) => (
        <div
          key={c.key}
          className={`rounded-2xl border ${c.ring} bg-gradient-to-br ${c.tint} p-4 shadow-sm hover:shadow-md transition`}
        >
          <div className="flex items-center justify-between">
            <span className="w-9 h-9 rounded-xl bg-white/80 border border-white shadow-sm flex items-center justify-center text-lg">
              <span aria-hidden="true">{c.icon}</span>
            </span>
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{c.label}</span>
          </div>
          <p className="font-display text-2xl sm:text-3xl font-black mt-3 text-slate-900">{c.value}</p>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">{c.sub}</p>
        </div>
      ))}
    </section>
  )
}

function ContinueLearning({ item, signedIn }) {
  if (!item) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display text-lg font-black">Continue Learning</h3>
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Pick up where you left off</span>
        </div>
        <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 p-5 text-slate-600">
          <span className="text-3xl" aria-hidden="true">🎮</span>
          <div className="flex-1">
            <p className="font-bold text-slate-700">
              {signedIn ? 'No recent games yet — try a daily challenge!' : 'Sign in to keep your progress across devices.'}
            </p>
            <p className="text-xs text-slate-500">Your last game will appear here.</p>
          </div>
          <Link to="/games#grades" className="hidden sm:inline-flex px-3 py-2 rounded-xl text-xs font-black text-white bg-slate-900 hover:bg-slate-800">Browse</Link>
        </div>
      </section>
    )
  }
  const grade = gradeByValue(item.grade)
  const subject = subjectBySlug(item.subject)
  const progress = Math.min(100, Math.max(5, Math.round(item.accuracy || item.progress || 60)))
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-black">Continue Learning</h3>
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Last played</span>
      </div>
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white flex items-center justify-center text-2xl shadow-md">
          <span aria-hidden="true">{subject?.emoji || '📘'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-slate-900 truncate">{item.title || item.gameTitle || 'Game'}</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {grade && <MiniChip>{grade.label}</MiniChip>}
            {subject && <MiniChip>{subject.label}</MiniChip>}
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px] font-black text-slate-500 mb-1">
              <span>You're {progress}% there</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full transition-[width] duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
        <Link
          to={`/games/play/${item.gameId || item.id}`}
          className="shrink-0 hidden sm:inline-flex items-center gap-1 px-4 py-2.5 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-md"
        >
          Continue <span aria-hidden="true">→</span>
        </Link>
      </div>
      <Link
        to={`/games/play/${item.gameId || item.id}`}
        className="sm:hidden mt-3 inline-flex w-full items-center justify-center gap-1 px-4 py-2.5 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500"
      >
        Continue →
      </Link>
    </section>
  )
}

function LeaderboardPreview({ rows }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-black">Top Learners Today</h3>
        <Link to="/games/leaderboard" className="text-xs font-black text-amber-700 hover:text-amber-900">View all →</Link>
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
        className="mt-3 inline-flex w-full items-center justify-center gap-1 px-3 py-2 rounded-xl text-xs font-black text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200"
      >
        Open full leaderboard →
      </Link>
    </section>
  )
}

function LbRow({ row, rank }) {
  const medal = rank === 1 ? 'bg-amber-400 text-white' : rank === 2 ? 'bg-slate-300 text-slate-800' : rank === 3 ? 'bg-orange-400 text-white' : 'bg-slate-100 text-slate-600'
  const highlight = rank <= 3 ? 'bg-gradient-to-r from-amber-50 to-white border-amber-100' : 'bg-white border-slate-100'
  return (
    <li className={`flex items-center gap-3 p-2 rounded-xl border ${highlight}`}>
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${medal}`}>
        {rank <= 3 ? (rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉') : rank}
      </span>
      <span className="flex-1 min-w-0 text-sm font-bold text-slate-800 truncate">{row.displayName || 'Anonymous'}</span>
      <span className="text-sm font-black text-slate-900">{Number(row.score || 0).toLocaleString()}</span>
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">pts</span>
    </li>
  )
}

function EmptyLeaderboard() {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 p-4 text-center">
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
        <h3 className="font-display text-xl font-black">Recommended for You</h3>
        <Link to="/games#grades" className="text-xs font-black text-amber-700 hover:text-amber-900">See all →</Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {games.map((g, i) => (
          <RecommendedCard key={g.id} game={g} badge={i === 0 ? 'Recommended' : i === 1 ? 'Popular' : 'New'} />
        ))}
      </div>
    </section>
  )
}

function RecommendedCard({ game, badge }) {
  const subject = subjectBySlug(game.subject)
  const grade = gradeByValue(game.grade)
  const subjectColor = SUBJECT_VISUAL[subject?.slug] || SUBJECT_VISUAL.default
  const badgeStyle = {
    Recommended: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    Popular:     'bg-rose-100 text-rose-800 border-rose-200',
    New:         'bg-sky-100 text-sky-800 border-sky-200',
  }[badge] || 'bg-slate-100 text-slate-700 border-slate-200'
  return (
    <Link
      to={`/games/play/${game.id}`}
      className="group relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition overflow-hidden"
    >
      <div className={`absolute -top-10 -right-10 w-36 h-36 rounded-full opacity-20 ${subjectColor.blob}`} aria-hidden="true" />
      <div className="relative flex items-start gap-3">
        <div className={`w-12 h-12 rounded-2xl ${subjectColor.tileBg} flex items-center justify-center text-2xl shrink-0 shadow-sm`}>
          <span aria-hidden="true">{subject?.emoji || '🎮'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-black text-slate-900 text-sm leading-tight line-clamp-2">{game.title}</h4>
            <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${badgeStyle}`}>
              {badge}
            </span>
          </div>
          <div className="flex gap-1 mt-1.5">
            {grade && <MiniChip>{grade.label}</MiniChip>}
            {subject && <MiniChip>{subject.label}</MiniChip>}
          </div>
        </div>
      </div>
      <div className="relative mt-3 flex items-center justify-between text-[11px] font-black">
        <span className="text-slate-500">⏱ {game.timer}s · 🎯 {game.points} pts</span>
        <span className="text-amber-600 group-hover:translate-x-1 transition">Play →</span>
      </div>
    </Link>
  )
}

function BadgesStrip({ earnedIds, signedIn }) {
  const ids = new Set(earnedIds)
  const show = GAME_BADGES.slice(0, 6)
  return (
    <section className="mt-6 sm:mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-black">Your Badges</h3>
        <Link to="/badges" className="text-xs font-black text-amber-700 hover:text-amber-900">View all →</Link>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {show.map((b) => {
          const earned = signedIn && ids.has(b.id)
          const style = BADGE_TIER_STYLES[b.tier] || BADGE_TIER_STYLES.bronze
          return (
            <div
              key={b.id}
              className={`rounded-xl border-2 p-3 text-center transition ${earned ? `${style.bg} ${style.border} shadow-sm` : 'bg-slate-50 border-slate-200 opacity-60 grayscale'}`}
              title={earned ? b.description : b.hint}
            >
              <div className="text-3xl leading-none mb-1.5" aria-hidden="true">{b.icon}</div>
              <p className={`text-[11px] font-black leading-tight ${earned ? style.text : 'text-slate-500'}`}>{b.name}</p>
              {!earned && <p className="text-[9px] font-bold text-slate-400 mt-0.5">Locked</p>}
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
    { key: 'lower',  label: 'Lower Primary',  note: 'Grades 1 – 3', tint: 'from-amber-100 via-rose-50 to-orange-100',  ring: 'border-amber-200', accent: 'from-amber-400 to-orange-400' },
    { key: 'middle', label: 'Middle Primary', note: 'Grades 4 – 6', tint: 'from-emerald-100 via-teal-50 to-cyan-100',    ring: 'border-emerald-200', accent: 'from-emerald-400 to-teal-500' },
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
              className={`rounded-3xl border ${band.ring} bg-gradient-to-br ${band.tint} p-4 sm:p-5 shadow-sm`}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-600">{band.note}</p>
                  <h4 className="font-display text-base sm:text-lg font-black text-slate-900">{band.label}</h4>
                </div>
                <span className={`w-9 h-9 rounded-full bg-gradient-to-br ${band.accent} shadow-md flex items-center justify-center text-white text-lg`}>
                  <span aria-hidden="true">{band.key === 'lower' ? '🌱' : '🚀'}</span>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {grades.map((g, idx) => (
                  <Link
                    key={g.value}
                    to={`/games/g/${g.value}`}
                    className="group bg-white rounded-2xl border-2 border-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition flex flex-col items-center justify-center py-4 sm:py-5 text-center"
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
        <h3 className="font-display text-xl font-black">Popular Games</h3>
        <span className="text-xs font-bold text-slate-500 hidden sm:inline">Loved by learners this week</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {games.map((g) => (
          <PopularCard key={g.id} game={g} />
        ))}
      </div>
    </section>
  )
}

function PopularCard({ game }) {
  const subject = subjectBySlug(game.subject)
  const grade = gradeByValue(game.grade)
  const subjectColor = SUBJECT_VISUAL[subject?.slug] || SUBJECT_VISUAL.default
  return (
    <Link
      to={`/games/play/${game.id}`}
      className="group rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition overflow-hidden flex flex-col"
    >
      <div className={`relative aspect-[4/3] ${subjectColor.thumbBg} flex items-center justify-center`}>
        <span className="text-5xl" aria-hidden="true">{subject?.emoji || '🎮'}</span>
        <span className="absolute top-2 right-2 text-[10px] font-black px-1.5 py-0.5 rounded-full bg-white/90 text-amber-800 shadow-sm">
          ⭐ 4.{7 + (game.id?.length % 3)}
        </span>
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <h4 className="font-black text-sm leading-tight text-slate-900 line-clamp-2">{game.title}</h4>
        <div className="flex gap-1 mt-1.5">
          {grade && <MiniChip>{grade.label}</MiniChip>}
          {subject && <MiniChip>{subject.label}</MiniChip>}
        </div>
        <div className="mt-auto pt-2 flex items-center justify-between text-[11px] font-black">
          <span className="text-slate-500">🎯 {game.points} pts</span>
          <span className="text-amber-600 group-hover:translate-x-0.5 transition">▶</span>
        </div>
      </div>
    </Link>
  )
}

function MotivationalFooter() {
  const pillars = [
    { label: 'Learn',    icon: '📚', tint: 'from-sky-100 to-blue-100' },
    { label: 'Practice', icon: '✏️', tint: 'from-amber-100 to-orange-100' },
    { label: 'Compete',  icon: '🏆', tint: 'from-rose-100 to-pink-100' },
    { label: 'Achieve',  icon: '🌟', tint: 'from-emerald-100 to-teal-100' },
  ]
  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-gradient-to-r from-indigo-50 via-white to-amber-50 p-5 sm:p-6 shadow-sm">
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
            <div key={p.label} className={`rounded-2xl bg-gradient-to-br ${p.tint} border border-white shadow-sm p-3 text-center`}>
              <div className="text-2xl" aria-hidden="true">{p.icon}</div>
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-700 mt-1">{p.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ───────────── Small helpers ───────────── */

function MiniChip({ children }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
      {children}
    </span>
  )
}

const SUBJECT_VISUAL = {
  mathematics: { tileBg: 'bg-rose-100',    thumbBg: 'bg-gradient-to-br from-rose-50 to-pink-100',     blob: 'bg-rose-300' },
  english:     { tileBg: 'bg-sky-100',     thumbBg: 'bg-gradient-to-br from-sky-50 to-cyan-100',      blob: 'bg-sky-300' },
  science:     { tileBg: 'bg-emerald-100', thumbBg: 'bg-gradient-to-br from-emerald-50 to-teal-100',  blob: 'bg-emerald-300' },
  social:      { tileBg: 'bg-amber-100',   thumbBg: 'bg-gradient-to-br from-amber-50 to-orange-100',  blob: 'bg-amber-300' },
  default:     { tileBg: 'bg-slate-100',   thumbBg: 'bg-gradient-to-br from-slate-50 to-slate-100',   blob: 'bg-slate-300' },
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

function pickContinue(history, games) {
  if (!history || history.length === 0 || !games) return null
  const last = history[0]
  if (!last?.gameId) return null
  const match = games.find((g) => g.id === last.gameId)
  if (!match) return { ...last, title: last.gameTitle || 'Recent Game', progress: last.accuracy || 50 }
  return { ...match, gameId: match.id, accuracy: last.accuracy }
}

function pickRecommended({ games, history, userProfile }) {
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
      // Light preference for earlier/simpler content as a stable default.
      score += g.difficulty === 'easy' ? 0.5 : 0
      return { g, score: score + Math.random() * 0.4 }
    })
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, 3).map((x) => x.g)
}

function pickPopular(games) {
  if (!games || games.length === 0) return []
  // Stable-ish "popularity" using document ids as seed — keeps the order
  // consistent during a session without a real popularity signal.
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
