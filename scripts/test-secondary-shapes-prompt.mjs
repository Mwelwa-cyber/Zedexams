/**
 * scripts/test-secondary-shapes-prompt.mjs — the model is actually offered the
 * secondary figures.
 *
 * A figure the catalog can draw and the prompt never mentions is a figure that
 * will never be generated, and nothing else in the suite notices: every catalog
 * test passes, every export test passes, and papers simply come back without
 * it. `assessmentShapes.js` is the CommonJS allowlist the prompt is built from
 * (test:assessment-shapes already proves its keys and params exist in the real
 * catalog); this proves the secondary families reached it and reached the
 * prompt text the model is handed.
 *
 * Run: node scripts/test-secondary-shapes-prompt.mjs
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { DIAGRAM_CATALOG } from '../functions/shared/assessment/diagramCatalogCore.js'

const require = createRequire(import.meta.url)
const { SHAPE_LIBRARY, isAllowedShape, shapeLibraryReference } = require('../functions/teacherTools/assessmentShapes.js')
const { SYSTEM_PROMPT } = require('../functions/teacherTools/assessmentPromptV10.js')

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const SECONDARY = [
  'circletheorem', 'bearings', 'elevation', 'labelledtriangle',
  'functiongraph', 'transformation', 'vectordiagram',
  'histogram', 'frequencypolygon', 'ogive', 'travelgraph', 'linearprogramming',
  'earthgeometry', 'venn3elements',
]

console.log('\nthe secondary figures reach the model')

test('every secondary family is on the generation allowlist', () => {
  for (const key of SECONDARY) {
    assert.ok(isAllowedShape(key), `"${key}" can be drawn but generation is not allowed to ask for it`)
  }
})

test('every catalog field of a secondary family is offered as a param', () => {
  // The sibling test (test:assessment-shapes) proves each ADVERTISED param is a
  // real field. This is the other direction: a field the prompt never mentions
  // is one the model cannot set, so the figure silently renders its default —
  // an ogive with no read-off lines, a graph with nothing marked on it.
  for (const key of SECONDARY) {
    const fields = DIAGRAM_CATALOG[key].fields.map(([f]) => f)
    const offered = new Set(SHAPE_LIBRARY[key].params)
    for (const field of fields) {
      assert.ok(offered.has(field), `${key}.${field} exists but is never offered to the model`)
    }
  }
})

test('the prompt lists every secondary key with its params', () => {
  const reference = shapeLibraryReference()
  for (const key of SECONDARY) {
    assert.ok(reference.includes(`- ${key} —`), `the shape reference omits ${key}`)
  }
  // And the reference really is what gets injected into the prompt.
  assert.ok(SYSTEM_PROMPT.includes(`- ${SECONDARY[0]} —`), 'the prompt does not carry the shape reference')
})

test('the prompt shows a worked example for each family cluster', () => {
  // The model follows examples far more reliably than it follows a parameter
  // list, and these params are dense: "A@200" and "A>B,060,8" are not
  // guessable from a field name.
  for (const key of ['circletheorem', 'bearings', 'functiongraph', 'transformation', 'ogive', 'linearprogramming', 'earthgeometry']) {
    assert.ok(SYSTEM_PROMPT.includes(`libraryKey:"${key}"`), `the prompt has no worked example for ${key}`)
  }
})

test('the self-check tells the model an unusable figure blocks the whole paper', () => {
  // Because it does — resolveFigureForExport refuses the export. A model that
  // is not told this has no reason to check its own parameters.
  const selfCheck = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('VALIDATE BEFORE YOU EMIT'))
  assert.match(selfCheck, /libraryKey from the list above/)
  assert.match(selfCheck, /BLOCKS the whole paper from being exported/)
})

console.log(`\nsecondary shapes ↔ prompt: ${passed} passed\n`)
