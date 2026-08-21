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

/* ── 3b. The MODE, mirrored ────────────────────────────────────────────
 *
 * This block used to pin the two-state seeding as an exact string:
 *   ids.indexOf(saved) !== -1 ? saved : (prefersDark ? 'midnight' : …)
 * i.e. "a saved palette, otherwise ask the OS". That was the whole bug. With
 * only those two states the ONLY way to say "always light" was a key that
 * every fresh context lacks — a second browser, Incognito, a cleared profile,
 * the signed-out site before auth resolves — so the OS answered instead, and
 * because the seed is deliberately never written it answered again on every
 * cold start. Measured on the built app: three consecutive reloads on a
 * dark-OS browser, all three midnight, `examprep:theme` still null.
 *
 * What is pinned now is the three-state resolution, on both sides. */

assert.ok(
  boot.includes("window.matchMedia('(prefers-color-scheme: dark)').matches"),
  'public/boot.js no longer reads prefers-color-scheme for the system mode',
)

// The mode vocabulary and the default must agree across all three readers.
const coreSrc = readFileSync(resolve(root, 'src/contexts/readingThemeCore.js'), 'utf8')
const coreModes = coreSrc.match(/export const READING_THEME_MODES = Object\.freeze\(\[([^\]]*)\]/)
assert.ok(coreModes, 'readingThemeCore.js no longer declares READING_THEME_MODES')
const MODES = coreModes[1].split(',').map((m) => m.trim().replace(/^'|'$/g, '')).filter(Boolean)
assert.deepEqual(MODES, ['light', 'dark', 'system'], 'the mode vocabulary has changed')

const bootModes = boot.match(/var modes = \[([^\]]+)\]/)
assert.ok(bootModes, 'public/boot.js no longer declares the theme-mode list')
assert.deepEqual(
  bootModes[1].split(',').map((m) => m.trim().replace(/^'|'$/g, '')),
  MODES,
  'public/boot.js theme modes have drifted from readingThemeCore.js',
)

assert.ok(
  boot.includes("localStorage.getItem('examprep:themeMode')"),
  "public/boot.js must read the 'examprep:themeMode' key — without it the "
    + 'pre-paint frame ignores an explicit answer and paints the OS colour scheme',
)
assert.ok(
  boot.includes("localStorage.getItem('examprep:lightTheme')"),
  "public/boot.js must read the 'examprep:lightTheme' key, or a reader who "
    + 'chose Sky is returned to the brand default on every load',
)

// The resolution itself, on both sides. An explicit answer outranks the OS;
// only 'system' consults it. If either side loses that, boot paints one thing
// and hydration another — the flash this whole mirror exists to prevent.
assert.ok(
  boot.includes(
    "var resolved = mode === 'dark'\n      ? 'midnight'\n      : (mode === 'light' ? light : (prefersDark ? 'midnight' : light));",
  ),
  'public/boot.js no longer resolves the palette from the mode — an explicit '
    + "light or dark answer must outrank prefers-color-scheme, and only 'system' may consult it",
)
assert.ok(
  /if \(mode === 'dark'\) return DARK_READING_THEME_ID/.test(coreSrc)
    && /if \(mode === 'light'\) return light/.test(coreSrc)
    && /return osDark \? DARK_READING_THEME_ID : light/.test(coreSrc),
  'readingThemeCore.resolveReadingTheme no longer mirrors the boot.js resolution',
)
assert.ok(
  ctx.includes('resolveReadingTheme({ mode, light, osDark: prefersDarkColorScheme() })'),
  'ThemeContext no longer resolves the initial palette through resolveReadingTheme',
)

// The MIGRATION. A device that saved a palette before modes existed must have
// its mode inferred from it, on both sides — reading those devices as
// 'system' would throw away the very choice this change exists to make
// durable, and would put every one of them back on the OS.
assert.ok(
  boot.includes("mode = saved ? (saved === 'midnight' ? 'dark' : 'light') : 'system';"),
  'public/boot.js no longer infers a mode from an already-saved palette — every '
    + 'device that chose a palette before modes existed would fall back to the OS',
)
assert.ok(
  /return isDarkReadingThemeId\(savedTheme\) \? 'dark' : 'light'/.test(coreSrc),
  'readingThemeCore.inferReadingThemeMode no longer mirrors the boot.js migration',
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
// boot.js reads and never writes. That division is what keeps the pre-paint
// guard honest: a visitor who has not answered is still unanswered after the
// first frame, so 'system' keeps following the device rather than freezing on
// whatever the OS happened to say the first time they loaded the page.
// ThemeContext is the only writer, and only for a real choice.
for (const key of ['examprep:theme', 'examprep:themeMode', 'examprep:lightTheme']) {
  assert.ok(
    !boot.includes(`localStorage.setItem('${key}'`),
    `public/boot.js must never write '${key}' — resolving a palette pre-paint is not a choice`,
  )
}

console.log(
  `✓ reading theme mirror — ${THEME_IDS.length} themes and ${Object.keys(RETIRED).length} retirements match across ThemeContext, index.css and boot.js`,
)
