/**
 * Glass-surface token guards (Teacher Dashboard "intelligent glass").
 *
 * Three rules from the glass design brief, enforced so they cannot silently
 * regress:
 *  1. Every themed --ws-* token declared in the light block has a Night
 *     override in .tdv2.is-dark — a token missed there is exactly how a
 *     white glow patch ships on the dark theme. (The --ws-dark-glass-*
 *     family is exempt by name: it styles the hero inset, which is dark in
 *     every theme, so a Night override would be duplication.)
 *  2. No backdrop-filter on any glass CONTENT surface — tiles, panels,
 *     rows, the search bar, the hero inset. Real blur stays reserved for
 *     floating chrome (sticky bars, menus, dialog scrims), which is the
 *     one exception the brief grants; blur on a scrolled grid is the exact
 *     thing it forbids on low-end phones.
 *  3. The sweep animations move via transform, never `left` — animating
 *     layout properties is the other banned cost.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
// The shell keeps the two token stylesheets next to TeacherLayout; the
// dashboard PAGE moved to src/features/dashboardV2/ and took its own
// section stylesheet with it (docs/architecture.md §13).
const dashDir = resolve(root, 'src/components/teacher/dashboardV2')
const featDir = resolve(root, 'src/features/dashboardV2/components')

const glass = readFileSync(resolve(dashDir, 'glassSurface.css'), 'utf8')

/* ── 1. every themed token has a Night override ───────────────────────── */

function tokensIn(block) {
  const names = new Set()
  for (const m of block.matchAll(/(--ws-[\w-]+)\s*:/g)) names.add(m[1])
  return names
}

// The light declarations live in `.tdv2 { … }` blocks that are not
// `.tdv2.is-dark`; the dark ones in `.tdv2.is-dark { … }`.
const blocks = [...glass.matchAll(/^\.tdv2(\.is-dark)?\s*\{([^}]*)\}/gms)]
assert.ok(blocks.length >= 2, 'glassSurface.css must declare .tdv2 and .tdv2.is-dark token blocks')

const light = new Set()
const dark = new Set()
for (const [, isDark, body] of blocks) {
  for (const t of tokensIn(body)) (isDark ? dark : light).add(t)
}
assert.ok(light.size > 0, 'no --ws-* tokens found in the light block')

const THEME_INVARIANT = (name) =>
  name.startsWith('--ws-dark-glass-') || // hero inset: dark in every theme
  name === '--ws-accent' // the inherited alias, not a palette value

const missing = [...light].filter((t) => !THEME_INVARIANT(t) && !dark.has(t))
assert.deepEqual(
  missing,
  [],
  `themed glass tokens missing a Night override in .tdv2.is-dark: ${missing.join(', ')}`,
)

const darkOnly = [...dark].filter((t) => !light.has(t))
assert.deepEqual(
  darkOnly,
  [],
  `Night overrides for tokens that do not exist in the light block (typo?): ${darkOnly.join(', ')}`,
)

/* ── 2. no backdrop-filter outside the auto-hiding chrome bars ────────── */

assert.ok(
  !/backdrop-filter\s*:/.test(glass),
  'glassSurface.css must never use backdrop-filter — that is the whole point of the faked-glass recipe',
)

const dash = readFileSync(resolve(dashDir, 'dashboardV2.css'), 'utf8')
// Content surfaces that must NEVER blur. Floating chrome (sticky header,
// dock, menus, dialog scrims, the preview panel) may.
const CONTENT_SURFACE =
  /\.glass-|\.tws|\.tdv2-tile|\.tdv2m-tool-tile|\.tdv2m-recent-tile|\.tdv2m-qcsheet-tile|\.tdv2m-glass|\.tdv2-doc-row|\.tdv2-search|\.tdv2-hero-inset|\.tdv2-ai-/
// Attribute each backdrop-filter declaration to its rule's selector list.
for (const m of dash.matchAll(/([^{}]+)\{[^}]*backdrop-filter\s*:[^}]*\}/g)) {
  const selectors = m[1].trim().split('\n').pop().trim()
  assert.ok(
    !CONTENT_SURFACE.test(selectors),
    `backdrop-filter on a glass content surface: "${selectors}"`,
  )
}

const tws = readFileSync(resolve(featDir, 'teacherWorkspaceSection.css'), 'utf8')
assert.ok(!/backdrop-filter\s*:/.test(tws), 'teacherWorkspaceSection.css must not use backdrop-filter')

/* ── 3. sweeps animate transform, never `left` ────────────────────────── */

for (const [, name, body] of glass.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
  assert.ok(
    !/[^-\w]left\s*:/.test(body),
    `@keyframes ${name} animates \`left\` — sweeps must move via transform`,
  )
}

console.log('✓ glass tokens — Night overrides complete, no stray backdrop-filter, sweeps use transform')
