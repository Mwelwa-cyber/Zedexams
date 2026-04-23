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
    celebrate: {
      wrap:   'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50',
      tile:   'bg-gradient-to-br from-emerald-400 to-teal-500',
      accent: 'text-emerald-800',
      icon:   SparklesIcon,
    },
    steady: {
      wrap:   'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50',
      tile:   'bg-gradient-to-br from-amber-400 to-orange-500',
      accent: 'text-amber-800',
      icon:   StarIcon,
    },
    encourage: {
      wrap:   'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-indigo-50',
      tile:   'bg-gradient-to-br from-sky-400 to-indigo-500',
      accent: 'text-sky-800',
      icon:   RocketLaunchIcon,
    },
  }[fb.tone] || {
    wrap: 'border-slate-200 bg-white', tile: 'bg-slate-400', accent: 'text-slate-700', icon: SparklesIcon,
  }
  const Icon = toneStyle.icon

  return (
    <section className={`mt-4 rounded-[20px] border ${toneStyle.wrap} p-4 sm:p-5 shadow-sm`}>
      <div className="flex items-start gap-3">
        <div className={`w-12 h-12 rounded-2xl ${toneStyle.tile} text-white flex items-center justify-center shadow-md shrink-0`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[11px] font-black uppercase tracking-wider ${toneStyle.accent}`}>
            Smart Feedback
          </p>
          <h3 className="font-display text-lg sm:text-xl font-black leading-tight text-slate-900 mt-0.5">
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
            <div className="mt-3 rounded-xl bg-white/70 border border-white px-3 py-2 text-sm font-bold text-slate-700 inline-flex items-center gap-2">
              <ArrowRightIcon className="w-4 h-4 text-slate-500" />
              <span>{fb.suggestedNext}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
