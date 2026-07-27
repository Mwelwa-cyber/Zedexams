/**
 * Every shape in the catalogue draws.
 *
 * The export gate refuses a paper whose required diagram the catalogue "cannot
 * draw", and it cannot tell a key that was never in the catalogue from a shape
 * whose own drawing code throws or returns nothing. Both come back as the same
 * unresolved figure, and the teacher is told to replace a diagram that is
 * perfectly valid and simply broken.
 *
 * Only the catalogue itself can tell those apart, so it is checked here: every
 * key, with default params, and again with the params a caller might not pass.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { DIAGRAM_CATALOG, renderDiagramSvg } from './diagramCatalogCore.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const keys = Object.keys(DIAGRAM_CATALOG)

test('the catalogue is not empty', () => {
  // A test that iterates an empty catalogue passes without checking anything.
  assert.ok(keys.length > 5, `expected a catalogue of shapes, found ${keys.length}`)
})

test('every shape draws with no params at all', () => {
  // The gate calls the resolver with whatever the paper stored, which for an
  // AI-chosen diagram is often nothing. A shape that needs params to survive is
  // a shape that reports itself missing on exactly the papers most likely to
  // use it.
  const broken = []
  for (const key of keys) {
    let svg = null
    try {
      svg = renderDiagramSvg(key)
    } catch (err) {
      broken.push(`${key} threw: ${err.message}`)
      continue
    }
    if (!svg || !String(svg).includes('<svg')) broken.push(`${key} drew nothing`)
  }
  assert.deepEqual(broken, [], `shapes that would be reported as unresolved:\n        ${broken.join('\n        ')}`)
})

test('every shape draws with an empty params object and a colour', () => {
  const broken = []
  for (const key of keys) {
    try {
      const svg = renderDiagramSvg(key, {}, '#1c1612')
      if (!svg || !String(svg).includes('<svg')) broken.push(key)
    } catch (err) {
      broken.push(`${key} threw: ${err.message}`)
    }
  }
  assert.deepEqual(broken, [])
})

test('a key that is not in the catalogue draws nothing, rather than throwing', () => {
  // The gate treats a throw and a falsy return as the same answer, but only the
  // falsy return lets the PLACEHOLDER path in the exporters run.
  assert.ok(!renderDiagramSvg('not-a-shape'))
  assert.ok(!renderDiagramSvg(''))
  assert.ok(!renderDiagramSvg(null))
  assert.ok(!renderDiagramSvg(undefined))
})

test('the drawn shape carries the colour it was given', () => {
  const key = keys[0]
  const svg = String(renderDiagramSvg(key, {}, '#ff0000'))
  assert.ok(svg.includes('#ff0000') || svg.includes('ff0000'),
    `${key} ignored its colour — a monochrome paper would print it in the default ink`)
})

if (!process.exitCode) {
  console.log(`\n✓ diagram catalogue — ${passed} tests passed across ${keys.length} shapes`)
}
