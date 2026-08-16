/* Loading-tempo mirror guard (npm run test:loading-tempo).
 *
 * The app's loading rhythm is declared once, as --load-tempo in
 * src/shared/styles/zxLoading.css. Three surfaces cannot read that token and
 * must therefore carry the derived durations literally:
 *
 *   index.html                              the inline boot skeleton, which
 *                                           paints before any CSS bundle exists
 *   src/shared/components/FullScreenLoader   the React loader that takes over
 *                                           from it mid-animation
 *   src/app/guards/sessionRestorationScreen.css  the session-restoration screen
 *
 * The first two are documented as needing to stay keyframes-identical so the
 * ring KEEPS TURNING across the skeleton → React hand-off. Nothing enforced
 * that, and the failure is quiet in the worst way: the ring visibly jumps speed
 * for one frame during the swap, which reads as a stutter on a slow connection
 * — exactly where it is least likely to be noticed in development and most
 * likely to be seen by a user.
 *
 * This checks the numbers agree. It deliberately does NOT check colours: the
 * boot surfaces are hard-coded brand values by design (no theme is on <body>
 * yet), documented in each file.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const TOKENS = read('src/shared/styles/zxLoading.css')

// The one declaration everything else derives from.
const tempoMatch = TOKENS.match(/--load-tempo:\s*([\d.]+)s/)
assert.ok(tempoMatch, '--load-tempo must be declared in src/shared/styles/zxLoading.css')
const TEMPO = Number(tempoMatch[1])
assert.ok(TEMPO > 0 && TEMPO < 10, `--load-tempo looks wrong: ${TEMPO}s`)

// Derived durations, in the ratios the design uses: the ring on the tempo, the
// counter-arc at a clean 3:2 of it, the glow at 2× so it lands on the beat
// every second cycle, the indeterminate bar on the tempo.
const RING = TEMPO
const COUNTER_ARC = TEMPO * 1.5
const GLOW = TEMPO * 2
const BAR = TEMPO
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

const s = (n) => `${Number(n.toFixed(3))}s`

/* ── The two boot-ring mirrors ─────────────────────────────────────────── */

const BOOT_SURFACES = [
  ['index.html', read('index.html')],
  ['src/shared/components/FullScreenLoader.jsx', read('src/shared/components/FullScreenLoader.jsx')],
]

for (const [name, src] of BOOT_SURFACES) {
  assert.ok(
    src.includes(`animation: zed-boot-spin ${s(RING)} linear infinite;`),
    `${name}: the boot ring must spin at ${s(RING)} (--load-tempo)`,
  )
  assert.ok(
    src.includes(`.zed-boot-arc--orange { animation-duration: ${s(COUNTER_ARC)};`),
    `${name}: the counter-arc must run at ${s(COUNTER_ARC)} (1.5x --load-tempo)`,
  )
  assert.ok(
    src.includes(`animation: zed-boot-glow ${s(GLOW)} ease-in-out infinite;`),
    `${name}: the glow must run at ${s(GLOW)} (2x --load-tempo)`,
  )
  assert.ok(
    src.includes(`animation: zed-boot-bar ${s(BAR)} ${EASE} infinite;`),
    `${name}: the indeterminate bar must run at ${s(BAR)} on the shared easing`,
  )
}

/* ── The session-restoration screen ────────────────────────────────────── */
// This one CAN read the token (it loads with the bundle), so the guard is that
// it derives rather than hard-codes — a literal duration here is the drift.

const ZSR = read('src/app/guards/sessionRestorationScreen.css')

for (const [label, rule] of [
  ['ring', /animation:\s*zsr-spin\s+var\(--load-tempo/],
  ['counter-arc', /animation-duration:\s*calc\(var\(--load-tempo/],
  ['glow', /animation:\s*zsr-glow\s+calc\(var\(--load-tempo/],
  ['indeterminate bar', /animation:\s*zsr-indeterminate\s+var\(--load-tempo/],
  ['skeleton shimmer', /animation:\s*zsr-shimmer\s+var\(--load-tempo/],
]) {
  assert.match(
    ZSR,
    rule,
    `sessionRestorationScreen.css: the ${label} must derive from --load-tempo, not hard-code a duration`,
  )
}

/* ── Skeleton tints must resolve against the LIVE theme ────────────────── */
// A custom property is substituted where it is DECLARED. The reading themes are
// declared on `body.theme-*`, so a color-mix built at `:root` resolves against
// the default palette and every other theme inherits that already-computed
// value — a pale sky blue on the terracotta cream, in every theme, which is the
// exact defect the skeleton retint exists to remove. It fails silently: the
// placeholder still renders, just in the wrong palette.

const rootBlock = TOKENS.match(/:root\s*\{[\s\S]*?\}/)
assert.ok(rootBlock, 'zxLoading.css must declare its tempo tokens on :root')
for (const token of ['--skeleton-base', '--skeleton-hi']) {
  assert.ok(
    !rootBlock[0].includes(token),
    `zxLoading.css: ${token} is declared on :root, so it substitutes the DEFAULT theme's accent and never follows the reader's theme. Declare it on \`body\`, where the theme class lives.`,
  )
  assert.match(
    TOKENS,
    new RegExp(`body\\s*\\{[\\s\\S]*?${token}:`),
    `zxLoading.css: ${token} must be declared on \`body\``,
  )
}

/* ── No stray second tempo in the system stylesheet ────────────────────── */
// Every infinite loop in zxLoading.css must derive from the token. The two
// exceptions are declared here rather than left to judgement: the button
// spinner and the dots are deliberately faster than the page tempo, because a
// 14px indicator on the tempo reads as stalled.
const INLINE_DURATIONS = [...TOKENS.matchAll(/animation:[^;]*?([\d.]+m?s)[^;]*infinite/g)].map(
  (m) => m[1],
)
const ALLOWED = new Set(['0.9s', '1.2s'])
for (const d of INLINE_DURATIONS) {
  assert.ok(
    ALLOWED.has(d),
    `zxLoading.css: infinite animation at a hard-coded ${d} — derive it from --load-tempo, or add it to ALLOWED here with a reason`,
  )
}

console.log('loading tempo: all mirrors agree (--load-tempo:', `${TEMPO}s)`)
