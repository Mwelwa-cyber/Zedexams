/**
 * Guards isImmersiveStudioPath — the predicate TeacherLayout uses to suppress
 * the global dashboard dock on full-screen studio routes that render their own
 * fixed bottom bar (the assessment studio's .sv-dock, the lesson-plan wizard's
 * .lpw-nav), where two stacked bottom bars would otherwise collide.
 *
 * Run: node scripts/test-immersive-studio-routes.mjs   (npm run test:immersive-routes)
 */
import assert from 'node:assert/strict'
import { isImmersiveStudioPath } from '../src/features/teacherShell/lib/immersiveStudioRoutes.js'

let passed = 0
function check(pathname, expected) {
  assert.equal(
    isImmersiveStudioPath(pathname),
    expected,
    `isImmersiveStudioPath(${JSON.stringify(pathname)}) should be ${expected}`,
  )
  passed++
}

// Immersive studio routes (own dock) → global nav hidden.
check('/teacher/test-papers/new', true)
check('/teacher/test-papers/abc123/edit', true)
check('/teacher/assessments/new', true)
check('/teacher/assessments/paper-42/edit', true)
check('/teacher/exam-papers/new', true)
check('/teacher/exam-papers/xY9/edit', true)
check('/teacher/test-papers/new/', true) // trailing slash tolerated
check('/teacher/lesson-plans/new', true) // lesson-plan wizard (own .lpw-nav bar)
check('/teacher/lesson-plans/lp-77/edit', true)

// Non-immersive routes → global nav stays.
check('/teacher/test-papers', false) // the list route (AssessmentList)
check('/teacher/assessments', false)
check('/teacher/exam-papers', false)
check('/teacher/lesson-plans', false) // redirects to the library, keeps the dock
check('/teacher', false)
check('/teacher/library', false)
check('/teacher/register', false)
check('/teacher/test-papers/abc123', false) // detail without /edit
check('/teacher/test-papers/abc/edit/extra', false) // deeper path
check('/settings', false)
check('', false)

console.log(`✓ immersive-studio-routes: ${passed} assertions passed`)
