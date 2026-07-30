/**
 * The two theme systems must agree about what "dark" means.
 *
 * THE SHAPE OF THE PROBLEM
 * There are two independent palette systems in this app:
 *
 *   reading themes    six palettes, --bg / --card / --text, on <body>
 *   workspace themes  four palettes, --zt-*,               on <html>
 *
 * A learner picks the first. A teacher picks the second. Neither picks both.
 *
 * Every shared surface — the whole of src/components/ui/, and shared pages
 * like /my-subscription — is written against the READING tokens, and those
 * components render inside the teacher studios. So a teacher who turned on
 * Night got dark chrome wrapped around light shared cards, and a shared page
 * that is perfectly tokenised rendered at full brightness: being tokenised in
 * the wrong token set is indistinguishable from being hardcoded.
 *
 * WHAT IS ASSERTED HERE
 * The bridge, and the three things about it that are easy to get wrong and
 * silent when wrong.
 *
 * A behavioural version of this lives alongside it — the matrix is measured in
 * a real browser in the dark-surface audit. This one is the cheap guard that
 * runs in the plain-node suite on every commit.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')

/* ── 1. The bridge exists, and is declared ON BODY ────────────────────── */

// This is the subtle one. `[data-theme='night']` is on <html> and the reading
// palettes are declared on <body>. For an INHERITED custom property the
// nearer declaration wins regardless of specificity, so a bridge written as
//   [data-theme='night'] { --card: … }
// is shadowed by `body.theme-oatmeal { --card: … }` on every element inside
// the body — which is to say, everywhere — and applies to nothing at all.
// It would look completely correct in review.
const bridge = css.match(/html\[data-theme='night'\]\s+body\s*\{([^}]*)\}/)
assert.ok(
  bridge,
  "No `html[data-theme='night'] body` rule in src/index.css. That is the " +
    'bridge that makes the workspace dark theme reach the reading tokens the ' +
    'shared components are written in. Note it must be declared on BODY: an ' +
    "inherited custom property takes the NEAREST declaration, so the same " +
    'rule written against <html> alone is shadowed by `body.theme-<id>` ' +
    'everywhere inside the body and silently applies to nothing.',
)

/* ── 2. It carries every token a reading palette declares ─────────────── */
// A partial bridge is worse than none: the tokens it names go dark and the
// ones it forgets stay at the light palette's value, so a dark card ends up
// with a light border or a light input inside it.
const midnight = css.match(/body\.theme-midnight[^{]*\{([^}]*)\}/)
assert.ok(midnight, 'The Midnight reading palette is gone from src/index.css.')

const tokensOf = (block) =>
  new Set((block.match(/--[\w-]+(?=\s*:)/g) || []).filter((t) => !t.startsWith('--zt-')))
const missing = [...tokensOf(midnight[1])].filter((t) => !tokensOf(bridge[1]).has(t))

assert.deepEqual(
  missing,
  [],
  'The bridge does not restate every token the Midnight reading palette ' +
    'declares. A token it misses keeps the LIGHT palette value while its ' +
    'neighbours go dark — a dark card with a light border, or a light input ' +
    `inside it. Add:\n  ${missing.join('\n  ')}`,
)

/* ── 3. Native controls follow ────────────────────────────────────────── */
// <select> popups, scrollbars, autofill and the caret are painted by the OS
// and read `color-scheme`, not custom properties. `html.dark` is toggled from
// the READING theme only, so without this line a teacher on Night gets the
// dark surfaces above and a white dropdown list on top of them.
assert.match(
  css,
  /html\[data-theme='night'\]\s*\{\s*color-scheme:\s*dark/,
  "`html[data-theme='night'] { color-scheme: dark }` is missing. The reading " +
    "theme's `html.dark` hook does not fire for a teacher on Night, so native " +
    'dropdowns, scrollbars and autofill stay light on the now-dark surfaces.',
)

/* ── 4. Both dark modes reach the pinned-palette container ────────────── */
// .force-light-theme pins Games and Quizzes light because they are painted in
// ~500 Tailwind literals. The remap that gives them a dark twin was scoped to
// the reading theme only, which left them as the one surface a teacher on
// Night still met at full brightness.
// Split on commas rather than matching whole rules: the block writes long
// multi-line selector lists, and one stale entry inside a list is exactly the
// miss this is looking for.
const selectors = (css.match(/[^{}]+(?=\{)/g) || [])
  .flatMap((s) => s.split(','))
  .map((s) => s.trim())
  .filter((s) => s.includes('.force-light-theme'))
const remaps = selectors.filter((s) => /theme-midnight|data-theme='night'/.test(s))
assert.ok(remaps.length > 20, `expected the pinned-palette dark remap; found ${remaps.length} selectors`)
const readingOnly = remaps.filter((s) => !/data-theme='night'/.test(s))
assert.deepEqual(
  readingOnly.map((s) => s.trim().slice(0, 90)),
  [],
  'These .force-light-theme dark rules name only the reading theme, so they ' +
    'do not fire for a teacher on Night — Games and Quizzes stay bright for ' +
    'them. Both hooks belong on every rule in that block (the block uses ' +
    "`:is(body.theme-midnight, html[data-theme='night'] body)` for exactly " +
    `this):\n  ${readingOnly.map((s) => s.trim().slice(0, 90)).join('\n  ')}`,
)

console.log('theme bridge: ok')
