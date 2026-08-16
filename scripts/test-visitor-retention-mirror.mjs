/**
 * Release-safety: the visit retention window exists in two places —
 * functions/visitorTrackingCore.js (VISIT_RETENTION_DAYS, the number the
 * writer actually stamps onto every visit document's expiresAt) and
 * src/features/adminAnalytics/pages/AdminVisitors.jsx (the same number, used to
 * LABEL the page-view tile on /admin/visitors).
 *
 * Why this needs a guard rather than a comment. That tile used to read
 * "Page views · all time" and count the `visits` collection, which was honest
 * while nothing ever deleted a visit doc. Adding a Firestore TTL made the count
 * a rolling window, so the label had to state the window. Drift between the two
 * numbers breaks nothing, throws nothing, and renders perfectly — it just
 * reports a 30-day number as a 90-day one, or vice versa, to the one person
 * using the page to decide whether traffic is growing. That is the failure mode
 * this repo keeps catching with mirrors (play catalog, paper terminology,
 * attendance terms), so it gets the same treatment.
 *
 * This does NOT check that a TTL policy exists in GCP — nothing in this repo
 * can. See scripts/check-ttl-policies.mjs, which owns that boundary.
 *
 * Run: node scripts/test-visitor-retention-mirror.mjs
 */

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const {
  VISIT_RETENTION_DAYS,
  VISITOR_MARKER_RETENTION_DAYS,
  expiryFrom,
} = require('../functions/visitorTrackingCore.js')

const dashboardSrc = readFileSync(
  path.join(ROOT, 'src/features/adminAnalytics/pages/AdminVisitors.jsx'),
  'utf8',
)

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('visitor-retention-mirror')

// ── the mirror itself ───────────────────────────────────────────────────────
const declared = dashboardSrc.match(/const VISIT_RETENTION_DAYS\s*=\s*(\d+)/)
ok('the dashboard declares a VISIT_RETENTION_DAYS constant', declared !== null)
ok(
  `the dashboard's window (${declared?.[1]}) matches the writer's (${VISIT_RETENTION_DAYS})`,
  Number(declared[1]) === VISIT_RETENTION_DAYS,
)

// The constant existing is not the point — it has to reach the label. A tile
// hard-coding "all time" beside a correct constant is exactly the bug.
ok(
  'the page-view tile label is built FROM the constant, not hard-coded',
  /label=\{`Page views · last \$\{VISIT_RETENTION_DAYS\}d`\}/.test(dashboardSrc),
)
// Scoped to LABEL attributes, not the whole file: prose explaining that the
// tile used to say "all time" is exactly the context a future reader needs, and
// a check that forbids describing the old behaviour would push that
// explanation out of the file to stay green.
ok(
  'no tile LABEL still claims to count all time',
  !/label=\{?["'`][^"'`]*all time/i.test(dashboardSrc),
)

// ── the windows themselves ──────────────────────────────────────────────────
ok('the visit window is a positive whole number of days',
   Number.isInteger(VISIT_RETENTION_DAYS) && VISIT_RETENTION_DAYS > 0)
ok('the marker window is a positive whole number of days',
   Number.isInteger(VISITOR_MARKER_RETENTION_DAYS) && VISITOR_MARKER_RETENTION_DAYS > 0)
// Markers exist only to dedupe within ONE Lusaka day, so outliving the raw
// visits they support would invert the point of expiring them at all.
ok('markers expire well before the visits they support',
   VISITOR_MARKER_RETENTION_DAYS < VISIT_RETENTION_DAYS)
// A marker is read only for its own day; anything under a day would race a
// late-arriving beacon and start double-counting uniqueVisitors.
ok('the marker window still leaves slack for a late beacon',
   VISITOR_MARKER_RETENTION_DAYS >= 2)

// ── expiryFrom: a TTL policy only acts on a real Timestamp ──────────────────
const base = new Date('2026-08-16T10:00:00Z')
const out = expiryFrom(base, 90)
ok('expiryFrom returns a Date, not epoch milliseconds', out instanceof Date)
ok('expiryFrom advances by exactly the requested days',
   out.getTime() - base.getTime() === 90 * 86400000)
ok('expiryFrom is exact across a month boundary',
   expiryFrom(new Date('2026-01-31T00:00:00Z'), 1).toISOString() === '2026-02-01T00:00:00.000Z')
// Callers pass `now` from the request; a malformed clock must not produce an
// Invalid Date, which Firestore would reject and take the pageview write with it.
ok('a bogus `now` falls back to a valid Date rather than Invalid Date',
   Number.isFinite(expiryFrom('not-a-date', 90).getTime()))
ok('a bogus day count does not produce Invalid Date',
   Number.isFinite(expiryFrom(base, NaN).getTime()))
ok('a negative window never expires in the past',
   expiryFrom(base, -5).getTime() >= base.getTime())

console.log(`\n─── visitor-retention-mirror · ${passed} passed ───`)
