#!/usr/bin/env node
/**
 * Static-text regression tests for the learner-AI visibility fixes
 * landed in this PR. Mirrors the pattern from
 * scripts/test-firestore-rules-text.mjs — scans the rules file as
 * text and asserts the three new gates remain in place.
 *
 * Three contracts:
 *
 *   P0-1 — `aiGeneratedContent` read for non-admins must require
 *          `status=='published' AND (isTeacherOrAbove() OR
 *          resource.data.grade matches callerGrade())`. Closes the
 *          spec hole "Grade 4 learner cannot see Grade 5 quizzes" —
 *          previously the rule trusted the client query filter.
 *
 *   F2  — `aiAgentTasks` create rule must restrict `taskType` for
 *          learners to the per-attempt agents only
 *          ('weakness_analysis', 'learner_feedback'); teachers and
 *          admins keep full access.
 *
 *   F4  — `aiLiveAgentStates` read must be admin-only (was authed-
 *          read; the Monitor UI is admin-gated so no production
 *          path actually subscribes from a learner / teacher).
 *
 * Run: npm run test:visibility-rules  (also via npm run test:all)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'firestore.rules')
const rules = readFileSync(RULES_PATH, 'utf8')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    pass++; console.log(`  ok  ${name}`)
  } catch (err) {
    fail++; failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

// ── Setup: callerGrade() helper exists ─────────────────────────

console.log('\nHelper functions')

test('callerGrade() helper is defined', () => {
  assert(/function callerGrade\(\)/.test(rules),
    'rules must define a callerGrade() helper')
  assert(/get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)\.data\.get\(['"]grade['"]/.test(rules),
    'callerGrade() must read users/{uid}.grade with a default')
})

// ── P0-1: aiGeneratedContent grade enforcement ─────────────────

console.log('\nP0-1 — aiGeneratedContent grade enforcement')

function extractBlock(needle, terminator) {
  const idx = rules.indexOf(needle)
  if (idx < 0) return ''
  // Find the closing `}` for the match block — naive scan good enough
  // for the rules file size.
  const tail = rules.slice(idx)
  const endIdx = tail.indexOf(terminator)
  return endIdx < 0 ? tail : tail.slice(0, endIdx)
}

test('aiGeneratedContent block exists', () => {
  const block = extractBlock('match /aiGeneratedContent/{contentId}', '\n    }')
  assert(block.length > 0, 'rules must declare aiGeneratedContent')
})

test('aiGeneratedContent read rule branches on (admin OR published+grade-match)', () => {
  const block = extractBlock('match /aiGeneratedContent/{contentId}', '\n    }')
  // Three required substrings in the read rule:
  assert(/isAdmin\(\)/.test(block), 'admin bypass missing')
  assert(/resource\.data\.status\s*==\s*['"]published['"]/.test(block),
    'status==published gate missing')
  // The new grade gate — either teacher passthrough OR grade equality.
  assert(/isTeacherOrAbove\(\)/.test(block),
    'teacher cross-grade passthrough missing')
  assert(/string\(resource\.data\.grade\)\s*==\s*string\(callerGrade\(\)\)/.test(block),
    'grade equality check missing (must coerce to string both sides)')
})

test('aiGeneratedContent write still locked to server (write: if false)', () => {
  const block = extractBlock('match /aiGeneratedContent/{contentId}', '\n    }')
  assert(/allow write:\s*if false/.test(block),
    'write must remain server-only')
})

// ── F2: aiAgentTasks create taskType gate ─────────────────────

console.log('\nF2 — aiAgentTasks create taskType gate')

test('aiAgentTasks create restricts learner taskTypes', () => {
  const block = extractBlock('match /aiAgentTasks/{taskId}', '\n    }')
  assert(block.length > 0, 'rules must declare aiAgentTasks')
  // Teachers + admins get unrestricted access OR learners restricted to
  // the per-attempt allow-list.
  assert(/isTeacherOrAbove\(\)/.test(block),
    'teacher/admin passthrough missing in create rule')
  assert(/['"]weakness_analysis['"]/.test(block),
    'learner allow-list must include weakness_analysis')
  assert(/['"]learner_feedback['"]/.test(block),
    'learner allow-list must include learner_feedback')
})

test('aiAgentTasks create still requires status==queued + size limits', () => {
  const block = extractBlock('match /aiAgentTasks/{taskId}', '\n    }')
  assert(/incoming\(\)\.status\s*==\s*['"]queued['"]/.test(block),
    'status:queued precondition missing')
  assert(/incoming\(\)\.taskType\.size\(\)\s*<=\s*64/.test(block),
    'taskType size limit missing')
})

test('learner CANNOT queue exam_quiz / curriculum_update_check / practice_quiz / notes / study_tips', () => {
  // Sanity: the allow-list MUST NOT contain any of these powerful types.
  // The learner branch (after isTeacherOrAbove() OR) lists ONLY the
  // per-attempt allowed types. Negative-test the entire create block.
  const block = extractBlock('match /aiAgentTasks/{taskId}', '\n    }')
  // Grab just the create rule's taskType allow-list — the array
  // literal after the isTeacherOrAbove() branch.
  const taskTypeListMatch = block.match(/\|\|\s*incoming\(\)\.taskType\s+in\s+\[([^\]]+)\]/)
  assert(taskTypeListMatch, 'must find the learner-task-type allow-list')
  const list = taskTypeListMatch[1]
  const FORBIDDEN_FOR_LEARNERS = [
    'practice_quiz', 'exam_quiz', 'notes', 'study_tips',
    'curriculum_update_check',
  ]
  for (const t of FORBIDDEN_FOR_LEARNERS) {
    assert(!list.includes(`'${t}'`) && !list.includes(`"${t}"`),
      `learner allow-list must NOT include '${t}'`)
  }
})

// ── F4: aiLiveAgentStates admin-only read ─────────────────────

console.log('\nF4 — aiLiveAgentStates admin-only read')

test('aiLiveAgentStates read locked to isAdmin()', () => {
  const block = extractBlock('match /aiLiveAgentStates/{agentId}', '\n    }')
  assert(block.length > 0, 'rules must declare aiLiveAgentStates')
  // Old rule was `allow read: if isAuthed();` — fail if that pattern
  // is still present without an isAdmin() conjunction.
  assert(/allow read:\s*if isAuthed\(\)\s*&&\s*isAdmin\(\)/.test(block),
    'aiLiveAgentStates read must be admin-only (isAuthed() && isAdmin())')
})

test('aiLiveAgentStates write still locked (write: if false)', () => {
  const block = extractBlock('match /aiLiveAgentStates/{agentId}', '\n    }')
  assert(/allow write:\s*if false/.test(block))
})

// ── Defence: existing admin-only collections untouched ─────────

console.log('\nDefence — existing admin-only rules unchanged')

test('aiAgentLogs still admin-only read', () => {
  assert(/match \/aiAgentLogs\/\{logId\}[\s\S]*allow read:\s*if isAdmin\(\)/.test(rules),
    'aiAgentLogs rule must remain admin-only')
})

test('aiSupervisorLogs still admin-only read', () => {
  assert(/match \/aiSupervisorLogs\/\{logId\}[\s\S]*allow read:\s*if isAdmin\(\)/.test(rules))
})

test('learnerWeaknessProfiles still owner-or-admin read', () => {
  const idx = rules.indexOf('match /learnerWeaknessProfiles/{profileId}')
  assert(idx > 0, 'learnerWeaknessProfiles rule must exist')
  const block = rules.slice(idx, idx + 600)
  assert(/resource\.data\.learnerId\s*==\s*request\.auth\.uid/.test(block),
    'rule must still require learnerId == auth.uid for non-admin reads')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
