import { Link } from 'react-router-dom'
import { ArrowTrendingUpIcon, SparklesIcon, TrophyIcon } from '@heroicons/react/24/solid'

/**
 * Progression UI — the visible "goal to chase" built on src/utils/gameProgress.
 *
 *   - <RankBadge>      compact "Lv N · Rank" chip (hub + reuse)
 *   - <LevelMeter>     hub card: level, rank, XP bar, points-to-next
 *   - <LevelUpBanner>  celebratory done-screen banner when a round levels you up
 *   - <XpProgressBar>  done-screen "+N XP" plus a slim bar to the next level
 *
 * All take a `levelInfo()` / `levelUpInfo()` result, so they stay pure-display.
 */

const RANK_TONE = {
  emerald: { soft: 'bg-emerald-100 text-emerald-900', bar: 'bg-emerald-500', tile: 'bg-emerald-200' },
  sky:     { soft: 'bg-sky-100 text-sky-900',         bar: 'bg-sky-500',     tile: 'bg-sky-200' },
  blue:    { soft: 'bg-blue-100 text-blue-900',       bar: 'bg-blue-600',    tile: 'bg-blue-200' },
  amber:   { soft: 'bg-amber-100 text-amber-900',     bar: 'bg-amber-500',   tile: 'bg-amber-200' },
  orange:  { soft: 'bg-orange-100 text-orange-900',   bar: 'bg-orange-500',  tile: 'bg-orange-200' },
  violet:  { soft: 'bg-violet-100 text-violet-900',   bar: 'bg-violet-500',  tile: 'bg-violet-200' },
  rose:    { soft: 'bg-rose-100 text-rose-900',       bar: 'bg-rose-500',    tile: 'bg-rose-200' },
}

function tone(rank) {
  return RANK_TONE[rank?.tone] || RANK_TONE.emerald
}

export function RankBadge({ progress, className = '' }) {
  if (!progress) return null
  const t = tone(progress.rank)
  return (
    <span className={`zx-chip ${t.soft} ${className}`}>
      <span aria-hidden="true">{progress.rank.emoji}</span>
      Lv {progress.level} · {progress.rank.title}
    </span>
  )
}

/**
 * Hub level card. Sits under the stats strip and turns the cosmetic "Level"
 * number into something the learner is actively climbing.
 */
export function LevelMeter({ progress, signedIn = true }) {
  if (!progress) return null
  const t = tone(progress.rank)
  const atTop = !progress.nextRank

  return (
    <section className="zx-card rounded-[18px] bg-white p-4 sm:rounded-[22px] sm:p-5">
      <div className="flex items-center gap-3.5">
        <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-[16px] border-2 border-slate-900 text-[28px] leading-none ${t.tile}`}>
          <span aria-hidden="true">{progress.rank.emoji}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-display text-lg font-bold leading-none text-slate-900">
                Level {progress.level}
              </div>
              <div className="mt-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-500">
                {progress.rank.title}
              </div>
            </div>
            <span className="font-display text-sm font-bold text-slate-400">
              {progress.points.toLocaleString()} pts
            </span>
          </div>

          <div className="mt-2.5 h-2.5 overflow-hidden rounded-full border-[1.5px] border-slate-900 bg-[#EFE9DB]">
            <div
              className={`h-full rounded-full ${t.bar} transition-[width] duration-500`}
              style={{ width: `${progress.progress}%` }}
            />
          </div>

          <div className="mt-1.5 text-[11px] font-semibold text-slate-500">
            {!signedIn ? (
              <Link to="/login" className="font-extrabold text-[#0E5E70] underline">
                Sign in to save your progress
              </Link>
            ) : atTop ? (
              <>Top rank reached — keep your streak alive! <span aria-hidden="true">🏆</span></>
            ) : (
              <>
                <b className="text-slate-900">{progress.pointsToNext.toLocaleString()} pts</b> to Level {progress.level + 1}
                {progress.nextRank && (
                  <> · next rank <b className="text-slate-900">{progress.nextRank.emoji} {progress.nextRank.title}</b> at Lv {progress.nextRank.min}</>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

/** Celebratory banner shown on the done screen when the round levelled you up. */
export function LevelUpBanner({ change }) {
  if (!change?.leveledUp) return null
  const t = tone(change.rank)
  return (
    <div className={`zx-anim-bump zx-card rounded-[18px] p-4 ${t.soft}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border-2 border-slate-900 bg-white">
          <ArrowTrendingUpIcon className="h-6 w-6 text-slate-900" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">
            Level up! You reached Level {change.toLevel} {change.rank.emoji}
          </p>
          <p className="mt-1 text-sm leading-6 opacity-90">
            {change.newRank
              ? <>New rank unlocked: <b>{change.newRank.title}</b>. Keep climbing!</>
              : <>Nice work — {change.after?.pointsToNext?.toLocaleString?.() ?? change.after?.pointsToNext} pts to Level {change.toLevel + 1}.</>}
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * "You beat your own best" banner — the cheapest competitive hook there is:
 * the learner racing themselves. Shown on the done screen when this round beat
 * their previous best for the game.
 */
export function PersonalBestBanner({ personalBest }) {
  if (!personalBest?.isBest) return null
  return (
    <div className="zx-anim-bump zx-card rounded-[18px] bg-amber-100 p-4 text-amber-900">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border-2 border-slate-900 bg-white text-amber-600">
          <TrophyIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">New personal best! 🎉</p>
          <p className="mt-1 text-sm leading-6 opacity-90">
            You beat your previous best of {personalBest.prevBest.toLocaleString()} pts on this game.
          </p>
        </div>
      </div>
    </div>
  )
}

/** Slim "+N XP" earned indicator + progress to the next level, for done screens. */
export function XpProgressBar({ progress, gained }) {
  if (!progress) return null
  const t = tone(progress.rank)
  const pts = Number(gained) || 0
  return (
    <div className="zx-card rounded-[14px] bg-white p-3.5 text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-extrabold text-slate-900">
          <SparklesIcon className="h-4 w-4 text-amber-500" />
          {pts > 0 ? `+${pts} XP` : 'XP earned'}
        </span>
        <span className="text-[11px] font-bold text-slate-500">
          Level {progress.level} · {progress.rank.title}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full border-[1.5px] border-slate-900 bg-[#EFE9DB]">
        <div
          className={`h-full rounded-full ${t.bar} transition-[width] duration-500`}
          style={{ width: `${progress.progress}%` }}
        />
      </div>
      <div className="mt-1.5 text-[11px] font-semibold text-slate-500">
        {progress.nextRank || progress.pointsToNext > 0
          ? <><b className="text-slate-900">{progress.pointsToNext.toLocaleString()} pts</b> to Level {progress.level + 1}</>
          : <>Top level reached <span aria-hidden="true">🏆</span></>}
      </div>
    </div>
  )
}
