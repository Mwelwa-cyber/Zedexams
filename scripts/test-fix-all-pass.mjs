#!/usr/bin/env node
/**
 * Fix-all pass — unit tests.
 *
 * Two remaining confirmed bugs from prior audits in this session:
 *
 *   F4 — curriculumWatcher writes a new `pending_review` report on
 *        every scan. If the admin doesn't review the first report
 *        before the next scheduled scan, the OLD report stays at
 *        pending_review forever — admin queue fills with stale
 *        duplicates for the same source URL.
 *
 *        Fix: after writing the new report, the watcher demotes any
 *        prior pending_review reports for the same sourceUrl to
 *        status='superseded' + supersededBy=<newId>. Mirrors the
 *        aiGeneratedContent sibling-demote pattern from PR #562.
 *
 *   F3 — Teachers who queued a generation task via AgentBriefForm
 *        could not preview the draft until an admin approved it.
 *        Rule was `isAdmin() || status==published` for non-grade-match
 *        reads — teachers were denied their own queued draft.
 *
 *        Fix:
 *          - _stubFactory now stamps `sourceTaskId: task.id` on the
 *            artifact (forward link aiAgentTasks.resultContentId
 *            was already in place — this is the reverse pointer).
 *          - Schema accepts the new field (optional + nullable for
 *            backwards-compat with existing docs).
 *          - Firestore rule adds a teacher-or-above branch that
 *            allows the read when the artifact's sourceTaskId
 *            points to a task whose createdBy matches auth.uid.
 *            Uses exists() + get() cross-collection check — one
 *            extra small-doc read per teacher-on-draft eval.
 *
 * Run: npm run test:fix-all-pass  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const WATCHER_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/runners/curriculumWatcher.js'), 'utf8',
)
const STUB_FACTORY_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/runners/_stubFactory.js'), 'utf8',
)
const RULES_TEXT = readFileSync(join(ROOT, 'firestore.rules'), 'utf8')
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

// ── F4: Curriculum watcher supersedes prior pending_review siblings ─

console.log('\nF4 — Curriculum watcher supersedes prior pending_review siblings')

test('watcher queries for sibling pending_review reports by sourceUrl', () => {
  // After the new report is added, the watcher should query for
  // siblings with the same sourceUrl + status=pending_review.
  assert(/\.where\(["']sourceUrl["'],\s*["']==["'],\s*source\.url\)/.test(WATCHER_TEXT),
    'must query where("sourceUrl", "==", source.url)')
  assert(/\.where\(["']status["'],\s*["']==["'],\s*["']pending_review["']\)/.test(WATCHER_TEXT),
    'must filter to status=pending_review')
})

test('watcher demote loop skips the newly-created doc', () => {
  // Must not demote the doc it just created. Look for the
  // ref.id-skip in the iteration.
  const addIdx = WATCHER_TEXT.indexOf('.collection(COLLECTIONS.CURRICULUM_REPORTS).add(report)')
  const block = WATCHER_TEXT.slice(addIdx, addIdx + 1500)
  assert(/if \(doc\.id === ref\.id\) continue/.test(block),
    'must skip the just-created doc by id')
})

test('demote writes status=superseded + supersededBy + reviewedAt', () => {
  const addIdx = WATCHER_TEXT.indexOf('.collection(COLLECTIONS.CURRICULUM_REPORTS).add(report)')
  const block = WATCHER_TEXT.slice(addIdx, addIdx + 1500)
  assert(/status:\s*["']superseded["']/.test(block),
    'must set status="superseded"')
  assert(/supersededBy:\s*ref\.id/.test(block),
    'must point supersededBy at the new doc')
  // reviewedBy should be flagged as system-driven so admin can tell
  // the difference from a human action.
  assert(/reviewedBy:\s*["']system:watcher["']/.test(block),
    'reviewedBy must be "system:watcher" — distinguishable from admin actions')
})

test('demote runs inside a try/catch — never breaks the new-report write', () => {
  const addIdx = WATCHER_TEXT.indexOf('.collection(COLLECTIONS.CURRICULUM_REPORTS).add(report)')
  const tail = WATCHER_TEXT.slice(addIdx, addIdx + 2000)
  // Must have a try { ... } catch (err) { console.warn ... } around
  // the supersede logic so a failure doesn't roll back the add.
  assert(/try\s*\{[\s\S]*?siblings[\s\S]*?\}\s*catch\s*\(err\)\s*\{/.test(tail),
    'supersede must be wrapped in try/catch with console.warn fallback')
})

// ── F3: Teacher own-draft visibility ───────────────────────────────

console.log('\nF3 — Teacher previewing own queued drafts')

test('_stubFactory stamps sourceTaskId: task.id on the artifact', () => {
  // Look in docPayload for the sourceTaskId field.
  const payloadIdx = STUB_FACTORY_TEXT.indexOf('const docPayload = {')
  const block = STUB_FACTORY_TEXT.slice(payloadIdx, payloadIdx + 1500)
  assert(/sourceTaskId:\s*task\.id\s*\?/.test(block) ||
    /sourceTaskId:\s*String\(task\.id\)/.test(block),
    'docPayload must include sourceTaskId derived from task.id')
})

test('schema accepts sourceTaskId field (optional + nullable)', () => {
  // Verify the aiGeneratedContent write schema includes the field.
  const aiContentIdx = SCHEMA_TEXT.indexOf('export const aiGeneratedContentWriteSchema')
  const block = SCHEMA_TEXT.slice(aiContentIdx, aiContentIdx + 3000)
  assert(/sourceTaskId:\s*z\.string\(\)/.test(block),
    'aiGeneratedContentWriteSchema must declare sourceTaskId')
  assert(/sourceTaskId:[\s\S]{0,120}\.optional\(\)/.test(block),
    'sourceTaskId must be .optional() for backwards-compat with existing docs')
  assert(/sourceTaskId:[\s\S]{0,120}\.nullable\(\)/.test(block),
    'sourceTaskId must be .nullable() — _stubFactory writes null when task.id is missing')
})

test('schema also accepts supersededBy field (paired with F4 above)', () => {
  const aiContentIdx = SCHEMA_TEXT.indexOf('export const aiGeneratedContentWriteSchema')
  const block = SCHEMA_TEXT.slice(aiContentIdx, aiContentIdx + 3000)
  assert(/supersededBy:\s*z\.string\(\)/.test(block),
    'supersededBy must be in the content schema')
})

test('Firestore rule adds teacher-on-own-draft branch using sourceTaskId', () => {
  // Locate the aiGeneratedContent rule block.
  const ruleIdx = RULES_TEXT.indexOf('match /aiGeneratedContent/{contentId}')
  const block = RULES_TEXT.slice(ruleIdx, ruleIdx + 1500)
  assert(/isTeacherOrAbove\(\)/.test(block),
    'rule must include isTeacherOrAbove() in the new branch')
  assert(/['"]sourceTaskId['"] in resource\.data/.test(block),
    'rule must check sourceTaskId existence before exists()')
  assert(/exists\(\/databases\/\$\(database\)\/documents\/aiAgentTasks/.test(block),
    'rule must exists() the source task')
  assert(/get\(\/databases\/\$\(database\)\/documents\/aiAgentTasks[\s\S]{0,200}createdBy == request\.auth\.uid/.test(block),
    'rule must compare task.createdBy === auth.uid via get()')
})

test('rule still blocks all direct client writes to aiGeneratedContent', () => {
  // Defence: ensure my read-rule extension didn't accidentally drop
  // the `write: if false` guard.
  const ruleIdx = RULES_TEXT.indexOf('match /aiGeneratedContent/{contentId}')
  const block = RULES_TEXT.slice(ruleIdx, ruleIdx + 1500)
  assert(/allow write:\s*if false/.test(block),
    'write must remain server-only — no client paths')
})

test('rule still admin-bypasses + still grade-gates learners', () => {
  // Make sure the existing branches are preserved.
  const ruleIdx = RULES_TEXT.indexOf('match /aiGeneratedContent/{contentId}')
  const block = RULES_TEXT.slice(ruleIdx, ruleIdx + 1500)
  assert(/isAdmin\(\)/.test(block), 'admin bypass must remain')
  assert(/resource\.data\.status\s*==\s*['"]published['"]/.test(block),
    'published-only gate must remain for non-admin / non-teacher branches')
  assert(/string\(resource\.data\.grade\)\s*==\s*string\(callerGrade\(\)\)/.test(block),
    'learner grade-match must remain')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
