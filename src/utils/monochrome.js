/**
 * monochrome — will this paper still be readable after it is printed? (§4.2)
 *
 * The brief asks for black-and-white legibility to be *verified*. That matters
 * more here than the phrasing suggests: most Zambian schools print monochrome,
 * and a class set is usually one printed master run through a photocopier
 * thirty times. Every generation loses contrast. A mid-grey that looks fine on
 * a backlit screen can be close to invisible on the sheet a learner receives.
 *
 * So colour is not the only question — luminance is. This module reduces a
 * colour to the grey a monochrome printer will render it as, and answers
 * whether that grey still stands out from what is behind it.
 *
 * The numbers are WCAG's contrast ratios. They were written for screens, but
 * the quantity they measure — relative luminance separation — is exactly what
 * survives a greyscale conversion, and they are the only widely-agreed
 * thresholds for "can a person actually read this". A photocopy is worse than
 * the model assumes, which is a reason to treat them as a floor rather than a
 * target.
 *
 * Pure: no DOM, no canvas. Parsing a colour and comparing two of them is
 * arithmetic, so it runs in the plain-node tests and can be called from the
 * exporters without dragging a browser in.
 */

/** WCAG AA for body text, and our floor for anything a learner must read. */
export const TEXT_MIN_RATIO = 4.5

/**
 * WCAG AA for large text (18pt+, or 14pt bold). Papers use this for headings.
 */
export const LARGE_TEXT_MIN_RATIO = 3

/**
 * WCAG's non-text minimum, for rules, borders, leader lines and figure strokes.
 * A line is recognisable at lower contrast than a letterform is.
 */
export const LINE_MIN_RATIO = 3

/** The sheet itself. Everything is measured against this unless stated. */
export const PAPER_WHITE = '#ffffff'

const HEX_SHORT = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX_FULL = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const RGB_FN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i

/**
 * Parse a colour to 0-255 channels, or null when it is not one we can measure.
 *
 * Accepts `#abc`, `#aabbcc`, a bare `aabbcc` (which is how `docx` wants it) and
 * `rgb()`/`rgba()`. A named colour returns null rather than a guess: reporting
 * "unmeasurable" is honest, and silently treating `rebeccapurple` as black
 * would pass a check it was never actually tested against.
 */
export function parseColor(color) {
  const s = String(color == null ? '' : color).trim()
  if (!s) return null
  let m = HEX_FULL.exec(s)
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
  m = HEX_SHORT.exec(s)
  if (m) return m.slice(1, 4).map(h => parseInt(h + h, 16))
  m = RGB_FN.exec(s)
  if (m) {
    const ch = m.slice(1, 4).map(n => Math.max(0, Math.min(255, Math.round(Number(n)))))
    return ch.every(Number.isFinite) ? ch : null
  }
  return null
}

/** sRGB channel → linear light. */
function toLinear(channel) {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * Relative luminance, 0 (black) to 1 (white).
 *
 * This IS the greyscale conversion a monochrome printer performs — the weights
 * are the eye's sensitivity to each primary, which is why a saturated green
 * prints far lighter than a blue of the same nominal "darkness".
 */
export function relativeLuminance(color) {
  const rgb = parseColor(color)
  if (!rgb) return null
  const [r, g, b] = rgb.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * The 0-255 grey a monochrome printer renders this colour as. Reported rather
 * than used internally: a teacher asking "why did my red arrow vanish" is
 * answered by "it prints as this grey", not by a luminance in the abstract.
 */
export function printedGrey(color) {
  const l = relativeLuminance(color)
  if (l == null) return null
  // Back to sRGB so the number means something next to the original hex.
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055
  return Math.round(c * 255)
}

/**
 * WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white).
 * null when either colour cannot be measured.
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (la == null || lb == null) return null
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** The floor a given role has to clear. */
export function minRatioFor(role) {
  if (role === 'line' || role === 'largeText') return role === 'line' ? LINE_MIN_RATIO : LARGE_TEXT_MIN_RATIO
  return TEXT_MIN_RATIO
}

/**
 * Does this ink survive being printed?
 *
 * @param {object} args
 * @param {string} args.color the ink
 * @param {string} [args.on]  what it sits on (default: the paper)
 * @param {'text'|'largeText'|'line'} [args.role]
 * @returns {{ok: boolean, ratio: number|null, required: number,
 *   grey: number|null, measurable: boolean}}
 */
export function inkSurvivesPrint({ color, on = PAPER_WHITE, role = 'text' } = {}) {
  const required = minRatioFor(role)
  const ratio = contrastRatio(color, on)
  if (ratio == null) {
    // Unmeasurable is not the same as failing. It is reported so a caller can
    // decide, rather than being quietly counted as a pass.
    return { ok: false, ratio: null, required, grey: null, measurable: false }
  }
  return {
    ok: ratio >= required,
    ratio: Math.round(ratio * 100) / 100,
    required,
    grey: printedGrey(color),
    measurable: true,
  }
}

/**
 * A plain-language note for ink that will not survive the printer. '' when
 * there is nothing to say.
 *
 * A teacher reads this, so it talks about the photocopier rather than about
 * luminance ratios.
 */
export function printContrastWarning(result, label = 'Some text on this paper') {
  if (!result || result.ok) return ''
  if (!result.measurable) {
    return `${label} uses a colour that could not be checked for black-and-white printing.`
  }
  return (
    `${label} is too faint to print clearly in black and white — it comes out ` +
    'a light grey, and photocopying will fade it further. Use a darker colour.'
  )
}
