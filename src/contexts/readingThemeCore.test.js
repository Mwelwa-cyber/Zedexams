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

// THE REGRESSION. A saved light palette on a dark-OS machine must read light.
// When this answered `true`, the workspace theme came up 'night', the index.css
// bridge overrode every reading token, and the learner's Night toggle — which
// writes this very key — could not turn the page light again.
assert.equal(withEnv({ saved: 'oatmeal', osDark: true }, seededDarkness), false)
assert.equal(withEnv({ saved: 'sky', osDark: true }, seededDarkness), false)
// …and the mirror image: a saved Midnight on a light-OS machine reads dark, so
// the two systems agree about what dark means rather than half-agreeing.
assert.equal(withEnv({ saved: 'midnight', osDark: false }, seededDarkness), true)
assert.equal(withEnv({ saved: 'dark', osDark: false }, seededDarkness), true)

// A saved value we do not recognise is still an answer of sorts — it
// normalises to the light default — so it must not fall through to the OS.
assert.equal(withEnv({ saved: 'neon', osDark: true }, seededDarkness), false)

// Storage unavailable (Safari private mode, a locked-down profile) falls
// through to the OS rather than throwing on the boot path.
assert.equal(withEnv({ osDark: true, throws: true }, seededDarkness), true)
assert.equal(withEnv({ osDark: false, throws: true }, seededDarkness), false)

// No window at all (SSR/prerender) is light, never a crash.
assert.equal(prefersDarkColorScheme(), false)

console.log('✓ reading theme core — a saved palette outranks the OS in the workspace seed')
