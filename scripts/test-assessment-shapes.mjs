#!/usr/bin/env node
/**
 * Guards that the assessment shape allowlist (functions/teacherTools/
 * assessmentShapes.js — a CommonJS mirror the prompt + schema use) never
 * drifts from the real SVG catalog (src/curriculum/diagrams/diagramCatalog.js).
 * Every allowlisted key must exist in the catalog, every listed param must be a
 * real field on that catalog entry, and every key must render a valid SVG.
 * Run: node scripts/test-assessment-shapes.mjs
 */

import { createRequire } from 'node:module'
import assert from 'node:assert'

const require = createRequire(import.meta.url)
const { SHAPE_LIBRARY } = require('../functions/teacherTools/assessmentShapes.js')
const { DIAGRAM_CATALOG, renderDiagramSvg } = await import('../src/curriculum/diagrams/diagramCatalog.js')

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('assessmentShapes ↔ diagramCatalog')

for (const [key, { params }] of Object.entries(SHAPE_LIBRARY)) {
  const entry = DIAGRAM_CATALOG[key]
  assert.ok(entry, `allowlisted shape "${key}" must exist in the diagram catalog`)

  // Every param we advertise to the model must be a real field on the catalog
  // entry (its `fields` are [key, label] pairs) so the model can't be told to
  // set a param the renderer ignores.
  const fieldKeys = new Set(entry.fields.map(([f]) => f))
  for (const p of params) {
    assert.ok(fieldKeys.has(p), `shape "${key}" param "${p}" must be a catalog field`)
  }

  // And it must actually render.
  const svg = renderDiagramSvg(key, entry.defaults, '#1c1612')
  assert.ok(svg && svg.startsWith('<svg') && svg.endsWith('</svg>'), `shape "${key}" must render an SVG`)
}
ok(`all ${Object.keys(SHAPE_LIBRARY).length} allowlisted shapes exist, fields match, and render`, true)

console.log(`assessmentShapes: ${passed} checks passed`)
