/**
 * The seed rule, in isolation: an OS colour scheme is what we show someone
 * who has not answered, and a saved reading palette IS an answer.
 *
 * Why this is worth its own test rather than being folded into the provider
 * spec: `seededDarkness` is what the WORKSPACE theme reads to decide whether
 * to come up 'night', and `html[data-theme='night'] body` outranks
 * `body.theme-<id>` in index.css. So getting this wrong does not mis-tint one
 * surface — it paints the whole app dark over a light palette the learner
 * chose, with no learner-facing control able to clear it. That was the bug
 * (readingThemeCore.js's header note).
 */
import assert from 'node:assert/strict'
import {
  DARK_READING_THEME_IDS,
  READING_THEME_STORAGE_KEY,
  isDarkReadingThemeId,
  prefersDarkColorScheme,
  seededDarkness,
  seededWorkspaceDarkness,
} from './readingThemeCore.js'

/* ── the darkness question ─────────────────────────────────────────────── */

assert.equal(isDarkReadingThemeId('midnight'), true)
// The legacy alias, still on the disk of any device that has not been
// rewritten. Reading it as light would flip a returning learner's workspace
// seed to light under a dark page.
assert.equal(isDarkReadingThemeId('dark'), true)

for (const light of ['oatmeal', 'sky', 'solar', 'warm', 'light', 'lavender', 'vivid']) {
  assert.equal(isDarkReadingThemeId(light), false, `'${light}' is a light palette`)
}
// Unrecognised ids normalise to the light brand default, so "not in the list"
// must answer light rather than throw or go dark.
for (const junk of [undefined, null, '', 'neon', 0, {}, []]) {
  assert.equal(isDarkReadingThemeId(junk), false, `${JSON.stringify(junk)} must read as light`)
}
assert.deepEqual([...DARK_READING_THEME_IDS], ['midnight', 'dark'])

/* ── the seed ──────────────────────────────────────────────────────────── */

const original = { window: globalThis.window, localStorage: globalThis.localStorage }

function withEnv({ saved, osDark, throws = false }, run) {
  const store = new Map()
  if (saved !== undefined && saved !== null) store.set(READING_THEME_STORAGE_KEY, saved)
  const localStorage = {
    getItem(k) {
      if (throws) throw new Error('storage disabled')
      return store.has(k) ? store.get(k) : null
    },
  }
  globalThis.localStorage = localStorage
  globalThis.window = {
    localStorage,
    matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: dark)' && osDark }),
  }
  try {
    return run()
  } finally {
    globalThis.window = original.window
    globalThis.localStorage = original.localStorage
  }
}

// Nothing saved → the OS decides. This is the case the seed exists for.
assert.equal(withEnv({ osDark: true }, seededDarkness), true)
assert.equal(withEnv({ osDark: false }, seededDarkness), false)

// THE ORIGINAL BUG. A saved light palette on a dark-OS machine must read
// light. When this answered `true`, the workspace theme came up 'night', the
// index.css bridge overrode every reading token, and the learner's Night
// toggle — which writes this very key — could not turn the page light again.
assert.equal(withEnv({ saved: 'oatmeal', osDark: true }, seededDarkness), false)
assert.equal(withEnv({ saved: 'sky', osDark: true }, seededDarkness), false)

// THE REGRESSION THE FIRST FIX SHIPPED (#2524 → #2535), and the reason this
// rule is NOT symmetric. A saved Midnight on a LIGHT-OS machine must NOT
// darken the workspace: a reading palette is a statement about the page a
// learner reads on, not a request to repaint the teacher workspace. When this
// answered `true`, `data-theme` went to 'night' and the bridge repainted the
// entire app — and since <ReadingThemeSync> pushes the reading palette to the
// account, it reached every browser the user signed in from, teachers too.
assert.equal(withEnv({ saved: 'midnight', osDark: false }, seededDarkness), false)
assert.equal(withEnv({ saved: 'dark', osDark: false }, seededDarkness), false)
// On a dark OS the same saved palette is dark — but because the OS said so,
// which is exactly what it did before either fix.
assert.equal(withEnv({ saved: 'midnight', osDark: true }, seededDarkness), true)
assert.equal(withEnv({ saved: 'dark', osDark: true }, seededDarkness), true)

// A saved value we do not recognise is still an answer of sorts — it
// normalises to the light default — so it vetoes the OS like any light one.
assert.equal(withEnv({ saved: 'neon', osDark: true }, seededDarkness), false)

// Storage unavailable (Safari private mode, a locked-down profile) falls
// through to the OS rather than throwing on the boot path.
assert.equal(withEnv({ osDark: true, throws: true }, seededDarkness), true)
assert.equal(withEnv({ osDark: false, throws: true }, seededDarkness), false)

// No window at all (SSR/prerender) is light, never a crash.
assert.equal(prefersDarkColorScheme(), false)

/* ── the rule as a pure function, both directions ──────────────────────── */

// The property that matters, stated once: this can turn an OS-dark seed OFF
// and can NEVER turn one ON. Anything that makes the second column read true
// where osDark is false is the #2535 regression coming back.
const cases = [
  // readingTheme,  osDark,  expected
  ['oatmeal',       true,    false],  // a light choice vetoes a dark OS
  ['sky',           true,    false],
  ['solar',         true,    false],
  ['oatmeal',       false,   false],
  ['midnight',      true,    true],   // dark choice + dark OS → dark
  ['midnight',      false,   false],  // dark choice, light OS → the OS wins
  ['dark',          false,   false],  // …legacy alias included
  [null,            true,    true],   // no choice → the OS alone
  [null,            false,   false],
  [undefined,       true,    true],
  ['',              true,    true],   // empty string is "no choice", not light
]
for (const [readingTheme, osDark, expected] of cases) {
  assert.equal(
    seededWorkspaceDarkness({ readingTheme, osDark }),
    expected,
    `seededWorkspaceDarkness(${JSON.stringify(readingTheme)}, osDark=${osDark}) should be ${expected}`,
  )
}
// Stated as a property rather than only as a table, so a future edit that
// adds a new "and also go dark when…" branch fails here as well.
for (const readingTheme of [null, undefined, '', 'oatmeal', 'sky', 'solar', 'midnight', 'dark', 'neon']) {
  assert.equal(
    seededWorkspaceDarkness({ readingTheme, osDark: false }),
    false,
    `nothing may seed a dark workspace when the OS asks for light (${JSON.stringify(readingTheme)})`,
  )
}
assert.equal(seededWorkspaceDarkness(), false, 'no arguments must not throw')

console.log('✓ reading theme core — a light palette vetoes the OS seed, and nothing imposes a dark one')
