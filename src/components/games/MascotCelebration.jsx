import { getSubjectMascot, getSubjectTheme } from './gamesUi'

/**
 * Celebrating subject mascot shown on every game-end "Done" screen.
 *
 * The mascot matches the subject of the game just played (so winning a
 * Maths round shows the Maths Fox, etc.) and the cheer line is tuned to
 * the player's accuracy so the message always feels earned.
 */
export default function MascotCelebration({ game, accuracy = 0, score = 0 }) {
  const mascot = getSubjectMascot(game?.subject)
  const theme = getSubjectTheme(game?.subject)
  const tier = pickTier(accuracy, score)

  return (
    <div className={`zx-celebrate relative mx-auto mb-5 flex max-w-md items-center gap-4 overflow-hidden rounded-[20px] border ${theme.border} bg-gradient-to-br ${theme.gradient} px-4 py-4 text-left shadow-[0_18px_44px_-30px_rgba(15,23,42,0.28)]`}>
      <div aria-hidden="true" className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full bg-white/45 blur-2xl" />
      <span aria-hidden="true" className="zx-celebrate-spark zx-celebrate-spark-1">✨</span>
      <span aria-hidden="true" className="zx-celebrate-spark zx-celebrate-spark-2">⭐</span>

      <span
        role="img"
        aria-label={mascot.name}
        className="zx-celebrate-emoji relative inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-[2.4rem] leading-none ring-4 ring-white/70 shadow-[0_14px_28px_-12px_rgba(15,23,42,0.32)]"
      >
        {mascot.emoji}
      </span>
      <div className="relative min-w-0">
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
          {mascot.name} says
        </p>
        <p className="mt-1 text-base font-black leading-tight text-slate-900 sm:text-lg">
          {tier.cheer}
        </p>
        <p className="mt-1 text-sm font-medium leading-snug text-slate-700">
          {tier.support}
        </p>
      </div>

      <style>{`
        .zx-celebrate .zx-celebrate-emoji {
          animation: zx-celebrate-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both,
                     zx-celebrate-bob 4.2s ease-in-out 0.55s infinite;
          transform-origin: center;
        }
        @keyframes zx-celebrate-pop {
          0%   { transform: scale(0.4) rotate(-12deg); opacity: 0; }
          70%  { transform: scale(1.12) rotate(6deg);  opacity: 1; }
          100% { transform: scale(1)    rotate(-2deg); opacity: 1; }
        }
        @keyframes zx-celebrate-bob {
          0%, 100% { transform: translateY(0)   rotate(-2deg); }
          50%      { transform: translateY(-3px) rotate(3deg); }
        }
        .zx-celebrate .zx-celebrate-spark {
          position: absolute;
          font-size: 1rem;
          opacity: 0.7;
          pointer-events: none;
          animation: zx-celebrate-twinkle 2.4s ease-in-out infinite;
        }
        .zx-celebrate .zx-celebrate-spark-1 { top: 12%; left: 22%; animation-delay: 0.2s; }
        .zx-celebrate .zx-celebrate-spark-2 { bottom: 18%; right: 14%; animation-delay: 1.1s; font-size: 0.9rem; }
        @keyframes zx-celebrate-twinkle {
          0%, 100% { transform: scale(0.8); opacity: 0.3; }
          50%      { transform: scale(1.15); opacity: 0.85; }
        }
        @media (prefers-reduced-motion: reduce) {
          .zx-celebrate .zx-celebrate-emoji,
          .zx-celebrate .zx-celebrate-spark { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

function pickTier(accuracy, score) {
  if (accuracy >= 90 || score >= 200) {
    return { cheer: 'Champion run! 🏆', support: 'You crushed it. Want to chase a perfect round next?' }
  }
  if (accuracy >= 70 || score >= 100) {
    return { cheer: 'Brilliant work!',  support: 'You are on a roll. One more round to lock in that streak?' }
  }
  if (accuracy >= 40 || score >= 40) {
    return { cheer: 'Good effort!',     support: 'Every round teaches you something new. Try again to climb higher.' }
  }
  return { cheer: 'Great try!',         support: 'Tricky round! Tap "Play again" — I believe in you.' }
}
