#!/usr/bin/env node
/**
 * Approval-workflow fixes — unit tests.
 *
 * Two P0 bugs from the approval-workflow audit:
 *
 *   P0-1 — Curriculum-update approval flow was dead-letter:
 *     * UI was read-only (no Approve / Reject buttons)
 *     * Field-name mismatch — UI queried `scannedAt` + rendered
 *       fields the watcher didn't write
 *     * No Cloud Function trigger on report approval (so admin
 *       decisions weren't audit-logged)
 *
 *   P0-2 — Learners could see multiple "published" versions of the
 *     same topic after admin regenerate. The dispatcher's publish
 *     branch did not demote the OLD published doc for the same
 *     (type, grade, subject, topic, subtopic) tuple.
 *
 * Run: npm run test:approval-fixes  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const DISPATCHER_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8',
)
const APPROVER_PATH = join(
  ROOT, 'functions/agents/learnerAi/curriculumApprover.js',
)
const APPROVER_TEXT = readFileSync(APPROVER_PATH, 'utf8')
const INDEX_TEXT = readFileSync(
  join(ROOT, 'functions/index.js'), 'utf8',
)
const REPORTS_UI_TEXT = readFileSync(
  join(ROOT, 'src/components/admin/learnerAi/CurriculumUpdateReports.jsx'), 'utf8',
)
const SCHEMA_TEXT = readFileSync(
  join(ROOT, 'src/schemas/learnerAi.js'), 'utf8',
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

// ── Schema: 'superseded' status + change-type ──────────────────

console.log('\nSchema — superseded enums')

test('GENERATED_CONTENT_STATUSES includes "superseded"', () => {
  // Find the enum block + assert the literal is present.
  const m = SCHEMA_TEXT.match(/GENERATED_CONTENT_STATUSES\s*=\s*z\.enum\(\[([\s\S]{0,600}?)\]\)/)
  assert(m, 'enum block not found')
  assert(/['"]superseded['"]/.test(m[1]), 'superseded must be listed')
})

test('CONTENT_VERSION_CHANGE_TYPES includes "superseded"', () => {
  const m = SCHEMA_TEXT.match(/CONTENT_VERSION_CHANGE_TYPES\s*=\s*z\.enum\(\[([\s\S]{0,1400}?)\]\)/)
  assert(m, 'enum block not found')
  assert(/['"]superseded['"]/.test(m[1]), 'superseded must be listed')
})

// ── P0-2: Dispatcher sibling-demote on publish ─────────────────

console.log('\nP0-2 — dispatcher demotes sibling published docs')

test('demoteSiblingPublishedContent helper exists', () => {
  assert(/async function demoteSiblingPublishedContent\(/.test(DISPATCHER_TEXT),
    'helper function missing')
})

test('helper queries by type + grade + subject + topic + subtopic + status=published', () => {
  const fnIdx = DISPATCHER_TEXT.indexOf('async function demoteSiblingPublishedContent')
  const block = DISPATCHER_TEXT.slice(fnIdx, fnIdx + 2000)
  assert(/\.where\(["']type["']/.test(block),    'must filter by type')
  assert(/\.where\(["']grade["']/.test(block),   'must filter by grade')
  assert(/\.where\(["']subject["']/.test(block), 'must filter by subject')
  assert(/\.where\(["']topic["']/.test(block),   'must filter by topic')
  assert(/\.where\(["']subtopic["']/.test(block), 'must filter by subtopic')
  assert(/CONTENT_STATUS\.PUBLISHED/.test(block), 'must filter to status=published')
})

test('helper skips the new content doc (keepContentId)', () => {
  const fnIdx = DISPATCHER_TEXT.indexOf('async function demoteSiblingPublishedContent')
  const block = DISPATCHER_TEXT.slice(fnIdx, fnIdx + 2000)
  assert(/if \(doc\.id === keepContentId\) continue/.test(block),
    'must skip the doc we just published')
})

test('helper writes status="superseded" + supersededBy + updatedAt', () => {
  const fnIdx = DISPATCHER_TEXT.indexOf('async function demoteSiblingPublishedContent')
  const block = DISPATCHER_TEXT.slice(fnIdx, fnIdx + 2000)
  assert(/status:\s*["']superseded["']/.test(block),
    'must set status=superseded')
  assert(/supersededBy:\s*keepContentId/.test(block),
    'must stamp supersededBy pointer to the new doc')
})

test('helper appends a "superseded" version snapshot per demoted doc', () => {
  const fnIdx = DISPATCHER_TEXT.indexOf('async function demoteSiblingPublishedContent')
  const block = DISPATCHER_TEXT.slice(fnIdx, fnIdx + 2000)
  assert(/recordContentVersion\(/.test(block),
    'must record a version snapshot')
  assert(/changeType:\s*["']superseded["']/.test(block),
    'snapshot changeType must be "superseded"')
})

test('publish branch in onApproved actually calls the demote helper', () => {
  // Locate the publish branch + the demote call. The window must be
  // wide enough to reach the actual call site (~140 lines into the
  // function).
  const approvedFnIdx = DISPATCHER_TEXT.indexOf('createAiAgentTasksOnApproved')
  // Bound the search to the end of the onApproved function — find the
  // next top-level helper definition that follows it.
  const helperIdx = DISPATCHER_TEXT.indexOf(
    'async function demoteSiblingPublishedContent', approvedFnIdx,
  )
  const block = DISPATCHER_TEXT.slice(approvedFnIdx,
    helperIdx > 0 ? helperIdx : approvedFnIdx + 12000)
  assert(/demoteSiblingPublishedContent\(/.test(block),
    'onApproved must call demoteSiblingPublishedContent')
  assert(/keepContentId:\s*resolvedContentRef\.id/.test(block),
    'must pass the new content id as keepContentId')
})

// ── P0-1: Curriculum Approver Cloud Function ──────────────────

console.log('\nP0-1 — curriculumApprover.js Cloud Function')

test('curriculumApprover module exists', () => {
  assert(existsSync(APPROVER_PATH), 'curriculumApprover.js missing')
})

test('module exports createCurriculumUpdateReportsOnApproved', () => {
  assert(/module\.exports\s*=\s*\{\s*createCurriculumUpdateReportsOnApproved/.test(APPROVER_TEXT),
    'export missing')
})

test('trigger document matches curriculumUpdateReports/{reportId}', () => {
  assert(/document:\s*["']curriculumUpdateReports\/\{reportId\}["']/.test(APPROVER_TEXT),
    'trigger document mismatch')
})

test('trigger fires only on pending_review → terminal transitions', () => {
  assert(/beforeStatus !==\s*["']pending_review["']/.test(APPROVER_TEXT),
    'must early-return when before.status !== pending_review')
  assert(/TERMINAL_STATUSES\.has\(afterStatus\)/.test(APPROVER_TEXT) ||
    /\["approved",\s*"rejected"/.test(APPROVER_TEXT),
    'must gate on terminal after.status')
})

test('trigger writes writeAuditLog with correct action name', () => {
  assert(/writeAuditLog\(/.test(APPROVER_TEXT),
    'must call writeAuditLog')
  assert(/learner_ai\.curriculum_approve/.test(APPROVER_TEXT),
    'approve audit action missing')
  assert(/learner_ai\.curriculum_reject/.test(APPROVER_TEXT),
    'reject audit action missing')
})

test('trigger does NOT auto-mutate cbcKnowledgeBase', () => {
  // Strip all comments + string literals before checking — the file
  // is allowed to MENTION cbcKnowledgeBase in the explanatory header
  // comment ("does NOT mutate cbcKnowledgeBase"). What we want to
  // prevent is an actual write to that collection.
  const codeOnly = APPROVER_TEXT
    .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */ block comments
    .replace(/\/\/.*$/gm, '')            // // line comments
    .replace(/["'][^"'\n]*["']/g, '""')  // string literals
  assert(!/cbcKnowledgeBase/.test(codeOnly),
    'curriculum apply is admin-only — trigger code must not reference cbcKnowledgeBase')
  // Also confirm there's no collection() call with the KB name.
  assert(!/\.collection\(["']cbcKnowledgeBase["']/.test(APPROVER_TEXT),
    'must not open the cbcKnowledgeBase collection')
})

test('trigger is wired into functions/index.js', () => {
  assert(/createCurriculumUpdateReportsOnApproved/.test(INDEX_TEXT),
    'import missing in functions/index.js')
  assert(/exports\.curriculumUpdateReportsOnApproved\s*=\s*createCurriculumUpdateReportsOnApproved\(\)/.test(INDEX_TEXT),
    'export wiring missing')
})

// ── UI: CurriculumUpdateReports with approve/reject ────────────

console.log('\nUI — CurriculumUpdateReports approve / reject + field alignment')

test('UI queries orderBy("checkedAt") (matches watcher write)', () => {
  assert(/orderBy\(["']checkedAt["']/.test(REPORTS_UI_TEXT),
    'orderBy must match the watcher\'s write field')
  assert(!/orderBy\(["']scannedAt["']/.test(REPORTS_UI_TEXT),
    'old scannedAt orderBy must be removed')
})

test('UI renders the fields the watcher writes', () => {
  // Each of these field names is referenced in the JSX.
  const REQUIRED = ['sourceName', 'sourceUrl', 'trustLevel',
    'affectedGrades', 'affectedSubjects', 'summary', 'recommendation', 'checkedAt']
  for (const f of REQUIRED) {
    assert(REPORTS_UI_TEXT.includes(`r.${f}`),
      `UI must render r.${f}`)
  }
})

test('UI does NOT render legacy fields the watcher does not write', () => {
  const LEGACY = ['newDocuments', 'changedDocuments', 'staleKbModules', 'kbVersion']
  for (const f of LEGACY) {
    assert(!REPORTS_UI_TEXT.includes(`r.${f}`),
      `UI must not render legacy field r.${f}`)
  }
})

test('UI has Approve + Reject buttons', () => {
  assert(/>\s*Approve\s*</.test(REPORTS_UI_TEXT), 'Approve button text missing')
  assert(/>\s*Reject\s*</.test(REPORTS_UI_TEXT),  'Reject button text missing')
})

test('UI writes status + reviewedBy + reviewedAt (per the rule whitelist)', () => {
  // The rule allows only ['status','reviewedBy','reviewedAt'].
  // Verify the setStatus handler writes those three keys + nothing else.
  const m = REPORTS_UI_TEXT.match(/updateDoc\(doc\(db,\s*['"]curriculumUpdateReports['"],\s*reportId\),\s*\{([\s\S]{0,400}?)\}\)/)
  assert(m, 'updateDoc call missing')
  const payload = m[1]
  assert(/status,/.test(payload),     'must write status')
  assert(/reviewedBy:/.test(payload), 'must write reviewedBy')
  assert(/reviewedAt:/.test(payload), 'must write reviewedAt')
  // Make sure no other keys leak — the rule would reject the write.
  const otherKeys = payload.replace(/['"][^'"]*['"]/g, '"_"')
    .match(/\w+:/g) || []
  const KNOWN = new Set(['status:', 'reviewedBy:', 'reviewedAt:'])
  for (const k of otherKeys) {
    assert(KNOWN.has(k), `unexpected payload key: ${k} (Firestore rule allows only ${[...KNOWN].join(', ')})`)
  }
})

test('UI confirmation copy reminds admin that approval does NOT auto-apply', () => {
  assert(/auto-apply/i.test(REPORTS_UI_TEXT) || /not.*apply/i.test(REPORTS_UI_TEXT),
    'confirmation must remind admin that the KB is not auto-mutated')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
