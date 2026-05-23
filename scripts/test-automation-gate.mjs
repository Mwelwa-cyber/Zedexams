#!/usr/bin/env node
/**
 * Automation gate — unit tests.
 *
 * Covers the pure helpers exposed by
 * functions/agents/learnerAi/automationGate.js + verifies the
 * dispatcher integration via source-text greps.
 *
 * What's tested:
 *   - loadAutomationSettings returns permissive defaults when the
 *     Firestore doc is missing
 *   - assertAutomationAllowed throws on enabled:false (code:automation_disabled)
 *   - throws on grade not in non-empty enabledGrades (grade_not_enabled)
 *   - throws on subject not in non-empty enabledSubjects (subject_not_enabled)
 *   - allows everything when both arrays empty (backwards-compat default)
 *   - assertDailyQuotas throws on question quota breach
 *   - assertDailyQuotas throws on quiz quota breach (only for quiz types)
 *   - countQuestionsInContent returns correct count per artifact type
 *   - estimateQuestionCount estimates from task.parameters
 *   - recordGenerationUsage swallows errors silently (never throws)
 *   - hard-rule pin: tampered requireAdminApprovalFor* falls back to defaults
 *   - Zod aiAutomationSettingsWriteSchema rejects bogus literal pins
 *   - Dispatcher source text imports the gate + invokes both helpers
 *
 * Run: npm run test:automation-gate  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const GATE_PATH = join(ROOT, 'functions/agents/learnerAi/automationGate.js')
const DISPATCHER_TEXT = readFileSync(join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8')
const FACTORY_TEXT = readFileSync(join(ROOT, 'functions/agents/learnerAi/runners/_stubFactory.js'), 'utf8')
const HEALTH_TEXT = readFileSync(join(ROOT, 'functions/agents/learnerAi/healthCheck.js'), 'utf8')

// ── Mock firebase-admin so we can drive different Firestore responses
// per test case. The mocks read from this mutable state.
const state = {
  settingsDoc: null,        // null = doc absent; object = doc data
  usageDoc: null,
  incrementCalls: [],
  failOnSet: false,
}

const fakeAdmin = {
  firestore: () => ({
    doc: (path) => ({
      get: async () => {
        if (path === 'aiAutomationSettings/global') {
          return {
            exists: state.settingsDoc !== null,
            data: () => state.settingsDoc,
          }
        }
        throw new Error(`unexpected doc() path: ${path}`)
      },
    }),
    collection: (name) => ({
      doc: (id) => ({
        get: async () => {
          if (name === 'aiUsageDaily') {
            return {
              exists: state.usageDoc !== null,
              data: () => state.usageDoc,
            }
          }
          throw new Error(`unexpected collection().doc() path: ${name}/${id}`)
        },
        set: async (payload, opts) => {
          if (state.failOnSet) throw new Error('simulated firestore failure')
          state.incrementCalls.push({ name, id, payload, opts })
        },
      }),
    }),
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
const gate = await import(GATE_PATH)
const { aiAutomationSettingsWriteSchema } = await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  // Reset state + cache between tests so assertions don't bleed.
  state.settingsDoc = null
  state.usageDoc = null
  state.incrementCalls = []
  state.failOnSet = false
  gate.clearCache()
  try {
    const r = fn()
    if (r && typeof r.then === 'function') {
      return r.then(() => { pass++; console.log(`  ok  ${name}`) })
              .catch(err => { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) })
    }
    pass++; console.log(`  ok  ${name}`)
  } catch (err) {
    fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

console.log('\nloadAutomationSettings — defaults + hard-rule defence')

await test('returns permissive defaults when doc missing', async () => {
  const s = await gate.loadAutomationSettings()
  assert(s.enabled === true)
  assert(s.maxQuestionsPerDay === 100)
  assert(s.maxQuizzesPerDay === 20)
  assert(s.requireAdminApprovalForExamQuizzes === true)
  assert(s.curriculumUpdateCheckFrequency === 'weekly')
  assert(s.enabledGrades.length === 0)
  assert(s.enabledSubjects.length === 0)
})

await test('honours admin overrides when doc valid', async () => {
  state.settingsDoc = {
    enabled: false,
    maxQuestionsPerDay: 50,
    maxQuizzesPerDay: 5,
    requireAdminApprovalForExamQuizzes: true,
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'monthly',
    enabledGrades: ['7', '8'],
    enabledSubjects: ['Mathematics'],
  }
  const s = await gate.loadAutomationSettings()
  assert(s.enabled === false)
  assert(s.maxQuestionsPerDay === 50)
  assert(s.curriculumUpdateCheckFrequency === 'monthly')
  assert(s.enabledGrades.length === 2)
})

await test('falls back to defaults when requireAdminApprovalForExamQuizzes is tampered to false', async () => {
  state.settingsDoc = {
    enabled: false,
    requireAdminApprovalForExamQuizzes: false,    // tampered!
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'monthly',
  }
  const s = await gate.loadAutomationSettings()
  // Must fall back to defaults — i.e. enabled:true, not false from
  // the tampered doc.
  assert(s.enabled === true, 'must fall back to defaults when hard rule tampered')
  assert(s.requireAdminApprovalForExamQuizzes === true)
})

console.log('\nassertAutomationAllowed — pause + whitelist gates')

await test('throws automation_disabled when enabled:false', async () => {
  state.settingsDoc = {
    enabled: false,
    requireAdminApprovalForExamQuizzes: true,
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'weekly',
  }
  let caught = null
  try { await gate.assertAutomationAllowed({task: {grade: '7'}}) }
  catch (e) { caught = e }
  assert(caught && caught.code === 'automation_disabled', `expected automation_disabled, got ${caught && caught.code}`)
})

await test('throws grade_not_enabled when task.grade not in whitelist', async () => {
  state.settingsDoc = {
    enabled: true,
    requireAdminApprovalForExamQuizzes: true,
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'weekly',
    enabledGrades: ['7'],
    enabledSubjects: [],
  }
  let caught = null
  try { await gate.assertAutomationAllowed({task: {grade: '9', subject: 'Mathematics'}}) }
  catch (e) { caught = e }
  assert(caught && caught.code === 'grade_not_enabled', `got: ${caught && caught.code}`)
})

await test('throws subject_not_enabled when subject not in whitelist', async () => {
  state.settingsDoc = {
    enabled: true,
    requireAdminApprovalForExamQuizzes: true,
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'weekly',
    enabledGrades: [],
    enabledSubjects: ['Mathematics'],
  }
  let caught = null
  try { await gate.assertAutomationAllowed({task: {grade: '7', subject: 'Biology'}}) }
  catch (e) { caught = e }
  assert(caught && caught.code === 'subject_not_enabled', `got: ${caught && caught.code}`)
})

await test('allows everything when both arrays empty', async () => {
  state.settingsDoc = null    // defaults: empty arrays, enabled:true
  await gate.assertAutomationAllowed({task: {grade: '9', subject: 'Biology'}})
  // no throw = pass
})

await test('coerces numeric grade to string for whitelist comparison', async () => {
  state.settingsDoc = {
    enabled: true,
    requireAdminApprovalForExamQuizzes: true,
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'weekly',
    enabledGrades: ['7'],
    enabledSubjects: [],
  }
  await gate.assertAutomationAllowed({task: {grade: 7, subject: 'Mathematics'}})
  // no throw — '7' (string) matches 7 (number) after coercion
})

console.log('\nassertDailyQuotas — caps')

await test('throws daily_question_quota_exceeded when projected exceeds cap', async () => {
  state.settingsDoc = null    // defaults (cap 100)
  state.usageDoc = { questionsGenerated: 95 }
  let caught = null
  try { await gate.assertDailyQuotas({estimatedQuestionCount: 10, contentType: 'practice_quiz'}) }
  catch (e) { caught = e }
  assert(caught && caught.code === 'daily_question_quota_exceeded', `got: ${caught && caught.code}`)
})

await test('throws daily_quiz_quota_exceeded when at quiz cap', async () => {
  state.settingsDoc = { ...{
    enabled: true,
    requireAdminApprovalForExamQuizzes: true,
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'weekly',
  }, maxQuestionsPerDay: 10_000, maxQuizzesPerDay: 5 }
  state.usageDoc = { questionsGenerated: 0, quizzesGenerated: 5 }
  let caught = null
  try { await gate.assertDailyQuotas({estimatedQuestionCount: 1, contentType: 'practice_quiz'}) }
  catch (e) { caught = e }
  assert(caught && caught.code === 'daily_quiz_quota_exceeded', `got: ${caught && caught.code}`)
})

await test('quiz quota does not apply to non-quiz content', async () => {
  state.settingsDoc = { ...{
    enabled: true,
    requireAdminApprovalForExamQuizzes: true,
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'weekly',
  }, maxQuestionsPerDay: 10_000, maxQuizzesPerDay: 5 }
  state.usageDoc = { questionsGenerated: 0, quizzesGenerated: 5 }
  await gate.assertDailyQuotas({estimatedQuestionCount: 0, contentType: 'notes'})
  // notes does not trip the quiz cap — no throw
})

await test('passes when projected fits inside cap', async () => {
  state.settingsDoc = null
  state.usageDoc = { questionsGenerated: 50 }
  await gate.assertDailyQuotas({estimatedQuestionCount: 25, contentType: 'practice_quiz'})
})

console.log('\ncountQuestionsInContent')

await test('counts practice_quiz.questions[]', async () => {
  const n = gate.countQuestionsInContent('practice_quiz', {questions: [1, 2, 3]})
  assert(n === 3, `got ${n}`)
})

await test('sums exam_quiz.sections[].questions[]', async () => {
  const n = gate.countQuestionsInContent('exam_quiz', {sections: [
    {questions: [1, 2, 3]},
    {questions: [1, 2]},
  ]})
  assert(n === 5, `got ${n}`)
})

await test('returns 0 for notes / study_tips / learner_feedback', async () => {
  assert(gate.countQuestionsInContent('notes', {body: 'x'}) === 0)
  assert(gate.countQuestionsInContent('study_tips', {tips: ['x']}) === 0)
  assert(gate.countQuestionsInContent('learner_feedback', {feedback: 'x'}) === 0)
})

await test('returns 0 on null content', async () => {
  assert(gate.countQuestionsInContent('practice_quiz', null) === 0)
})

console.log('\nestimateQuestionCount')

await test('defaults practice_quiz to 10', async () => {
  const n = gate.estimateQuestionCount({taskType: 'practice_quiz', parameters: {}})
  assert(n === 10)
})
await test('reads practice_quiz.parameters.numQuestions', async () => {
  const n = gate.estimateQuestionCount({taskType: 'practice_quiz', parameters: {numQuestions: 25}})
  assert(n === 25)
})
await test('sums exam_quiz section sizes', async () => {
  const n = gate.estimateQuestionCount({taskType: 'exam_quiz',
    parameters: {sectionASize: 5, sectionBSize: 3, sectionCSize: 2}})
  assert(n === 10)
})
await test('returns 0 for non-quiz task types', async () => {
  assert(gate.estimateQuestionCount({taskType: 'notes', parameters: {}}) === 0)
})

console.log('\nrecordGenerationUsage — fire-and-forget')

await test('writes increment to aiUsageDaily/{today}', async () => {
  await gate.recordGenerationUsage({contentType: 'practice_quiz', questionCount: 7})
  assert(state.incrementCalls.length === 1)
  const call = state.incrementCalls[0]
  assert(call.name === 'aiUsageDaily')
  assert(call.payload.questionsGenerated.__increment === 7)
  assert(call.payload.quizzesGenerated.__increment === 1)
  assert(call.payload.artifactsGenerated.__increment === 1)
})

await test('non-quiz content increments artifacts only (quiz counter +0)', async () => {
  await gate.recordGenerationUsage({contentType: 'notes', questionCount: 0})
  const call = state.incrementCalls[0]
  assert(call.payload.questionsGenerated.__increment === 0)
  assert(call.payload.quizzesGenerated.__increment === 0)
  assert(call.payload.artifactsGenerated.__increment === 1)
})

await test('NEVER throws on Firestore failure', async () => {
  state.failOnSet = true
  // Must not throw — usage metering is best-effort.
  await gate.recordGenerationUsage({contentType: 'practice_quiz', questionCount: 5})
})

console.log('\nZod schema — hard-rule pins')

await test('aiAutomationSettingsWriteSchema accepts valid doc', () => {
  const ok = aiAutomationSettingsWriteSchema.safeParse({
    enabled: true,
    maxQuestionsPerDay: 100,
    maxQuizzesPerDay: 20,
    requireAdminApprovalForExamQuizzes: true,
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'weekly',
    enabledGrades: ['7'],
    enabledSubjects: ['Mathematics'],
    updatedAt: new Date(),
    updatedBy: 'admin-uid',
  })
  assert(ok.success, `expected pass: ${ok.error && ok.error.message}`)
})

await test('aiAutomationSettingsWriteSchema rejects requireAdminApprovalForExamQuizzes:false', () => {
  const bad = aiAutomationSettingsWriteSchema.safeParse({
    enabled: true,
    maxQuestionsPerDay: 100, maxQuizzesPerDay: 20,
    requireAdminApprovalForExamQuizzes: false,   // not literal true!
    requireAdminApprovalForCurriculumUpdates: true,
    curriculumUpdateCheckFrequency: 'weekly',
    enabledGrades: [], enabledSubjects: [],
    updatedAt: new Date(), updatedBy: 'admin-uid',
  })
  assert(!bad.success, 'must reject non-literal-true for hard rule')
})

console.log('\nDispatcher + factory wiring (source-text)')

await test('dispatcher imports assertAutomationAllowed + assertDailyQuotas', () => {
  assert(DISPATCHER_TEXT.includes('assertAutomationAllowed'))
  assert(DISPATCHER_TEXT.includes('assertDailyQuotas'))
  assert(DISPATCHER_TEXT.includes('./automationGate'))
})

await test('dispatcher writes errorMessage when gate throws', () => {
  // The gate catch block prefixes with err.code when present.
  assert(/err\s*&&\s*err\.code/.test(DISPATCHER_TEXT) ||
    /err\.code\s*:/.test(DISPATCHER_TEXT),
    'dispatcher must surface err.code on automation gate failure')
})

await test('_stubFactory imports recordGenerationUsage + calls it fire-and-forget', () => {
  assert(FACTORY_TEXT.includes('recordGenerationUsage'))
  assert(FACTORY_TEXT.includes('countQuestionsInContent'))
  assert(FACTORY_TEXT.includes('.catch(() => { /* swallow — metering is best-effort */ })') ||
    /\.catch\(.*=>.*\)/.test(FACTORY_TEXT),
    'recordGenerationUsage call must be fire-and-forget')
})

await test('healthCheck gates scheduled handlers on enabled', () => {
  assert(HEALTH_TEXT.includes('loadAutomationSettings'))
  assert(HEALTH_TEXT.includes('settings.enabled === false'))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
