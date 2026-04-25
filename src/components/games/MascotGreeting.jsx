import { getSubjectMascot, getSubjectTheme } from './gamesUi'

/**
 * Mascot-led splash that introduces a game on its "Ready?" start card.
 *
 * The mascot matches the subject of the game (so the Maths Fox introduces
 * a Maths game, the Story Owl introduces an English game, etc.) and the
 * tagline is the same one used on the discovery cards, so kids learn to
 * recognise their guides across the experience.
 */
export default function MascotGreeting({ game, intro = "Let's play together!" }) {
  const mascot = getSubjectMascot(game?.subject)
  const theme = getSubjectTheme(game?.subject)

  return (
    <div className={`zx-greeting relative mx-auto mb-6 flex max-w-md items-center gap-4 overflow-hidden rounded-[20px] border ${theme.border} bg-gradient-to-br ${theme.gradient} p-4 text-left shadow-[0_18px_44px_-30px_rgba(15,23,42,0.28)]`}>
      <div aria-hidden="true" className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full bg-white/45 blur-2xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-6 -left-6 h-20 w-20 rounded-full bg-white/35 blur-2xl" />
      <span aria-hidden="true" className="zx-greeting-spark zx-greeting-spark-1">✨</span>

      <span
        role="img"
        aria-label={mascot.name}
        className="zx-greeting-emoji relative inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-[2.4rem] leading-none ring-4 ring-white/70 shadow-[0_14px_28px_-12px_rgba(15,23,42,0.32)]"
      >
        {mascot.emoji}
      </span>

      <div className="relative min-w-0">
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
          Hi! I’m {mascot.name}
        </p>
        <p className="mt-1 text-base font-black leading-tight text-slate-900 sm:text-lg">
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
