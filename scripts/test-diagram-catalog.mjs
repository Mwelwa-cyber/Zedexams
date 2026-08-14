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
} from '../src/curriculum/diagrams/diagramCatalog.js'

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

test('clockface + protractor exist and render valid <svg>', () => {
  for (const key of ['clockface', 'protractor']) {
    const entry = getDiagram(key)
    assert.ok(entry && typeof entry.render === 'function', `missing entry: ${key}`)
    const svg = renderDiagramSvg(key, entry.defaults)
    assert.ok(typeof svg === 'string' && svg.includes('<svg') && svg.trim().endsWith('</svg>'), `${key} not a closed SVG`)
  }
})

test('clockface draws two hands from numeric hour/minute (injection-safe)', () => {
  // Hour/minute are parsed as numbers — a hostile string falls back to a time
  // and renders no raw author text, so it can never inject markup.
  const svg = renderDiagramSvg('clockface', { hour: '<script>x</script>', minute: '<script>x</script>' })
  assert.ok(!svg.includes('<script>'), 'clockface must not echo a hostile label')
  // Twelve numerals + 60 ticks + 2 hands + centre dot — at least the two hands.
  assert.ok((svg.match(/<line /g) || []).length >= 62, 'clockface should draw ticks + hands')
})

test('protractor labels with the normalised numeric angle (no raw author text)', () => {
  assert.ok(renderDiagramSvg('protractor', { angle: '60' }).includes('>60°</text>'), 'prints the degree label')
  // A raw "60°" param must not double up the degree sign.
  assert.ok(renderDiagramSvg('protractor', { angle: '60°' }).includes('>60°</text>'), 'no 60°° doubling')
  // An out-of-range angle clamps the arm AND the label to 180 so they agree.
  assert.ok(renderDiagramSvg('protractor', { angle: '200' }).includes('>180°</text>'), '200 clamps to 180°')
  // A hostile / non-numeric angle renders no raw markup — it falls back to 60.
  const hostile = renderDiagramSvg('protractor', { angle: '<script>x</script>' })
  assert.ok(!hostile.includes('<script>'), 'protractor never echoes a hostile angle')
  assert.ok(hostile.includes('>60°</text>'), 'non-numeric angle falls back to 60°')
})

test('barchart + linegraph print a numbered y-axis scale', () => {
  // max 60 → nice step 20 → tick labels 0, 20, 40, 60 on the axis.
  for (const key of ['barchart', 'linegraph']) {
    const svg = renderDiagramSvg(key, { labels: 'a,b,c,d,e', values: '40,50,20,60,30' })
    for (const t of ['>0</text>', '>20</text>', '>40</text>', '>60</text>']) {
      assert.ok(svg.includes(t), `${key} missing y-axis label ${t}`)
    }
  }
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
