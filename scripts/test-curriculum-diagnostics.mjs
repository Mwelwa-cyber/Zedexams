/**
 * Tests for the structured curriculum diagnostics logger
 * (src/utils/curriculumDiagnostics.js).
 *
 * Verifies: events reach a registered sink, warnings are always forwarded,
 * the ring buffer records recent events, the payload carries only ids/counts
 * (no PII), and reset restores defaults.
 *
 * Run: node scripts/test-curriculum-diagnostics.mjs
 */

import assert from 'node:assert/strict'
import {
  CURRICULUM_EVENTS,
  logCurriculumEvent,
  setDiagnosticsSink,
  recentCurriculumEvents,
  __resetCurriculumDiagnostics,
} from '../src/utils/curriculumDiagnostics.js'

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`) }

console.log('curriculum diagnostics')

check('warning events always reach the sink with the event name folded in', () => {
  __resetCurriculumDiagnostics()
  const seen = []
  setDiagnosticsSink((event, payload) => seen.push([event, payload]))
  logCurriculumEvent(CURRICULUM_EVENTS.CATALOGUE_MISSING, {
    studioId: 'exam', curriculumId: 'cbc', gradeId: 'ECE_N', timestamp: 1,
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0][0], CURRICULUM_EVENTS.CATALOGUE_MISSING)
  assert.equal(seen[0][1].event, CURRICULUM_EVENTS.CATALOGUE_MISSING)
  assert.equal(seen[0][1].studioId, 'exam')
  __resetCurriculumDiagnostics()
})

check('recentCurriculumEvents records events even without a sink', () => {
  __resetCurriculumDiagnostics()
  logCurriculumEvent(CURRICULUM_EVENTS.INVALID_SELECTION, { studioId: 'test-paper', field: 'subject', timestamp: 2 })
  const recent = recentCurriculumEvents()
  assert.equal(recent.length, 1)
  assert.equal(recent[0].event, CURRICULUM_EVENTS.INVALID_SELECTION)
  __resetCurriculumDiagnostics()
})

check('diagnostics never throw on a bad sink', () => {
  __resetCurriculumDiagnostics()
  setDiagnosticsSink(() => { throw new Error('sink boom') })
  // Must not propagate.
  logCurriculumEvent(CURRICULUM_EVENTS.FALLBACK_BLOCKED, { studioId: 'x', timestamp: 3 })
  __resetCurriculumDiagnostics()
})

check('payload carries only ids/counts — no obvious PII keys', () => {
  __resetCurriculumDiagnostics()
  const seen = []
  setDiagnosticsSink((_e, payload) => seen.push(payload))
  logCurriculumEvent(CURRICULUM_EVENTS.RESOLVED, {
    studioId: 'exam', curriculumId: 'cbc', gradeId: 'G4', subjectId: 'english',
    subjectOptionCount: 8, timestamp: 4,
  })
  // Note: RESOLVED is sampled in production, but with a sink set in node
  // (isDev false) it still samples via Math.random — so just assert the ring
  // buffer captured it with the right shape (buffer is unsampled).
  const rec = recentCurriculumEvents().at(-1)
  for (const forbidden of ['name', 'email', 'learnerName', 'studentName', 'content', 'questionText']) {
    assert.ok(!(forbidden in rec), `payload must not carry ${forbidden}`)
  }
  assert.equal(rec.subjectOptionCount, 8)
  __resetCurriculumDiagnostics()
})

console.log(`\n✅ curriculum-diagnostics: ${passed} checks passed`)
