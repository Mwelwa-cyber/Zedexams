/**
 * Shared "sticker" styling that mirrors the GamesHub (first page) look:
 * white cards with a 2px navy border and a hard 2px offset shadow, an
 * uppercase eyebrow with an orange dash, and a tactile press-down on
 * sticker buttons. Mounted once inside GamesShell so every /games page
 * (hub, subject selector, game list, play surface) inherits the same
 * visual language.
 */
export default function GameStickerStyles() {
  return (
    <style>{`
      .zx-card {
        border: 2px solid #0F1B2D;
        box-shadow: 0 2px 0 #0F1B2D;
      }
      .learner-game-theme .zx-card {
        border-color: #050816;
        box-shadow:
          0 3px 0 #050816,
          0 18px 36px -28px rgba(0,0,0,0.9);
      }
      .learner-game-theme .zx-card:hover {
        box-shadow:
          0 2px 0 #050816,
          0 22px 42px -30px rgba(0,0,0,0.95);
      }
      .zx-card-dark {
        background: #0F172A;
        color: #fff;
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
        background: #D97757;
      }
      .zx-sticker-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-weight: 800;
        border: 2px solid #0F1B2D;
        box-shadow: 0 3px 0 #0F1B2D;
        transition: transform 80ms ease, box-shadow 80ms ease;
        will-change: transform;
      }
      .zx-sticker-btn:hover { transform: translateY(1px); box-shadow: 0 2px 0 #0F1B2D; }
      .zx-sticker-btn:active { transform: translateY(3px); box-shadow: 0 0 0 #0F1B2D; }
      .zx-sticker-btn:disabled {
        opacity: 0.55;
        transform: none;
        box-shadow: 0 3px 0 #0F1B2D;
        cursor: not-allowed;
      }
      .zx-sticker-btn-primary {
        background: #D97757;
        color: #fff;
      }
      .zx-sticker-btn-secondary {
        background: #fff;
        color: #0F1B2D;
      }
      .zx-sticker-btn-dark {
        background: #0F172A;
        color: #fff;
      }
      .zx-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        border: 2px solid #0F1B2D;
        background: #fff;
        font-size: 10.5px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #0F1B2D;
        box-shadow: 0 2px 0 #0F1B2D;
      }
      .zx-hscroll {
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
      }
      .zx-hscroll::-webkit-scrollbar { display: none; }
      .zx-mascot-tile span { display: inline-block; }
      @keyframes zx-question-in {
        0%   { transform: translateY(8px) scale(0.98); opacity: 0; }
        100% { transform: translateY(0)    scale(1);    opacity: 1; }
      }
      @keyframes zx-flame {
        0%, 100% { transform: scale(1) rotate(-2deg); filter: drop-shadow(0 0 4px rgba(209,118,49,0.4)); }
        50%      { transform: scale(1.15) rotate(2deg); filter: drop-shadow(0 0 8px rgba(209,118,49,0.7)); }
      }
      .zx-flame { animation: zx-flame 1.4s ease-in-out infinite; display: inline-block; }
      /* Game-feel juice: floating score deltas, answer reactions, combo bump. */
      @keyframes zx-score-pop {
        0%   { transform: translateY(6px) scale(0.7); opacity: 0; }
        25%  { transform: translateY(-4px) scale(1.15); opacity: 1; }
        100% { transform: translateY(-34px) scale(1); opacity: 0; }
      }
      @keyframes zx-combo-bump {
        0%   { transform: scale(1); }
        45%  { transform: scale(1.12); }
        100% { transform: scale(1); }
      }
      @keyframes zx-correct-pop {
        0%   { transform: scale(1); }
        40%  { transform: scale(1.04); }
        100% { transform: scale(1); }
      }
      .zx-correct-pop { animation: zx-correct-pop 0.32s ease-out; }
      @keyframes zx-shake {
        0%, 100% { transform: translateX(0); }
        20%      { transform: translateX(-7px); }
        40%      { transform: translateX(6px); }
        60%      { transform: translateX(-4px); }
        80%      { transform: translateX(3px); }
      }
      .zx-shake { animation: zx-shake 0.4s ease-in-out; }
      /* Class forms so the reduced-motion block below can disable them
         (inline-style animations can't be overridden by a media query). */
      .zx-anim-pop { animation: zx-score-pop 0.9s cubic-bezier(0.22,1,0.36,1) forwards; }
      .zx-anim-bump { animation: zx-combo-bump 0.34s ease-out; }
      @media (prefers-reduced-motion: reduce) {
        .zx-flame { animation: none !important; }
        .zx-correct-pop,
        .zx-shake,
        .zx-anim-pop,
        .zx-anim-bump { animation: none !important; }
      }
    `}</style>
  )
}
