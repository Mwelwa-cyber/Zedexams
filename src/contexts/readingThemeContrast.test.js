/**
 * WCAG AA contrast gate for the learner READING themes — the twin of
 * teacherThemeContrast.test.js for the other token set.
 *
 * The teacher workspace palettes have had a contrast gate since they shipped;
 * the reading palettes — the ones learners actually read notes, quizzes and
 * exams in — had none. That asymmetry is how Sky came to put white text on a
 * 2.77:1 button and how the default theme's muted copy sat at 4.47:1 on its
 * own page: none of it is visible by eye on a good monitor, and all of it is
 * marginal on a cheap laptop in a bright Zambian classroom.
 *
 * It matters most for MIDNIGHT. It is the only dark palette in the product,
 * so it is the only one where a change made while looking at a light theme
 * can go wrong in a direction nobody sees. A dark palette also fails
 * differently: on a light theme a mistake makes text faint, on a dark one it
 * makes text vanish.
 *
 * WHY IT PARSES THE STYLESHEET
 * ----------------------------
 * The reading palettes have no JS source of truth — CSS cannot import JS, so
 * index.css IS where they are declared (readingThemeMirror.test.js guards the
 * id list against ThemeContext.jsx and boot.js). Reading the values from the
 * stylesheet means the test measures what actually ships, not a second copy
 * of it that could drift.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED
 * ---------------------------------
 * - Hairlines (--border, --input-border) against their surfaces. They run
 *   1.2–1.7:1 in every palette including the light ones. WCAG 1.4.11 governs
 *   boundaries that are the ONLY thing identifying a control; these are
 *   decorative edges on surfaces that already differ from the page, and
 *   asserting 3:1 would mean redrawing all four palettes' card edges by eye.
 *   Stated here rather than silently omitted, because a gap nobody wrote down
 *   reads later as a gap nobody knew about.
 * - --accent against a surface. It is a FILL; what has to be legible is the
 *   ink ON it, and that pair (--accent-text on --accent) IS asserted. Solar's
 *   amber is 2.07:1 on its own cream page and holding that to 3:1 would mean
 *   giving up the colour the theme is named for.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8')

const BODY = 4.5
const LARGE = 3

/* ── colour maths ─────────────────────────────────────────────────────── */

function parseColor(value) {
  const raw = String(value).trim()
  if (raw.startsWith('#')) {
    let h = raw.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    assert.equal(h.length, 6, `unsupported hex colour: ${value}`)
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), alpha: 1 }
  }
  const m = raw.match(/^rgba?\(([^)]+)\)$/)
  assert.ok(m, `unsupported colour format: ${value}`)
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
  assert.ok(parts.length === 3 || parts.length === 4, `bad rgb(a): ${value}`)
  return { rgb: parts.slice(0, 3), alpha: parts.length === 4 ? parts[3] : 1 }
}

/**
 * Midnight's semantic wash tokens are translucent (`rgba(21,128,61,0.20)`),
 * so they have no colour until something is behind them. Measuring the raw
 * value reports the contrast of a colour that is never painted; they are
 * composited over the surface they sit on first.
 */
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

/** Contrast of `fg` over `bg`, both resolved against `under` if translucent. */
function contrast(fg, bg, under) {
  const bgRgb = parseColor(bg).alpha === 1 ? parseColor(bg).rgb : composite(bg, under)
  const bgHex = `rgb(${bgRgb.join(',')})`
  const fgRgb = parseColor(fg).alpha === 1 ? parseColor(fg).rgb : composite(fg, bgHex)
  const [hi, lo] = [relativeLuminance(fgRgb), relativeLuminance(bgRgb)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

/* ── 1. Read the palettes out of index.css ────────────────────────────── */

/**
 * Each palette is declared once, on a selector list that pairs the body class
 * with the picker-swatch alias:
 *
 *   body.theme-midnight,
 *   .reading-swatch[data-reading-theme='midnight'] { … }
 *
 * Anchoring on that exact shape rather than on `body.theme-<id>` anywhere is
 * what keeps this from accidentally reading one of the many single-token
 * `body.theme-midnight .some-component` overrides further down the file.
 */
function readPalette(id) {
  const re = new RegExp(
    `body\\.theme-${id},\\s*\\n\\.reading-swatch\\[data-reading-theme='${id}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`,
  )
  const m = css.match(re)
  assert.ok(m, `index.css no longer declares the '${id}' palette in the expected shape`)
  const tokens = {}
  for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[d[1]] = d[2].trim()
  return tokens
}

// Sky's block additionally carries the `:root` default, so it is matched on
// its own selector shape below rather than through readPalette().
const skyMatch = css.match(
  /:root,\s*\nbody\.theme-sky,\s*\n\.reading-swatch\[data-reading-theme='sky'\]\s*\{([\s\S]*?)\n\}/,
)
assert.ok(skyMatch, "index.css no longer declares the 'sky' palette alongside :root")
const sky = {}
for (const d of skyMatch[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) sky[d[1]] = d[2].trim()

const PALETTES = {
  sky,
  midnight: readPalette('midnight'),
  oatmeal: readPalette('oatmeal'),
  solar: readPalette('solar'),
}

/**
 * Every palette must declare every token these assertions read. A palette
 * missing one does not throw at runtime — it silently inherits :root's Sky
 * value, which is a light colour, so on Midnight the omission would paint
 * light ink and look like a rendering bug rather than a missing declaration.
 */
const REQUIRED = [
  '--bg', '--bg-subtle', '--card', '--card-hover', '--text', '--text-muted',
  '--border', '--accent', '--accent-text', '--accent-bg', '--accent-fg',
  '--input-bg', '--input-border',
  '--success-fg', '--success-bg', '--warning-fg', '--warning-bg',
  '--danger-fg', '--danger-bg', '--info-fg', '--info-bg',
]

for (const [id, tokens] of Object.entries(PALETTES)) {
  for (const name of REQUIRED) {
    assert.ok(tokens[name], `theme '${id}' does not declare ${name}`)
  }
}

/* ── 2. The pairs ─────────────────────────────────────────────────────── */

/** [foreground, background, threshold, what it is] */
const PAIRS = [
  // Body copy on every surface it is drawn on.
  ['--text', '--bg', BODY, 'body copy on the page'],
  ['--text', '--bg-subtle', BODY, 'body copy on a tinted panel'],
  ['--text', '--card', BODY, 'body copy on a card'],
  ['--text', '--card-hover', BODY, 'body copy on a hovered card'],
  ['--text', '--input-bg', BODY, 'typed text in a field'],

  // The muted tier is still body text — it is where a palette usually fails.
  ['--text-muted', '--bg', BODY, 'secondary copy on the page'],
  ['--text-muted', '--bg-subtle', BODY, 'secondary copy on a tinted panel'],
  ['--text-muted', '--card', BODY, 'secondary copy on a card'],
  ['--text-muted', '--input-bg', BODY, 'placeholder text in a field'],

  // The accent used as a FILL, judged by the ink sitting on it.
  ['--accent-text', '--accent', BODY, 'button label on the accent fill'],

  // The accent used AS TEXT, judged against the page behind it.
  ['--accent-fg', '--bg', BODY, 'link on the page'],
  ['--accent-fg', '--card', BODY, 'link on a card'],
  ['--accent-fg', '--accent-bg', BODY, 'link on its own tinted chip'],

  // Status messages. The wash tokens are translucent on Midnight, so they are
  // composited over the surface a status chip is drawn on — a card.
  ['--success-fg', '--success-bg', BODY, 'success message'],
  ['--warning-fg', '--warning-bg', BODY, 'warning message'],
  ['--danger-fg', '--danger-bg', BODY, 'error message'],
  ['--info-fg', '--info-bg', BODY, 'info message'],
]

/**
 * The semantic solids are what a chip's own edge or icon is drawn in — a
 * graphical object, so the 3:1 floor rather than 4.5:1.
 */
const LARGE_PAIRS = [
  ['--success', '--card', LARGE, 'success indicator on a card'],
  ['--warning', '--card', LARGE, 'warning indicator on a card'],
  ['--danger', '--card', LARGE, 'error indicator on a card'],
  ['--info', '--card', LARGE, 'info indicator on a card'],
]

let checked = 0
const failures = []

for (const [id, tokens] of Object.entries(PALETTES)) {
  for (const [fg, bg, min, what] of [...PAIRS, ...LARGE_PAIRS]) {
    const fgv = tokens[fg]
    const bgv = tokens[bg]
    if (!fgv || !bgv) continue
    const ratio = contrast(fgv, bgv, tokens['--card'])
    checked++
    if (ratio < min) {
      failures.push(
        `${id}: ${what} — ${fg} (${fgv}) on ${bg} (${bgv}) is ${ratio.toFixed(2)}:1, needs ${min}:1`,
      )
    }
  }
}

assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}\n`)

/* ── 3. Midnight must actually be dark ────────────────────────────────── */

/**
 * ThemeContext only puts `dark` on <html> — and only lets `color-scheme: dark`
 * reach the native widgets — for the ids in DARK_THEME_IDS. If Midnight's
 * surfaces were ever lightened without that set being revisited, every
 * assertion above would still pass (a light palette can be perfectly legible)
 * while the page carried dark-mode native controls. Assert the direction.
 */
const midnightBg = relativeLuminance(parseColor(PALETTES.midnight['--bg']).rgb)
assert.ok(
  midnightBg < 0.1,
  `Midnight's --bg is no longer a dark surface (luminance ${midnightBg.toFixed(3)}). ` +
    'If that is intended, DARK_THEME_IDS in ThemeContext.jsx has to change with it.',
)
for (const id of ['sky', 'oatmeal', 'solar']) {
  const L = relativeLuminance(parseColor(PALETTES[id]['--bg']).rgb)
  assert.ok(L > 0.5, `theme '${id}' is no longer a light palette (luminance ${L.toFixed(3)})`)
}

console.log(`readingThemeContrast: ${checked} pairs across ${Object.keys(PALETTES).length} palettes OK`)
