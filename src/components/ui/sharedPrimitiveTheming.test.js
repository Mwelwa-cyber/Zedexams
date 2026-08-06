/**
 * The shared UI primitives must follow the theme.
 *
 * These four components are drawn on dozens of screens, so a fixed light
 * palette in one of them is not one bug — it is the same bug everywhere the
 * component is used, and it is exactly what "some parts are not in dark mode"
 * looks like from the outside: a page that is correctly dark except for the
 * status pills, the header badge, or a pagination error.
 *
 * The test reads the SOURCE rather than rendering, deliberately. What is
 * being pinned is that no fixed light colour is written down in these files
 * at all — a render assertion in jsdom cannot see it, because jsdom applies
 * no stylesheet and every one of these classes resolves to nothing.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Tailwind's numbered colour scales are a light-theme palette with no dark
 * variant in this codebase — `bg-green-100` is the same wash on Night as on
 * cream. The semantic tokens (--success-bg and friends) exist precisely to
 * replace them and are redeclared per theme.
 *
 * `-500`/`-600` fills are allowed: those are saturated enough to read on
 * either surface, and the badge dot is meant to be loud in every theme. What
 * is banned is the pale end, plus white/black literals used as a SURFACE.
 */
const LIGHT_SCALE = /\b(?:bg|text|border|ring)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300)\b/g

/** A fixed hex where a token belongs. */
const HEX_LITERAL = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g

/** `ring-white` / `bg-white` — a halo or a card that cannot go dark. */
const FIXED_WHITE = /\b(?:bg|ring|border)-white\b/g

const FILES = [
  'StatusBadge.jsx',
  'HeaderIconButton.jsx',
  'PaginationFooter.jsx',
]

/**
 * Comments explain the fix and legitimately name the colours being replaced,
 * so they must not be scanned — otherwise the only way to pass is to delete
 * the reasoning.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const failures = []

for (const file of FILES) {
  const src = stripComments(readFileSync(join(here, file), 'utf8'))
  for (const [label, pattern] of [
    ['light Tailwind scale', LIGHT_SCALE],
    ['hex literal', HEX_LITERAL],
    ['fixed white', FIXED_WHITE],
  ]) {
    const hits = src.match(pattern)
    if (hits) failures.push(`${file}: ${label} → ${[...new Set(hits)].join(', ')}`)
  }
}

assert.deepEqual(
  failures,
  [],
  'These shared primitives paint a fixed light palette, so they stay light on ' +
  'Night wherever they are used. Replace with the semantic tokens ' +
  '(bg-success-subtle / text-success / bg-danger-subtle / text-danger / ' +
  'bg-info-subtle / text-info / bg-warning-subtle / text-warning) or the ' +
  'theme tokens (theme-card / theme-border / theme-bg-subtle / ' +
  'theme-text-muted), which are all redeclared per theme:\n  ' +
  failures.join('\n  '),
)

/*
 * The guard has to be able to fail, or it is decoration. Re-run the same
 * matcher against the code these files used to contain.
 */
const BEFORE = `
  draft: { cls: 'bg-gray-100 text-gray-600' },
  active: 'border-blue-200 bg-blue-50 text-blue-700',
  <span className="bg-red-500 ring-2 ring-white" />
  <p style={{ color: '#b91c1c' }} />
`
const caught = [LIGHT_SCALE, HEX_LITERAL, FIXED_WHITE].filter((p) => BEFORE.match(p))
assert.equal(caught.length, 3, 'the matchers must catch the palette they replaced')

console.log('shared primitive theming: ok')
