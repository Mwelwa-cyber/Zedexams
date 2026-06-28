// Guards the re-extracted English Language (Grades 2-7, 2013) syllabus in
// curriculum-data-2013.json. Grades 3-7 were re-extracted from the source CDC
// PDF (see scripts/extract-2013-english.mjs) after the XLSX conversion left
// them with data-value column headers, swapped Component/Topic columns and
// truncated Skills/Values. The PDF isn't committed, so this validates the
// committed output shape rather than re-running the extraction.
//
// Plain `node` assertion script — run via `npm run test:2013-english`
// (auto-discovered by scripts/run-all-tests.mjs).

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUBJECT, COLS, topicKeyOf, lineKey } from './extract-2013-english.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]
const GRADES = ['Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7']

let passed = 0
function check(label, fn) { fn(); passed++; console.log(`  ✓ ${label}`) }

// ── Unit checks on the extractor helpers ────────────────────────────────────
console.log('\nhelpers')
check('topicKeyOf takes the first three code segments', () => {
  assert.strictEqual(topicKeyOf('5.1.2.1 Seek and give'), '5.1.2')
  assert.strictEqual(topicKeyOf('5.1.2. Language in a social setting'), '5.1.2')
  assert.strictEqual(topicKeyOf('7.4.8.1 Identify nouns'), '7.4.8')
  assert.strictEqual(topicKeyOf('Nouns'), null)
})
check('lineKey resolves the row key from topic OR outcome', () => {
  // outcome printed above its own topic cell still resolves to the same key
  assert.strictEqual(lineKey('', '5.1.2.1 Seek'), '5.1.2')
  assert.strictEqual(lineKey('5.1.2. Language', 'give factual'), '5.1.2')
  // word-labelled writing topic keyed off its outcome code
  assert.strictEqual(lineKey('Nouns', '7.4.8.1 Identify'), '7.4.8')
  // pure continuation line has no key
  assert.strictEqual(lineKey('a story', 'characters in'), null)
})

// ── Whole-dataset guards on the committed JSON ──────────────────────────────
for (const rel of FILES) {
  console.log(`\n${rel}`)
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  const subject = data[SUBJECT]

  check('subject present with the six grade sheets', () => {
    assert.ok(subject, `missing "${SUBJECT}"`)
    assert.deepStrictEqual(Object.keys(subject), GRADES)
  })

  for (const sheetName of GRADES) {
    const sheet = subject[sheetName]
    check(`${sheetName}: canonical columns (no COLUMN N, no data-value headers)`, () => {
      assert.deepStrictEqual(sheet.columns, COLS)
      for (const col of sheet.columns) {
        assert.ok(!/^COLUMN\s*\d+$/i.test(col), `phantom column: ${col}`)
        assert.ok(!/^\d+\.\d+/.test(col), `data-value header: ${col}`)
      }
    })
  }

  // The re-extracted grades carry the substance the old data had lost.
  for (const sheetName of ['Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7']) {
    const sheet = subject[sheetName]
    check(`${sheetName}: well-formed rows with populated outcomes`, () => {
      const rows = sheet.rows.filter(r => r.type === 'data')
      assert.ok(rows.length >= 15, `only ${rows.length} rows`)
      let coded = 0
      for (const r of rows) {
        assert.deepStrictEqual(Object.keys(r.cells).sort(), [...COLS].sort())
        if (topicKeyOf(r.cells.TOPIC) || topicKeyOf(r.cells['SPECIFIC OUTCOMES'])) coded++
        // No giant merged row survived the splitter.
        for (const v of Object.values(r.cells)) assert.ok(v.length < 1200, 'over-merged cell')
      }
      // Most rows should be anchored to a real topic/outcome code.
      assert.ok(coded >= rows.length * 0.7, `only ${coded}/${rows.length} coded rows`)
    })
  }
}

// Both copies must stay byte-identical for the subject.
check('public and functions copies agree on the English subject', () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, FILES[0]), 'utf8'))[SUBJECT]
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, FILES[1]), 'utf8'))[SUBJECT]
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b))
})

console.log(`\nAll ${passed} English 2013 checks passed.`)
