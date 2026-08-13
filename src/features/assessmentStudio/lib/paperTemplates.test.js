/**
 * Unit tests for paperTemplates — the ready-made paper structures.
 * Run: node src/utils/paperTemplates.test.js
 */

import {
  PAPER_TEMPLATES,
  getTemplateById,
  templateStats,
  instantiateTemplate,
} from './paperTemplates.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

console.log('catalogue — well-formed')
{
  assert(PAPER_TEMPLATES.length >= 5, 'ships at least five templates')
  const ids = PAPER_TEMPLATES.map((t) => t.id)
  assert(new Set(ids).size === ids.length, 'every template id is unique')
  assert(PAPER_TEMPLATES.every((t) => t.name && t.description && Array.isArray(t.blocks) && t.blocks.length), 'each has name, description and blocks')
  assert(getTemplateById('end-of-term') !== null, 'getTemplateById finds a known template')
  assert(getTemplateById('does-not-exist') === null, 'getTemplateById returns null for unknown id')
}

console.log('\ntemplateStats — counts without instantiating')
{
  const eot = templateStats(getTemplateById('end-of-term'))
  // Section A: 15 mcq × 1 = 15 marks; Section B: 5 structured × 5 = 25 marks.
  assert(eot.questionCount === 20, 'end-of-term has 20 questions')
  assert(eot.totalMarks === 40, 'end-of-term totals 40 marks (15 + 25)')
  assert(eot.sectionCount === 2, 'end-of-term has two sections')
  assert(/multiple choice/.test(eot.typeLabel), 'type label lists the question types')
  assert(templateStats(null).questionCount === 0, 'null template summarises to zero')
}

console.log('\ninstantiateTemplate — produces real studio state')
{
  const { sections, parts, formPatch } = instantiateTemplate(getTemplateById('end-of-term'))
  assert(parts.length === 2, 'creates a Part per section block')
  assert(parts[0].order === 0 && parts[1].order === 1, 'parts are ordered 0,1')
  assert(sections.length === 20, 'creates one section per question (15 + 5)')
  assert(sections.every((s) => s.kind === 'standalone' && s.question), 'standalone sections carry a question')
  // First 15 belong to part A, last 5 to part B, via question.partId.
  const inA = sections.filter((s) => s.question.partId === parts[0].id)
  const inB = sections.filter((s) => s.question.partId === parts[1].id)
  assert(inA.length === 15 && inB.length === 5, 'questions are assigned to their part via partId')
  assert(inA.every((s) => s.question.type === 'mcq'), 'Section A questions are MCQ')
  assert(inA.every((s) => Array.isArray(s.question.options) && s.question.options.length === 4), 'MCQ questions get four option slots')
  assert(inB.every((s) => s.question.type === 'diagram' && s.question.marks === 5), 'structured questions become diagram-type, 5 marks each')
  assert(formPatch.duration === '90', 'formPatch backfills the suggested duration as a string')
}

console.log('\ninstantiateTemplate — loose questions (no part)')
{
  const { sections, parts } = instantiateTemplate(getTemplateById('weekly-quiz'))
  assert(parts.length === 0, 'a part-less template creates no parts')
  assert(sections.length === 9, 'weekly quiz has 6 mcq + 3 short answer = 9 questions')
  assert(sections.every((s) => s.question.partId === null || s.question.partId === undefined), 'loose questions have no partId')
}

console.log('\ninstantiateTemplate — passage block')
{
  const { sections } = instantiateTemplate(getTemplateById('comprehension'))
  const section = sections.find((s) => s.kind === 'passage')
  assert(section, 'comprehension template includes a passage section')
  assert(section.passage.passageKind === 'comprehension', 'passage uses the comprehension kind')
  assert(Array.isArray(section.passage.questions) && section.passage.questions.length === 5, 'passage carries its 5 sub-questions')
  assert(section.passage.questions.every((q) => q.marks === 2), 'passage sub-questions carry their marks')
  // Regression: a short-answer comprehension sub-question must be seeded as a
  // text answer (no MCQ option slots, blank string answer), not left with
  // emptyPassageQuestion's MCQ defaults — otherwise it reopens looking like a
  // multiple-choice question with four empty options.
  assert(section.passage.questions.every((q) => q.type === 'short_answer'), 'passage sub-questions keep their short-answer type')
  assert(section.passage.questions.every((q) => Array.isArray(q.options) && q.options.length === 0), 'short-answer passage sub-questions carry no MCQ options')
  assert(section.passage.questions.every((q) => q.correctAnswer === ''), 'short-answer passage sub-questions have a blank text answer')
}

console.log('\ninstantiateTemplate — every catalogue template instantiates cleanly')
{
  let ok = true
  for (const t of PAPER_TEMPLATES) {
    const { sections } = instantiateTemplate(t)
    const stats = templateStats(t)
    const builtQuestions = sections.reduce((sum, s) => sum + (s.kind === 'passage' ? (s.passage?.questions?.length || 0) : 1), 0)
    if (builtQuestions !== stats.questionCount) {
      ok = false
      console.error(`    ${t.id}: built ${builtQuestions} questions, stats said ${stats.questionCount}`)
    }
  }
  assert(ok, 'instantiated question count matches templateStats for every template')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll paperTemplates tests passed.')
