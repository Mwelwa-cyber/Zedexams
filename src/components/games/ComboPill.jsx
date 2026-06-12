import { comboHeat } from './gameFeel'

/**
 * Drop-in replacement for the static "Streak" stat pill. As the live streak
 * climbs it visibly heats up — colour shifts emerald → amber → orange → rose,
 * a glow ring grows, flame emoji appear, and the whole pill bumps on each
 * increment (keyed off the streak value). This is what turns a silent counter
 * into something a learner wants to keep alive.
 *
 * Same footprint as the other stat pills so it slots straight into the
 * 3-column stats grid without layout changes.
 */
export default function ComboPill({ streak }) {
  const heat = comboHeat(streak)
  return (
    <div
      key={streak} /* re-mount on every change so the bump animation re-fires */
      className={`zx-card rounded-[14px] px-3 py-2 text-center transition-colors ${heat.bg} ${heat.ring} ${heat.text}`}
      style={heat.active ? { animation: 'zx-combo-bump 0.34s ease-out' } : undefined}
    >
      <div className="flex items-center justify-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.12em] opacity-70">
        {heat.flames && <span aria-hidden="true" className="text-[11px] leading-none">{heat.flames}</span>}
        <span>{heat.label}</span>
      </div>
      <div className="font-display text-xl font-bold leading-none mt-1">{streak}</div>
    </div>
  )
}
