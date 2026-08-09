#!/usr/bin/env node
/**
 * Tests for Record of Work variance metadata (Phase 3 slice 4, safe interim).
 * Run: npm run test:record-of-work-variance
 */
import assert from 'node:assert/strict'
import { normalizeVariance, weekHasVariance, weekWithVarianceField } from '../src/features/recordOfWork/lib/recordOfWorkVariance.js'
import { restoreRecordFromGeneration } from '../src/features/recordOfWork/lib/recordOfWorkPlanning.js'

let pass = 0
function test(name, fn) { fn(); pass++; console.log(`  ok  ${name}`) }
const eq = (a, b, m) => assert.strictEqual(a, b, m)

console.log('\nnormalizeVariance')
test('trims, caps and keeps meaningful content', () => {
  const v = normalizeVariance({ actualDate: '2026-07-14', reason: '  school event  ', followUp: 'complete next lesson', initials: ' MM ' })
  eq(v.actualDate, '2026-07-14'); eq(v.reason, 'school event'); eq(v.followUp, 'complete next lesson'); eq(v.initials, 'MM')
})
test('drops an invalid date rather than storing junk', () => {
  eq(normalizeVariance({ actualDate: '14/07/2026', reason: 'x' }).actualDate, '')
  eq(normalizeVariance({ actualDate: 'yesterday' }), null)
})
test('caps free-text lengths', () => {
  eq(normalizeVariance({ reason: 'r'.repeat(500) }).reason.length, 300)
  eq(normalizeVariance({ initials: 'ABCDEFGHIJKLMN' }).initials.length, 10)
})
test('empty / whitespace-only → null (field omitted entirely)', () => {
  eq(normalizeVariance(null), null)
  eq(normalizeVariance({}), null)
  eq(normalizeVariance({ reason: '   ' }), null)
})

console.log('\nweekWithVarianceField')
test('sets a field and keeps the rest of the row', () => {
  const w = { week: '3', topic: 'Fractions', coverage: 'partial' }
  const next = weekWithVarianceField(w, 'reason', 'sports day')
  eq(next.topic, 'Fractions'); eq(next.coverage, 'partial')
  eq(next.variance.reason, 'sports day')
})
test('clearing the last field removes the variance key (legacy shape preserved)', () => {
  const w = { week: '3', variance: { actualDate: '', reason: 'x', followUp: '', initials: '' } }
  const next = weekWithVarianceField(w, 'reason', '')
  eq('variance' in next, false)
  eq(weekHasVariance(next), false)
})
test('statutory coverage is never touched by variance edits', () => {
  const w = { week: '3', coverage: 'full' }
  eq(weekWithVarianceField(w, 'initials', 'MM').coverage, 'full')
})

console.log('\nround-trip through open-by-id restore')
test('variance survives save → load (restoreRecordFromGeneration preserves it)', () => {
  const gen = {
    id: 'rec-1', tool: 'record_of_work',
    output: {
      header: { grade: 'G4', subject: 'Mathematics', term: 2, year: '2026' },
      weeks: [{ week: '1', topic: 'Fractions', workDone: [], coverage: 'partial', remarks: '', variance: { actualDate: '2026-07-14', reason: 'school event', followUp: 'finish next lesson', initials: 'MM' } }],
    },
  }
  const r = restoreRecordFromGeneration(gen)
  eq(r.weeks[0].variance.reason, 'school event')
  eq(r.weeks[0].variance.initials, 'MM')
})
test('legacy rows without variance stay byte-identical in shape', () => {
  const r = restoreRecordFromGeneration({
    id: 'rec-2', tool: 'record_of_work',
    output: { header: {}, weeks: [{ week: '1', topic: 'T', workDone: [], coverage: '', remarks: '' }] },
  })
  eq('variance' in r.weeks[0], false)
})

console.log(`\n─── ${pass} tests · all passed ───`)
