/**
 * The Games / quiz-list surface must stay fully covered by its dark remap.
 *
 * WHAT THIS GUARDS
 * ----------------
 * GamesShell and QuizList paint themselves in hard-coded Tailwind literals —
 * `bg-white`, `text-slate-900`, `border-slate-900` — rather than palette
 * tokens. Midnight support for those two surfaces is therefore a REMAP: one
 * block in index.css that names each literal and states its dark twin.
 *
 * A remap has a failure mode a token system does not. Add a component that
 * reaches for `bg-white`, and in every light theme it is correct and in
 * Midnight it is a white card in a dark page — one component at a time, on a
 * theme most reviewers are not using. Nothing throws, nothing looks wrong in
 * review, and the surface degrades back toward the full-brightness page it
 * started as. So the vocabulary is checked mechanically: every neutral literal
 * these files use must be named in the remap.
 *
 * WHAT IS DELIBERATELY OUT OF SCOPE
 * ---------------------------------
 * Only the NEUTRAL vocabulary (white / slate greys) and the arbitrary hex
 * values are covered. The coloured ones are not, and that is a decision
 * rather than an omission:
 *
 *  - Pastel tints (`bg-emerald-100`, `bg-amber-100`, `zx-mascot-tile`) are
 *    stickers. A small coloured tile reads as art on a dark page exactly as it
 *    does on a light one, and the leaderboard's amber notice is *supposed* to
 *    be a bright card. Remapping those to neutral dark surfaces was tried and
 *    was worse: it silently outranked the tint utilities the cards are built
 *    from and turned the one element on the page meant to be noticed into
 *    amber-900 ink at 1.61:1.
 *  - Saturated fills (`bg-[#D97757]`, `bg-sky-500`) and the `text-white` that
 *    sits on them are unchanged in the dark, because the fill is unchanged.
 *
 * Coverage of those is asserted by the rendered-page audit, not here.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')

/* ── 1. The files that render inside the pinned-palette container ─────── */

const files = readdirSync(here)
  .filter((f) => f.endsWith('.jsx') && !f.includes('.test.') && !f.includes('.spec.'))
  .map((f) => join(here, f))
  .concat([resolve(root, 'src/components/quiz/QuizList.jsx')])

assert.ok(
  files.length >= 20,
  `expected the games components in ${here}; found ${files.length}. ` +
  'If they moved, update this guard rather than deleting it.',
)

// Both shells must still carry the container this remap is scoped to — the
// remap applies to nothing at all if the class is renamed away.
for (const shell of ['GamesShell.jsx', '../quiz/QuizList.jsx']) {
  const src = readFileSync(resolve(here, shell), 'utf8')
  assert.match(
    src,
    /force-light-theme/,
    `${shell} no longer carries .force-light-theme — the Midnight remap in ` +
    'index.css is scoped to that container and would apply to nothing.',
  )
}

/* ── 2. The neutral vocabulary these files actually use ───────────────── */

/**
 * A literal needs a remap when it paints a LIGHT surface or DARK ink — those
 * are the two that invert. `text-white`, `bg-white/15` washes over coloured
 * art, and the saturated fills do not.
 */
const NEEDS_REMAP = [
  /\bbg-white\b(?!\/)/g,                       // opaque white surface
  /\bbg-slate-(?:50|100|200|800|900)\b/g,
  /\btext-slate-(?:300|400|500|600|700|800|900)\b/g,
  /\bborder-slate-(?:100|200|300|800|900)\b/g,
  /\bring-slate-(?:100|200|300)\b/g,
]

/**
 * A white wash is only in scope once it is opaque enough to BE the surface.
 *
 * `bg-white/60` and up are frosted panels — the sticky nav, a card over the
 * page — and behave like a white card: dark ink is placed on them and they
 * have to invert. Below that they are highlights lying over coloured art (the
 * hero gradient, a mascot circle) with `text-white` on top, and they read the
 * same either way; inverting them would put a dark smear on a coloured hero.
 * The line is at 50% rather than wherever the current code happens to sit, so
 * a new `bg-white/55` is classified by the rule and not by this comment.
 */
const WASH_SURFACE_ALPHA = 50
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/\bbg-white\/(\d{2})\b/g)) {
    if (Number(m[1]) >= WASH_SURFACE_ALPHA) NEEDS_REMAP.push(new RegExp(`\\b${m[0]}\\b`, 'g'))
  }
}

const used = new Set()
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  for (const re of NEEDS_REMAP) {
    for (const m of src.matchAll(re)) used.add(m[0])
  }
  // Arbitrary values: a hex is in scope when it is a dark ink or a light fill.
  for (const m of src.matchAll(/\b(text|bg|border)-\[(#[0-9A-Fa-f]{6})\]/g)) {
    const [, prop, hex] = m
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const inverts = prop === 'text' ? L < 0.18 : L > 0.75
    if (inverts) used.add(`${prop}-[${hex}]`)
  }
}

assert.ok(
  used.size >= 10,
  `expected to find the light vocabulary in the games files; found ${used.size}. ` +
  'If the parser has drifted, fix it rather than deleting this guard.',
)

/* ── 3. What the remap in index.css names ─────────────────────────────── */

const css = readFileSync(resolve(root, 'src/index.css'), 'utf8')
// The block is keyed to `.force-light-theme` and the dark hook, not to one
// spelling of that hook. There are two dark modes set by two different people
// in two different places — a learner picks Midnight (reading theme, on
// <body>), a teacher picks Night (workspace theme, on <html>) — so the block
// now leads with `:is(body.theme-midnight, html[data-theme='night'] body)`.
// Matching the literal old selector would fail here for a reason that has
// nothing to do with what this test is checking.
const block = css.match(
  /:is\(body\.theme-midnight[^)]*\) \.force-light-theme \{[\s\S]*?(?=\n\/\* Heavy slate shadow)/,
)
assert.ok(
  block,
  'index.css no longer carries the dark remap for .force-light-theme. ' +
  'Without it /games and /quizzes render at full brightness on the dark ' +
  'theme — for a learner on Midnight AND a teacher on Night.',
)

// Selectors are written escaped (`.bg-white\/72`, `.text-\[\#053541\]`);
// unescape so they compare against the class names as authored in JSX.
const remapped = new Set(
  [...block[0].matchAll(/\.((?:[\w-]|\\.)+)/g)]
    .map((m) => m[1].replace(/\\/g, '')),
)

const missing = [...used].filter((c) => !remapped.has(c)).sort()
assert.deepEqual(
  missing,
  [],
  'These light-surface / dark-ink classes are used on the Games or quiz-list ' +
  'surface but are not remapped for Midnight in index.css, so they render at ' +
  'full brightness on the dark theme:\n  ' + missing.join('\n  ') + '\n',
)

console.log(
  `✓ games dark surface — ${used.size} light literals across ${files.length} files, all remapped`,
)
