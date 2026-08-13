/**
 * Unit tests for the Lesson Plan Wizard's pure step model (wizardSteps.js).
 * Plain-node assertion script — run with
 * `node src/features/lessonPlanStudio/components/wizard/wizardSteps.test.js` or
 * `npm run test:lesson-wizard-steps`. Throws on the first failed assertion.
 */
import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  REVIEW_STEP,
  clampStep,
  validateStep,
  firstInvalidStep,
  maxReachableStep,
  allStepsValid,
} from './wizardSteps.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg)
  passed++
}

/** A fully valid CBC studio state. Override slices per test. */
function cbcState(overrides = {}) {
  return {
    curriculumMode: 'cbc',
    lessonDetails: {
      grade: 'Grade 4',
      subject: 'Mathematics Syllabus (Grades 4-6)',
      duration: '40',
      date: '2026-07-24',
      time: '',
      medium: 'English',
      teacherName: '',
      school: '',
      resources: 'basic',
    },
    topicData: {
      topic: '4.1 Numbers',
      subtopic: '4.1.1 Counting',
      subtopicRow: {
        specificCompetence: 'Count objects up to 1000',
        learningActivities: ['Counting games'],
        expectedStandard: 'Counts accurately',
      },
    },
    selectedOutcomes: [],
    learningEnvironments: ['Artificial'],
    lessonSeries: { planningMode: 'single', lessonFocus: '' },
    lessonBreakdown: [],
    formatOptions: { pageBudget: '2', writingStyle: 'point', format: 'modern', advanced: {} },
    ...overrides,
  }
}

function previousState(overrides = {}) {
  return cbcState({
    curriculumMode: 'previous',
    topicData: {
      topic: 'Numbers',
      subtopic: 'Counting',
      subtopicRow: { specificOutcomes: ['Count to 100', 'Skip count'] },
    },
    selectedOutcomes: ['Count to 100'],
    learningEnvironments: [],
    ...overrides,
  })
}

// ── Step model shape ──────────────────────────────────────────────────────────

assert(WIZARD_STEP_COUNT === 5, 'exactly five steps')
assert(REVIEW_STEP === 4, 'review is the last step')
assert(WIZARD_STEPS[0].title === 'Lesson Setup', 'step 1 title')
assert(WIZARD_STEPS[1].title === 'Topic & Curriculum', 'step 2 title')
assert(WIZARD_STEPS[2].title === 'Lesson Context', 'step 3 title')
assert(WIZARD_STEPS[3].title === 'Format & Options', 'step 4 title')
assert(WIZARD_STEPS[4].title === 'Review & Generate', 'step 5 title')
assert(WIZARD_STEPS.every((s) => s.description && s.short), 'every step has description + short label')

// ── clampStep ─────────────────────────────────────────────────────────────────

assert(clampStep(-1) === 0, 'clamps below range')
assert(clampStep(99) === 4, 'clamps above range')
assert(clampStep('2') === 2, 'coerces numeric strings')
assert(clampStep('junk') === 0, 'garbage falls back to 0')
assert(clampStep(2.9) === 2, 'truncates fractions')

// ── Step 0: Lesson Setup ──────────────────────────────────────────────────────

{
  const s = cbcState({ curriculumMode: null })
  const r = validateStep(0, s)
  assert(!r.valid && /curriculum/i.test(r.reason), 'no curriculum → blocked with reason')
}
{
  const s = cbcState()
  s.lessonDetails = { ...s.lessonDetails, grade: '' }
  const r = validateStep(0, s)
  assert(!r.valid && /class/i.test(r.reason), 'no class → blocked')
  assert(r.fieldId === 'ldf-grade', 'points at the grade field')
}
{
  const s = cbcState()
  s.lessonDetails = { ...s.lessonDetails, subject: '' }
  const r = validateStep(0, s)
  assert(!r.valid && /subject/i.test(r.reason), 'no subject → blocked')
}
{
  const s = cbcState()
  s.lessonDetails = { ...s.lessonDetails, date: '' }
  const r = validateStep(0, s)
  assert(!r.valid && /date/i.test(r.reason), 'no date → blocked')
}
{
  const s = cbcState()
  s.lessonDetails = { ...s.lessonDetails, time: '' }
  assert(validateStep(0, s).valid, 'time stays optional')
}
assert(validateStep(0, cbcState()).valid, 'complete setup passes')

// ── Step 1: Topic & Curriculum ────────────────────────────────────────────────

{
  const s = cbcState()
  s.topicData = { topic: '', subtopic: '', subtopicRow: null }
  const r = validateStep(1, s)
  assert(!r.valid && /topic/i.test(r.reason), 'no topic → blocked')
}
{
  const s = cbcState()
  s.topicData = { ...s.topicData, subtopic: '', subtopicRow: null }
  const r = validateStep(1, s)
  assert(!r.valid && /subtopic/i.test(r.reason), 'no subtopic → blocked')
}
{
  const s = cbcState()
  s.topicData = { ...s.topicData, subtopicRow: null }
  const r = validateStep(1, s)
  assert(!r.valid, 'CBC without a loaded curriculum row → blocked (competence drives the plan)')
}
assert(validateStep(1, cbcState()).valid, 'CBC topic step passes with a loaded row')
{
  const s = previousState({ selectedOutcomes: [] })
  const r = validateStep(1, s)
  assert(!r.valid && /outcome/i.test(r.reason), 'Previous mode requires at least one outcome')
}
assert(validateStep(1, previousState()).valid, 'Previous topic step passes with an outcome')

// ── Step 2: Lesson Context ────────────────────────────────────────────────────

{
  const s = cbcState({ learningEnvironments: [] })
  const r = validateStep(2, s)
  assert(!r.valid && /environment/i.test(r.reason), 'CBC requires an environment')
}
{
  const s = cbcState({
    lessonSeries: { planningMode: 'series' },
    lessonBreakdown: [],
  })
  const r = validateStep(2, s)
  assert(!r.valid && /series/i.test(r.reason), 'series mode without a breakdown → blocked')
}
{
  const s = cbcState({
    lessonSeries: { planningMode: 'series' },
    lessonBreakdown: [{ lessonNumber: 1, title: 'L1', focus: '', status: 'pending' }],
  })
  assert(validateStep(2, s).valid, 'series mode with a breakdown passes')
}
assert(validateStep(2, previousState()).valid, 'Previous curriculum context step is always valid')

// ── Step 3: Format & Options ──────────────────────────────────────────────────

assert(validateStep(3, cbcState()).valid, 'defaults pass the format step')
{
  const s = cbcState({ formatOptions: { pageBudget: '', writingStyle: 'point', format: 'modern', advanced: {} } })
  assert(!validateStep(3, s).valid, 'missing page budget → blocked')
}

// ── Step 4: Review aggregates 0–3 ─────────────────────────────────────────────

assert(validateStep(4, cbcState()).valid, 'review valid when all steps pass')
{
  const s = cbcState({ learningEnvironments: [] })
  const r = validateStep(4, s)
  assert(!r.valid && /environment/i.test(r.reason), 'review surfaces the first failing step reason')
}

// ── firstInvalidStep / maxReachableStep / allStepsValid ───────────────────────

assert(firstInvalidStep(cbcState()) === -1, 'all valid → -1')
assert(allStepsValid(cbcState()) === true, 'allStepsValid true when complete')
assert(maxReachableStep(cbcState()) === 4, 'review reachable when complete')
{
  const s = cbcState({ curriculumMode: null })
  assert(firstInvalidStep(s) === 0, 'missing curriculum → first invalid is 0')
  assert(maxReachableStep(s) === 0, 'cannot navigate past the invalid step')
}
{
  const s = cbcState({ learningEnvironments: [] })
  assert(firstInvalidStep(s) === 2, 'context incomplete → first invalid is 2')
  assert(maxReachableStep(s) === 2, 'reachable up to the incomplete step')
  assert(allStepsValid(s) === false, 'allStepsValid false when a step fails')
}

// ── Defensive: null state never throws ────────────────────────────────────────

assert(validateStep(0, null).valid === false, 'null state is invalid, not a crash')

console.log(`All wizardSteps tests passed (${passed} assertions).`)
