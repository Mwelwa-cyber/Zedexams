/**
 * WCAG AA contrast gate for the four teacher workspace themes.
 *
 * This is the test that pays for itself. The palette these themes were
 * specified from failed its own accessibility requirement in 15 of the 44
 * pairs below — Miombo's white-on-gold button was 2.75:1 against a 4.5:1
 * bar, and three themes' muted body text sat around 3.4:1. None of that is
 * visible by eye on a good monitor; all of it is unreadable on a cheap
 * laptop in a bright Zambian classroom, which is the actual device this
 * product runs on.
 *
 * Every pair is asserted, not sampled, because a theme is exactly the kind
 * of thing that gets a fifth palette added later by copying the shape of an
 * existing one and adjusting hues by eye.
 *
 * Thresholds are WCAG 2.1: 4.5:1 for body text, 3:1 for large/bold text and
 * for UI boundaries that carry meaning.
 */
import assert from 'node:assert/strict'
import { TEACHER_THEMES, TOKEN_NAMES } from './teacherThemeCore.js'

const BODY = 4.5
const LARGE = 3

/* ── colour maths ─────────────────────────────────────────────────────── */

function parseColor(value) {
  const raw = String(value).trim()
  if (raw.startsWith('#')) {
    let h = raw.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    assert.equal(h.length, 6, `unsupported hex colour: ${value}`)
    return {
      rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)),
      alpha: 1,
    }
  }
  const m = raw.match(/^rgba?\(([^)]+)\)$/)
  assert.ok(m, `unsupported colour format: ${value}`)
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
  assert.ok(parts.length === 3 || parts.length === 4, `bad rgb(a): ${value}`)
  return { rgb: parts.slice(0, 3), alpha: parts.length === 4 ? parts[3] : 1 }
}

// Translucent foregrounds (the sidebar text tokens are rgba) must be
// composited over their background before measuring — measuring the raw
// value reports the contrast of a colour that is never actually painted.
function composite(fg, bg) {
  const f = parseColor(fg)
  const b = parseColor(bg)
  assert.equal(b.alpha, 1, 'background must be opaque to composite against')
  return f.rgb.map((c, i) => c * f.alpha + b.rgb[i] * (1 - f.alpha))
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(composite(fg, bg))
  const l2 = relativeLuminance(parseColor(bg).rgb)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/* ── the pairs every theme must satisfy ───────────────────────────────── */

const PAIRS = [
  // Body copy on both page and card.
  ['text', 'surface', BODY, 'primary text on the page'],
  ['text', 'card', BODY, 'primary text on a card'],
  ['text-muted', 'surface', BODY, 'helper text on the page'],
  ['text-muted', 'card', BODY, 'helper text on a card'],

  // Anything sitting on an accent fill: primary buttons, the active nav
  // pill, badges. This is the pair the source palette got wrong twice.
  ['on-accent', 'accent', BODY, 'label on an accent button'],
  ['on-accent', 'accent-deep', BODY, 'label on the deep end of an accent gradient'],

  // The accent used AS text — kicker labels, links, the active card's tick.
  ['accent-text', 'surface', BODY, 'accent text on the page'],
  ['accent-text', 'card', BODY, 'accent text on a card'],

  // Sidebar chrome.
  ['sidebar-text', 'sidebar-bg', BODY, 'inactive nav item'],
  ['sidebar-muted', 'sidebar-bg', LARGE, 'sidebar section label (uppercase, tracked)'],

  // Notice banners.
  ['banner-text', 'banner-bg', BODY, 'banner copy'],

  // Boundaries: a card edge and a hairline must be distinguishable from
  // what they separate, or the layout loses its structure.
  ['card-border', 'card', LARGE, 'card outline against the card'],
  ['line', 'card', 1.3, 'hairline against a card'],
  ['line', 'surface', 1.2, 'hairline against the page'],
]

/* ── the assertions ───────────────────────────────────────────────────── */

const failures = []

for (const theme of TEACHER_THEMES) {
  const tokens = theme.tokens

  // A theme that silently omits a token inherits another theme's value at
  // runtime, which looks like a rendering bug rather than a typo.
  assert.deepEqual(
    Object.keys(tokens).sort(),
    [...TOKEN_NAMES].sort(),
    `theme "${theme.id}" must define exactly the declared token set`,
  )

  for (const [fgKey, bgKey, min, what] of PAIRS) {
    const ratio = contrastRatio(tokens[fgKey], tokens[bgKey])
    if (ratio < min) {
      failures.push(
        `${theme.id}: ${what} — ${fgKey} on ${bgKey} is ${ratio.toFixed(2)}:1, needs ${min}:1`,
      )
    }
  }

  // Every theme's sidebar and hero chrome carries white text, which is only
  // safe because every theme defines a DARK sidebar. --zt-on-dark is a
  // single invariant value, so this is what stops a future light-sidebar
  // theme from shipping white-on-white.
  const onDark = contrastRatio('#FFFFFF', tokens['sidebar-bg'])
  if (onDark < BODY) {
    failures.push(
      `${theme.id}: sidebar is too light for --zt-on-dark (#FFFFFF) — ${onDark.toFixed(2)}:1`,
    )
  }
}

assert.equal(
  failures.length,
  0,
  `WCAG AA contrast failures:\n  ${failures.join('\n  ')}`,
)

const pairCount = TEACHER_THEMES.length * (PAIRS.length + 1)
console.log(`✓ teacher theme contrast — ${pairCount} pairs across ${TEACHER_THEMES.length} themes pass WCAG AA`)
