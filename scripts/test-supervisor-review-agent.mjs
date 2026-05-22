#!/usr/bin/env node
/**
 * AI Supervisor (final gatekeeper) — unit tests.
 *
 * Covers:
 *   - Composite confidence math (weighted avg)
 *   - Hard overrides (qualityCheck failed, standardsCheck failed,
 *     missing upstream verdict)
 *   - Confidence band decisions (90-100, 70-89, 50-69, <50)
 *   - Auto-publish allow-list per artifact type + settings
 *   - Hard "never auto-publish" rules (exam_quiz,
 *     curriculum_update_check)
 *   - Study tips require parameters.weakLearnerId for auto-publish
 *   - Quality Check requiresHumanReview blocks auto-publish
 *   - Supervisor planner appends supervisorReview to every chain
 *   - Dispatcher uses chainContext.supervisorDecision for terminal
 *     task status
 *   - End-to-end Zod validation against supervisorDecisionSchema
 *
 * Run: npm run test:supervisor-review  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/supervisorReview.js')
const SUPERVISOR = join(ROOT, 'functions/agents/learnerAi/runners/supervisor.js')
const DISPATCHER_TEXT = readFileSync(join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8')

const fakeAdmin = {firestore: () => ({})}
fakeAdmin.firestore.FieldValue = {serverTimestamp: () => '__ts__'}

const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === '../logger') {
    return {
      writeAgentLog: async () => {}, writeSupervisorLog: async () => {},
      updateLiveAgentState: async () => {}, writeTaskStep: async () => {},
    }
  }
  return origLoad.call(this, request, parent, ...rest)
}

const sv = await import(RUNNER)
const supervisor = await import(SUPERVISOR)
const { supervisorDecisionSchema } = await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

const goodReader = {status: 'ok', confidenceScore: 0.9, matchKind: 'subtopic_exact'}
const goodStd = {status: 'passed', confidenceScore: 1.0, zambianCurriculumFit: true, zambianAssessmentFit: true}
const goodQc = {status: 'passed', confidenceScore: 1.0, requiresHumanReview: false, deterministicGroundingPass: true}

console.log('\nComposite confidence math')

test('weighted avg: reader 0.2 + std 0.3 + qc 0.5', () => {
  const c = sv.compositeConfidence({
    reader: {confidenceScore: 1.0},
    standardsCheck: {confidenceScore: 1.0},
    qualityCheck: {confidenceScore: 1.0},
  })
  assert(c === 1.0, `expected 1.0, got ${c}`)
})
test('missing verdicts collapse to 0.5 contributions', () => {
  const c = sv.compositeConfidence({reader: null, standardsCheck: null, qualityCheck: null})
  assert(c === 0.5, `expected 0.5, got ${c}`)
})
test('quality check dominates (weight 0.5)', () => {
  const c = sv.compositeConfidence({
    reader: {confidenceScore: 0}, standardsCheck: {confidenceScore: 0},
    qualityCheck: {confidenceScore: 1.0},
  })
  assert(c === 0.5, `expected 0.5 (0.5×1), got ${c}`)
})

console.log('\nConfidence-band decisions (happy path)')

test('90-100% + practice_quiz + flag on → approved', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {autoPublishPracticeQuizzes: true},
  })
  assert(d.decision === 'approved', `expected approved, got ${d.decision}`)
  assert(d.requiredAdminAction === 'none', 'no admin action when approved')
})

test('90-100% + practice_quiz + flag OFF → sent_for_review', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {},
  })
  assert(d.decision === 'sent_for_review', `expected sent_for_review, got ${d.decision}`)
  assert(d.requiredAdminAction === 'approve_or_reject')
})

test('70-89% band → sent_for_review regardless of settings', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: {confidenceScore: 0.8}, standardsCheck: {confidenceScore: 0.8, status: 'passed', zambianCurriculumFit: true, zambianAssessmentFit: true},
    qualityCheck: {confidenceScore: 0.8, status: 'passed', requiresHumanReview: false, deterministicGroundingPass: true},
    settings: {autoPublishPracticeQuizzes: true},
  })
  assert(d.decision === 'sent_for_review', `expected sent_for_review, got ${d.decision}`)
})

test('50-69% band → regenerate_required', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: {confidenceScore: 0.5}, standardsCheck: {confidenceScore: 0.55, status: 'passed', zambianCurriculumFit: true, zambianAssessmentFit: true},
    qualityCheck: {confidenceScore: 0.65, status: 'passed', requiresHumanReview: false, deterministicGroundingPass: true},
    settings: {},
  })
  assert(d.decision === 'regenerate_required', `expected regenerate_required, got ${d.decision} (conf=${d.confidence})`)
  assert(d.requiredAdminAction === 'review_regeneration')
})

test('<50% band → rejected', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: {confidenceScore: 0.2}, standardsCheck: {confidenceScore: 0.3, status: 'needs_review', zambianCurriculumFit: false, zambianAssessmentFit: false},
    qualityCheck: {confidenceScore: 0.3, status: 'needs_review', requiresHumanReview: true, deterministicGroundingPass: false},
    settings: {},
  })
  assert(d.decision === 'rejected', `expected rejected, got ${d.decision}`)
  assert(d.requiredAdminAction === 'review_rejection')
})

console.log('\nHard overrides (qualityCheck / standardsCheck failed)')

test('qualityCheck failed + mid-confidence → regenerate_required', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: goodReader, standardsCheck: goodStd,
    qualityCheck: {status: 'failed', confidenceScore: 0.5, requiresHumanReview: true, deterministicGroundingPass: false},
    settings: {autoPublishPracticeQuizzes: true},
  })
  assert(d.decision === 'regenerate_required', `expected regenerate, got ${d.decision}`)
})

test('qualityCheck failed + very low confidence → rejected', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: {confidenceScore: 0.3}, standardsCheck: {confidenceScore: 0.3, status: 'failed', zambianCurriculumFit: false, zambianAssessmentFit: false},
    qualityCheck: {status: 'failed', confidenceScore: 0.2, requiresHumanReview: true, deterministicGroundingPass: false},
    settings: {},
  })
  assert(d.decision === 'rejected', `expected rejected, got ${d.decision}`)
})

test('standardsCheck failed → regenerate_required', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: goodReader,
    standardsCheck: {status: 'failed', confidenceScore: 0.7, zambianCurriculumFit: false, zambianAssessmentFit: true},
    qualityCheck: goodQc,
    settings: {autoPublishPracticeQuizzes: true},
  })
  assert(d.decision === 'regenerate_required', `expected regenerate, got ${d.decision}`)
})

test('missing qualityCheck verdict → sent_for_review', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: null,
    settings: {},
  })
  assert(d.decision === 'sent_for_review', `expected sent_for_review, got ${d.decision}`)
})

console.log('\nHard auto-publish rules per task type')

test('exam_quiz at 100% confidence → still sent_for_review', () => {
  const d = sv.decide({
    task: {taskType: 'exam_quiz'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {autoPublishPracticeQuizzes: true, autoPublishExamQuizzes: true},
  })
  assert(d.decision === 'sent_for_review',
    `exam_quiz must never auto-approve, got ${d.decision}`)
})

test('curriculum_update_check never auto-publishes', () => {
  const d = sv.decide({
    task: {taskType: 'curriculum_update_check'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {},
  })
  assert(d.decision === 'sent_for_review',
    `curriculum_update_check must never approve, got ${d.decision}`)
})

test('notes auto-publish requires autoPublishNotes flag', () => {
  const dOff = sv.decide({
    task: {taskType: 'notes'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {},
  })
  const dOn = sv.decide({
    task: {taskType: 'notes'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {autoPublishNotes: true},
  })
  assert(dOff.decision === 'sent_for_review', 'flag off → review')
  assert(dOn.decision === 'approved', 'flag on → approved')
})

test('study_tips auto-publish ONLY with weakLearnerId on task', () => {
  const noWeak = sv.decide({
    task: {taskType: 'study_tips', parameters: {}},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {autoPublishStudyTips: true},
  })
  const withWeak = sv.decide({
    task: {taskType: 'study_tips', parameters: {weakLearnerId: 'learner-1'}},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {autoPublishStudyTips: true},
  })
  assert(noWeak.decision === 'sent_for_review',
    'no weakLearnerId must skip auto-publish (tips must be based on real weakness data)')
  assert(withWeak.decision === 'approved', 'weakLearnerId enables auto-publish')
})

test('weakness_analysis + learner_feedback never auto-publish', () => {
  const dW = sv.decide({
    task: {taskType: 'weakness_analysis'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {autoPublishPracticeQuizzes: true},
  })
  const dF = sv.decide({
    task: {taskType: 'learner_feedback'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {},
  })
  assert(dW.decision === 'sent_for_review')
  assert(dF.decision === 'sent_for_review')
})

test('qualityCheck.requiresHumanReview blocks auto-approve', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: goodReader, standardsCheck: goodStd,
    qualityCheck: {...goodQc, requiresHumanReview: true},
    settings: {autoPublishPracticeQuizzes: true},
  })
  assert(d.decision === 'sent_for_review',
    `requiresHumanReview must block approve, got ${d.decision}`)
})

console.log('\nSupervisor planner — appends supervisorReview to every chain')

for (const t of ['practice_quiz', 'notes', 'study_tips', 'learner_feedback', 'weakness_analysis']) {
  test(`planStepsFor(${t}) ends with supervisorReview`, () => {
    const steps = supervisor.planStepsFor(t)
    assert(steps[steps.length - 1] === 'supervisorReview',
      `${t} chain must end with supervisorReview, got: ${steps.join(',')}`)
  })
}
test('planStepsFor(exam_quiz) ends with supervisorReview', () => {
  const steps = supervisor.planStepsFor('exam_quiz')
  assert(steps[steps.length - 1] === 'supervisorReview',
    `exam_quiz chain must end with supervisorReview, got: ${steps.join(',')}`)
})
test('planStepsFor(curriculum_update_check) ends with supervisorReview', () => {
  const steps = supervisor.planStepsFor('curriculum_update_check')
  assert(steps[steps.length - 1] === 'supervisorReview',
    `curriculum_update_check must still pass through gatekeeper, got: ${steps.join(',')}`)
})

console.log('\nDispatcher wiring (source-text checks)')

test('dispatcher imports runSupervisorReview', () => {
  assert(DISPATCHER_TEXT.includes('runSupervisorReview'),
    'dispatcher must require runSupervisorReview')
  assert(DISPATCHER_TEXT.includes('supervisorReview: runSupervisorReview'),
    'dispatcher RUNNER_MAP must include supervisorReview')
})
test('dispatcher carries chainContext.supervisorDecision forward', () => {
  assert(DISPATCHER_TEXT.includes('chainContext.supervisorDecision'),
    'dispatcher must stash result.supervisorDecision on chainContext')
})
test('dispatcher uses supervisor decision for terminal task status', () => {
  // Look for the explicit decision→status mapping.
  assert(DISPATCHER_TEXT.includes('TASK_STATUS.APPROVED') &&
    DISPATCHER_TEXT.includes('TASK_STATUS.REGENERATING') &&
    DISPATCHER_TEXT.includes('TASK_STATUS.REJECTED'),
    'dispatcher must map all four decisions to TASK_STATUS values')
})

console.log('\nEnd-to-end Zod validation')

test('approved decision validates against supervisorDecisionSchema', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: goodReader, standardsCheck: goodStd, qualityCheck: goodQc,
    settings: {autoPublishPracticeQuizzes: true},
  })
  const full = {
    decision: d.decision, reason: d.reason, confidenceScore: d.confidence,
    requiredAdminAction: d.requiredAdminAction,
    upstreamVerdicts: {
      curriculumReader: {status: goodReader.status, confidenceScore: goodReader.confidenceScore, matchKind: goodReader.matchKind},
      standardsCheck: {status: goodStd.status, confidenceScore: goodStd.confidenceScore, zambianCurriculumFit: goodStd.zambianCurriculumFit, zambianAssessmentFit: goodStd.zambianAssessmentFit},
      qualityCheck: {status: goodQc.status, confidenceScore: goodQc.confidenceScore, requiresHumanReview: goodQc.requiresHumanReview, deterministicGroundingPass: goodQc.deterministicGroundingPass},
    },
    modelUsed: 'deterministic', artifactType: 'practice_quiz',
    contentId: 'abc', autoPublishSettings: {autoPublishPracticeQuizzes: true},
    checkedAt: new Date(),
  }
  const parsed = supervisorDecisionSchema.parse(full)
  assert(parsed.decision === 'approved', 'parsed decision')
})

test('rejected decision validates', () => {
  const d = sv.decide({
    task: {taskType: 'practice_quiz'},
    reader: {confidenceScore: 0.2}, standardsCheck: {confidenceScore: 0.3, status: 'failed', zambianCurriculumFit: false, zambianAssessmentFit: false},
    qualityCheck: {confidenceScore: 0.2, status: 'failed', requiresHumanReview: true, deterministicGroundingPass: false},
    settings: {},
  })
  const full = {
    decision: d.decision, reason: d.reason, confidenceScore: d.confidence,
    requiredAdminAction: d.requiredAdminAction,
    upstreamVerdicts: {
      curriculumReader: {status: 'missing', confidenceScore: 0.2, matchKind: null},
      standardsCheck: {status: 'failed', confidenceScore: 0.3, zambianCurriculumFit: false, zambianAssessmentFit: false},
      qualityCheck: {status: 'failed', confidenceScore: 0.2, requiresHumanReview: true, deterministicGroundingPass: false},
    },
    modelUsed: 'deterministic', artifactType: 'practice_quiz',
    contentId: 'abc', autoPublishSettings: null,
    checkedAt: new Date(),
  }
  const parsed = supervisorDecisionSchema.parse(full)
  assert(parsed.decision === 'rejected')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
