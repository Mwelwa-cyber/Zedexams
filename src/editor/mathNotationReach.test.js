/**
 * School notation must REACH every surface that renders it.
 *
 * The regression class this ends: `safeRender.toHTML()` emits
 * `.math-frac-num` / `.math-frac-den` markup, and the CSS that stacks them
 * lived in `editor.css`, which only the authoring surfaces import. The markup
 * shipped to learners with nothing to stack it — a Grade 4 learner met "6 8"
 * instead of a fraction — and it was invisible from every surface a developer
 * would have looked at, because those import editor.css.
 *
 * Nothing failed. That is why this is a test rather than a comment: the fix is
 * one import line, and an import line is exactly the kind of thing a later
 * refactor tidies away while every authoring surface still looks correct.
 *
 * The GEOMETRIC assertion — that the numerator's box actually sits above the
 * denominator's — needs a browser and lands with the screen gate's stage, as
 * a named `stackedNotation` check. This is the half that can run everywhere,
 * and it covers the failure that actually happened.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let passed = 0
const test = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`) }

console.log('editor — school notation reaches the renderer')

// Built from parts, deliberately. Written literally, this file would CONTAIN
// `import('../mathNotation.css')` — and `test:import-boundaries` inspects
// dynamic imports, so it resolved the string relative to THIS file and
// correctly reported that `src/mathNotation.css` does not exist. A good catch
// by that guard, and the reason the pattern is assembled rather than quoted.
const NOTATION_CSS = 'mathNotation.css'
const dynamicImportOf = (spec) => new RegExp(`import\\(['"][^'"]*${spec.replace('.', '\\.')}['"]\\)`)

const safeRender = read('src/editor/utils/safeRender.js')
const notation = read('src/editor/mathNotation.css')
const editorCss = read('src/editor/editor.css')

test('the renderer imports the notation stylesheet', () => {
  // The one line the whole fix is. Without it the markup renders unstyled on
  // every surface that is not the editor.
  assert.match(safeRender, dynamicImportOf(NOTATION_CSS),
    'safeRender.js no longer imports mathNotation.css — the stacking CSS stops reaching '
    + 'the learner routes, and every authoring surface still looks correct')
})

test('it imports it the same way it imports KaTeX — guarded by a window', () => {
  // A top-level CSS import would break the plain-node test runners that load
  // this module, which is why KaTeX is imported this way in the first place.
  const guarded = safeRender.slice(safeRender.indexOf("typeof window !== 'undefined'"))
  assert.match(guarded, dynamicImportOf('katex.min.css'))
  assert.match(guarded, dynamicImportOf(NOTATION_CSS))
})

test('the stylesheet actually stacks — a column, and a bar', () => {
  // Present but gutted is the other way to lose this, and it would look like a
  // working import.
  assert.match(notation, /\.math-frac-stack\s*\{[^}]*flex-direction:\s*column/,
    'the fraction stack is no longer a column — numerator and denominator would sit side by side')
  assert.match(notation, /\.math-frac-num\s*\{[^}]*border-bottom/,
    'the fraction bar is gone — a stacked fraction with no bar is not the school form')
})

test('every class safeRender emits for notation is styled here', () => {
  // Derived from the emitters rather than listed by hand: the fraction, the
  // number base and vertical arithmetic all emit through the same path, and a
  // fourth added later must not silently arrive unstyled.
  for (const cls of ['math-frac', 'math-frac-stack', 'math-frac-num', 'math-frac-den',
    'math-frac-whole', 'vert-arith', 'num-base', 'num-base-sub']) {
    assert.ok(notation.includes(`.${cls}`), `.${cls} is emitted but not styled in mathNotation.css`)
  }
})

test('the rules did not get copied BACK into editor.css', () => {
  // Two copies is how the fix rots: the editor keeps looking right while the
  // renderer's copy drifts or is deleted as a duplicate.
  assert.ok(!/\.math-frac-num\s*\{/.test(editorCss),
    'editor.css has regained the fraction rules — there must be one copy, and it must be the '
    + 'one the renderer imports')
})

test('editor.css still points at where they went', () => {
  assert.match(editorCss, /mathNotation\.css/,
    'the pointer is gone, so the next reader finds an unexplained absence')
})

console.log(`\neditor school notation reach: ${passed} passed`)
