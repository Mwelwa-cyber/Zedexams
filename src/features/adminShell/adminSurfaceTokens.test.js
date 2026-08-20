/**
 * The admin shell must paint from ONE palette, whatever the workspace theme.
 *
 * WHAT THIS GUARDS
 * ----------------
 * `/admin` renders inside `.admin-game-theme`, a deliberately fixed light
 * skin — cream parchment, white cards, navy borders, orange stickers. It is
 * not themeable and has no picker anywhere in the admin area.
 *
 * But the shell reads TWO token sets on the same pixels. `.admin-game-theme`
 * pins the reading palette (--bg / --card / --text / --border …), while the
 * chrome and most of AdminDashboard are written in the WORKSPACE tokens
 * (--zt-text, --zt-text-muted, --zt-card, --zt-surface) instead. Those follow
 * `data-theme` on <html>, so until the pin below existed they went dark under
 * the Night workspace theme while the surfaces beneath them stayed white —
 * dashboard headings at 1.23:1, nav labels at 1.97:1, the signed-in admin's
 * own name at 1.24:1.
 *
 * Nobody had to choose Night to see it: boot.js and teacherThemeStore seed the
 * workspace theme from the reading palette, which falls back to
 * `prefers-color-scheme`. A dark-mode OS was enough.
 *
 * WHY A TEXT TEST AND NOT A RENDERED ONE
 * --------------------------------------
 * The failure is a cascade fact — which selector last declared a custom
 * property for a subtree — and it is invisible to a component test: jsdom
 * resolves `var(--zt-text)` to the empty string, so a spec renders the admin
 * shell perfectly happily with every one of these pairs at 1:1. It is equally
 * invisible in review, because the page is correct in three of the four
 * workspace themes and most reviewers are on one of those three.
 *
 * So the vocabulary is checked mechanically instead: every --zt-* token any
 * theme block declares must also be declared inside `.admin-game-theme`, and
 * the pairs the admin actually paints must clear WCAG AA. The completeness
 * half matters more than the contrast half — a partial palette is the failure
 * `.force-light-theme` documents in index.css, where every visible surface
 * looks correct right up until one component reaches for the missing token.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
// Comments are stripped before parsing: the rules under test are introduced
// by long block comments, so a "preceded by `}` or start-of-file" anchor never
// matches on the raw text, and a `{` inside a comment would end a rule body
// early. Stripping first makes both problems disappear rather than making the
// selector pattern cleverer.
const css = stripPrintBlocks(
  readFileSync(resolve(root, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
)

/* ── colour maths (WCAG 2.1) ──────────────────────────────────────────── */

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
  return { rgb: parts.slice(0, 3), alpha: parts.length === 4 ? parts[3] : 1 }
}

// Translucent foregrounds must be composited over their background first —
// measuring the raw rgba reports the contrast of a colour never painted.
function composite(fg, bg) {
  const f = parseColor(fg)
  const b = parseColor(bg)
  return f.rgb.map((c, i) => c * f.alpha + b.rgb[i] * (1 - f.alpha))
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(fg, bg) {
  const l1 = luminance(composite(fg, bg))
  const l2 = luminance(parseColor(bg).rgb)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/* ── reading the declarations out of index.css ────────────────────────── */

/**
 * Remove `@media print { … }` in full, with a brace-matched scan.
 *
 * The print stylesheet flattens every palette scope — `.admin-game-theme`
 * included — to `#ffffff !important` / `#000000 !important` so a printed page
 * is plain black on white. Those declarations are real, but they answer a
 * different question than this test asks, and being last in the document they
 * would win the merge below and hand every contrast pair a trivially-passing
 * black-on-white. A regex cannot do this: the block contains nested rules, so
 * the match has to count braces.
 */
function stripPrintBlocks(source) {
  let out = ''
  let i = 0
  let removed = 0
  while (i < source.length) {
    const at = source.indexOf('@media', i)
    if (at === -1) { out += source.slice(i); break }
    const open = source.indexOf('{', at)
    if (open === -1) { out += source.slice(i); break }
    if (!/print/.test(source.slice(at, open))) {
      out += source.slice(i, open + 1)
      i = open + 1
      continue
    }
    let depth = 1
    let j = open + 1
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth += 1
      else if (source[j] === '}') depth -= 1
      j += 1
    }
    out += source.slice(i, at)
    i = j
    removed += 1
  }
  assert.ok(
    removed > 0,
    'no @media print block was found in index.css — this stripper is no longer '
    + 'doing anything, so the print reset would silently win every comparison '
    + 'below and make each contrast pair pass as black-on-white',
  )
  return out
}

/**
 * Every innermost rule in the stylesheet, as {selectors[], body}.
 *
 * `[^{}]*` for the body is what restricts this to rules that declare
 * properties: an at-rule wrapper like `@layer components { … }` has nested
 * braces, so it never matches and the rules INSIDE it do — which is why
 * `@layer components { … }` needs no handling of its own. `@media print` is
 * the exception and is removed before this runs: its rules ARE innermost.
 */
function innermostRules() {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
    body: m[2],
  }))
}

/**
 * Every custom property `selector` ends up declaring, merged across each rule
 * that lists it, in document order.
 *
 * Merging rather than taking one rule is what makes this work on both shapes
 * in play. The default workspace theme ships as
 * `:root, [data-theme='terracotta'] { … }`, so a sole-selector parser finds
 * nothing for it; `.admin-game-theme` is targeted by several rules, only one
 * of which carries the tokens, so a last-rule-wins parser finds the
 * font-family block and reports zero tokens. Both failures are silent — the
 * guard would pass while covering nothing.
 *
 * Descendant rules (`.admin-game-theme .studio-card`) are excluded by
 * construction: their selector is a different string, so `includes` misses
 * them, which is correct — they style children, not the scope itself.
 */
function declarations(selector) {
  const out = {}
  const matching = innermostRules().filter((r) => r.selectors.includes(selector))
  assert.ok(matching.length > 0, `index.css has no rule for \`${selector}\``)
  for (const rule of matching) {
    for (const decl of rule.body.split(';')) {
      const m = decl.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/i)
      if (m) out[m[1]] = m[2]
    }
  }
  return out
}

const WORKSPACE_THEMES = ['terracotta', 'miombo', 'copperbelt', 'night']
const admin = declarations('.admin-game-theme')

/* ── 1. The pin is COMPLETE ───────────────────────────────────────────── */

// Union across all four themes, not just Night: a token only Miombo declares
// still leaks into /admin for a user on Miombo.
const themeTokens = new Set()
for (const id of WORKSPACE_THEMES) {
  for (const token of Object.keys(declarations(`[data-theme='${id}']`))) {
    themeTokens.add(token)
  }
}

assert.ok(
  themeTokens.size >= 16,
  `only ${themeTokens.size} --zt-* tokens found across the workspace themes — `
  + 'the parser is no longer reading them, so this guard covers nothing',
)

const unpinned = [...themeTokens].filter((t) => !(t in admin)).sort()
assert.deepEqual(
  unpinned, [],
  `.admin-game-theme does not pin ${unpinned.join(', ')}. Every --zt-* token a `
  + 'workspace theme declares must be pinned on the admin skin, or that token '
  + 'keeps following data-theme inside /admin and goes dark under Night while '
  + 'the surface under it stays white. Add it to the block in src/index.css.',
)

/* ── 2. Nothing pinned is itself a --zt-* reference ───────────────────── */

// `--zt-text: var(--zt-text)` would satisfy the check above and pin nothing.
for (const token of themeTokens) {
  assert.ok(
    !/var\(\s*--zt-/.test(admin[token]),
    `.admin-game-theme's ${token} is \`${admin[token]}\` — it resolves back to `
    + 'the workspace theme, so it is not pinned at all.',
  )
}

/* ── 3. The pairs the admin actually paints clear WCAG AA ─────────────── */

const BODY = 4.5
const LARGE = 3

// Each pair names the surface it was measured on, because the bug was never
// one token being wrong — it was two correct tokens from different sets
// meeting on one pixel.
const PAIRS = [
  // AdminDashboard + AdminSetupBanner: --zt-text on this skin's own cards.
  ['AdminDashboard heading (--zt-text on --card)', admin['--zt-text'], admin['--card'], BODY],
  ['AdminDashboard heading (--zt-text on --bg)', admin['--zt-text'], admin['--bg'], BODY],
  ['AdminDashboard body (--zt-text-muted on --card)', admin['--zt-text-muted'], admin['--card'], BODY],
  ['AdminDashboard body (--zt-text-muted on --bg)', admin['--zt-text-muted'], admin['--bg'], BODY],
  // AdminLayout sidebar: this skin's text on the --zt-card fill it paints.
  ['Sidebar nav label (--text-muted on --zt-card)', admin['--text-muted'], admin['--zt-card'], BODY],
  ['Sidebar admin name (--text on --zt-card)', admin['--text'], admin['--zt-card'], BODY],
  // AdminLayout brand strip: --zt-text on the --zt-surface behind it.
  ['Brand strip (--zt-text on --zt-surface)', admin['--zt-text'], admin['--zt-surface'], BODY],
  ['Brand strip muted (--zt-text-muted on --zt-surface)', admin['--zt-text-muted'], admin['--zt-surface'], BODY],
  // Borders carry the sticker look's meaning, so they get the 3:1 UI bar.
  ['Card border (--zt-card-border on --card)', admin['--zt-card-border'], admin['--card'], LARGE],
]

for (const [label, fg, bg, min] of PAIRS) {
  assert.ok(fg && bg, `${label}: a token in this pair is undefined`)
  const ratio = contrastRatio(fg, bg)
  assert.ok(
    ratio >= min,
    `${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}:1`,
  )
}

/* ── 4. The guard can fail ────────────────────────────────────────────── */

// A test whose failure path is never exercised is a test that passes because
// it checks nothing. Night's own --zt-text is what /admin painted before the
// pin; assert it would still be rejected.
const nightText = declarations("[data-theme='night']")['--zt-text']
assert.ok(
  contrastRatio(nightText, admin['--card']) < BODY,
  'Night\'s --zt-text now clears AA on the admin card, so pair check 3 would '
  + 'have passed on the original bug — the guard proves nothing.',
)

console.log(
  `admin surface tokens OK — ${themeTokens.size} --zt-* tokens pinned, `
  + `${PAIRS.length} contrast pairs clear AA`,
)
