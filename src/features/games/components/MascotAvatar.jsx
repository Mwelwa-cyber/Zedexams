import { getSubjectMascot } from '../lib/subjectMascots'

/**
 * Subject mascots as inline-SVG characters — a consistent illustrated cast
 * that replaces the raw emoji.
 *
 * Why SVG and not emoji or raster art:
 *   - Emoji render differently on every OS/device and read as placeholder.
 *   - Raster art means binary assets + bandwidth, bad for data-saver users.
 *   - Inline SVG is featherweight, pixel-crisp at any size, identical on
 *     every device, and inherits whatever animation the parent tile applies
 *     (the greeting waves, the celebration pops, hub tiles sit still).
 *
 * The four core games subjects (mathematics / english / science / social)
 * have hand-built characters drawn in one shared sticker style — flat fills,
 * navy outlines, big friendly eyes, rosy cheeks. Any other subject falls back
 * to its emoji so nothing ever renders blank.
 */

const NAVY = '#102033'

// Subjects that have a drawn character (the rest fall back to emoji).
export const MASCOT_ART_SLUGS = new Set(['mathematics', 'english', 'science', 'social'])

export function hasMascotArt(slug) {
  return MASCOT_ART_SLUGS.has(String(slug || '').toLowerCase())
}

/** Shared cute face: two eyes with highlights, rosy cheeks, a soft smile. */
function Face({ cx = 32, cy = 33, spread = 7, eyeY = -2, mouthY = 6, cheekY = 4 }) {
  const lx = cx - spread
  const rx = cx + spread
  const ey = cy + eyeY
  return (
    <g>
      <circle cx={lx} cy={ey} r="2.5" fill={NAVY} />
      <circle cx={rx} cy={ey} r="2.5" fill={NAVY} />
      <circle cx={lx + 0.9} cy={ey - 0.9} r="0.8" fill="#fff" />
      <circle cx={rx + 0.9} cy={ey - 0.9} r="0.8" fill="#fff" />
      <circle cx={lx - 2.4} cy={cy + cheekY} r="2.3" fill="#FB7185" opacity="0.5" />
      <circle cx={rx + 2.4} cy={cy + cheekY} r="2.3" fill="#FB7185" opacity="0.5" />
      <path
        d={`M${cx - 4} ${cy + mouthY} Q${cx} ${cy + mouthY + 4} ${cx + 4} ${cy + mouthY}`}
        fill="none"
        stroke={NAVY}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </g>
  )
}

function FoxArt() {
  const body = '#CE7452'
  const dark = '#A3422E'
  return (
    <g stroke={NAVY} strokeWidth="2" strokeLinejoin="round">
      {/* ears */}
      <path d="M15 19 L21 5 L30 18 Z" fill={body} />
      <path d="M49 19 L43 5 L34 18 Z" fill={body} />
      <path d="M19.5 15 L22 8.5 L26 15 Z" fill={dark} stroke="none" />
      <path d="M44.5 15 L42 8.5 L38 15 Z" fill={dark} stroke="none" />
      {/* head */}
      <circle cx="32" cy="33" r="17" fill={body} />
      {/* white muzzle */}
      <ellipse cx="32" cy="40" rx="12" ry="9" fill="#fff" strokeWidth="1.6" />
      {/* nose */}
      <path d="M29.4 36.5 L34.6 36.5 L32 40 Z" fill={NAVY} stroke="none" />
      <g strokeWidth="0">
        <Face cx={32} cy={32} spread={7} eyeY={-1} mouthY={9} cheekY={7} />
      </g>
    </g>
  )
}

function OwlArt() {
  const body = '#3B82F6'
  const dark = '#2563EB'
  const belly = '#DBEAFE'
  const beak = '#F59E0B'
  return (
    <g stroke={NAVY} strokeWidth="2" strokeLinejoin="round">
      {/* ear tufts */}
      <path d="M18 14 L22 4 L28 13 Z" fill={dark} />
      <path d="M46 14 L42 4 L36 13 Z" fill={dark} />
      {/* body */}
      <path d="M32 11 C19 11 14 22 14 33 C14 45 22 53 32 53 C42 53 50 45 50 33 C50 22 45 11 32 11 Z" fill={body} />
      {/* belly */}
      <ellipse cx="32" cy="41" rx="11" ry="11" fill={belly} stroke="none" />
      {/* big eyes */}
      <circle cx="25" cy="29" r="7.5" fill="#fff" strokeWidth="1.6" />
      <circle cx="39" cy="29" r="7.5" fill="#fff" strokeWidth="1.6" />
      <circle cx="25.5" cy="29.5" r="3.2" fill={NAVY} stroke="none" />
      <circle cx="38.5" cy="29.5" r="3.2" fill={NAVY} stroke="none" />
      <circle cx="26.7" cy="28.3" r="1.1" fill="#fff" stroke="none" />
      <circle cx="39.7" cy="28.3" r="1.1" fill="#fff" stroke="none" />
      {/* beak */}
      <path d="M29 33.5 L35 33.5 L32 39.5 Z" fill={beak} strokeWidth="1.4" />
      {/* cheeks */}
      <circle cx="18.5" cy="36" r="2.3" fill="#FB7185" opacity="0.5" stroke="none" />
      <circle cx="45.5" cy="36" r="2.3" fill="#FB7185" opacity="0.5" stroke="none" />
    </g>
  )
}

function TurtleArt() {
  const shell = '#15A34A'
  const shellLight = '#86EFAC'
  const skin = '#34D399'
  return (
    <g stroke={NAVY} strokeWidth="2" strokeLinejoin="round">
      {/* feet */}
      <ellipse cx="15" cy="44" rx="5" ry="3.3" fill={skin} />
      <ellipse cx="49" cy="44" rx="5" ry="3.3" fill={skin} />
      {/* head */}
      <circle cx="32" cy="46" r="7" fill={skin} />
      {/* shell dome */}
      <path d="M11 40 A21 21 0 0 1 53 40 Z" fill={shell} />
      {/* shell inner */}
      <path d="M18 40 A14 14 0 0 1 46 40 Z" fill={shellLight} stroke="none" />
      {/* shell segments */}
      <path d="M32 40 L32 20" strokeWidth="1.4" fill="none" />
      <path d="M24 40 L21 27" strokeWidth="1.4" fill="none" />
      <path d="M40 40 L43 27" strokeWidth="1.4" fill="none" />
      {/* face on the head */}
      <g strokeWidth="0">
        <circle cx="29.5" cy="45" r="1.7" fill={NAVY} />
        <circle cx="34.5" cy="45" r="1.7" fill={NAVY} />
        <circle cx="30" cy="44.4" r="0.5" fill="#fff" />
        <circle cx="35" cy="44.4" r="0.5" fill="#fff" />
        <path d="M30 48.5 Q32 50.5 34 48.5" fill="none" stroke={NAVY} strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </g>
  )
}

function LionArt() {
  const face = '#FBBF24'
  const mane = '#F59E0B'
  const maneDark = '#D97706'
  // A dense fluffy mane: many small overlapping tufts ringing the face, so it
  // reads as fur rather than the wide-spaced petals of a flower. Two stroked
  // discs behind give the ring depth; the face disc sits on top.
  const cx = 32
  const cy = 33
  const tufts = []
  const count = 13
  const ringR = 14.8
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count - Math.PI / 2
    tufts.push({ x: cx + ringR * Math.cos(a), y: cy + ringR * Math.sin(a) })
  }
  return (
    <g stroke={NAVY} strokeWidth="2" strokeLinejoin="round">
      {/* mane tufts (stroked, so the outer edge is scalloped fur) */}
      {tufts.map((t, i) => (
        <circle key={i} cx={t.x.toFixed(1)} cy={t.y.toFixed(1)} r="3.6" fill={mane} />
      ))}
      {/* base discs unify the tufts into one mane */}
      <circle cx={cx} cy={cy} r="14" fill={maneDark} stroke="none" />
      <circle cx={cx} cy={cy} r="12.8" fill={mane} stroke="none" />
      {/* ears peeking through the mane */}
      <circle cx="22" cy="22" r="3" fill={maneDark} />
      <circle cx="42" cy="22" r="3" fill={maneDark} />
      {/* face */}
      <circle cx={cx} cy={cy} r="11.5" fill={face} />
      {/* muzzle + nose */}
      <ellipse cx="32" cy="35" rx="6.5" ry="4.5" fill="#FDE68A" stroke="none" />
      <path d="M29.8 33.5 L34.2 33.5 L32 36 Z" fill={NAVY} stroke="none" />
      <g strokeWidth="0">
        <circle cx="26.5" cy="31" r="2.4" fill={NAVY} />
        <circle cx="37.5" cy="31" r="2.4" fill={NAVY} />
        <circle cx="27.4" cy="30.1" r="0.8" fill="#fff" />
        <circle cx="38.4" cy="30.1" r="0.8" fill="#fff" />
        <circle cx="22.5" cy="35" r="2.1" fill="#FB7185" opacity="0.5" />
        <circle cx="41.5" cy="35" r="2.1" fill="#FB7185" opacity="0.5" />
        <path d="M32 36 Q32 39 29.5 39" fill="none" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M32 36 Q32 39 34.5 39" fill="none" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </g>
  )
}

const ART = {
  mathematics: FoxArt,
  english: OwlArt,
  science: TurtleArt,
  social: LionArt,
}

/**
 * Render a subject mascot. Fills its parent box, so wrap it in the same
 * pastel tile the emoji used.
 *
 * @param {string} slug subject slug (mathematics / english / science / social / …)
 * @param {string} className sizing classes for the <svg> (default fills parent)
 */
export default function MascotAvatar({ slug, className = 'h-full w-full', title }) {
  const key = String(slug || '').toLowerCase()
  const Art = ART[key]
  const mascot = getSubjectMascot(key)
  const label = title || mascot.name

  if (!Art) {
    // Unknown subject — keep the existing emoji so nothing renders blank.
    return (
      <span role="img" aria-label={label} className={`grid place-items-center text-4xl leading-none ${className}`}>
        {mascot.emoji}
      </span>
    )
  }

  return (
    <svg
      viewBox="0 0 64 64"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={label}
      style={{ display: 'block' }}
    >
      <Art />
    </svg>
  )
}
