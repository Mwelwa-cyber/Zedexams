#!/usr/bin/env node
/**
 * Bug-fix pass — unit tests.
 *
 * Three small fixes carried over from prior audits in this session:
 *
 *   Fix 1 — Pause cache TTL: 60s → 5s
 *     dispatcher.js PAUSED_CACHE_TTL_MS. Admin pause toggle in the
 *     Live Monitor used to take ~60s to take effect on new task
 *     pickup; now takes ~5s. Cost: ~12× more single-doc reads from
 *     aiAgentControls (≤15 docs total, negligible).
 *     Source audits: Live Monitor F2, Security audit F2, Cost guards F3.
 *
 *   Fix 2 — Notes auto-publish requires non-empty task.topic
 *     dispatcher.js AUTO_PUBLISH_SETTING_BY_TASK.notes.precondition.
 *     Was null; could ship a topic-less notes doc straight to
 *     learners if a malformed task slipped past the schema. Now
 *     requires task.topic to be a non-empty string.
 *     Source audit: Approval workflow F3.
 *
 *   Fix 3 — Curriculum reports: "Mark applied" button + audit-log
 *     coverage for the approved → applied transition.
 *     - UI: new button (shows only on status='approved'), prompt
 *       reminds admin to apply manually via /admin/cbc-kb first.
 *     - Trigger: curriculumApprover.js now accepts both transitions
 *       (pending_review → approved/rejected; approved → applied),
 *       writes one audit log per decision including the new
 *       learner_ai.curriculum_applied action.
 *     Source audit: Approval workflow #562 out-of-scope item.
 *
 * Run: npm run test:bug-fix-pass  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const DISPATCHER_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8',
)
const APPROVER_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/curriculumApprover.js'), 'utf8',
)
const REPORTS_UI_TEXT = readFileSync(
  join(ROOT, 'src/components/admin/learnerAi/CurriculumUpdateReports.jsx'), 'utf8',
)

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

// ── Fix 1: Pause cache TTL ─────────────────────────────────────

console.log('\nFix 1 — Pause cache TTL dropped 60s → 5s')

test('PAUSED_CACHE_TTL_MS is 5_000', () => {
  assert(/PAUSED_CACHE_TTL_MS\s*=\s*5_000/.test(DISPATCHER_TEXT),
    'dispatcher must set PAUSED_CACHE_TTL_MS = 5_000')
})

test('old 60_000 value is gone', () => {
  // Defence: catch a future revert. The constant should not appear
  // with the old value anywhere in the dispatcher.
  assert(!/PAUSED_CACHE_TTL_MS\s*=\s*60_000/.test(DISPATCHER_TEXT),
    'dispatcher must not reset PAUSED_CACHE_TTL_MS back to 60_000')
})

// ── Fix 2: Notes auto-publish precondition ─────────────────────

console.log('\nFix 2 — Notes auto-publish requires non-empty task.topic')

test('AUTO_PUBLISH_SETTING_BY_TASK.notes has a precondition function', () => {
  // Look for the notes entry's precondition. Must not be null.
  const notesIdx = DISPATCHER_TEXT.indexOf('settingKey: "autoPublishNotes"')
  assert(notesIdx > 0, 'notes entry missing')
  // Search the next ~400 chars for the precondition keyword.
  const block = DISPATCHER_TEXT.slice(notesIdx, notesIdx + 600)
  assert(/precondition:\s*\(task\)\s*=>/.test(block),
    'notes precondition must be a function, not null')
  assert(!/precondition:\s*null/.test(block),
    'notes precondition must not be null')
})

test('notes precondition checks task.topic is non-empty string', () => {
  const notesIdx = DISPATCHER_TEXT.indexOf('settingKey: "autoPublishNotes"')
  const block = DISPATCHER_TEXT.slice(notesIdx, notesIdx + 600)
  assert(/typeof task\.topic === ["']string["']/.test(block),
    'must check typeof task.topic === string')
  assert(/task\.topic\.trim\(\)\.length\s*>\s*0/.test(block),
    'must require trimmed length > 0')
})

// Other entries unchanged.
test('Other AUTO_PUBLISH_SETTING_BY_TASK entries unchanged', () => {
  // study_tips still requires weakLearnerId; learner_feedback still
  // requires learnerId + attemptId.
  assert(/parameters\.weakLearnerId/.test(DISPATCHER_TEXT),
    'study_tips precondition (weakLearnerId) must remain')
  assert(/parameters\.learnerId/.test(DISPATCHER_TEXT),
    'learner_feedback precondition (learnerId) must remain')
  assert(/parameters\.attemptId/.test(DISPATCHER_TEXT),
    'learner_feedback precondition (attemptId) must remain')
})

// Hard rule: exam_quiz + curriculum_update_check still absent.
test('exam_quiz still absent from AUTO_PUBLISH_SETTING_BY_TASK', () => {
  const tableIdx = DISPATCHER_TEXT.indexOf('AUTO_PUBLISH_SETTING_BY_TASK = Object.freeze({')
  const endIdx = DISPATCHER_TEXT.indexOf('});', tableIdx)
  const table = DISPATCHER_TEXT.slice(tableIdx, endIdx)
  assert(!/^\s*exam_quiz\s*:/m.test(table),
    'exam_quiz key MUST NOT be added to AUTO_PUBLISH_SETTING_BY_TASK (hard rule)')
  assert(!/^\s*curriculum_update_check\s*:/m.test(table),
    'curriculum_update_check key MUST NOT be added (hard rule)')
})

// ── Fix 3: "Mark applied" button + audit-log coverage ──────────

console.log('\nFix 3 — Mark applied + audit-log applied transition')

test('UI has "Mark applied" button gated on status==approved', () => {
  // Verify the button text + its conditional render branch.
  assert(/>\s*Mark applied\s*</.test(REPORTS_UI_TEXT),
    'Mark applied button text missing')
  // Branch must check status === 'approved'.
  assert(/status\s*===\s*['"]approved['"]/.test(REPORTS_UI_TEXT),
    'button render must gate on status==approved')
})

test('UI confirmation copy for "applied" reminds admin of manual KB step', () => {
  // The new PROMPTS dictionary must include an applied entry.
  assert(/applied:\s*['"]/.test(REPORTS_UI_TEXT) ||
    /applied:\s*`/.test(REPORTS_UI_TEXT),
    'PROMPTS.applied entry must exist')
  assert(/manually updated the KB/i.test(REPORTS_UI_TEXT) ||
    /update.*the KB.*manually/i.test(REPORTS_UI_TEXT),
    'applied prompt must remind admin of the manual KB update')
})

test('setStatus handler still writes only the 3 rule-allowed keys', () => {
  // Defence: ensure my new branch didn't add extra keys that would
  // be rejected by firestore.rules:1419-1420.
  const m = REPORTS_UI_TEXT.match(/updateDoc\(doc\(db,\s*['"]curriculumUpdateReports['"],\s*reportId\),\s*\{([\s\S]{0,400}?)\}\)/)
  assert(m, 'updateDoc call missing')
  const payload = m[1]
  const otherKeys = payload.replace(/['"][^'"]*['"]/g, '"_"')
    .match(/\w+:/g) || []
  const KNOWN = new Set(['status:', 'reviewedBy:', 'reviewedAt:'])
  for (const k of otherKeys) {
    assert(KNOWN.has(k),
      `unexpected payload key: ${k} (rule allows only ${[...KNOWN].join(', ')})`)
  }
})

test('curriculumApprover trigger accepts approved → applied transition', () => {
  assert(/isApplyDecision/.test(APPROVER_TEXT),
    'trigger must detect the apply transition')
  assert(/beforeStatus === ["']approved["']\s*&&\s*afterStatus === ["']applied["']/.test(APPROVER_TEXT),
    'must check before==approved && after==applied')
})

test('curriculumApprover emits learner_ai.curriculum_applied audit action', () => {
  assert(/learner_ai\.curriculum_applied/.test(APPROVER_TEXT),
    'audit log action for applied must be present')
})

test('trigger still does NOT auto-mutate cbcKnowledgeBase', () => {
  const codeOnly = APPROVER_TEXT
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/["'][^"'\n]*["']/g, '""')
  assert(!/cbcKnowledgeBase/.test(codeOnly),
    'trigger code must not reference cbcKnowledgeBase (hard rule: no auto-apply)')
})

test('first-decision branch (pending_review → terminal) still fires', () => {
  // Defence: make sure my extension didn't break the original branch.
  assert(/isFirstDecision/.test(APPROVER_TEXT),
    'first-decision branch flag must exist')
  assert(/beforeStatus === ["']pending_review["']/.test(APPROVER_TEXT),
    'first-decision must check before==pending_review')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
