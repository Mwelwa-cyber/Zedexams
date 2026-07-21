/**
 * Node test for the client-side status view (src/utils/systemStatus.js).
 * Run: node scripts/test-system-status.mjs
 *
 * The critical truthfulness property: a STALE or MISSING status doc must read
 * "unknown", never "operational".
 */

import assert from 'node:assert'
import {
  STATUS,
  STALE_AFTER_MS,
  computeStatusView,
  overallHeadline,
  statusTone,
} from '../src/utils/systemStatus.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('systemStatus')

const freshDoc = (overall = STATUS.OPERATIONAL, generatedAt = 1_000_000) => ({
  schemaVersion: 2,
  overall,
  generatedAt,
  ranAt: '2026-07-20T10:00:00Z',
  components: {
    pages: {label: 'Website', core: true, status: STATUS.OPERATIONAL, raw: STATUS.OPERATIONAL},
    firebase: {label: 'Database & storage', core: true, status: STATUS.OPERATIONAL, raw: STATUS.OPERATIONAL},
    quizzes: {label: 'Quiz content', core: false, status: STATUS.OPERATIONAL, raw: STATUS.OPERATIONAL},
    images: {label: 'Images & diagrams', core: false, status: STATUS.OPERATIONAL, raw: STATUS.OPERATIONAL},
    dailyExams: {label: 'Daily exams', core: false, status: STATUS.OPERATIONAL, raw: STATUS.OPERATIONAL},
    playBilling: {label: 'Payments (Android billing)', core: false, status: STATUS.OPERATIONAL, raw: STATUS.OPERATIONAL},
  },
})

// 1. Fresh operational doc → operational.
{
  const now = 1_000_000 + 60_000 // 1 min later
  const view = computeStatusView(freshDoc(), now)
  ok('fresh doc → operational', view.overall === STATUS.OPERATIONAL)
  ok('fresh doc → not stale', view.stale === false)
  ok('fresh doc → 6 components', view.components.length === 6)
}

// 2. STALE doc → unknown (the core anti-lie property).
{
  const gen = 1_000_000
  const now = gen + STALE_AFTER_MS + 60_000 // just past the stale window
  const view = computeStatusView(freshDoc(STATUS.OPERATIONAL, gen), now)
  ok('stale operational doc → overall unknown', view.overall === STATUS.UNKNOWN)
  ok('stale doc → stale flag', view.stale === true)
  ok('stale doc → every component unknown', view.components.every((c) => c.status === STATUS.UNKNOWN))
}

// 3. Missing doc → unknown, never operational.
{
  const view = computeStatusView(null, 1_000_000)
  ok('null doc → unknown', view.overall === STATUS.UNKNOWN)
  ok('null doc → hasData false', view.hasData === false)
  ok('null doc → stale true', view.stale === true)
}

// 4. Doc with no generatedAt → treated as stale/unknown.
{
  const d = freshDoc()
  delete d.generatedAt
  const view = computeStatusView(d, 1_000_000)
  ok('no generatedAt → unknown', view.overall === STATUS.UNKNOWN)
}

// 5. Fresh outage passes through (does not get masked).
{
  const now = 1_000_000 + 60_000
  const view = computeStatusView(freshDoc(STATUS.MAJOR_OUTAGE), now)
  ok('fresh major outage → major_outage', view.overall === STATUS.MAJOR_OUTAGE)
  ok('major outage headline', overallHeadline(STATUS.MAJOR_OUTAGE) === 'Major outage')
}

// 6. Tone mapping sanity.
{
  ok('operational tone ok', statusTone(STATUS.OPERATIONAL) === 'ok')
  ok('degraded tone warn', statusTone(STATUS.DEGRADED) === 'warn')
  ok('major_outage tone down', statusTone(STATUS.MAJOR_OUTAGE) === 'down')
  ok('unknown tone unknown', statusTone(STATUS.UNKNOWN) === 'unknown')
}

console.log(`\n${passed} assertions passed.`)
