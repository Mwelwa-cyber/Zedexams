/**
 * The cover illustration: a stack of books, a marked paper with an A+, and a
 * pencil.
 *
 * §1b: the cover "has to sell sitting a 90-minute exam to a 12-year-old, so it
 * is illustrated rather than plain". Inline SVG built from the palette so it
 * survives Night mode — swap it for commissioned art later, same box, same
 * anchor.
 *
 * The literal hexes here are the ILLUSTRATION's own palette, not UI colour.
 * §8's "no hex in these components" rule is about chrome that has to answer to
 * a theme; a drawing's fills are its content, the way a photograph's are, and
 * routing them through tokens would mean every token change silently
 * redrawing a picture nobody asked to change. They are drawn from the same
 * indigo/coral family so the drawing reads as part of the palette either way.
 */

export default function CoverArt({ className = 'pq-art' }) {
  return (
    <div className={className}>
      <svg viewBox="0 0 240 210" width="100%" height="auto" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="pq-art-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6d4fe0" /><stop offset="1" stopColor="#4b33c4" />
          </linearGradient>
          <linearGradient id="pq-art-b" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff8a4c" /><stop offset="1" stopColor="#f4622c" />
          </linearGradient>
          <linearGradient id="pq-art-c" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c5bea" /><stop offset="1" stopColor="#5636ce" />
          </linearGradient>
        </defs>

        <g stroke="#ff7a3c" strokeWidth="4" strokeLinecap="round" opacity=".9">
          <path d="M60 42 L56 26" /><path d="M78 36 L82 22" /><path d="M45 58 L34 52" />
        </g>

        <g>
          <rect x="34" y="122" width="98" height="24" rx="6" fill="url(#pq-art-c)" />
          <rect x="34" y="122" width="9" height="24" rx="4" fill="#3b23a8" opacity=".55" />
          <text x="49" y="138" fontFamily="Nunito, sans-serif" fontSize="10.5" fontWeight="800" fill="#fff">SUCCEED</text>

          <rect x="39" y="98" width="98" height="24" rx="6" fill="url(#pq-art-b)" />
          <rect x="39" y="98" width="9" height="24" rx="4" fill="#c7431b" opacity=".5" />
          <text x="54" y="114" fontFamily="Nunito, sans-serif" fontSize="10.5" fontWeight="800" fill="#fff">LEARN</text>

          <rect x="44" y="74" width="98" height="24" rx="6" fill="url(#pq-art-a)" />
          <rect x="44" y="74" width="9" height="24" rx="4" fill="#33208f" opacity=".55" />
          <text x="59" y="90" fontFamily="Nunito, sans-serif" fontSize="10.5" fontWeight="800" fill="#fff">PRACTICE</text>
          <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".8">
            <path d="M115 82h5" /><path d="M117.5 84.5v-5" />
          </g>
        </g>

        <g transform="rotate(58 196 150)">
          <rect x="150" y="142" width="80" height="14" rx="3" fill="#ffc24d" />
          <rect x="150" y="149" width="80" height="7" rx="2" fill="#f0a824" />
          <path d="M150 142l-13 7 13 7z" fill="#f6e3c6" />
          <path d="M141 147l-4 2 4 2z" fill="#3a3350" />
          <rect x="220" y="142" width="7" height="14" fill="#c9c4da" />
          <rect x="227" y="142" width="10" height="14" rx="3" fill="#ff7a8a" />
        </g>

        <g transform="rotate(6 178 92)">
          <path d="M124 18h92a6 6 0 016 6v124a6 6 0 01-6 6h-92a6 6 0 01-6-6V24a6 6 0 016-6z" fill="#ffffff" />
          <path d="M216 18l12 12h-12z" fill="#e3ddf6" />
          <text x="131" y="43" fontFamily="Nunito, sans-serif" fontSize="12.5" fontWeight="800" fill="#2a2160">PAPER</text>
          <rect x="131" y="50" width="52" height="3" rx="1.5" fill="#d9d2f2" />
          <circle cx="203" cy="41" r="12.5" fill="none" stroke="#ff7a3c" strokeWidth="3" />
          <text x="203" y="46" textAnchor="middle" fontFamily="Nunito, sans-serif" fontSize="12" fontWeight="900" fill="#ff7a3c">A+</text>
          {[72, 100, 128].map((y, i) => (
            <g key={y}>
              <rect x="131" y={y} width="14" height="14" rx="4" fill="none" stroke="#6d4fe0" strokeWidth="2.6" />
              <path d={`M134.4 ${y + 7.2}l2.4 2.4 5-5`} stroke="#6d4fe0" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="152" y={y + 3} width={60 - i * 6} height="3.4" rx="1.7" fill="#dcd6f4" />
              {i < 2 && <rect x="152" y={y + 10} width={42 - i * 5} height="3.4" rx="1.7" fill="#eae6fa" />}
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
