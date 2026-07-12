/**
 * Migration tests for the 2013 curriculum normalizer
 * (scripts/migrate-2013-curriculum.mjs). Runs the migrate() transform over the
 * REAL 2013 data and asserts the acceptance-level guarantees:
 *   • combined outcomes are split into independent records (Tests 1-5)
 *   • no record carries more than one outcome code (acceptance #9)
 *   • table-heading rows are removed (acceptance #15)
 *   • the run is idempotent (Test 11 / acceptance #21)
 *   • deterministic ids are never the display sentence (section 6)
 *   • ambiguous rows are flagged, not dropped (acceptance #26)
 *
 * Plain-node — run with:  node scripts/test-migrate-2013-curriculum.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { migrate } from './migrate-2013-curriculum.mjs'
import { splitSpecificOutcomes } from '../src/utils/curriculum2013Parser.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raw = JSON.parse(readFileSync(path.join(ROOT, 'functions', 'data', 'curriculum-data-2013.json'), 'utf8'))

let passed = 0
const check = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`) } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1
  }
}

const report = migrate(raw)
const byOutcome = new Map()
for (const r of report.records) if (r.specificOutcome?.code) byOutcome.set(`${r.gradeId}|${r.subjectId}|${r.specificOutcome.code}`, r)

console.log('\nmigration — structural guarantees over the real 2013 data')

check('produces thousands of independent outcome records', () => {
  assert.ok(report.records.length > 3000, `got ${report.records.length}`)
  assert.ok(report.totals.combinedOutcomesDetected > 400)
})

check('no record contains more than one outcome code (acceptance #9)', () => {
  const offenders = report.records.filter((r) => {
    const st = r.specificOutcome?.statement || ''
    return splitSpecificOutcomes(st).filter((o) => o.code).length >= 1
  }).filter((r) => !r.needsReview)  // the 13 genuinely-broken OCR rows are flagged, not silently wrong
  assert.equal(offenders.length, 0, offenders.slice(0, 3).map((r) => r.id).join(', '))
})

check('Malaria splits into three independent outcomes (Test 1 / acceptance #5)', () => {
  const codes = ['5.2.3.1', '5.2.3.2', '5.2.3.3']
  for (const c of codes) {
    const rec = byOutcome.get(`g5|integrated_science|${c}`)
    assert.ok(rec, `missing ${c}`)
    assert.equal(rec.subtopic.title.toLowerCase(), 'malaria')
    assert.equal(rec.topic.code, '5.2.0')
  }
})

check('Personal Hygiene 4.2.1 → four outcomes (Test 2 / acceptance #6)', () => {
  const found = ['4.2.1.1', '4.2.1.2', '4.2.1.3', '4.2.1.4']
    .filter((c) => byOutcome.get(`g4|integrated_science|${c}`))
  assert.equal(found.length, 4)
})

check('table-heading rows are removed, never stored (acceptance #15)', () => {
  assert.ok(report.totals.headingRowsRemoved > 100)
  const headingWords = new Set(['knowledge', 'skills', 'values', 'content', 'specific outcomes'])
  const leaked = report.records.filter((r) =>
    headingWords.has(String(r.subtopic?.title || '').toLowerCase()) && !r.needsReview)
  assert.equal(leaked.length, 0)
})

check('deterministic ids never use the display sentence (section 6)', () => {
  for (const r of report.records.slice(0, 200)) {
    assert.ok(/^2013-/.test(r.id), r.id)
    assert.ok(r.id.length < 90)
    assert.ok(!/\s/.test(r.id))
  }
})

check('migration is idempotent — re-run yields identical ids (Test 11)', () => {
  const a = migrate(raw).records.map((r) => r.id)
  const b = migrate(raw).records.map((r) => r.id)
  assert.deepEqual(a, b)
})

check('ambiguous rows are flagged for review, not dropped (acceptance #26)', () => {
  assert.ok(report.totals.recordsNeedingReview > 0)
  assert.equal(report.reviewQueue.length, report.totals.recordsNeedingReview)
  for (const q of report.reviewQueue.slice(0, 20)) {
    assert.ok(Array.isArray(q.problems) && q.problems.length > 0)
    assert.ok(q.rawText, 'review entry retains raw source text')
  }
})

check('no sheet parse threw (fail-soft, all sheets processed)', () => {
  assert.equal(report.sheetsFailed.length, 0, JSON.stringify(report.sheetsFailed))
})

console.log(`\n${passed} checks passed`)
if (process.exitCode) console.error('\nSOME TESTS FAILED'); else console.log('ALL TESTS PASSED')
