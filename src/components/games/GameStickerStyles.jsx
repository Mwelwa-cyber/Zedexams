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
        background: #FF7A1A;
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
        background: #FF7A1A;
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
        0%, 100% { transform: scale(1) rotate(-2deg); filter: drop-shadow(0 0 4px rgba(255,140,0,0.4)); }
        50%      { transform: scale(1.15) rotate(2deg); filter: drop-shadow(0 0 8px rgba(255,140,0,0.7)); }
      }
      .zx-flame { animation: zx-flame 1.4s ease-in-out infinite; display: inline-block; }
      @media (prefers-reduced-motion: reduce) {
        .zx-flame { animation: none !important; }
      }
    `}</style>
  )
}
