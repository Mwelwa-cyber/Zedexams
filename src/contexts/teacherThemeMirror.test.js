/**
 * Drift guards for the teacher theme system.
 *
 * The token values exist in three places by necessity, not by choice:
 *   1. teacherThemeCore.js  — the source of truth (JS; testable, commented)
 *   2. src/index.css        — CSS cannot import JS
 *   3. public/boot.js       — the pre-paint guard runs before any bundle
 *
 * Each copy is load-bearing and none can be removed, so the only defence
 * against them drifting is to fail the build when they do. Without this,
 * correcting a colour in one file and not the others produces a theme that
 * is right after hydration and wrong for the first frame — or right in the
 * picker's swatch and wrong on the page.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  DEFAULT_TEACHER_THEME,
  TEACHER_THEMES,
  TEACHER_THEME_IDS,
  TEACHER_THEME_STORAGE_KEY,
  TOKEN_NAMES,
  TOKEN_PREFIX,
  normalizeTeacherThemeId,
  resolveThemeConflict,
  shouldPersistTheme,
} from './teacherThemeCore.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8')
const boot = readFileSync(resolve(root, 'public/boot.js'), 'utf8')

/* ── 1. index.css matches the source of truth, value for value ─────────── */

function tokenBlock(selector) {
  // Match the declaration block for a selector, tolerating the leading
  // `:root,` on the default theme.
  const re = new RegExp(`(?:^|\\n)(?:[^{}]*?)\\[data-theme='${selector}'\\]\\s*\\{([^}]*)\\}`, 'm')
  const m = css.match(re)
  assert.ok(m, `src/index.css has no [data-theme='${selector}'] block`)
  const out = {}
  for (const line of m[1].split('\n')) {
    const d = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?);\s*$/)
    if (d) out[d[1]] = d[2].trim()
  }
  return out
}

for (const theme of TEACHER_THEMES) {
  const block = tokenBlock(theme.id)
  const expected = {}
  for (const name of TOKEN_NAMES) {
    expected[`${TOKEN_PREFIX}${name}`] = theme.tokens[name]
  }
  // Compare normalised: CSS is case-insensitive for hex and the two files
  // are written by different hands, so only real value differences fail.
  const norm = (o) => Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, v.toLowerCase().replace(/\s+/g, ' ')]),
  )
  assert.deepEqual(
    norm(block),
    norm(expected),
    `src/index.css [data-theme='${theme.id}'] has drifted from teacherThemeCore.js`,
  )
}

// The default theme must ALSO be on bare :root, or a document that somehow
// loses the attribute renders with no palette at all rather than the default.
assert.match(
  css,
  new RegExp(`:root,\\s*\\n?\\s*\\[data-theme='${DEFAULT_TEACHER_THEME}'\\]`),
  `:root must carry the ${DEFAULT_TEACHER_THEME} tokens as the no-attribute fallback`,
)

/* ── 2. boot.js mirrors the ids, the key and the default ───────────────── */

const bootIds = boot.match(/var teacherIds = \[([^\]]+)\]/)
assert.ok(bootIds, 'public/boot.js no longer declares teacherIds')
assert.deepEqual(
  bootIds[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
  [...TEACHER_THEME_IDS],
  'public/boot.js teacherIds has drifted from teacherThemeCore.js',
)
assert.ok(
  boot.includes(`localStorage.getItem('${TEACHER_THEME_STORAGE_KEY}')`),
  `public/boot.js must read the '${TEACHER_THEME_STORAGE_KEY}' key`,
)
// Twice: the happy path and the catch block. Both must land on the default,
// because a storage exception is not a reason to render an unstyled page.
// The id list is excised first so its own 'terracotta' entry isn't counted
// as a fallback.
const bootWithoutIdList = boot.replace(bootIds[0], '')
assert.equal(
  (bootWithoutIdList.match(new RegExp(`'${DEFAULT_TEACHER_THEME}'`, 'g')) || []).length,
  2,
  `public/boot.js must fall back to '${DEFAULT_TEACHER_THEME}' on both paths`,
)

/* ── 2b. the no-saved-choice seeding mirrors teacherThemeStore ─────────── */

// With nothing stored, both sides seed from the READING palette — which has
// itself already fallen back to prefers-color-scheme on a device that saved
// nothing. If either side loses the seed, a dark-OS first visit paints one
// theme pre-paint and flips to the other when React mounts.
//
// It must be the reading palette and NOT prefers-color-scheme directly:
// `html[data-theme='night'] body` outranks `body.theme-<id>` (themeBridge),
// so an OS seed here overrides a learner who explicitly chose a light palette
// and no learner-facing control can clear it. See readingThemeCore.js.
assert.ok(
  boot.includes(`? 'night'\n        : (teacherDark ? 'night' : '${DEFAULT_TEACHER_THEME}');`),
  'public/boot.js must seed the teacher theme from the resolved reading palette when nothing is saved',
)
assert.ok(
  boot.includes(`var teacherDark = resolvedReadingTheme === 'midnight';`),
  'public/boot.js teacher seed no longer derives from the reading palette it just resolved',
)
assert.ok(
  !/teacherPrefersDark/.test(boot),
  'public/boot.js reads prefers-color-scheme directly for the teacher seed again — that is the '
    + 'bug readingThemeCore.js documents: it overrides an explicitly chosen light reading palette',
)
// The retired dashboard key still counts as a saved dark choice in BOTH
// readers (it outranks the OS seed in each).
assert.ok(
  boot.includes(`localStorage.getItem('zedexams:tdv2-theme') === 'dark'`),
  'public/boot.js no longer honours the legacy tdv2 dashboard key',
)
const store = readFileSync(resolve(root, 'src/contexts/teacherThemeStore.js'), 'utf8')
assert.ok(
  store.includes('return seedFor(seededDarkness())'),
  'teacherThemeStore.readInitial no longer mirrors the boot.js seed (the resolved reading palette)',
)
// Reading the OS directly here is the regression, not a refactor of it: it is
// what let an unchosen workspace theme outrank a chosen reading palette.
assert.ok(
  !/matchMedia/.test(store),
  'teacherThemeStore queries the OS colour scheme directly again — it must go through '
    + 'readingThemeCore.seededDarkness so an explicit reading choice wins over the OS',
)
// The seed must keep FOLLOWING: readInitial answers once, and the reading
// theme moves afterwards (Night toggle, picker, profile hydration).
assert.ok(
  store.includes('export function syncSeededTeacherTheme('),
  'teacherThemeStore no longer exposes syncSeededTeacherTheme — an unchosen workspace theme '
    + 'would freeze on its first value and the learner Night toggle could not clear it',
)
const ctxSrc = readFileSync(resolve(root, 'src/contexts/ThemeContext.jsx'), 'utf8')
assert.ok(
  /syncSeededTeacherTheme\(theme\)/.test(ctxSrc),
  'ThemeProvider no longer re-seeds the workspace theme when the reading theme changes',
)
// The seed must never be written — an absent key keeps following the OS.
assert.ok(
  !boot.includes(`localStorage.setItem('${TEACHER_THEME_STORAGE_KEY}'`),
  'public/boot.js must never write the teacher-theme key — the OS seed is not a saved choice',
)

/* ── 3. the pure decisions ─────────────────────────────────────────────── */

for (const id of TEACHER_THEME_IDS) {
  assert.equal(normalizeTeacherThemeId(id), id, `${id} should pass through`)
}
for (const bad of [undefined, null, '', 'oatmeal', 'midnight', 'NIGHT', 0, {}, []]) {
  assert.equal(
    normalizeTeacherThemeId(bad),
    DEFAULT_TEACHER_THEME,
    `${JSON.stringify(bad)} must fall back to the default`,
  )
}

// The profile wins over a stale device value — that is the whole point of
// saving it to the account.
assert.deepEqual(
  resolveThemeConflict({ profileTheme: 'night', localTheme: 'miombo' }),
  { theme: 'night', source: 'profile' },
)
// ...but a profile that has never recorded a theme must NOT stomp a local
// choice. "Not answered" and "answered with the default" are different, and
// conflating them silently resets a deliberate pick on every fresh sign-in.
assert.deepEqual(
  resolveThemeConflict({ profileTheme: undefined, localTheme: 'copperbelt' }),
  { theme: 'copperbelt', source: 'local' },
)
assert.deepEqual(
  resolveThemeConflict({ profileTheme: 'garbage', localTheme: 'copperbelt' }),
  { theme: 'copperbelt', source: 'local' },
)
assert.deepEqual(
  resolveThemeConflict({}),
  { theme: DEFAULT_TEACHER_THEME, source: 'default' },
)

// No write when nothing changed — otherwise every sign-in bills a write.
assert.equal(shouldPersistTheme({ nextTheme: 'night', profileTheme: 'night' }), false)
assert.equal(shouldPersistTheme({ nextTheme: 'night', profileTheme: 'miombo' }), true)
assert.equal(shouldPersistTheme({ nextTheme: 'night', profileTheme: undefined }), true)
assert.equal(shouldPersistTheme({ nextTheme: 'bogus', profileTheme: 'night' }), false)

console.log(`✓ teacher theme mirror — ${TEACHER_THEMES.length} themes match across core, index.css and boot.js`)
