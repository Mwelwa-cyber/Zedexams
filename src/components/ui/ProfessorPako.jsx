/**
 * Zed — friendly robot mascot for ZedExams ("Ask Zed").
 *
 * Props:
 *   size    — pixel width/height of the SVG (default 100)
 *   mood    — 'normal' | 'happy' | 'thinking' | 'excited' | 'tip'
 *   animate — true = floating animation (respects data-saver)
 *   className — additional wrapper classes
 *
 * Component name kept as ProfessorPako to preserve existing imports.
 */
import { useDataSaver } from '../../contexts/DataSaverContext'

export default function ProfessorPako({ size = 100, mood = 'normal', animate = true, className = '' }) {
  const { dataSaver } = useDataSaver()
  const shouldAnimate = animate && !dataSaver

  const bubbleSymbol = {
    normal:  '?',
    happy:   '!',
    thinking:'…',
    excited: '★',
    tip:     'i',
  }[mood] ?? '?'

  // A slightly wider grin when excited or happy
  const mouthPath = {
    normal:  'M52 65 Q64 76 76 65 Q64 72 52 65Z',
    happy:   'M50 64 Q64 79 78 64 Q64 73 50 64Z',
    thinking:'M58 68 Q64 72 70 68 Q64 70 58 68Z',
    excited: 'M48 63 Q64 82 80 63 Q64 75 48 63Z',
    tip:     'M52 65 Q64 76 76 65 Q64 72 52 65Z',
  }[mood] ?? 'M52 65 Q64 76 76 65 Q64 72 52 65Z'

  return (
    <div
      className={`inline-block select-none ${shouldAnimate ? 'animate-float' : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 140 140"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Zed the robot mascot"
        role="img"
      >
        {/* ── BODY (torso) ─────────────────────────────────── */}
        <rect x="34" y="94" width="60" height="38" rx="14" fill="#FAFAFA" stroke="#1F2937" strokeWidth="2" />
        {/* Lower-belly soft blue shading */}
        <path
          d="M34 116 L94 116 L94 122 Q94 132 80 132 L48 132 Q34 132 34 122Z"
          fill="#DBEAFE"
          opacity="0.55"
        />
        {/* Belly badge */}
        <rect x="58" y="114" width="12" height="8" rx="2" fill="#F59E0B" stroke="#B45309" strokeWidth="1" />

        {/* ── NECK (between head and body) ─────────────────── */}
        <rect x="54" y="86" width="20" height="10" rx="3" fill="#1F2937" />
        <rect x="54" y="86" width="20" height="3" rx="1.5" fill="#374151" />

        {/* ── HEAD (white dome) ────────────────────────────── */}
        <ellipse cx="64" cy="56" rx="42" ry="34" fill="#FAFAFA" stroke="#1F2937" strokeWidth="2" />
        {/* Soft blue under-shading on head */}
        <ellipse cx="64" cy="78" rx="38" ry="11" fill="#DBEAFE" opacity="0.5" />

        {/* ── VISOR / FACE SCREEN ──────────────────────────── */}
        <rect x="28" y="46" width="72" height="30" rx="14" fill="#1F2937" />
        <rect x="28" y="46" width="72" height="6" rx="3" fill="#374151" opacity="0.7" />
        {/* Subtle screen highlight */}
        <ellipse cx="44" cy="54" rx="10" ry="2.5" fill="#4B5563" opacity="0.55" />

        {/* ── EYES (closed smile arcs ^_^) ─────────────────── */}
        <path
          d="M40 60 Q48 52 56 60"
          stroke="#FBBF24"
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M72 60 Q80 52 88 60"
          stroke="#FBBF24"
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
        />

        {/* ── MOUTH (smile inside visor) ───────────────────── */}
        <path d={mouthPath} fill="#FAFAFA" />

        {/* ── ROSY CHEEKS (on white head, below visor) ─────── */}
        <ellipse cx="30" cy="80" rx="4" ry="2.8" fill="#FCA5A5" opacity="0.85" />
        <ellipse cx="98" cy="80" rx="4" ry="2.8" fill="#FCA5A5" opacity="0.85" />

        {/* ── ANTENNA (drawn after head so stalk attaches) ─── */}
        <line x1="60" y1="11" x2="60" y2="24" stroke="#4B5563" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="60" cy="9" r="5.5" fill="#F59E0B" stroke="#B45309" strokeWidth="1.2" />
        <circle cx="58.4" cy="7.4" r="1.7" fill="#FCD34D" />

        {/* ── LEFT ARM (resting at side) ───────────────────── */}
        <ellipse cx="28" cy="110" rx="9" ry="12" fill="#FAFAFA" stroke="#1F2937" strokeWidth="2" />

        {/* ── RIGHT ARM (waving up) ────────────────────────── */}
        <path
          d="M92 98 Q106 90 110 76"
          stroke="#1F2937"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse cx="112" cy="72" rx="9.5" ry="10.5" fill="#FAFAFA" stroke="#1F2937" strokeWidth="2" />
        {/* Tiny thumb detail on the mitten hand */}
        <path
          d="M104 74 Q102 78 105 81"
          stroke="#1F2937"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />

        {/* ── LEGS / FEET ──────────────────────────────────── */}
        <rect x="46" y="130" width="14" height="10" rx="3.5" fill="#1F2937" />
        <rect x="68" y="130" width="14" height="10" rx="3.5" fill="#1F2937" />

        {/* ── SPEECH BUBBLE (signature "Ask Zed" cue) ──────── */}
        <ellipse cx="118" cy="26" rx="14" ry="11" fill="#FAFAFA" stroke="#1F2937" strokeWidth="2" />
        <path
          d="M108 32 L100 40 L112 35Z"
          fill="#FAFAFA"
          stroke="#1F2937"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Cover bubble outline where tail joins, so it reads as one shape */}
        <path d="M109 33 L112 35" stroke="#FAFAFA" strokeWidth="2.4" strokeLinecap="round" />
        <text
          x="118"
          y="31"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fill="#F59E0B"
          fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        >
          {bubbleSymbol}
        </text>

        {/* ── MOOD ACCESSORIES ─────────────────────────────── */}
        {mood === 'excited' && (
          <>
            <path d="M14 50 L10 46 M14 56 L8 56 M14 62 L10 66" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
            <path d="M132 100 L136 96 M134 106 L138 106" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
            {/* Extra sparkle near antenna */}
            <path d="M76 12 L80 8 M78 16 L82 16" stroke="#FBBF24" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
        {mood === 'thinking' && (
          <>
            <circle cx="22" cy="34" r="3" fill="#E0E7FF" stroke="#6366F1" strokeWidth="1.4" />
            <circle cx="14" cy="26" r="2.2" fill="#E0E7FF" stroke="#6366F1" strokeWidth="1.4" />
          </>
        )}
        {mood === 'tip' && (
          <circle cx="60" cy="9" r="9" fill="#FBBF24" opacity="0.25" />
        )}
      </svg>
    </div>
  )
}
