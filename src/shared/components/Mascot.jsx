/**
 * Mascot — animated graduation-cap owl for ExamPrep Zambia.
 * Uses an inline SVG so no external assets are needed.
 *
 * Props:
 *   size      — pixel width/height (default 80)
 *   mood      — 'happy' | 'excited' | 'thinking' | 'star'
 *   animate   — true (default) enables the floating animation
 *   className — extra Tailwind classes on the wrapper
 */
export default function Mascot({ size = 80, mood = 'happy', animate = true, className = '' }) {
  return (
    <div
      className={`inline-block select-none ${animate ? 'animate-float' : ''} ${className}`}
      style={{ lineHeight: 0, width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 112" fill="none" xmlns="http://www.w3.org/2000/svg" width={size} height={size}>
        {/* Drop shadow */}
        <ellipse cx="50" cy="108" rx="20" ry="4" fill="rgba(0,0,0,0.12)" />

        {/* Body */}
        <ellipse cx="50" cy="74" rx="25" ry="27" fill="#16a34a" />
        {/* Belly patch */}
        <ellipse cx="50" cy="78" rx="15" ry="18" fill="#dcfce7" />
        {/* Belly stripes (cute detail) */}
        <path d="M42 71 Q50 74 58 71" stroke="#bbf7d0" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M41 77 Q50 80 59 77" stroke="#bbf7d0" strokeWidth="1.5" strokeLinecap="round" fill="none" />

        {/* Left wing */}
        <ellipse cx="26" cy="76" rx="9" ry="19" fill="#15803d" transform="rotate(-18 26 76)" />
        {/* Right wing */}
        <ellipse cx="74" cy="76" rx="9" ry="19" fill="#15803d" transform="rotate(18 74 76)" />

        {/* Head */}
        <circle cx="50" cy="40" r="26" fill="#16a34a" />

        {/* Ear tufts */}
        <path d="M28 22 L24 10 L35 18 Z" fill="#15803d" />
        <path d="M72 22 L76 10 L65 18 Z" fill="#15803d" />

        {/* Face patch */}
        <ellipse cx="50" cy="44" rx="18" ry="16" fill="#dcfce7" />

        {/* Left eye white */}
        <circle cx="40" cy="40" r="9.5" fill="white" />
        {/* Right eye white */}
        <circle cx="60" cy="40" r="9.5" fill="white" />

        {/* Left pupil */}
        <circle cx="40" cy="40" r={mood === 'excited' ? 6 : 5} fill="#1e293b" />
        {/* Right pupil */}
        <circle cx="60" cy="40" r={mood === 'excited' ? 6 : 5} fill="#1e293b" />

        {/* Eye shine left */}
        <circle cx="42.5" cy="37.5" r="2.2" fill="white" />
        {/* Eye shine right */}
        <circle cx="62.5" cy="37.5" r="2.2" fill="white" />

        {/* Small inner pupil */}
        <circle cx="40" cy="41" r="2" fill="#0f172a" />
        <circle cx="60" cy="41" r="2" fill="#0f172a" />

        {/* Beak */}
        <path d="M46 51 L50 58 L54 51 Z" fill="#fbbf24" />
        {/* Beak highlight */}
        <path d="M47 52 L50 54" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeLinecap="round" />

        {mood === 'thinking' && (
          /* thought dots */
          <>
            <circle cx="72" cy="25" r="2.5" fill="#fbbf24" className="animate-twinkle" />
            <circle cx="78" cy="18" r="3.5" fill="#fbbf24" />
            <circle cx="85" cy="10" r="5" fill="#fbbf24" />
          </>
        )}

        {/* ── Graduation cap ── */}
        {/* Board */}
        <rect x="28" y="15" width="44" height="7" rx="3.5" fill="#1e293b" />
        {/* Diamond top */}
        <polygon points="50,5 26,15 50,23 74,15" fill="#1e293b" />
        {/* Cap shine */}
        <polygon points="50,5 38,10 50,15 62,10" fill="rgba(255,255,255,0.08)" />
        {/* Tassel string */}
        <line x1="73" y1="15" x2="78" y2="27" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
        {/* Tassel ball */}
        <circle cx="78" cy="29" r="3.5" fill="#fbbf24" />
        {/* Tassel fringe */}
        <line x1="76" y1="29" x2="74" y2="34" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="78" y1="30" x2="78" y2="35" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="80" y1="29" x2="82" y2="34" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />

        {/* Feet */}
        <path d="M37 98 L33 104 M37 98 L37 104 M37 98 L41 104" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M63 98 L59 104 M63 98 L63 104 M63 98 L67 104" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />

        {/* Stars for 'star' mood */}
        {mood === 'star' && (
          <>
            <text x="14" y="54" fontSize="10" className="animate-twinkle">⭐</text>
            <text x="76" y="54" fontSize="10" className="animate-twinkle" style={{ animationDelay: '0.4s' }}>⭐</text>
          </>
        )}
      </svg>
    </div>
  )
}
