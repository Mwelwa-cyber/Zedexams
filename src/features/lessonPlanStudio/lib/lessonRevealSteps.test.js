/**
 * Unit tests for the lesson-plan live-reveal step builders
 * (lessonRevealSteps.js). Plain-node assertion script — run with
 * `node src/features/lessonPlanStudio/lib/lessonRevealSteps.test.js` or
 * `npm run test:lesson-reveal-steps`. Throws on the first failed assertion.
 *
 * The builders are validated both in isolation and end-to-end against the real
 * renderPlanHtml(), so we know each snapshot renders a valid, growing document.
 */
import { buildMetaRevealSteps, buildBodyRevealSteps } from './lessonRevealSteps.js'
import { renderPlanHtml } from '../../../shared/utils/renderPlanHtml.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg)
  passed++
}

// ── buildMetaRevealSteps ──────────────────────────────────────────────────────

const META = {
  school: 'Twalumba Primary',
  teacherName: 'Mr. Banda',
  grade: 'Grade 5',
  subject: 'Science',
  topic: 'Living Things',
  subtopic: 'Plants',
  date: '2026-07-04',
  duration: 40,
}

{
  const steps = buildMetaRevealSteps(META)
  // school, teacher, grade, subject, topic, subtopic, date, duration (time empty → skipped)
  assert(steps.length === 8, `expected 8 meta steps, got ${steps.length}`)

  // First step shows ONLY the school (everything else still blank).
  const first = steps[0]
  assert(first.school === 'Twalumba Primary', 'first meta step fills school')
  assert(first.teacherName === '', 'first meta step leaves teacher blank')
  assert(first.subject === '', 'first meta step leaves subject blank')

  // Each step is cumulative — later fields appear without dropping earlier ones.
  const last = steps[steps.length - 1]
  assert(last.school === 'Twalumba Primary', 'last meta step keeps school')
  assert(last.teacherName === 'Mr. Banda', 'last meta step has teacher')
  assert(last.subject === 'Science', 'last meta step has subject')
  assert(last.subtopic === 'Plants', 'last meta step has sub-topic')
  assert(last.duration === 40, 'last meta step has duration')

  // The revealed school renders into the document header.
  const html = renderPlanHtml({}, first, 'cbc')
  assert(html.includes('Twalumba Primary'), 'school renders into header on the first step')
  assert(!html.includes('Mr. Banda'), 'teacher name does not render before its step')
}

// Empty meta still yields one usable snapshot.
{
  const steps = buildMetaRevealSteps({})
  assert(steps.length >= 1, 'empty meta still yields at least one step')
}

// ── buildBodyRevealSteps ──────────────────────────────────────────────────────

const PLAN = {
  generalCompetences: ['Communication', 'Critical thinking'],
  specificCompetence: 'Identify parts of a plant',
  lessonGoal: 'Learners name the parts of a plant',
  rationale: 'Plants are all around us',
  priorKnowledge: 'Learners have seen plants',
  references: ['CBC Science G5'],
  materials: ['Real plant', 'Chart'],
  expectedStandard: 'Names three parts',
  stages: [
    { name: 'INTRODUCTION', duration: '5 min', teacher: 'Show a plant', pupils: 'Observe', assessment: 'Q&A' },
    { name: 'LESSON DEVELOPMENT', duration: '25 min', teacher: 'Explain parts', pupils: 'Draw', assessment: 'Check drawings' },
    { name: 'CONCLUSION', duration: '10 min', teacher: 'Summarise', pupils: 'Recap', assessment: 'Exit question' },
  ],
}

{
  const steps = buildBodyRevealSteps(PLAN, 'cbc')

  // 8 present fields (generalCompetences, specificCompetence, lessonGoal,
  // rationale, priorKnowledge, references, materials, expectedStandard;
  // learningEnvironment absent) + 3 stages + 1 complete.
  const fieldSteps = steps.filter((s) => s.id.startsWith('field-'))
  const stageSteps = steps.filter((s) => s.id.startsWith('stage-'))
  assert(fieldSteps.length === 8, `expected 8 field steps, got ${fieldSteps.length}`)
  assert(stageSteps.length === 3, `expected 3 stage steps, got ${stageSteps.length}`)
  assert(steps[steps.length - 1].id === 'complete', 'final step id is "complete"')

  // First field step reveals only generalCompetences; specificCompetence not yet.
  const firstField = steps[0]
  assert(firstField.id === 'field-generalCompetences', 'first step is general competences')
  assert(firstField.plan.generalCompetences, 'first step carries general competences')
  assert(firstField.plan.specificCompetence === undefined, 'first step withholds later fields')

  // Every field step already has the full (empty) stage skeleton so the table
  // is present from the very first frame.
  assert(Array.isArray(firstField.plan.stages) && firstField.plan.stages.length === 3,
    'field steps carry the 3-row stage skeleton')
  assert(firstField.plan.stages.every((s) => !s.teacher), 'skeleton stages have no content yet')

  // The first stage step fills stage 0 but leaves later stages empty.
  const firstStage = stageSteps[0]
  assert(firstStage.plan.stages[0].teacher === 'Show a plant', 'stage 0 filled at first stage step')
  assert(!firstStage.plan.stages[1].teacher, 'stage 1 still empty at first stage step')
  assert(/introduction/i.test(firstStage.label), 'stage label names the stage')

  // The last stage step fills every stage.
  const lastStage = stageSteps[stageSteps.length - 1]
  assert(lastStage.plan.stages.every((s) => s.teacher), 'all stages filled at last stage step')

  // Every snapshot renders to a non-empty document string.
  for (const step of steps) {
    const html = renderPlanHtml(step.plan, META, 'cbc')
    assert(typeof html === 'string' && html.length > 0, `step ${step.id} renders non-empty HTML`)
  }

  // The final snapshot renders the real content the earlier ones withheld.
  const finalHtml = renderPlanHtml(steps[steps.length - 1].plan, META, 'cbc')
  assert(finalHtml.includes('Show a plant'), 'final render includes stage 0 teacher activity')
  assert(finalHtml.includes('Summarise'), 'final render includes the last stage')
  assert(finalHtml.includes('Identify parts of a plant'), 'final render includes specific competence')
}

// Previous-curriculum plan uses the OBC field + stage order.
{
  const oldPlan = {
    rationale: 'Because measurement matters',
    prerequisiteKnowledge: 'Counting',
    specificOutcomes: ['Measure length'],
    stages: [
      { name: 'INTRODUCTION', teacher: 'Ask', pupils: 'Answer' },
      { name: 'DEVELOPMENT', teacher: 'Demonstrate', pupils: 'Practise' },
    ],
  }
  const steps = buildBodyRevealSteps(oldPlan, 'previous')
  const stageSteps = steps.filter((s) => s.id.startsWith('stage-'))
  assert(stageSteps.length === 2, `expected 2 old-curriculum stage steps, got ${stageSteps.length}`)
  const html = renderPlanHtml(steps[steps.length - 1].plan, { ...META, subject: 'Maths' }, 'previous')
  assert(html.includes('Measure length'), 'old-curriculum final render includes the outcome')
}

// A plan with no recognised fields still yields a scaffold + stages + complete.
{
  const bare = { stages: [{ name: 'INTRODUCTION', teacher: 'Hi', pupils: 'Hello' }] }
  const steps = buildBodyRevealSteps(bare, 'cbc')
  assert(steps.some((s) => s.id === 'scaffold'), 'bare plan still gets a scaffold step')
  assert(steps[steps.length - 1].id === 'complete', 'bare plan still ends with complete')
}

// Non-object input is handled gracefully.
assert(buildBodyRevealSteps(null, 'cbc').length === 0, 'null plan → no steps')
assert(Array.isArray(buildMetaRevealSteps(null)), 'null meta → array')

console.log(`\n✅ lessonRevealSteps: all ${passed} assertions passed`)
