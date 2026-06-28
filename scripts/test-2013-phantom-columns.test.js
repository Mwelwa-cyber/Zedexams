// Guards the phantom-column repair applied to several 2013 syllabi in
// curriculum-data-2013.json (Food & Nutrition, Home Management, Mathematics
// G10/G11, Agricultural Science G12, Physical Education G8 & G12). Before the
// fix these sheets showed literal "COLUMN N" headers with the cell text one
// column off; see scripts/fix-2013-phantom-columns.mjs.
//
// Plain `node` assertion script — run via `npm run test:2013-phantom-columns`
// (auto-discovered by scripts/run-all-tests.mjs).

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLANS, rebuildSheet, assertLossless } from './fix-2013-phantom-columns.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

let passed = 0
function check(label, fn) {
  fn()
  passed++
  console.log(`  ✓ ${label}`)
}

for (const rel of FILES) {
  console.log(`\n${rel}`)
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

  for (const plan of PLANS) {
    const subject = data[plan.subject]
    check(`${plan.label}: subject present`, () => {
      assert.ok(subject, `missing "${plan.subject}"`)
    })

    for (const [sheetName, sheetPlan] of Object.entries(plan.sheets)) {
      const sheet = subject[sheetName]
      const canonical = sheetPlan.map(([name]) => name)

      check(`${plan.label} / ${sheetName}: canonical columns, no phantom COLUMN N`, () => {
        assert.deepStrictEqual(sheet.columns, canonical)
        for (const col of sheet.columns) {
          assert.ok(!/^COLUMN\s*\d+$/i.test(col), `phantom column survived: ${col}`)
        }
      })

      check(`${plan.label} / ${sheetName}: rows carry only canonical keys, no leaked headers`, () => {
        for (const row of sheet.rows) {
          if (row.type !== 'data') continue
          assert.deepStrictEqual(Object.keys(row.cells).sort(), [...canonical].sort())
          const joined = Object.values(row.cells).join(' ').trim().toUpperCase()
          assert.notStrictEqual(joined, 'KNOWLEDGE SKILLS VALUES')
          assert.notStrictEqual(joined, 'KNOWLEDGE')
        }
      })

      check(`${plan.label} / ${sheetName}: rebuild is idempotent`, () => {
        const again = rebuildSheet(sheet, sheetPlan)
        assert.strictEqual(JSON.stringify(again), JSON.stringify(sheet))
        // ...and lossless against itself.
        assertLossless(sheet, again, sheetPlan)
      })
    }
  }
}

console.log(`\nAll ${passed} 2013 phantom-column checks passed.`)
