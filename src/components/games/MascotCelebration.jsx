import { getSubjectMascot } from './gamesUi'

const TILE_BG = {
  mathematics: 'bg-orange-100',
  english:     'bg-blue-100',
  science:     'bg-green-100',
  social:      'bg-yellow-100',
}

/**
 * Celebrating subject mascot shown on every game-end "Done" screen.
 * Uses the hub's sticker style: white card with hard navy border + offset
 * shadow, square pastel mascot tile.
 */
export default function MascotCelebration({ game, accuracy = 0, score = 0 }) {
  const mascot = getSubjectMascot(game?.subject)
  const tileBg = TILE_BG[String(game?.subject || '').toLowerCase()] || 'bg-orange-100'
  const tier = pickTier(accuracy, score)

  return (
    <div className="zx-celebrate zx-card relative mx-auto mb-5 flex max-w-md items-center gap-4 rounded-[18px] bg-white px-4 py-4 text-left">
      <span aria-hidden="true" className="zx-celebrate-spark zx-celebrate-spark-1">✨</span>
      <span aria-hidden="true" className="zx-celebrate-spark zx-celebrate-spark-2">⭐</span>

      <span
        role="img"
        aria-label={mascot.name}
        className={`zx-celebrate-emoji grid h-16 w-16 shrink-0 place-items-center rounded-[14px] border-2 border-slate-900 text-[2.4rem] leading-none ${tileBg}`}
      >
        {mascot.emoji}
      </span>
      <div className="min-w-0">
        <p className="zx-eyebrow">{mascot.name} says</p>
        <p className="font-display mt-1 text-base font-bold leading-tight text-slate-900 sm:text-lg">
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
