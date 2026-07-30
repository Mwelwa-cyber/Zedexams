/**
 * A custom <select> arrow must not tile.
 *
 * WHAT WENT WRONG
 * A dark-theme override written as
 *
 *     [data-theme='night'] .studio-theme .studio-input {
 *       background: var(--zt-card);
 *     }
 *
 * changed nothing but a colour, as far as anyone reading it could tell. But
 * `background` is a SHORTHAND: it resets every background longhand it does not
 * name, so `background-repeat` went back to `repeat` and `background-position`
 * to `0% 0%`. The rule that draws the studio select arrow set those longhands
 * — in a different rule, further up the file — and re-declared only
 * `background-image` for the dark theme. The arrow then tiled across the whole
 * control, on every Class/Grade/Subject/Term/Week select in the app, on Night
 * only.
 *
 * Nothing about that is visible in the offending rule: it does not mention
 * repeat, or position, or the arrow. That is why this is a test and not a
 * convention.
 *
 * THE TWO INVARIANTS
 *
 * 1. GEOMETRY TRAVELS WITH THE IMAGE. Any rule that sets a
 *    `background-image: url(...)` must set `background-repeat` in the SAME
 *    rule. Relying on a repeat declared in a different rule is what left the
 *    two separable, and a shorthand anywhere in between separates them.
 *
 * 2. THE BACKSTOP EXISTS. An unlayered `select { background-repeat: no-repeat }`
 *    catches anything invariant 1 misses — including a shorthand introduced by
 *    a future @layer rule, which a layered fix could not outrank. It is safe as
 *    a blanket because a <select> is a single-line control: a tiled background
 *    on one is a bug in every case.
 *
 * Both are asserted because either alone leaves a real hole: (1) alone can be
 * beaten by specificity, and (2) alone would let a mispositioned arrow through
 * (repeat fixed, but still drawn at 0% 0% instead of the right edge).
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative, extname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')

const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', 'android'])
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue
    const f = join(dir, n)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (['.css', '.jsx'].includes(extname(f))) out.push(f)
  }
  return out
}

function parseRules(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{', i)
    if (open === -1) break
    let depth = 1
    let j = open + 1
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
    const selector = src.slice(i, open).split('}').pop().split('{').pop().trim()
    const body = src.slice(open + 1, j - 1)
    if (selector.startsWith('@')) out.push(...parseRules(body))
    else if (selector) out.push({ selector, body, line: src.slice(0, open).split('\n').length })
    i = j
  }
  return out
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ')

/* ── 1. Every background-image rule carries its own repeat ────────────── */

// A repeating background is legitimate for a TEXTURE — a page backdrop, a
// pattern, a gradient tile. The invariant is about images used as an ICON in a
// control, which is what a `url(data:image/svg+xml…)` on an input, select or
// button always is.
const isControlIcon = (rule) =>
  /background-image\s*:\s*url\(\s*["']?data:image\/svg\+xml/.test(rule.body) &&
  /(?:^|[\s.#>+~])(?:select|input|button|\.[\w-]*(?:input|select|search|field|box|btn|button)[\w-]*)\b/i.test(rule.selector)

const orphans = []
for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file)
  if (/\.(test|spec)\./.test(rel)) continue
  let css = readFileSync(file, 'utf8')
  if (rel.endsWith('.jsx')) {
    const m = css.match(/<style>\{`([\s\S]*?)`\}<\/style>/)
    if (!m) continue
    css = m[1]
  }
  for (const rule of parseRules(stripComments(css))) {
    if (!isControlIcon(rule)) continue
    if (/background-repeat\s*:/.test(rule.body)) continue
    orphans.push(`${rel}:${rule.line}  ${rule.selector.split(',')[0].trim()}`)
  }
}

assert.deepEqual(
  orphans,
  [],
  'These rules draw an icon into a control with background-image but do not ' +
    'set `background-repeat` in the same rule. A background-image tiles by ' +
    'default, and any `background:` shorthand elsewhere in the cascade resets ' +
    'a repeat declared in a different rule without naming it — which is how ' +
    'the studio select arrow came to tile across every dropdown on Night. Add ' +
    '`background-repeat: no-repeat` (and the position) to the rule that sets ' +
    `the image:\n  ${orphans.join('\n  ')}`,
)

/* ── 2. The unlayered backstop is still there ─────────────────────────── */

const indexCss = readFileSync(resolve(root, 'src/index.css'), 'utf8')

// Must be OUTSIDE @layer: a layered rule loses to any unlayered one, and the
// shorthands this defends against live in @layer utilities.
const layerRanges = []
{
  const src = stripComments(indexCss)
  const re = /@layer\b[^{]*\{/g
  let m
  while ((m = re.exec(src))) {
    let depth = 1
    let j = re.lastIndex
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
    layerRanges.push([m.index, j])
  }
}
const backstop = /(?:^|\})\s*select\s*\{[^}]*background-repeat\s*:\s*no-repeat/m.exec(stripComments(indexCss))

assert.ok(
  backstop,
  'The unlayered `select { background-repeat: no-repeat }` backstop is gone ' +
    'from src/index.css. It is the only thing that catches a `background:` ' +
    'shorthand introduced inside @layer, which a layered fix cannot outrank. ' +
    'Restore it rather than relying on every arrow rule being correct.',
)
assert.ok(
  !layerRanges.some(([a, b]) => backstop.index >= a && backstop.index < b),
  'The `select { background-repeat: no-repeat }` backstop has moved INSIDE an ' +
    '@layer. Layered rules lose to unlayered ones, so from in there it can no ' +
    'longer outrank the `background:` shorthands it exists to defend against. ' +
    'Move it back out of the layer.',
)

console.log('select arrow: ok')
