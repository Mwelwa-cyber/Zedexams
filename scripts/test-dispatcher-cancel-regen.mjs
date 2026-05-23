#!/usr/bin/env node
/**
 * Cancel + Regenerate dispatcher fixes — unit tests.
 *
 * Two P0 bugs surfaced by the Live AI Agent Monitor trace:
 *
 *   P0-1 — Cancel Task is racy. Admin sets task.status='rejected'
 *          mid-flight, but `runChain`'s final `setTaskFields` write
 *          unconditionally overwrites it with the supervisor's
 *          terminal status (often 'approved'), which then fires the
 *          publish trigger.
 *          Fix: re-read the task before the terminal write; if status
 *          is 'rejected' AND errorMessage starts with 'Cancelled',
 *          skip the write + log the cancellation.
 *
 *   P0-2 — Regenerate writes status='regenerating' but no trigger
 *          re-runs the chain. `createAiAgentTasksOnCreate` fires only
 *          on doc creation; `createAiAgentTasksOnApproved` (onUpdate)
 *          didn't call `runChain`.
 *          Fix: extend the onUpdate handler — when status flips
 *          terminal → 'regenerating' (or legacy 'queued'), record the
 *          regenerated version snapshot, reset pipeline fields, then
 *          call `runChain({taskId})`.
 *
 * Tests are source-text greps — the dispatcher's runChain isn't
 * trivially mockable (12 runner imports, deep Firestore touch). Greps
 * verify the right code is present so a future revert is caught by
 * `npm run test:all`.
 *
 * Run: npm run test:dispatcher-fixes  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DISPATCHER_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8',
)
const CANCEL_HANDLER_TEXT = readFileSync(
  join(ROOT, 'src/components/admin/learnerAi/LiveAgentStatusCards.jsx'), 'utf8',
)
const REGEN_MODAL_TEXT = readFileSync(
  join(ROOT, 'src/components/admin/learnerAi/RegenerateWithNotesModal.jsx'), 'utf8',
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

// ── Confirm the client-side writes the fix expects ────────────────

console.log('\nClient-side cancel + regenerate writes (baseline)')

test('Cancel handler writes status=rejected + errorMessage=Cancelled...', () => {
  assert(/status:\s*['"]rejected['"]/.test(CANCEL_HANDLER_TEXT),
    'handleCancelTask must write status=rejected')
  assert(/errorMessage:\s*['"]Cancelled from Live Monitor['"]/.test(CANCEL_HANDLER_TEXT),
    'handleCancelTask must set errorMessage starting with "Cancelled"')
})

test('Regenerate modal writes status=regenerating + regenerateNotes', () => {
  assert(/status:\s*['"]regenerating['"]/.test(REGEN_MODAL_TEXT),
    'RegenerateWithNotesModal must write status=regenerating')
  assert(/regenerateNotes:/.test(REGEN_MODAL_TEXT),
    'modal must write regenerateNotes')
})

// ── Fix P0-1: dispatcher honours cancellation ─────────────────────

console.log('\nFix P0-1 — dispatcher honours mid-flight cancellation')

test('runChain re-reads task before terminal setTaskFields', () => {
  // The final setTaskFields must be preceded by a fresh readTask call.
  // (Pattern: const finalTask = await readTask(taskRef); ... if (cancelled) return; ... setTaskFields)
  const idx = DISPATCHER_TEXT.indexOf('completedAt: admin.firestore.FieldValue.serverTimestamp()')
  // Find a `readTask` call within the 800 characters preceding the
  // first match of completedAt: serverTimestamp (that's the terminal write).
  // The first such serverTimestamp lives inside the publish trigger
  // (much later in the file), so we search for `runChain` block.
  const runChainStart = DISPATCHER_TEXT.indexOf('async function runChain')
  const runChainEnd = DISPATCHER_TEXT.indexOf('\n}', runChainStart)
  const runChainBody = DISPATCHER_TEXT.slice(runChainStart, runChainEnd)
  assert(/const finalTask\s*=\s*await readTask\(taskRef\)/.test(runChainBody),
    `runChain must re-read task before terminal write (got ${idx < 0 ? 'no terminal write' : 'no finalTask read'})`)
})

test('runChain checks status=rejected + Cancelled errorMessage', () => {
  const runChainStart = DISPATCHER_TEXT.indexOf('async function runChain')
  const runChainEnd = DISPATCHER_TEXT.indexOf('\n}', runChainStart)
  const body = DISPATCHER_TEXT.slice(runChainStart, runChainEnd)
  assert(/finalTask\.status\s*===\s*TASK_STATUS\.REJECTED/.test(body),
    'must check finalTask.status === REJECTED')
  assert(/finalTask\.errorMessage[\s\S]{0,80}startsWith\(["']cancelled/.test(body),
    'must check errorMessage starts with "cancelled" (lower-cased)')
})

test('runChain logs cancellation + early-returns before terminal write', () => {
  const runChainStart = DISPATCHER_TEXT.indexOf('async function runChain')
  const runChainEnd = DISPATCHER_TEXT.indexOf('\n}', runChainStart)
  const body = DISPATCHER_TEXT.slice(runChainStart, runChainEnd)
  assert(/action:\s*['"]honour_cancellation['"]/.test(body),
    'must writeAgentLog with action=honour_cancellation')
  // The early-return ('return;') must appear AFTER the cancellation
  // check and BEFORE the terminal setTaskFields.
  const honourIdx = body.indexOf("honour_cancellation")
  const terminalWriteIdx = body.lastIndexOf("setTaskFields(taskRef")
  assert(honourIdx > 0 && terminalWriteIdx > honourIdx,
    'cancellation check must come BEFORE the terminal setTaskFields')
  const between = body.slice(honourIdx, terminalWriteIdx)
  assert(/\breturn;\s*\n\s*\}/.test(between),
    'must `return;` before reaching the terminal write')
})

// ── Fix P0-2: regenerate re-runs the chain ────────────────────────

console.log('\nFix P0-2 — admin Regenerate re-triggers runChain')

test('onApproved handler detects terminal→regenerating transition', () => {
  // The handler must check `wasTerminal && after.status === REGENERATING`.
  assert(/after\.status\s*===\s*TASK_STATUS\.REGENERATING/.test(DISPATCHER_TEXT),
    'must check after.status === REGENERATING')
  assert(/isRegenerateRequest/.test(DISPATCHER_TEXT),
    'should use the isRegenerateRequest gate flag (or equivalent)')
})

test('onApproved handler resets pipeline fields before re-run', () => {
  // The reset must clear startedAt, completedAt, resultContentId,
  // errorMessage so the next runChain starts from a clean slate.
  // Verify within the regenerate block specifically.
  const regenIdx = DISPATCHER_TEXT.indexOf('isRegenerateRequest')
  assert(regenIdx > 0, 'isRegenerateRequest block must exist')
  // Find the next ~600 chars window — must contain the reset writes.
  const block = DISPATCHER_TEXT.slice(regenIdx, regenIdx + 2500)
  assert(/startedAt:\s*null/.test(block),
    'must reset startedAt:null')
  assert(/completedAt:\s*null/.test(block),
    'must reset completedAt:null')
  assert(/resultContentId:\s*null/.test(block),
    'must reset resultContentId:null')
})

test('onApproved handler calls runChain for the regenerate request', () => {
  const regenIdx = DISPATCHER_TEXT.indexOf('isRegenerateRequest')
  const block = DISPATCHER_TEXT.slice(regenIdx, regenIdx + 2500)
  assert(/await runChain\(\{\s*taskId\s*\}\)/.test(block),
    'must call await runChain({taskId}) inside the regenerate block')
})

test('onApproved handler logs the regenerate decision before re-run', () => {
  const regenIdx = DISPATCHER_TEXT.indexOf('isRegenerateRequest')
  const block = DISPATCHER_TEXT.slice(regenIdx, regenIdx + 2500)
  assert(/action:\s*["']regenerate["']/.test(block),
    'must writeAgentLog with action=regenerate before re-running')
})

test('Regenerated version snapshot still gets recorded', () => {
  // The regenerated version snapshot was added in PR #558 for the
  // 'queued' transition. The fix extends to also cover 'regenerating'.
  // Verify the snapshot write is still present inside the new block.
  const regenIdx = DISPATCHER_TEXT.indexOf('isRegenerateRequest')
  const block = DISPATCHER_TEXT.slice(regenIdx, regenIdx + 2500)
  assert(/VERSION_CHANGE_TYPES\.REGENERATED/.test(block),
    'must record a REGENERATED version snapshot before re-running')
})

test('regenerate block returns early so the publish branch never fires', () => {
  // After the regenerate handling, the function must `return;` —
  // otherwise the downstream `after.status !== APPROVED` check would
  // not stop the publish-path code (it would, but only by accident).
  // Explicit return is cleaner + protects future edits.
  const regenIdx = DISPATCHER_TEXT.indexOf('isRegenerateRequest')
  const block = DISPATCHER_TEXT.slice(regenIdx, regenIdx + 2500)
  const runChainCallIdx = block.indexOf('await runChain')
  assert(runChainCallIdx > 0, 'await runChain call missing')
  const afterRunChain = block.slice(runChainCallIdx, runChainCallIdx + 200)
  assert(/return;/.test(afterRunChain), 'must return; immediately after runChain to avoid falling into publish branch')
})

// ── Defence: existing publish path is still intact ────────────────

console.log('\nDefence — existing publish path unchanged')

test('publish path still requires before!=APPROVED && after===APPROVED', () => {
  assert(/if \(before\.status === TASK_STATUS\.APPROVED\) return/.test(DISPATCHER_TEXT),
    'publish-path early-return for already-approved must remain')
  assert(/if \(after\.status !== TASK_STATUS\.APPROVED\) return/.test(DISPATCHER_TEXT),
    'publish-path early-return for non-approved must remain')
})

test('content.set({status: PUBLISHED}) still wrapped by the approved branch', () => {
  // The PUBLISHED write must come AFTER the two early-returns above —
  // not in the regenerate block.
  const publishIdx = DISPATCHER_TEXT.indexOf('CONTENT_STATUS.PUBLISHED')
  const earlyReturnIdx = DISPATCHER_TEXT.indexOf('if (after.status !== TASK_STATUS.APPROVED) return')
  assert(publishIdx > earlyReturnIdx,
    'CONTENT_STATUS.PUBLISHED write must come AFTER the approved-only guard')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
