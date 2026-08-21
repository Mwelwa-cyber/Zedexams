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
import { LEARNER_ROLES } from '../src/utils/permissions.js'
import {
  LEARNER_ONLY_SEGMENTS,
  canOpenLearnerRoutes,
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

// ── canOpenLearnerRoutes mirrors the guard, for every learner spelling ──
//
// LearnerOnlyRoute reads AuthContext's `isLearner`, which is `isLearnerRole` —
// so 'student', the legacy spelling, is a learner to the guard. This predicate
// spelled the check out by hand as `role === 'learner'` and was therefore
// STRICTER than the thing it claims to mirror: a free 'student' account fell
// past the role branch to the premium check and came back "blocked".
//
// That was invisible while the only caller redirected (a learner's landing page
// is /dashboard whichever branch answers), and stopped being invisible the
// moment the learner tab bar asked the same question — it took Home and Notes
// off a legacy learner's own navigation. So both spellings are pinned here, on
// a FREE profile, because the plan check is exactly what a role miss falls into.
for (const role of LEARNER_ROLES) {
  assert.equal(
    canOpenLearnerRoutes({ role }),
    true,
    `canOpenLearnerRoutes says a free '${role}' account cannot open a learner route, `
    + 'but LearnerOnlyRoute lets it straight through on role alone. A navigation surface '
    + 'reading this predicate would hide a learner\'s own tabs from them.',
  )
}
assert.equal(canOpenLearnerRoutes({ role: 'teacher' }), false)
assert.equal(canOpenLearnerRoutes({ role: 'admin' }), true)
assert.equal(canOpenLearnerRoutes({ role: 'superAdmin' }), true)
// A guardian with no learner-portal plan is refused; one with premium is not.
assert.equal(canOpenLearnerRoutes({ role: 'parent' }), false)

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
