import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClockIcon,
  LockClosedIcon,
  StarIcon,
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
  buildSubjectProgress,
  getDurationLabel,
  getGameTypeTheme,
  getSubjectMascot,
} from './gamesUi'

/**
 * /games — playful mobile-first hub. Mockup-faithful 440px column with a
 * dark stats strip, the daily challenge hero, a 2×2 subjects grid, and
 * horizontal scrollers for hot games + badges.
 *
 * Data flow is unchanged: listGames + history + badges + streak +
 * leaderboard, all via Promise.allSettled so a single Firestore failure
 * never freezes the hub.
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
  const currentRank = currentUser
    ? state.leaderboardRows.findIndex((row) => row.userId === currentUser.uid) + 1
    : 0
  const earnedBadgeIds = new Set(Object.keys(state.badgesById || {}))
  const hotGames = buildHotGames(state.games, state.history, state.challenge?.game)

  const subjectCards = SUBJECTS.map((subject) => {
    const progress = buildSubjectProgress(subject.slug, state.games, state.history)
    return { subject, progress }
  })

  const stats = [
    { emoji: '⚡',  label: 'Level',  value: `Lv ${level}` },
    { emoji: '🔥', label: 'Streak', value: `${state.streak.streak || 0} day${state.streak.streak === 1 ? '' : 's'}`, animate: 'flame' },
    { emoji: '⭐', label: 'Points', value: totalPoints.toLocaleString() },
    { emoji: '🏆', label: 'Rank',   value: currentUser ? (currentRank ? `#${currentRank}` : '—') : 'Guest' },
  ]

  return (
    <GamesShell crumbs={[]}>
      <RedesignStyles />

      <div className="mx-auto w-full max-w-md space-y-7 pb-4 sm:max-w-3xl sm:space-y-9 lg:max-w-5xl lg:space-y-12">
        {/* Stats strip */}
        <section className="zx-card flex items-center justify-between gap-2 rounded-[18px] bg-slate-900 px-3.5 py-2.5 text-white sm:gap-4 sm:rounded-[22px] sm:px-6 sm:py-4">
          {stats.map((stat, i) => (
            <div key={stat.label} className="flex flex-1 items-center gap-2 sm:gap-3">
              <span className={`text-lg leading-none sm:text-2xl ${stat.animate === 'flame' ? 'zx-flame' : ''}`}>
                {stat.emoji}
              </span>
              <div className="leading-tight">
                <div className="font-display text-[18px] font-bold leading-none sm:text-[22px] lg:text-2xl">{stat.value}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-white/65 sm:text-[11px] sm:tracking-[0.16em]">
                  {stat.label}
                </div>
              </div>
              {i < stats.length - 1 && <span aria-hidden="true" className="h-5 w-px bg-white/20 sm:h-8" />}
            </div>
          ))}
        </section>

        {/* Hero — Daily Challenge */}
        <DailyChallengeCard
          challenge={state.challenge}
          streak={state.streak}
          loading={state.loading}
          hideGrade
        />

        {/* Subjects */}
        <Section eyebrow="Subjects" title="Pick your quest" actionLabel="All ›" actionTo="/games">
          {state.loading ? (
            <SubjectGridSkeleton />
          ) : (
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 lg:gap-5">
              {subjectCards.map(({ subject, progress }) => (
                <SubjectTile
                  key={subject.slug}
                  subject={subject}
                  progress={progress}
                  href={`/games/g/${pickGradeForSubject(state.games, subject.slug)}/${subject.slug}`}
                />
              ))}
            </div>
          )}
        </Section>

        {/* Hot games — horizontal scroller (becomes a grid on desktop) */}
        <Section eyebrow="🔥 Hot right now" title="Loved by players" actionLabel="All ›" actionTo="/games">
          {state.loading ? (
            <HotGamesSkeleton />
          ) : (
            <div className="zx-hscroll -mx-4 flex gap-3.5 overflow-x-auto px-4 pb-3 pt-1 sm:-mx-6 sm:gap-4 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
              {hotGames.map((entry) => (
                <HotGameCard key={entry.game.id} game={entry.game} badge={entry.badge} />
              ))}
            </div>
          )}
        </Section>

        {/* Badges — horizontal scroller everywhere; just wider on desktop */}
        <Section eyebrow="🏆 Badges" title="Collect them all" actionLabel="All ›" actionTo="/my-badges">
          <div className="zx-hscroll -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:gap-3 sm:px-6 lg:mx-0 lg:px-0">
            {GAME_BADGES.slice(0, 6).map((badge) => (
              <BadgeChip key={badge.id} badge={badge} earned={earnedBadgeIds.has(badge.id)} />
            ))}
          </div>
        </Section>
      </div>
    </GamesShell>
  )
}

/* ───────────────────────── Pieces ───────────────────────── */

function Section({ eyebrow, title, actionLabel, actionTo, children }) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between sm:mb-4">
        <div>
          <span className="zx-eyebrow">{eyebrow}</span>
          <h2 className="font-display mt-1 text-[26px] font-bold leading-none tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
            {title}
          </h2>
        </div>
        {actionTo && (
          <Link to={actionTo} className="text-xs font-extrabold text-[#0E5E70] transition hover:text-[#053541] sm:text-sm">
            {actionLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

const SUBJECT_TILE_SKIN = {
  mathematics: { tile: 'bg-orange-100', bar: 'bg-orange-500' },
  english:     { tile: 'bg-blue-100',   bar: 'bg-blue-600' },
  science:     { tile: 'bg-green-100',  bar: 'bg-green-600' },
  social:      { tile: 'bg-yellow-100', bar: 'bg-yellow-500' },
}

function SubjectTile({ subject, progress, href }) {
  const skin = SUBJECT_TILE_SKIN[subject.slug] || SUBJECT_TILE_SKIN.mathematics
  const mascot = getSubjectMascot(subject.slug)
  const empty = progress.totalGames === 0

  return (
    <Link
      to={href}
      className="zx-card group relative flex flex-col rounded-[22px] bg-white p-4 transition active:translate-y-[2px] active:shadow-none sm:p-5"
    >
      <span className="absolute right-3 top-3 rounded-full bg-slate-900 px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-white">
        {progress.totalGames} {progress.totalGames === 1 ? 'game' : 'games'}
      </span>

      <div className={`zx-mascot-tile mb-3 grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 text-[36px] leading-none sm:h-20 sm:w-20 sm:text-[44px] ${skin.tile}`}>
        <span aria-hidden="true">{mascot.emoji}</span>
      </div>

      <h3 className="font-display text-[19px] font-bold leading-none text-slate-900 sm:text-xl lg:text-[22px]">{subject.label}</h3>
      <p className="mt-1 text-[11.5px] font-semibold text-slate-500 sm:text-xs">{mascot.name}</p>

      <div className="mt-3 h-2 overflow-hidden rounded-full border-[1.5px] border-slate-900 bg-[#EFE9DB] sm:h-2.5">
        <div className={`h-full rounded-full ${skin.bar}`} style={{ width: `${empty ? 0 : progress.progress}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold text-slate-900 sm:text-xs">
          {empty ? 'Soon' : progress.progress === 100 ? '100% ✓' : `${progress.progress}%`}
        </span>
        <span className="truncate text-right text-[10.5px] uppercase tracking-[0.06em] text-slate-500 sm:text-[11px]">
          {empty
            ? 'Coming soon'
            : `${progress.plays} of ${progress.totalGames} played`}
        </span>
      </div>
    </Link>
  )
}

const HOT_BADGE_SKIN = {
  Popular:     'bg-[#FF7A1A] text-white',
  New:         'bg-blue-600 text-white',
  Recommended: 'bg-emerald-500 text-white',
}

const HOT_ICON_BG = {
  mathematics: 'bg-orange-100',
  english:     'bg-blue-100',
  science:     'bg-green-100',
  social:      'bg-yellow-100',
}

function HotGameCard({ game, badge }) {
  const typeTheme = getGameTypeTheme(game.type)
  const TypeIcon = typeTheme.icon
  const subjectKey = String(game.subject || '').toLowerCase()
  const iconBg = HOT_ICON_BG[subjectKey] || 'bg-amber-100'
  const subjectLabel = SUBJECTS.find((s) => s.slug === subjectKey)?.label || 'Game'

  return (
    <Link
      to={`/games/play/${game.id}`}
      className="zx-card relative flex w-[230px] shrink-0 snap-start flex-col rounded-[22px] bg-white p-4 transition active:translate-y-[2px] active:shadow-none sm:w-[260px] sm:p-5 lg:w-auto lg:shrink"
    >
      {badge && (
        <span className={`absolute right-3 top-3 rounded-full border-[1.5px] border-slate-900 px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.08em] ${HOT_BADGE_SKIN[badge] || HOT_BADGE_SKIN.Popular}`}>
          {badge}
        </span>
      )}

      <div className={`mb-3 grid h-11 w-11 place-items-center rounded-[12px] border-2 border-slate-900 ${iconBg} text-slate-900`}>
        <TypeIcon className="h-5 w-5" />
      </div>

      <div className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-[#053541]">{subjectLabel}</div>
      <h3 className="font-display mt-1 text-[18px] font-bold leading-tight tracking-tight text-slate-900">
        {game.title}
      </h3>
      <p className="mt-1.5 line-clamp-2 min-h-[32px] text-[12px] font-medium text-slate-500">
        {game.description}
      </p>

      <div className="mt-auto flex gap-2.5 border-t border-dashed border-[#D8D0BC] pt-2.5 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><ClockIcon className="h-3.5 w-3.5" /> {getDurationLabel(game)}</span>
        <span className="inline-flex items-center gap-1"><StarIcon className="h-3.5 w-3.5 text-amber-500" /> {Number(game.points) || 0} pts</span>
      </div>
    </Link>
  )
}

const TIER_MEDAL = {
  bronze: 'bg-amber-300',
  silver: 'bg-slate-200',
  gold:   'bg-yellow-400',
}

function BadgeChip({ badge, earned }) {
  const medal = TIER_MEDAL[badge.tier] || TIER_MEDAL.bronze

  return (
    <div
      title={!earned ? badge.hint : badge.description}
      className={`zx-card flex min-w-[178px] shrink-0 items-center gap-2.5 rounded-[18px] bg-white p-2.5 ${earned ? '' : 'opacity-50'}`}
    >
      <span className={`grid h-10 w-10 place-items-center rounded-[12px] border-2 border-slate-900 text-[20px] ${medal}`}>
        {earned ? badge.icon : <LockClosedIcon className="h-5 w-5 text-slate-700" />}
      </span>
      <div className="min-w-0">
        <div className="font-display text-[13px] font-semibold leading-none text-slate-900">{badge.name}</div>
        <div className="mt-1 text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
          {earned ? badge.tier : 'Locked'}
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Skeletons ───────────────────────── */

function SubjectGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="zx-card animate-pulse rounded-[22px] bg-white p-4">
          <div className="mb-3 h-16 w-16 rounded-[18px] border-2 border-slate-900 bg-slate-100" />
          <div className="h-4 w-2/3 rounded bg-slate-100" />
          <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
          <div className="mt-3 h-2 rounded-full border-[1.5px] border-slate-900 bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

function HotGamesSkeleton() {
  return (
    <div className="zx-hscroll -mx-[18px] flex gap-3.5 overflow-hidden px-[18px] pb-3 pt-1">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="zx-card w-[230px] shrink-0 animate-pulse rounded-[22px] bg-white p-4">
          <div className="mb-3 h-11 w-11 rounded-[12px] border-2 border-slate-900 bg-slate-100" />
          <div className="h-3 w-1/2 rounded bg-slate-100" />
          <div className="mt-2 h-4 w-3/4 rounded bg-slate-100" />
          <div className="mt-2 h-3 w-full rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

/* ───────────────────────── Helpers ───────────────────────── */

function buildHotGames(games, history, challengeGame) {
  if (!games.length) return []

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
    total += Number(game.points) || 0
    return total
  }

  const ranked = games.slice().sort((a, b) => score(b) - score(a))
  // Spread across subjects so the scroller shows variety.
  const seen = new Set()
  const picks = []
  for (const game of ranked) {
    const key = String(game.subject || '').toLowerCase()
    if (picks.length < 2 || !seen.has(key)) {
      picks.push(game)
      seen.add(key)
    }
    if (picks.length >= 4) break
  }

  return picks.map((game, index) => ({ game, badge: badgeFor(game, index) }))
}

function badgeFor(game, index) {
  const created = game.createdAt?.toMillis?.() || game.createdAt || 0
  const isRecent = created && Date.now() - created < 1000 * 60 * 60 * 24 * 30
  if (isRecent) return 'New'
  if (index === 0) return 'Popular'
  if ((game.difficulty || '').toLowerCase() === 'easy') return 'New'
  return 'Popular'
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

/**
 * Hard-bordered "sticker" card style + horizontal scroller hide-scrollbar.
 * Scoped to GamesHub so other /games pages keep their existing visual
 * language while we evaluate the redesign.
 */
function RedesignStyles() {
  return (
    <style>{`
      .zx-card {
        border: 2px solid #0F1B2D;
        box-shadow: 0 2px 0 #0F1B2D;
      }
      .zx-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 10.5px;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #053541;
      }
      .zx-eyebrow::before {
        content: '';
        width: 18px;
        height: 2px;
        border-radius: 2px;
        background: #FF7A1A;
      }
      .zx-hscroll {
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
      }
      .zx-hscroll::-webkit-scrollbar { display: none; }
      .zx-mascot-tile span { display: inline-block; }
      @keyframes zx-flame {
        0%, 100% { transform: scale(1) rotate(-2deg); filter: drop-shadow(0 0 4px rgba(255,140,0,0.4)); }
        50%      { transform: scale(1.15) rotate(2deg); filter: drop-shadow(0 0 8px rgba(255,140,0,0.7)); }
      }
      .zx-flame { animation: zx-flame 1.4s ease-in-out infinite; display: inline-block; }
      @media (prefers-reduced-motion: reduce) {
        .zx-flame { animation: none !important; }
      }
    `}</style>
  )
}
