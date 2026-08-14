#!/usr/bin/env node
/**
 * Guards that the SBA diagram allowlist (functions/teacherTools/sbaDiagrams.js —
 * the CommonJS mirror the SBA prompt + schema use) never drifts from the real
 * SVG catalog (src/curriculum/diagrams/diagramCatalog.js). Every allowlisted key
 * must exist in the catalog, every listed param must be a real field on that
 * catalog entry, and every key must render a valid SVG.
 * Run: node scripts/test-sba-diagrams.mjs
 */

import { createRequire } from 'node:module'
import assert from 'node:assert'

const require = createRequire(import.meta.url)
const { SBA_DIAGRAM_LIBRARY } = require('../functions/teacherTools/sbaDiagrams.js')
const { DIAGRAM_CATALOG, renderDiagramSvg } = await import('../src/curriculum/diagrams/diagramCatalog.js')

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('sbaDiagrams ↔ diagramCatalog')

for (const [key, { params }] of Object.entries(SBA_DIAGRAM_LIBRARY)) {
  const entry = DIAGRAM_CATALOG[key]
  assert.ok(entry, `allowlisted SBA diagram "${key}" must exist in the diagram catalog`)

  const fieldKeys = new Set(entry.fields.map(([f]) => f))
  for (const p of params) {
    assert.ok(fieldKeys.has(p), `SBA diagram "${key}" param "${p}" must be a catalog field`)
  }

  const svg = renderDiagramSvg(key, entry.defaults, '#1c1612')
  assert.ok(svg && svg.startsWith('<svg') && svg.endsWith('</svg>'), `SBA diagram "${key}" must render an SVG`)
}
ok(`all ${Object.keys(SBA_DIAGRAM_LIBRARY).length} allowlisted SBA diagrams exist, fields match, and render`, true)

console.log(`sbaDiagrams: ${passed} checks passed`)
