// Guards the re-extracted Primary 2013 syllabi in curriculum-data-2013.json
// that were rebuilt from source CDC PDFs (scripts/extract-2013-primary.mjs):
// Mathematics (Grades 1-7) and Integrated Science (Grade 5). Their original
// XLSX→JSON conversion produced data-value column headers; only re-extraction
// repairs them. The PDFs aren't committed, so this validates committed shape.
//
// Plain `node` assertion script — run via `npm run test:2013-primary`
// (auto-discovered by scripts/run-all-tests.mjs).

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fullCode } from './lib/syllabusPdfTable.mjs'
import { CONFIGS } from './extract-2013-primary.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]
// Subjects shipped as re-extracted (Social Studies / Zambian Language are not
// yet re-extracted — their dense Knowledge/Skills/Values columns need more
// work — so they're intentionally excluded here).
const SHIPPED = ['math', 'science']

let passed = 0
function check(label, fn) { fn(); passed++; console.log(`  ✓ ${label}`) }

console.log('\nhelpers')
check('fullCode reads the leading dotted code', () => {
  assert.strictEqual(fullCode('5.1.1 The Heart'), '5.1.1')
  assert.strictEqual(fullCode('1.1 NUMBERS AND NOTATION'), '1.1')
  assert.strictEqual(fullCode('The Heart'), null)
})

for (const rel of FILES) {
  console.log(`\n${rel}`)
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

  for (const key of SHIPPED) {
    const cfg = CONFIGS[key]
    const subject = data[cfg.subjectKey]
    check(`${cfg.arg}: subject present`, () => assert.ok(subject, `missing "${cfg.subjectKey}"`))

    for (const g of cfg.replace) {
      const sheet = subject[`Grade ${g}`]
      check(`${cfg.arg} Grade ${g}: canonical columns, no COLUMN N / data-value headers`, () => {
        assert.deepStrictEqual(sheet.columns, cfg.columns)
        for (const col of sheet.columns) {
          assert.ok(!/^COLUMN\s*\d+$/i.test(col), `phantom column: ${col}`)
          assert.ok(!/^\d+\.\d/.test(col), `data-value header: ${col}`)
        }
      })
      check(`${cfg.arg} Grade ${g}: well-formed coded rows`, () => {
        const rows = sheet.rows.filter(r => r.type === 'data')
        assert.ok(rows.length >= 5, `only ${rows.length} rows`)
        let coded = 0
        for (const r of rows) {
          assert.deepStrictEqual(Object.keys(r.cells).sort(), [...cfg.columns].sort())
          if (fullCode(r.cells[cfg.columns[cfg.rowCol]]) || fullCode(r.cells[cfg.columns[cfg.outcomeCol]])) coded++
          for (const v of Object.values(r.cells)) assert.ok(v.length < 2000, 'over-merged cell')
        }
        assert.ok(coded >= rows.length * 0.8, `only ${coded}/${rows.length} coded`)
      })
    }
  }
}

check('public and functions copies agree on the shipped subjects', () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, FILES[0]), 'utf8'))
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, FILES[1]), 'utf8'))
  for (const key of SHIPPED) {
    assert.strictEqual(JSON.stringify(a[CONFIGS[key].subjectKey]), JSON.stringify(b[CONFIGS[key].subjectKey]))
  }
})

console.log(`\nAll ${passed} Primary 2013 checks passed.`)
