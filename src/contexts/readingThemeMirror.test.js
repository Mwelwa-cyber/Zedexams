/**
 * Drift guards for the learner READING themes (the `theme-<id>` palettes on
 * <body>) — the twin of teacherThemeMirror.test.js for the other token set.
 *
 * The id list exists in three places by necessity, not by choice:
 *   1. src/contexts/ThemeContext.jsx — the source of truth
 *   2. src/index.css                 — CSS cannot import JS
 *   3. public/boot.js                — the pre-paint guard runs before any
 *                                      bundle, so it cannot import either
 *
 * Two failures this exists to catch, both quiet:
 *
 * - A theme offered in the picker with no palette behind it. The page renders
 *   with :root's defaults — which is the Sky palette — so the learner picks
 *   "Midnight" and gets pale blue. Nothing throws.
 *
 * - A RETIRED theme (lavender/vivid, removed 2026-07) that a device still has
 *   in localStorage and that nothing maps. Same silent outcome, except it hits
 *   returning learners only, which is exactly who would not report it.
 *
 * ThemeContext.jsx is JSX, so this reads it as text rather than importing it —
 * the plain-node suite has no JSX loader.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

const ctx = readFileSync(resolve(root, 'src/contexts/ThemeContext.jsx'), 'utf8')
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8')
const boot = readFileSync(resolve(root, 'public/boot.js'), 'utf8')

/* ── 1. Read the source of truth out of ThemeContext.jsx ───────────────── */

const themesBlock = ctx.match(/export const THEMES = \[([\s\S]*?)\n\]/)
assert.ok(themesBlock, 'ThemeContext.jsx no longer declares a THEMES array')
const THEME_IDS = [...themesBlock[1].matchAll(/id:\s*'([\w-]+)'/g)].map((m) => m[1])
assert.ok(THEME_IDS.length >= 2, 'THEMES parsed as fewer than two themes — the parser has drifted')

const defaultMatch = ctx.match(/export const DEFAULT_THEME = '([\w-]+)'/)
assert.ok(defaultMatch, 'ThemeContext.jsx no longer declares DEFAULT_THEME')
const DEFAULT_THEME = defaultMatch[1]
assert.ok(
  THEME_IDS.includes(DEFAULT_THEME),
  `DEFAULT_THEME '${DEFAULT_THEME}' is not one of the offered themes`,
)
assert.equal(
  THEME_IDS[0],
  DEFAULT_THEME,
  'the default theme must be listed first — the picker opens on the palette most readers are already using',
)

const retiredBlock = ctx.match(/const RETIRED_THEME_MAP = \{([\s\S]*?)\n\}/)
assert.ok(retiredBlock, 'ThemeContext.jsx no longer declares RETIRED_THEME_MAP')
const RETIRED = Object.fromEntries(
  [...retiredBlock[1].matchAll(/([\w-]+):\s*'([\w-]+)'/g)].map((m) => [m[1], m[2]]),
)

// A retired theme mapped to another retired theme, or to one that was never
// offered, leaves the learner exactly where they started: no palette.
for (const [from, to] of Object.entries(RETIRED)) {
  assert.ok(
    THEME_IDS.includes(to),
    `retired theme '${from}' maps to '${to}', which is not an offered theme`,
  )
  assert.ok(
    !THEME_IDS.includes(from),
    `'${from}' is listed as retired but is still offered in THEMES`,
  )
}

/* ── 2. Every offered theme has a palette, and previews through it ─────── */

for (const id of THEME_IDS) {
  assert.ok(
    css.includes(`body.theme-${id}`),
    `src/index.css has no palette for the '${id}' theme — it would render with :root's defaults`,
  )
  // The picker swatches preview a theme they are not inside by declaring its
  // tokens on themselves. Without the alias the swatch silently inherits the
  // ACTIVE theme and every option looks identical.
  assert.ok(
    css.includes(`.reading-swatch[data-reading-theme='${id}']`),
    `src/index.css has no .reading-swatch alias for '${id}' — its picker swatch cannot preview it`,
  )
}

// The retired palettes are removed, not merely unlisted. A dead CSS block is
// how a "removed" theme comes back the next time someone adds an id.
for (const id of Object.keys(RETIRED)) {
  assert.ok(
    !css.includes(`theme-${id}`),
    `src/index.css still carries CSS for the retired '${id}' theme`,
  )
}

/* ── 3. boot.js mirrors the ids, the retirements and the default ───────── */

const bootIds = boot.match(/var ids = \[([^\]]+)\]/)
assert.ok(bootIds, 'public/boot.js no longer declares the reading-theme id list')
assert.deepEqual(
  bootIds[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
  THEME_IDS,
  'public/boot.js reading-theme ids have drifted from ThemeContext.jsx',
)

const bootRetired = boot.match(/var retired = \{([^}]*)\}/)
assert.ok(bootRetired, 'public/boot.js no longer maps the retired themes')
assert.deepEqual(
  Object.fromEntries(
    [...bootRetired[1].matchAll(/([\w-]+):\s*'([\w-]+)'/g)].map((m) => [m[1], m[2]]),
  ),
  RETIRED,
  'public/boot.js retired-theme map has drifted from ThemeContext.jsx',
)

assert.ok(
  boot.includes("localStorage.getItem('examprep:theme')"),
  "public/boot.js must read the 'examprep:theme' key",
)

// No saved (or unrecognised) id seeds from the OS colour scheme: midnight
// when the OS asks for dark, the brand default otherwise. Asserted as the
// exact expression so the seeding and the fallback cannot be separated —
// a boot.js that only falls back to the default silently un-seeds every
// dark-OS first visit that ThemeContext would seed after hydration, which
// paints light then flips dark.
assert.ok(
  boot.includes(
    `ids.indexOf(saved) !== -1\n      ? saved\n      : (prefersDark ? 'midnight' : '${DEFAULT_THEME}');`,
  ),
  `public/boot.js must seed midnight on a dark OS and fall back to '${DEFAULT_THEME}' otherwise`,
)
assert.ok(
  boot.includes("window.matchMedia('(prefers-color-scheme: dark)').matches"),
  'public/boot.js no longer reads prefers-color-scheme for the reading-theme seed',
)
// ThemeContext's resolveInitialTheme must agree, or boot paints one thing
// and hydration another.
assert.ok(
  ctx.includes(`prefersDarkColorScheme() ? 'midnight' : DEFAULT_THEME`),
  'ThemeContext.resolveInitialTheme no longer mirrors the boot.js prefers-color-scheme seeding',
)
// Midnight must also flip <html class="dark"> pre-paint, because
// `color-scheme` (native form controls, scrollbars) keys off it.
assert.ok(
  boot.includes(`if (resolved === 'midnight') document.documentElement.classList.add('dark');`),
  'public/boot.js must add the dark class on <html> when the resolved reading theme is midnight',
)
assert.ok(
  boot.includes(`document.body.classList.add('theme-${DEFAULT_THEME}')`),
  `public/boot.js must fall back to '${DEFAULT_THEME}' when localStorage throws`,
)
// The seed must never be WRITTEN: an absent key means "not answered", which
// is what keeps the site following the OS until the visitor picks a theme.
// boot.js has no setItem at all for this key; ThemeContext writes it only
// inside setTheme.
assert.ok(
  !boot.includes("localStorage.setItem('examprep:theme'"),
  'public/boot.js must never write the reading-theme key — the OS seed is not a saved choice',
)

console.log(
  `✓ reading theme mirror — ${THEME_IDS.length} themes and ${Object.keys(RETIRED).length} retirements match across ThemeContext, index.css and boot.js`,
)
