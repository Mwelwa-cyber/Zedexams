// scripts/test-learner-only-routes.mjs
//
// LEARNER_ONLY_SEGMENTS (src/utils/navigation.js) is what stops the app from
// SENDING a teacher to a learner route after sign-in. It is a list, and a list
// about routes rots the moment a route is added — so it is checked against the
// route declaration itself, in both directions:
//
//   • every path App.jsx wraps in <LearnerOnlyRoute> has its first segment in
//     the list — otherwise a teacher can still be redirected onto it and meet
//     "Teacher accounts stay in the teacher portal";
//   • every entry in the list still names a learner-only segment — otherwise
//     the list accumulates segments that now belong to some other portal, and
//     starts discarding destinations a teacher was entitled to.
//
// Run: node scripts/test-learner-only-routes.mjs
import assert from 'node:assert/strict'
import { learnerOnlyRoutePaths } from './lib/declaredRoutes.mjs'
import {
  LEARNER_ONLY_SEGMENTS,
  isLearnerOnlyPath,
  resolvePostAuthPath,
} from '../src/utils/navigation.js'

const firstSegment = (path) => path.split(/[?#]/, 1)[0].split('/')[1] || ''

const declared = learnerOnlyRoutePaths()

// A parser that silently matches nothing would make every assertion below
// pass vacuously. The router declares ~26 learner-only routes today.
assert.ok(
  declared.length >= 20,
  `Parsed only ${declared.length} <LearnerOnlyRoute> paths from src/app/App.jsx — parser drifted?`,
)

const declaredSegments = new Set(declared.map(firstSegment))
const listed = new Set(LEARNER_ONLY_SEGMENTS)

const missing = [...declaredSegments].filter((s) => !listed.has(s)).sort()
assert.deepEqual(
  missing,
  [],
  `LEARNER_ONLY_SEGMENTS is missing ${missing.join(', ')} — App.jsx wraps ` +
  'those routes in <LearnerOnlyRoute>, so a teacher can still be redirected ' +
  'onto them after sign-in. Add the segment to src/utils/navigation.js.',
)

const stale = [...listed].filter((s) => !declaredSegments.has(s)).sort()
assert.deepEqual(
  stale,
  [],
  `LEARNER_ONLY_SEGMENTS lists ${stale.join(', ')}, which App.jsx no longer ` +
  'serves from a <LearnerOnlyRoute>. A stale entry discards destinations a ' +
  'teacher is entitled to. Remove it from src/utils/navigation.js.',
)

// Every declared learner-only route classifies, params and query included.
for (const path of declared) {
  const concrete = path.replace(/:[A-Za-z0-9_]+/g, 'abc123')
  assert.ok(isLearnerOnlyPath(concrete), `isLearnerOnlyPath('${concrete}') should be true`)
  assert.ok(
    isLearnerOnlyPath(`${concrete}?insights=1`),
    `isLearnerOnlyPath('${concrete}?insights=1') should be true`,
  )
}

// …and the whole point: a teacher is never landed on one of them.
const teacher = { role: 'teacher' }
for (const path of declared) {
  const concrete = path.replace(/:[A-Za-z0-9_]+/g, 'abc123')
  assert.equal(
    resolvePostAuthPath(teacher, concrete, '/'),
    '/teacher',
    `A teacher bounced from ${concrete} must land on /teacher, not that route`,
  )
}

// The guard can fail: a segment removed from the list is caught.
{
  const shortened = new Set(LEARNER_ONLY_SEGMENTS.filter((s) => s !== 'notes'))
  const stillMissing = [...declaredSegments].filter((s) => !shortened.has(s))
  assert.deepEqual(
    stillMissing,
    ['notes'],
    'Mutation check: dropping "notes" from the list must be detectable',
  )
}

console.log(
  `✓ learner-only routes — ${declared.length} guarded routes across ` +
  `${declaredSegments.size} segments, list in sync`,
)
