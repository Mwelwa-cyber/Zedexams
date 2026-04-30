import {
  SparklesIcon, StarIcon, CheckBadgeIcon, ArrowRightIcon, RocketLaunchIcon,
} from './gameIcons'
import { buildSmartFeedback } from '../../utils/gamesIntelligence'

/**
 * Child-friendly post-game feedback. Renders nothing on first-play where we
 * have no intelligence payload (keeps the Done screen clean for new users).
 *
 * Tone is always encouraging — the copy comes from `buildSmartFeedback`
 * which never uses negative framing. Weak areas are surfaced as "practice
 * opportunities", not mistakes.
 */
export default function SmartFeedback({ game, result, saveResult }) {
  if (!saveResult?.ok) return null
  const updateOutcome = saveResult.intelligence || null
  const fb = buildSmartFeedback({ game, result, updateOutcome })

  const toneStyle = {
    celebrate: { wrap: 'bg-emerald-100',  tile: 'bg-emerald-100', icon: SparklesIcon },
    steady:    { wrap: 'bg-amber-100',    tile: 'bg-amber-100',   icon: StarIcon },
    encourage: { wrap: 'bg-sky-100',      tile: 'bg-sky-100',     icon: RocketLaunchIcon },
  }[fb.tone] || { wrap: 'bg-white', tile: 'bg-slate-100', icon: SparklesIcon }
  const Icon = toneStyle.icon

  return (
    <section className={`zx-card mt-4 rounded-[18px] p-4 sm:p-5 ${toneStyle.wrap}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-[12px] border-2 border-slate-900 text-slate-900 ${toneStyle.tile}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="zx-eyebrow">Smart Feedback</p>
          <h3 className="font-display text-lg sm:text-xl font-bold leading-tight text-slate-900 mt-1">
            {fb.headline}
          </h3>

          {fb.strengths.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {fb.strengths.map((s, i) => (
                <li key={`s-${i}`} className="flex items-start gap-2 text-sm text-slate-800">
                  <CheckBadgeIcon className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}

          {fb.weakAreas.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {fb.weakAreas.map((w, i) => (
                <li key={`w-${i}`} className="flex items-start gap-2 text-sm text-slate-800">
                  <SparklesIcon className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          {fb.suggestedNext && (
            <div className="zx-card mt-3 inline-flex items-center gap-2 rounded-[12px] bg-white px-3 py-2 text-sm font-bold text-slate-700">
              <ArrowRightIcon className="w-4 h-4 text-slate-500" />
              <span>{fb.suggestedNext}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
