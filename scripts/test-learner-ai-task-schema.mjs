#!/usr/bin/env node
/**
 * Static schema test for the learner-AI pipeline.
 *
 * Three things matter and are easy to drift:
 *   1. firestore.rules whitelists every new collection.
 *   2. firestore.indexes.json carries the 8 composite indexes.
 *   3. The dispatcher's status machine + supervisor's step planner
 *      stay aligned with the rule's `incoming().status` whitelist.
 *
 * This test fails the build if any of those drift.
 *
 * Run: npm run test:learner-ai-schema  (also via npm run test:all)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = join(__dirname, '..')

const rules = readFileSync(join(REPO, 'firestore.rules'), 'utf8')
const indexes = JSON.parse(readFileSync(join(REPO, 'firestore.indexes.json'), 'utf8'))

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

console.log('\nLearner-AI Firestore rules — new collections present')

const NEW_COLLECTIONS = [
  'aiAgentTasks',
  'aiAgentLogs',
  'learnerAiGenerations',
  'liveAgentStates',
  'curriculumUpdateReports',
  'assessmentStandards',
  'approvedSyllabi',
]
for (const c of NEW_COLLECTIONS) {
  test(`rules whitelist /${c}/{id}`, () => {
    assert(rules.includes(`match /${c}/{`),
      `firestore.rules missing match block for ${c}`)
  })
}

test('aiAgentTasks create gated to department=learner_ai', () => {
  assert(rules.includes("incoming().department == 'learner_ai'"),
    'aiAgentTasks create rule must pin department to learner_ai')
})

test('aiAgentTasks create blocks supervisorPlan / curriculumRef prefill', () => {
  // Same approach as agentJobs: ensure tampered client cannot prefill
  // the orchestration / grounding fields.
  for (const field of ['supervisorPlan', 'curriculumRef', 'qualityVerdict', 'output']) {
    assert(rules.includes(`(!('${field}' in incoming()))`),
      `aiAgentTasks create rule does not block prefilled ${field}`)
  }
})

test('learnerAiGenerations learner read gated to published+ownLearnerUid', () => {
  assert(rules.includes("resource.data.visibility == 'published'") &&
         rules.includes('resource.data.learnerUid == request.auth.uid'),
    'learnerAiGenerations learner-read rule missing published+ownership predicate')
})

test('aiAgentLogs is admin-read, no client write', () => {
  const headerIdx = rules.indexOf('match /aiAgentLogs/')
  assert(headerIdx >= 0, 'aiAgentLogs match block not found')
  // The brace right after the path-parameter `{logId}` opens the block.
  // Find the first newline after the header — the block body starts there.
  const nlAfterHeader = rules.indexOf('\n', headerIdx)
  assert(nlAfterHeader > 0, 'aiAgentLogs header has no newline')
  // Grab the next ~30 lines — that's plenty for any single match block.
  const block = rules.slice(headerIdx, nlAfterHeader + 1000)
  assert(block.includes('allow read: if isAdmin();'),
    'aiAgentLogs must be admin-read only')
  assert(block.includes('allow write: if false;'),
    'aiAgentLogs must deny all client writes')
})

console.log('\nLearner-AI composite indexes — 8 essential indexes present')

const collectionsIndexed = new Set(
  indexes.indexes.map(i => i.collectionGroup),
)
for (const c of ['aiAgentTasks', 'aiAgentLogs', 'learnerAiGenerations']) {
  test(`indexes include ${c}`, () => {
    assert(collectionsIndexed.has(c),
      `firestore.indexes.json missing composite index for ${c}`)
  })
}

const requiredIndexShapes = [
  { collectionGroup: 'aiAgentTasks', fields: ['status', 'createdAt'] },
  { collectionGroup: 'aiAgentTasks', fields: ['learnerUid', 'status', 'createdAt'] },
  { collectionGroup: 'aiAgentTasks', fields: ['agentId', 'status', 'updatedAt'] },
  { collectionGroup: 'aiAgentLogs', fields: ['taskId', 'createdAt'] },
  { collectionGroup: 'aiAgentLogs', fields: ['agentId', 'level', 'createdAt'] },
  { collectionGroup: 'aiAgentLogs', fields: ['curriculumGrounded', 'createdAt'] },
  { collectionGroup: 'learnerAiGenerations', fields: ['learnerUid', 'visibility', 'createdAt'] },
  { collectionGroup: 'learnerAiGenerations', fields: ['visibility', 'subject', 'grade', 'createdAt'] },
]
for (const want of requiredIndexShapes) {
  test(`composite index ${want.collectionGroup}:(${want.fields.join(', ')})`, () => {
    const match = indexes.indexes.find(idx =>
      idx.collectionGroup === want.collectionGroup &&
      idx.fields.length === want.fields.length &&
      idx.fields.every((f, i) => f.fieldPath === want.fields[i])
    )
    assert(match, `missing composite index ${want.collectionGroup}:(${want.fields.join(', ')})`)
  })
}

console.log('\nDispatcher state machine aligns with rule whitelist')

const dispatcher = readFileSync(
  join(REPO, 'functions', 'agents', 'learnerAi', 'dispatcher.js'),
  'utf8',
)
for (const status of ['queued', 'supervisor_planning', 'curriculum_read', 'generating', 'quality_check', 'awaiting_approval', 'failed', 'published']) {
  test(`dispatcher uses status '${status}'`, () => {
    assert(dispatcher.includes(`"${status}"`),
      `dispatcher does not reference status '${status}'`)
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
