#!/usr/bin/env node
/**
 * Cost-guard fixes — unit tests.
 *
 * Two P0/P1 bugs from the automation-limits audit:
 *
 *   P0-1 — Regeneration loop was unbounded. Admin (or the supervisor's
 *          auto-decision) could re-queue a task indefinitely, burning
 *          the daily question quota on a single bad artifact. No
 *          per-task counter existed.
 *
 *   F1   — `taskExceedsBudget(usage, budget)` was defined in
 *          functions/agents/learnerAi/costGuard.js but never invoked.
 *          The per-task budget (maxSteps / maxTokens / maxCostUsdCents)
 *          existed as scaffolding only.
 *
 * Fixes:
 *   - costGuard.js: new MAX_REGENERATION_ATTEMPTS (3) constant; bump
 *     DEFAULT_TASK_BUDGET.maxSteps 4 → 8 (covers the longest current
 *     plan with headroom — exam_quiz has 6 steps so the old default
 *     would have aborted every chain if the budget gate had been
 *     wired in earlier).
 *   - dispatcher.js: in the step loop, call taskExceedsBudget after
 *     each step + abort with `task_budget_exceeded:<reason>`. In the
 *     regenerate branch, check `after.regenerationAttempts` against
 *     MAX_REGENERATION_ATTEMPTS + refuse if exceeded; otherwise
 *     increment the counter before re-running runChain.
 *   - schema: add `regenerationAttempts` + `regenerateNotes` to
 *     aiAgentTaskWriteSchema (both .optional() so existing tasks
 *     keep validating).
 *
 * Run: npm run test:cost-guard-fixes  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const DISPATCHER_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8',
)
const COST_GUARD_PATH = join(ROOT, 'functions/agents/learnerAi/costGuard.js')

// Mock firebase-admin so we can load aiService → costGuard without
// a Firestore connection.
const fakeAdmin = {
  firestore: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) }),
    doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
  }),
}
fakeAdmin.firestore.FieldValue = {
  serverTimestamp: () => '__ts__',
  increment: (n) => ({ __increment: n }),
}
const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  return origLoad.call(this, request, parent, ...rest)
}
const costGuard = await import(COST_GUARD_PATH)
const { aiAgentTaskWriteSchema } = await import('../src/schemas/learnerAi.js')
Module._load = origLoad

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

// ── costGuard.js — defaults + new constant ─────────────────────

console.log('\ncostGuard.js — defaults + new constant')

test('MAX_REGENERATION_ATTEMPTS exported as 3', () => {
  assert(costGuard.MAX_REGENERATION_ATTEMPTS === 3,
    `expected 3, got ${costGuard.MAX_REGENERATION_ATTEMPTS}`)
})

test('DEFAULT_TASK_BUDGET.maxSteps bumped from 4 → 8', () => {
  assert(costGuard.DEFAULT_TASK_BUDGET.maxSteps === 8,
    `expected 8, got ${costGuard.DEFAULT_TASK_BUDGET.maxSteps}`)
})

test('DEFAULT_TASK_BUDGET preserves maxTokensTotal + maxCostUsdCents', () => {
  assert(costGuard.DEFAULT_TASK_BUDGET.maxTokensTotal === 8000)
  assert(costGuard.DEFAULT_TASK_BUDGET.maxCostUsdCents === 30)
})

// ── taskExceedsBudget pure logic ───────────────────────────────

console.log('\ntaskExceedsBudget — pure helper')

test('returns null when no budget dimension is breached', () => {
  const r = costGuard.taskExceedsBudget(
    { steps: 4, tokensTotal: 1000, costUsdCents: 5 },
    { maxSteps: 8, maxTokensTotal: 8000, maxCostUsdCents: 30 },
  )
  assert(r === null, `expected null, got ${r}`)
})

test('returns "max_steps" when steps >= maxSteps', () => {
  const r = costGuard.taskExceedsBudget({ steps: 8 }, { maxSteps: 8 })
  assert(r === 'max_steps', `expected 'max_steps', got ${r}`)
})

test('returns "max_tokens_total" when tokensTotal >= maxTokensTotal', () => {
  const r = costGuard.taskExceedsBudget(
    { tokensTotal: 8500 }, { maxTokensTotal: 8000 },
  )
  assert(r === 'max_tokens_total', `expected 'max_tokens_total', got ${r}`)
})

test('returns "max_cost" when costUsdCents >= maxCostUsdCents', () => {
  const r = costGuard.taskExceedsBudget(
    { costUsdCents: 31 }, { maxCostUsdCents: 30 },
  )
  assert(r === 'max_cost', `expected 'max_cost', got ${r}`)
})

test('falls back to DEFAULT_TASK_BUDGET when no budget provided', () => {
  // 9 steps with no budget → uses DEFAULT.maxSteps=8 → breach
  const r = costGuard.taskExceedsBudget({ steps: 9 })
  assert(r === 'max_steps')
})

// ── Schema — regenerationAttempts field ────────────────────────

console.log('\nSchema — regenerationAttempts field')

const BASE_TASK = {
  taskType: 'practice_quiz',
  agentName: 'Aria',
  status: 'queued',
  grade: '7',
  subject: 'Mathematics',
  term: '1',
  topic: 'Fractions',
  subtopic: null,
  lessonNumber: null,
  assessmentType: null,
  startedAt: null,
  completedAt: null,
  resultContentId: null,
  errorMessage: null,
  createdAt: '__ts__',
  updatedAt: '__ts__',
}

test('aiAgentTaskWriteSchema accepts regenerationAttempts:0', () => {
  const r = aiAgentTaskWriteSchema.safeParse({
    ...BASE_TASK, regenerationAttempts: 0,
  })
  assert(r.success === true, `must accept: ${r.success ? '' : JSON.stringify(r.error.issues)}`)
})

test('aiAgentTaskWriteSchema accepts regenerationAttempts:3', () => {
  const r = aiAgentTaskWriteSchema.safeParse({
    ...BASE_TASK, regenerationAttempts: 3,
  })
  assert(r.success === true)
})

test('aiAgentTaskWriteSchema rejects regenerationAttempts:21 (over cap)', () => {
  const r = aiAgentTaskWriteSchema.safeParse({
    ...BASE_TASK, regenerationAttempts: 21,
  })
  assert(r.success === false, 'must reject > 20')
})

test('aiAgentTaskWriteSchema rejects regenerationAttempts:-1', () => {
  const r = aiAgentTaskWriteSchema.safeParse({
    ...BASE_TASK, regenerationAttempts: -1,
  })
  assert(r.success === false, 'must reject negatives')
})

test('aiAgentTaskWriteSchema allows omitting regenerationAttempts (backwards-compat)', () => {
  const r = aiAgentTaskWriteSchema.safeParse(BASE_TASK)
  assert(r.success === true, 'older task docs without the field must keep validating')
})

test('regenerateNotes field accepted up to 4000 chars', () => {
  const r = aiAgentTaskWriteSchema.safeParse({
    ...BASE_TASK, regenerateNotes: 'x'.repeat(4000),
  })
  assert(r.success === true)
})

test('regenerateNotes rejects > 4000 chars', () => {
  const r = aiAgentTaskWriteSchema.safeParse({
    ...BASE_TASK, regenerateNotes: 'x'.repeat(4001),
  })
  assert(r.success === false)
})

// ── dispatcher.js — wiring greps ──────────────────────────────

console.log('\nDispatcher wiring — taskExceedsBudget + regen counter')

test('dispatcher imports taskExceedsBudget + MAX_REGENERATION_ATTEMPTS', () => {
  assert(/taskExceedsBudget/.test(DISPATCHER_TEXT),
    'must import taskExceedsBudget')
  assert(/MAX_REGENERATION_ATTEMPTS/.test(DISPATCHER_TEXT),
    'must import MAX_REGENERATION_ATTEMPTS')
  assert(/DEFAULT_TASK_BUDGET/.test(DISPATCHER_TEXT),
    'must import DEFAULT_TASK_BUDGET')
})

test('chainContext.usage accumulator initialised before step loop', () => {
  assert(/chainContext\.usage\s*=\s*\{steps:\s*0/.test(DISPATCHER_TEXT),
    'must seed chainContext.usage = {steps: 0, ...}')
})

test('step loop checks taskExceedsBudget + aborts on breach', () => {
  // Locate the step loop body.
  const loopIdx = DISPATCHER_TEXT.indexOf('for (let i = 0; i < steps.length')
  const block = DISPATCHER_TEXT.slice(loopIdx, loopIdx + 3000)
  assert(/taskExceedsBudget\(chainContext\.usage/.test(block),
    'must call taskExceedsBudget inside the step loop')
  assert(/task_budget_exceeded:/.test(block),
    'must abort with errorMessage starting with task_budget_exceeded:')
  assert(/action:\s*["']budget_breach["']/.test(block),
    'must write an agent log with action=budget_breach')
})

test('regenerate branch checks regenerationAttempts >= MAX before re-running', () => {
  const regenIdx = DISPATCHER_TEXT.indexOf('isRegenerateRequest')
  const block = DISPATCHER_TEXT.slice(regenIdx, regenIdx + 3000)
  assert(/attemptsSoFar\s*>=\s*MAX_REGENERATION_ATTEMPTS/.test(block),
    'must compare against MAX_REGENERATION_ATTEMPTS')
  assert(/regeneration_loop_blocked/.test(block),
    'must mark task ERROR with regeneration_loop_blocked when capped')
})

test('regenerate branch increments regenerationAttempts on each re-queue', () => {
  const regenIdx = DISPATCHER_TEXT.indexOf('isRegenerateRequest')
  const block = DISPATCHER_TEXT.slice(regenIdx, regenIdx + 3000)
  assert(/regenerationAttempts:\s*attemptsSoFar \+ 1/.test(block),
    'must bump attemptsSoFar + 1 in the reset setTaskFields call')
})

test('block log + return BEFORE the runChain re-trigger', () => {
  // Ensure the loop-guard return is *before* the recordContentVersion +
  // setTaskFields(reset) + runChain calls — otherwise a capped task
  // would still run.
  const regenIdx = DISPATCHER_TEXT.indexOf('isRegenerateRequest')
  const block = DISPATCHER_TEXT.slice(regenIdx, regenIdx + 3000)
  const blockedIdx = block.indexOf('regeneration_loop_blocked')
  const runChainIdx = block.indexOf('await runChain({taskId})')
  assert(blockedIdx > 0 && runChainIdx > 0 && blockedIdx < runChainIdx,
    'loop-guard early-return must come BEFORE the runChain call')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
