/**
 * Pure "game feel" helpers shared by the game engines.
 *
 * These describe the moment-to-moment juice — how a streak should look as it
 * heats up, and what a score delta should look like as it pops. Keeping the
 * logic pure (no React, no DOM) means it can be unit-tested in plain Node
 * (see scripts/test-game-feel.mjs) and reused across every engine.
 */

/**
 * Map a live answer streak to a visual "heat" tier. The combo pill and the
 * streak sound both read off this so they escalate together: the longer the
 * run, the hotter and louder it feels.
 *
 * @param {number} streak current consecutive-correct count
 * @returns {{
 *   tier: 'cold'|'warm'|'hot'|'blaze',
 *   level: number,        // 0..3, handy for sound + intensity scaling
 *   flames: string,       // 🔥 repeated by tier (or '' when cold)
 *   bg: string,           // tailwind bg class for the pill
 *   ring: string,         // tailwind ring class (glow)
 *   text: string,         // tailwind text colour class
 *   label: string,        // short caption ('Streak' when cold, 'On fire!' …)
 *   active: boolean,      // true once the combo is worth celebrating
 * }}
 */
export function comboHeat(streak) {
  const n = Math.max(0, Math.floor(Number(streak) || 0))

  if (n < 2) {
    return {
      tier: 'cold',
      level: 0,
      flames: '',
      bg: 'bg-emerald-100',
      ring: 'ring-0 ring-transparent',
      text: 'text-slate-900',
      label: 'Streak',
      active: false,
    }
  }
  if (n < 4) {
    return {
      tier: 'warm',
      level: 1,
      flames: '🔥',
      bg: 'bg-amber-100',
      ring: 'ring-2 ring-amber-300/70',
      text: 'text-amber-900',
      label: 'Heating up',
      active: true,
    }
  }
  if (n < 7) {
    return {
      tier: 'hot',
      level: 2,
      flames: '🔥🔥',
      bg: 'bg-orange-200',
      ring: 'ring-2 ring-orange-400/80',
      text: 'text-orange-900',
      label: 'On fire!',
      active: true,
    }
  }
  return {
    tier: 'blaze',
    level: 3,
    flames: '🔥🔥🔥',
    bg: 'bg-rose-200',
    ring: 'ring-4 ring-rose-400/80',
    text: 'text-rose-900',
    label: 'Unstoppable!',
    active: true,
  }
}

/**
 * Format a score delta for a floating "+N" / "−N" pop. Zero deltas return an
 * empty label so callers can skip rendering them.
 *
 * @param {number} delta points gained (positive) or lost (negative)
 * @returns {{ text: string, tone: 'gain'|'loss'|'none' }}
 */
export function scorePopLabel(delta) {
  const d = Math.round(Number(delta) || 0)
  if (d > 0) return { text: `+${d}`, tone: 'gain' }
  if (d < 0) return { text: `${d}`, tone: 'loss' }
  return { text: '', tone: 'none' }
}
