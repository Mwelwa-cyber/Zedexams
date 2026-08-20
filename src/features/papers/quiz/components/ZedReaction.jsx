/**
 * Zed reacting: celebrating, thinking, or oops.
 *
 * A placeholder for the commissioned 3D mascot poses — same box, same anchor,
 * so dropping the real art in is a file swap rather than a layout change. The
 * character is the platform's, not this feature's; it carries Race Zed, the
 * games hub, GradeHub art and the notes reader, and it was explicitly kept
 * when the Ask Zed chat assistant was removed.
 *
 * Only three poses, and there is deliberately no sad one. §3: nothing negative
 * ever animates, and `oops` is a head-scratch — the face a person makes at a
 * question they nearly had, not at a child who got it wrong.
 */

export default function ZedReaction({ pose = 'neutral', className = 'pq-zed' }) {
  const mouth = pose === 'celebrate'
    ? <path d="M20 34c3 4 9 4 12 0" stroke="#0f1e4a" strokeWidth="3" strokeLinecap="round" fill="none" />
    : pose === 'oops'
      ? <path d="M20 36c3-3 9-3 12 0" stroke="#0f1e4a" strokeWidth="3" strokeLinecap="round" fill="none" />
      : <path d="M21 34h10" stroke="#0f1e4a" strokeWidth="3" strokeLinecap="round" />

  return (
    <svg className={className} viewBox="0 0 52 52" width="100%" height="100%" aria-hidden="true" focusable="false">
      <rect x="4" y="6" width="44" height="40" rx="14" fill="#2b3fa8" />
      <rect x="9" y="11" width="34" height="26" rx="10" fill="#eaf0ff" />
      <circle cx="20" cy="24" r="3.4" fill="#0f1e4a" />
      <circle cx="32" cy="24" r="3.4" fill="#0f1e4a" />
      {mouth}
      <path d="M22 42h8l-4 6z" fill="#ff7a3c" />
      <path d="M26 2v5" stroke="#ff7a3c" strokeWidth="3" strokeLinecap="round" />
      <circle cx="26" cy="2.4" r="2.4" fill="#ff7a3c" />
    </svg>
  )
}
