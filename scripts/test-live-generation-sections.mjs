/**
 * Unit tests for the Live Generation Canvas pure logic
 * (src/shared/components/liveGenerationSections.js).
 *
 * Plain-node assertion script — run with `node scripts/test-live-generation-sections.mjs`
 * or `npm run test:live-canvas`. Throws on the first failed assertion.
 */
import {
  humanizeKey,
  classifyValue,
  buildSections,
  buildTimeline,
  computeTimelineStatus,
  PREP_STEPS,
  FINALISE_STEP,
  TOOL_SECTION_CONFIG,
} from '../src/shared/components/liveGenerationSections.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}
function eq(a, b, msg) {
  assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

/* ── humanizeKey ───────────────────────────────────────────────── */
eq(humanizeKey('keyConcepts'), 'Key Concepts', 'camelCase splits')
eq(humanizeKey('mark_scheme'), 'Mark Scheme', 'snake_case splits')
eq(humanizeKey('learning-outcomes'), 'Learning Outcomes', 'kebab-case splits')
eq(humanizeKey('week1'), 'Week 1', 'digit boundary splits')
eq(humanizeKey('SMART'), 'SMART', 'all-caps word preserved')
eq(humanizeKey(''), '', 'empty stays empty')

/* ── classifyValue ─────────────────────────────────────────────── */
eq(classifyValue(null), 'empty', 'null is empty')
eq(classifyValue(''), 'empty', 'blank string is empty')
eq(classifyValue('   '), 'empty', 'whitespace string is empty')
eq(classifyValue([]), 'empty', 'empty array is empty')
eq(classifyValue({}), 'empty', 'empty object is empty')
eq(classifyValue('hi'), 'text', 'string is text')
eq(classifyValue(42), 'text', 'number is text')
eq(classifyValue(['a', 'b']), 'list', 'string array is list')
eq(classifyValue([{ a: 1 }]), 'cards', 'object array is cards')
eq(classifyValue({ a: 1 }), 'fields', 'object is fields')
eq(classifyValue({ a: null, b: '' }), 'empty', 'object of only-empty values is empty')

/* ── buildSections ─────────────────────────────────────────────── */
{
  const notes = {
    header: { title: 'X', grade: '5' },
    introduction: { hook: 'A hook' },
    keyConcepts: [{ name: 'Photosynthesis', explanation: 'Plants make food' }],
    references: [],            // empty → dropped
    glossary: [{ term: 'Leaf', definition: 'green thing' }],
  }
  const secs = buildSections(notes, TOOL_SECTION_CONFIG.notes)
  const ids = secs.map((s) => s.id)
  assert(!ids.includes('header'), 'header is always skipped')
  assert(!ids.includes('references'), 'empty section dropped')
  assert(ids.includes('introduction') && ids.includes('keyConcepts') && ids.includes('glossary'), 'content sections kept')
  eq(ids[0], 'introduction', 'config order honoured (introduction first)')
  eq(secs.find((s) => s.id === 'introduction').title, 'Lesson Opener', 'label override applied')
  eq(secs.find((s) => s.id === 'keyConcepts').kind, 'cards', 'object array classified as cards')
}

{
  // Unlisted keys still render, in natural order after ordered ones.
  const doc = { header: {}, alpha: 'a', zeta: 'z', beta: 'b' }
  const secs = buildSections(doc, { order: ['beta'] })
  eq(secs[0].id, 'beta', 'ordered key comes first')
  eq(secs.length, 3, 'all non-empty content keys included')
}

{
  // Non-object input never throws.
  eq(buildSections(null).length, 0, 'null result → no sections')
  eq(buildSections('nope').length, 0, 'string result → no sections')
}

{
  // answerKey is skipped by default, kept with keepAnswerKey.
  const doc = { header: {}, questions: [{ q: '1' }], answerKey: [{ a: '1' }] }
  eq(buildSections(doc).some((s) => s.id === 'answerKey'), false, 'answerKey skipped by default')
  eq(buildSections(doc, { keepAnswerKey: true }).some((s) => s.id === 'answerKey'), true, 'answerKey kept on request')
}

{
  // SBA config: learner paper reveals before the teacher-only marking scheme,
  // and the stimulus-diagram reference is never shown.
  const task = {
    header: { taskType: 'reading_comprehension' },
    title: 'Reading task',
    administration: 'Hand out one sheet per learner.',
    instructions: 'Answer all the questions in the spaces provided.',
    stimulus: 'The environment refers to all the natural things around us.',
    stimulusDiagram: { libraryKey: 'animalcell' },
    questions: [{ prompt: 'What is the environment?', marks: 2 }],
    markingScheme: { style: 'answer_key', notes: 'Accept any valid example.' },
  }
  const secs = buildSections(task, TOOL_SECTION_CONFIG.sba)
  const ids = secs.map((s) => s.id)
  assert(!ids.includes('stimulusDiagram'), 'sba: stimulus diagram reference skipped')
  assert(!ids.includes('header') && !ids.includes('title'), 'sba: header/title skipped')
  eq(ids[0], 'instructions', 'sba: learner instructions revealed first')
  assert(ids.indexOf('questions') < ids.indexOf('markingScheme'), 'sba: questions before marking scheme')
  eq(secs.find((s) => s.id === 'markingScheme').title, 'Marking Scheme', 'sba: marking scheme labelled')
}

/* ── buildTimeline ─────────────────────────────────────────────── */
{
  const sections = [
    { id: 'intro', title: 'Introduction', icon: '🚀' },
    { id: 'q', title: 'Questions', icon: '❓' },
  ]
  const tl = buildTimeline(sections)
  eq(tl.length, PREP_STEPS.length + sections.length + 1, 'timeline = prep + sections + finalise')
  eq(tl[0].id, PREP_STEPS[0].id, 'prep steps lead')
  eq(tl[tl.length - 1].id, FINALISE_STEP.id, 'finalise step trails')
  assert(tl[PREP_STEPS.length].label.startsWith('Creating'), 'first content step uses "Creating"')
  assert(tl[PREP_STEPS.length + 1].label.startsWith('Adding'), 'later content steps use "Adding"')
  eq(tl[PREP_STEPS.length].sectionId, 'intro', 'section step carries sectionId')
}

/* ── computeTimelineStatus ─────────────────────────────────────── */
{
  const sections = [{ id: 'a', title: 'A', icon: '📄' }, { id: 'b', title: 'B', icon: '📄' }]
  const timeline = buildTimeline(sections)

  // Preparing: first prep step active, everything after pending.
  const prep = computeTimelineStatus({ timeline, prepIndex: 0, revealedCount: 0, totalSections: 2 })
  eq(prep[0].status, 'active', 'preparing → first prep active')
  eq(prep[1].status, 'pending', 'preparing → later steps pending')

  // Preparing, later prep step.
  const prep2 = computeTimelineStatus({ timeline, prepIndex: 2, revealedCount: 0, totalSections: 2 })
  eq(prep2[0].status, 'done', 'prep step 0 done')
  eq(prep2[2].status, 'active', 'prep step 2 active')

  // Revealing: prep done, first section done, second section active.
  const rev = computeTimelineStatus({ timeline, prepIndex: 2, revealedCount: 1, totalSections: 2 })
  eq(rev[PREP_STEPS.length].status, 'done', 'revealing → first section step done')
  eq(rev[PREP_STEPS.length + 1].status, 'active', 'revealing → second section step active')

  // Complete: all done.
  const done = computeTimelineStatus({ timeline, prepIndex: 2, revealedCount: 2, totalSections: 2, complete: true })
  assert(done.every((s) => s.status === 'done'), 'complete → every step done')

  // Errored: active step shows error.
  const err = computeTimelineStatus({ timeline, prepIndex: 1, revealedCount: 0, totalSections: 2, errored: true })
  eq(err[1].status, 'error', 'errored → active step marked error')
  eq(err[0].status, 'done', 'errored → earlier steps stay done')
}

/* ── assessment reveal — validateAssessment's exact result shape ── */
{
  // The generator returns { schemaVersion, header, sections, markingScheme }.
  // schemaVersion/header are plumbing and must never reveal as document
  // sections (a "Schema Version — assessment.v9" row used to leak here).
  const result = {
    schemaVersion: '1.5',
    header: { title: 'Fractions Test', grade: 'G7', subject: 'Mathematics', topic: 'Fractions' },
    sections: [{ title: 'Section 1', questions: [{ number: 1, prompt: 'Q1', marks: 2 }] }],
    markingScheme: { notes: 'Standard marking.', totalMarks: 2 },
  }
  const sections = buildSections(result, TOOL_SECTION_CONFIG.assessment)
  const ids = sections.map((s) => s.id)
  assert(!ids.includes('schemaVersion'), 'assessment reveal skips schemaVersion')
  assert(!ids.includes('header'), 'assessment reveal skips header')
  eq(ids.join(','), 'sections,markingScheme', 'assessment reveals sections then marking scheme')
  eq(sections[0].title, 'Paper Sections', 'sections titled as Paper Sections')
  eq(sections[1].title, 'Marking Scheme', 'marking scheme gets its label')
  eq(sections[1].icon, '🗝️', 'marking scheme gets its icon')
}

console.log(`✓ live-generation-sections: ${passed} assertions passed`)
