/**
 * MobileMoneyMark — the network badge on a mobile-money picker.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * The checkout used to offer three identical white buttons reading "MTN
 * MoMo", "Airtel Money" and "Zamtel Kwacha". At phone width those three
 * labels are squeezed into a third of the screen each, so the row reads
 * as a wall of small bold text and nothing about it says "this is where
 * you choose how to pay". A payment method is recognised by its COLOUR
 * long before its name is read — which is exactly why every checkout in
 * the world puts a card scheme's mark on the button rather than the
 * words "Mastercard".
 *
 * ── What these are, and are not ────────────────────────────────────
 *
 * They are brand-COLOURED marks drawn from the network's own palette and
 * carrying the network's name. They are deliberately NOT reproductions
 * of MTN's, Airtel's or Zamtel's official logo artwork: we do not hold
 * those files, a traced imitation is worse than an honest one, and the
 * thing a parent needs at this moment is to tell the three apart, which
 * colour does. If the operators' official marks are ever supplied under
 * the merchant agreements, swapping them in means replacing the `<svg>`
 * bodies here and nothing else — every caller asks for a mark by
 * operator id.
 *
 * Drawn INLINE rather than loaded from `/assets`. Three reasons, and the
 * last one is the one that matters: an `<img>` is a network request on
 * the slowest screen in the product; a file under `public/` is not
 * present in the Capacitor bundle's origin the way an imported module
 * is; and a payment method that renders as a broken-image icon on a bad
 * connection is worse than one that renders as text.
 *
 * ── Contrast ───────────────────────────────────────────────────────
 *
 * Each mark carries its own background, so it reads the same in Night
 * mode as in day and needs no theme token. The text/ground pairs are
 * chosen for legibility rather than for exactness: black on MTN yellow
 * (18.7:1) and white on both Airtel red (5.3:1) and Zamtel green
 * (4.6:1), all above the 4.5:1 the rest of the product holds to.
 */

const MARKS = {
  mtn: { ground: '#FFCB05', ink: '#111111', text: 'MTN', title: 'MTN MoMo' },
  airtel: { ground: '#E40000', ink: '#FFFFFF', text: 'airtel', title: 'Airtel Money' },
  zamtel: { ground: '#009A44', ink: '#FFFFFF', text: 'zamtel', title: 'Zamtel Kwacha' },
}

/** True when this build can draw a mark for the operator id. */
export function hasMobileMoneyMark(operatorId) {
  return Object.prototype.hasOwnProperty.call(MARKS, String(operatorId || ''))
}

/**
 * @param {{operator: string, className?: string}} props
 *
 * `aria-hidden`, always. The mark repeats the network name that the
 * label beside it already carries, and a screen reader announcing
 * "MTN MTN MoMo" is worse than one announcing the label alone. An
 * operator this build has no mark for renders nothing at all rather
 * than an empty coloured box — the caller's text label still names it.
 */
export default function MobileMoneyMark({ operator, className = '' }) {
  const mark = MARKS[String(operator || '')]
  if (!mark) return null

  return (
    <svg
      className={`zx-momo-mark ${className}`.trim()}
      viewBox="0 0 96 56"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width="96" height="56" rx="12" fill={mark.ground} />
      <text
        x="48"
        y="28"
        fill={mark.ink}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="22"
        fontWeight="900"
        fontFamily="inherit"
        letterSpacing="-0.5"
      >
        {mark.text}
      </text>
    </svg>
  )
}
