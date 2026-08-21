/**
 * `color-mix()` must never be the only thing painting a surface
 * =============================================================
 *
 * The bug this guards (reported on Android, 2026-08-21): the teacher bottom
 * dock rendered as white icons on white, and the mobile nav drawer opened as
 * floating white text over the page. Both are `color-mix()` reaching a WebView
 * below Chrome 111, where the function does not exist.
 *
 * Three layers are checked, because the failure has three doors:
 *
 *   1. The fallback RULES (`fallbackForValue`) — the dominant operand, static
 *      mixes computed exactly, and `transparent` when the tint is the minor
 *      side so the plugin can never make a surface worse than it is today.
 *   2. The PLUGIN — a normal declaration gets a preceding fallback; a custom
 *      property gets inverted into `@supports`, because a browser stores a
 *      custom property's tokens unparsed and a preceding declaration would
 *      simply be overwritten.
 *   3. The REAL stylesheets — every `src/**` CSS file is run through the
 *      plugin and then through an engine that drops `color-mix()`, and the
 *      surfaces that broke are asserted to still be painted. This arm is the
 *      one that would have caught the original bug, and it fails if the
 *      plugin is ever unwired from postcss.config.js.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import colorMixFallback, { fallbackForValue } from './lib/colorMixFallback.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let checks = 0
const ok = (actual, expected, what) => { assert.deepEqual(actual, expected, what); checks += 1 }

/* ── 1. The fallback rules ─────────────────────────────────────────────── */

// The dominant operand wins: the mix result is always nearer the heavier side.
ok(fallbackForValue('color-mix(in srgb, var(--a) 88%, #000000)'), 'var(--a)',
  'the 88% operand is the fallback')
ok(fallbackForValue('color-mix(in srgb, var(--a) 12%, var(--b))'), 'var(--b)',
  'a 12% tint over --b falls back to --b')
// A single percentage implies its complement, and an omitted pair is 50/50.
ok(fallbackForValue('color-mix(in srgb, var(--a), var(--b))'), 'var(--a)',
  'an even mix keeps the first operand')
ok(fallbackForValue('color-mix(in srgb, var(--a) 30%, var(--b) 70%)'), 'var(--b)',
  'explicit weights on both sides are compared')

// THE SAFETY PROPERTY: when the colour is the minor side of a `transparent`
// mix the fallback is `transparent` — precisely what such a declaration
// already resolves to on an engine without color-mix. The plugin can turn a
// dropped declaration into a working one; it can never do the reverse.
ok(fallbackForValue('color-mix(in srgb, var(--a) 10%, transparent)'), 'transparent',
  'a light tint degrades to nothing, exactly as it does today')
ok(fallbackForValue('color-mix(in srgb, var(--a) 94%, transparent)'), 'var(--a)',
  'a 94% mix is opaque enough that the bare colour is the right fallback')

// Both sides static → compute the real mix rather than approximate it.
ok(fallbackForValue('color-mix(in srgb, #ffffff 80%, #000000)'), '#cccccc',
  'a static sRGB mix is computed exactly')
ok(fallbackForValue('color-mix(in srgb, #ff8800 13%, transparent)'), 'rgba(255, 136, 0, 0.13)',
  'a static tint keeps its alpha instead of vanishing')
// Nested mixes resolve innermost-first.
ok(fallbackForValue('color-mix(in srgb, color-mix(in srgb, #ffffff 80%, #000000) 90%, transparent)'),
  'rgba(204, 204, 204, 0.9)', 'a nested mix resolves before its parent')
// Only sRGB is computed; another space keeps the dominant operand rather than
// claiming a wrong-space mix is the true colour.
ok(fallbackForValue('color-mix(in oklab, #ffffff 80%, #000000)'), '#ffffff',
  'a non-sRGB space falls back rather than mis-computing')

// The expression must survive being embedded in a larger value.
ok(fallbackForValue('linear-gradient(180deg, var(--n) 0%, color-mix(in srgb, var(--a) 88%, #000) 100%)'),
  'linear-gradient(180deg, var(--n) 0%, var(--a) 100%)',
  'a mix inside a gradient is replaced in place')
// Both rgb() spellings parse to the same colour, so the exact-mix path is not
// lost just because a value used the modern space-separated form.
ok(fallbackForValue('color-mix(in srgb, rgb(255 136 0 / 50%) 60%, rgb(0 0 0))'),
  fallbackForValue('color-mix(in srgb, rgba(255,136,0,0.5) 60%, #000)'),
  'the space-separated and comma rgb() forms agree')
ok(fallbackForValue('color-mix(in srgb, rgba(255,136,0,0.5) 60%, #000)'), 'rgba(109, 58, 0, 0.7)',
  'alpha is premultiplied when mixing, per css-color-5')

// A value with no mix is returned untouched, and a lookalike token is not one.
ok(fallbackForValue('var(--plain)'), 'var(--plain)', 'a value without a mix is untouched')
ok(fallbackForValue('var(--my-color-mix(x))'), 'var(--my-color-mix(x))',
  'a hyphenated lookalike is not treated as the function')

/* ── 2. The plugin ─────────────────────────────────────────────────────── */

const run = async (css) => (await postcss([colorMixFallback()]).process(css, { from: undefined })).css

// A normal property uses the cascade: an engine that understands the mix takes
// the second declaration, one that does not drops it and keeps the first.
const normal = await run('.dock { background: color-mix(in srgb, var(--teal) 94%, transparent); }')
assert.match(normal, /background:\s*var\(--teal\);/, 'normal property gains a preceding fallback')
assert.match(normal, /background:\s*color-mix\(/, 'normal property keeps the real value')
assert.ok(normal.indexOf('var(--teal);') < normal.indexOf('color-mix('),
  'the fallback must come FIRST or the cascade picks the wrong one')
checks += 3

// A custom property must be inverted instead: a browser stores its tokens
// unparsed, so a preceding fallback declaration would just be overwritten.
const custom = await run(':root { --teal: color-mix(in srgb, var(--bg) 88%, #000); }')
assert.match(custom, /:root\s*{\s*--teal:\s*var\(--bg\);/, 'the definition itself becomes the fallback')
assert.match(custom, /@supports \(color: color-mix\(in srgb, red 50%, blue\)\)/,
  'the real value moves behind an @supports guard')
assert.ok(custom.indexOf('@supports') > custom.indexOf('--teal: var(--bg)'),
  'the guard must come after the fallback definition so it wins where supported')
checks += 3

// `!important` has to travel with the fallback, or the real declaration wins
// on every browser and the fallback never applies where it is needed.
const important = await run('.x { background: color-mix(in srgb, var(--a) 90%, #000) !important; }')
ok((important.match(/!important/g) || []).length, 2, 'the fallback keeps !important')

// An @supports the author wrote themselves already protects its contents.
const authored = await run(
  '@supports (color: color-mix(in srgb, red, blue)) { .y { color: color-mix(in srgb, var(--a) 90%, #000); } }')
let authoredDecls = 0
postcss.parse(authored).walkRules((rule) => { rule.walkDecls(() => { authoredDecls += 1 }) })
ok(authoredDecls, 1, 'an existing color-mix guard is left alone — no second fallback inside it')

// Running twice must not stack guards or fallbacks.
assert.equal(await run(normal), normal, 'the plugin is idempotent for declarations')
assert.equal(await run(custom), custom, 'the plugin is idempotent for custom properties')
checks += 2

// Media context is preserved — the guard is inserted as a sibling of the rule
// it came from, never hoisted out of the query that scoped it.
const inMedia = await run('@media (max-width: 767px) { :root { --x: color-mix(in srgb, var(--a) 80%, #000); } }')
let guardParent = null
postcss.parse(inMedia).walkAtRules('supports', (at) => {
  guardParent = at.parent.type === 'atrule' ? `@${at.parent.name} ${at.parent.params}` : at.parent.type
})
ok(guardParent, '@media (max-width: 767px)', '@supports stays inside its @media')

/* ── 3. The real stylesheets, through an engine with no color-mix ──────── */

function listCss(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listCss(full, out)
    else if (entry.name.endsWith('.css')) out.push(full)
  }
  return out
}

/**
 * Model a WebView below Chrome 111: comments are invisible, `@supports`
 * conditions it cannot satisfy are skipped whole, and any declaration whose
 * value contains `color-mix()` fails to parse and is discarded.
 */
function withoutColorMix(css) {
  const root = postcss.parse(css)
  root.walkAtRules('supports', (at) => { if (/color-mix/i.test(at.params)) at.remove() })
  root.walkDecls((decl) => { if (/color-mix\(/i.test(decl.value)) decl.remove() })
  root.walkComments((c) => c.remove())
  return root
}

/** Collect the last winning value of `prop` for `selector`, or null. */
function declaredValue(root, selector, prop) {
  let found = null
  root.walkRules((rule) => {
    if (!rule.selectors.some((s) => s.trim() === selector)) return
    rule.walkDecls(prop, (decl) => { found = decl.value })
  })
  return found
}

const sourceCss = listCss(path.join(ROOT, 'src'))
assert.ok(sourceCss.length > 0, 'found stylesheets to check')

// Every custom property defined with a mix must still be defined afterwards —
// this is the class that poisons consumers which never mention color-mix
// themselves (the drawer's gradient was one).
let poisoned = 0
const surfaceRoots = []
for (const file of sourceCss) {
  const raw = fs.readFileSync(file, 'utf8')
  if (!/color-mix\(/i.test(raw)) continue
  const defined = new Set()
  postcss.parse(raw).walkDecls((decl) => {
    if (decl.prop.startsWith('--') && /color-mix\(/i.test(decl.value)) defined.add(decl.prop)
  })
  const processed = await postcss([colorMixFallback()]).process(raw, { from: undefined })
  const degraded = withoutColorMix(processed.css)
  surfaceRoots.push({ file, degraded })
  const survivors = new Set()
  degraded.walkDecls((decl) => { if (decl.prop.startsWith('--')) survivors.add(decl.prop) })
  for (const prop of defined) {
    poisoned += 1
    assert.ok(survivors.has(prop),
      `${path.relative(ROOT, file)}: ${prop} is defined only as a color-mix(), so an ` +
      'Android WebView below Chrome 111 stores an unusable value and every ' +
      'consumer of it loses its background. Give it a fallback.')
  }
}
assert.ok(poisoned >= 15, `expected the known derived tokens to be covered, saw ${poisoned}`)
checks += poisoned

// The two surfaces from the report, named so a regression says which screen
// broke rather than which selector.
const SURFACES = [
  ['.tdv2m-dock', 'background', 'the teacher bottom dock (Home / Register / Library / Assessments)'],
  ['.tdv2m-drawer', 'background', 'the teacher mobile navigation drawer'],
  ['.tdv2-topbar', 'background', 'the teacher desktop top bar'],
]
for (const [selector, prop, what] of SURFACES) {
  const painted = surfaceRoots.some(({ degraded }) => {
    const value = declaredValue(degraded, selector, prop)
    return value != null && value !== 'transparent' && value !== 'none'
  })
  assert.ok(painted,
    `${what} (${selector}) has no ${prop} left once color-mix() is dropped — ` +
    'its content would render on whatever is behind it. This is the Android bug.')
  checks += 1
}

/* ── 4. Inline styles are out of the plugin's reach ────────────────────── */

// PostCSS never sees a JSX style object, so an inline color-mix() has no
// fallback at all. These two are reviewed and deliberate: each is decorative
// and the element stays legible without it. A NEW one needs the same review.
const ALLOWED_INLINE = new Map([
  ['src/features/teacherHome/pages/SchoolCalendar.jsx',
    'a selected-card drop shadow; the card also carries a 2px solid border'],
  ['src/features/schemeOfWork/components/SchemeTermPreview.jsx',
    'a 7% tint on a restore button that also carries a dashed border and label'],
])

function listJsx(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listJsx(full, out)
    else if (entry.name.endsWith('.jsx')) out.push(full)
  }
  return out
}

const offenders = []
for (const file of listJsx(path.join(ROOT, 'src'))) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const source = fs.readFileSync(file, 'utf8')
  // Only style values count; the word appearing in prose or a comment is fine.
  const inStyle = /(?:background|color|border|boxShadow|fill|stroke)[^\n]*:\s*[`'"][^`'"\n]*color-mix\(/i.test(source)
  if (inStyle && !ALLOWED_INLINE.has(rel)) offenders.push(rel)
}
assert.deepEqual(offenders, [],
  'inline color-mix() in a JSX style object has no fallback — PostCSS cannot ' +
  'see it. Move the declaration into a stylesheet, or record it in ' +
  'ALLOWED_INLINE with the reason it degrades safely.')
checks += 1

// The allow-list must not rot: a listed file that no longer has one should go.
for (const [rel] of ALLOWED_INLINE) {
  const source = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  assert.ok(/color-mix\(/.test(source),
    `${rel} is on ALLOWED_INLINE but no longer uses color-mix() — remove the entry.`)
  checks += 1
}

/* ── 5. The plugin is actually wired in ────────────────────────────────── */

const postcssConfig = fs.readFileSync(path.join(ROOT, 'postcss.config.js'), 'utf8')
assert.match(postcssConfig, /colorMixFallback/,
  'postcss.config.js no longer runs the fallback plugin, so nothing above ships')
checks += 1

console.log(`color-mix fallback: ${checks} checks passed`)
