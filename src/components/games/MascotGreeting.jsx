import { getSubjectMascot } from './gamesUi'

const TILE_BG = {
  mathematics: 'bg-orange-100',
  english:     'bg-blue-100',
  science:     'bg-green-100',
  social:      'bg-yellow-100',
}

/**
 * Mascot-led splash that introduces a game on its "Ready?" start card.
 * Uses the hub's sticker style: white card with hard navy border + offset
 * shadow, square pastel mascot tile.
 */
export default function MascotGreeting({ game, intro = "Let's play together!" }) {
  const mascot = getSubjectMascot(game?.subject)
  const tileBg = TILE_BG[String(game?.subject || '').toLowerCase()] || 'bg-orange-100'

  return (
    <div className="zx-greeting zx-card relative mx-auto mb-6 flex max-w-md items-center gap-4 rounded-[18px] bg-white p-4 text-left">
      <span aria-hidden="true" className="zx-greeting-spark zx-greeting-spark-1">✨</span>

      <span
        role="img"
        aria-label={mascot.name}
        className={`zx-greeting-emoji grid h-16 w-16 shrink-0 place-items-center rounded-[14px] border-2 border-slate-900 text-[2.4rem] leading-none ${tileBg}`}
      >
        {mascot.emoji}
      </span>

      <div className="min-w-0">
        <p className="zx-eyebrow">Hi! I’m {mascot.name}</p>
        <p className="font-display mt-1 text-base font-bold leading-tight text-slate-900 sm:text-lg">
          {intro}
        </p>
        <p className="mt-1 text-sm font-medium leading-snug text-slate-700">
          {mascot.tagline}
        </p>
      </div>

      <style>{`
        .zx-greeting .zx-greeting-emoji {
          animation: zx-greet-wave 3.6s ease-in-out infinite;
          transform-origin: 50% 80%;
        }
        @keyframes zx-greet-wave {
          0%, 100% { transform: rotate(-4deg); }
          25%      { transform: rotate(6deg); }
          50%      { transform: rotate(-2deg); }
          75%      { transform: rotate(4deg); }
        }
        .zx-greeting .zx-greeting-spark {
          position: absolute;
          font-size: 1rem;
          top: 12%;
          left: 22%;
          opacity: 0.7;
          pointer-events: none;
          animation: zx-greet-twinkle 2.6s ease-in-out infinite;
        }
        @keyframes zx-greet-twinkle {
          0%, 100% { transform: scale(0.85); opacity: 0.35; }
          50%      { transform: scale(1.1);  opacity: 0.85; }
        }
        @media (prefers-reduced-motion: reduce) {
          .zx-greeting .zx-greeting-emoji,
          .zx-greeting .zx-greeting-spark { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
