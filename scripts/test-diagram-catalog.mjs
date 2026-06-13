/**
 * Tests for the diagram catalog — focuses on the new maths diagram entries.
 * Plain `node` ES-module script (no test runner).
 *
 * Run: node scripts/test-diagram-catalog.mjs
 */

import assert from 'node:assert'
import {
  DIAGRAM_CATALOG,
  renderDiagramSvg,
  getDiagram,
} from '../src/components/diagrams/diagramCatalog.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('diagramCatalog')

const NEW_KEYS = ['mapping', 'vennelements', 'parallelogramh', 'triangleangle']

test('new maths diagram keys exist with the catalog shape', () => {
  for (const key of NEW_KEYS) {
    const entry = getDiagram(key)
    assert.ok(entry, `missing entry: ${key}`)
    assert.ok(typeof entry.name === 'string' && entry.name.length, `${key} needs a name`)
    assert.ok(typeof entry.cat === 'string' && entry.cat.length, `${key} needs a category`)
    assert.ok(entry.defaults && typeof entry.defaults === 'object', `${key} needs defaults`)
    assert.ok(Array.isArray(entry.fields) && entry.fields.length, `${key} needs fields`)
    assert.ok(typeof entry.render === 'function', `${key} needs a render fn`)
  }
})

test('new keys render valid <svg> output from their defaults', () => {
  for (const key of NEW_KEYS) {
    const svg = renderDiagramSvg(key, getDiagram(key).defaults)
    assert.ok(typeof svg === 'string', `${key} render returned non-string`)
    assert.ok(svg.includes('<svg'), `${key} output is not an SVG`)
    assert.ok(svg.trim().endsWith('</svg>'), `${key} SVG is not closed`)
  }
})

test('author-entered labels are escaped (no raw angle brackets injected)', () => {
  // Feed a hostile label into every text field of each new diagram; the only
  // angle brackets in the output must be the SVG tags themselves.
  for (const key of NEW_KEYS) {
    const entry = getDiagram(key)
    const params = {}
    for (const [fieldKey] of entry.fields) params[fieldKey] = '<script>x</script>'
    const svg = renderDiagramSvg(key, params)
    assert.ok(!svg.includes('<script>'), `${key} did not escape a hostile label`)
    assert.ok(svg.includes('&lt;script&gt;'), `${key} should HTML-escape the label`)
  }
})

test('mapping diagram draws an arrow polygon for each valid link', () => {
  const svg = renderDiagramSvg('mapping', { left: '1,2,3', right: '2,4,6', links: '1>1,3>3' })
  // Two links → two arrowhead polygons.
  assert.equal((svg.match(/<polygon/g) || []).length, 2)
})

test('vennelements places each region\'s elements as text', () => {
  const svg = renderDiagramSvg('vennelements', { onlyA: '1,2', both: '3', onlyB: '4', outside: '9' })
  for (const el of ['1', '2', '3', '4', '9']) {
    assert.ok(svg.includes(`>${el}</tspan>`), `element ${el} not rendered`)
  }
})

test('numberlinejump draws an arc + delta label per jump', () => {
  const svg = renderDiagramSvg('numberlinejump', { min: '-5', max: '5', jumps: '-3>2,2>-1' })
  assert.ok(typeof svg === 'string' && svg.includes('<svg') && svg.trim().endsWith('</svg>'), 'must be a closed SVG')
  // One quadratic arc <path> per valid jump.
  assert.equal((svg.match(/<path/g) || []).length, 2, 'one arc per jump')
  // Delta labels are computed from the numeric endpoints: -3→2 is +5.
  // (+5 can't come from the tick numbers, which render unsigned.)
  assert.ok(svg.includes('>+5</text>'), 'positive delta label rendered')
  // Out-of-range / malformed pairs are skipped (no arc).
  const skipped = renderDiagramSvg('numberlinejump', { min: '-5', max: '5', jumps: '99>2,foo>bar' })
  assert.equal((skipped.match(/<path/g) || []).length, 0, 'invalid/out-of-range jumps skipped')
})

test('renderDiagramSvg still returns null for an unknown key', () => {
  assert.equal(renderDiagramSvg('not-a-real-diagram', {}), null)
})

test('catalog has no duplicate keys for the new entries', () => {
  const keys = Object.keys(DIAGRAM_CATALOG)
  for (const key of NEW_KEYS) {
    assert.equal(keys.filter(k => k === key).length, 1, `${key} duplicated`)
  }
})

console.log(`\ndiagramCatalog: ${passed} passed`)
