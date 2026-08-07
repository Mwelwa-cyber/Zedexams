/**
 * templatePlanPreview + the document a Template Bank template renders to.
 *
 * These assert on the RENDERED HTML, not only on the meta object, because the
 * bug this replaces was invisible at the meta layer: the preview passed a
 * perfectly valid `format: 'modern'` and got a document with no STAGES column,
 * no borders and the stage duration run into the stage name. What a teacher
 * sees is the renderer's output, so that is what is pinned here.
 *
 * Plain `node` — run with `npm run test:template-preview`.
 */

import assert from 'node:assert/strict'
import {
  TEMPLATE_BLANK,
  templateCurriculumMode,
  templatePreviewMeta,
  templateSyllabusHint,
} from './templatePlanPreview.js'
import { renderPlanHtml } from '../studio/utils/renderPlanHtml.js'

const TEMPLATE = {
  id: 'tpl_1',
  title: 'Fractions — Equivalent fractions',
  grade: 'Grade 4',
  subject: 'Mathematics',
  topic: 'Fractions',
  subtopic: 'Equivalent fractions',
  curriculum: 'CBC',
  content: {
    header: {
      subject: 'Mathematics',
      grade: 'Grade 4',
      topic: '4.5 Fractions',
      subtopic: '4.5.1 Equivalent fractions',
      duration: '40',
    },
    generalCompetences: ['Critical thinking', 'Communication'],
    specificCompetence: 'Work with equivalent fractions',
    lessonGoal: 'Identify and write equivalent fractions',
    rationale: 'Fractions underpin ratio and proportion later in the phase.',
    priorKnowledge: 'Pupils can name halves and quarters.',
    references: ['MoE Grade 4 Mathematics syllabus', 'Pupil book 4'],
    materials: ['Fraction charts', 'Counters'],
    expectedStandard: 'Writes two equivalent fractions for a given fraction.',
    remedialWork: 'Repeat with halves only.',
    extensionActivity: 'Find three equivalents for 2/3.',
    stages: [
      {
        name: 'INTRODUCTION',
        duration: '5 min',
        teacher: ['Revise halves and quarters'],
        pupils: ['Answer orally'],
        assessment: ['Oral responses'],
      },
      {
        name: 'LESSON DEVELOPMENT — Activity 1: Folding paper',
        duration: '20 min',
        teacher: ['Model folding a strip into halves then quarters'],
        pupils: ['Fold strips in pairs', 'Record what they see'],
        assessment: ['Correct folds'],
      },
      {
        name: 'CONCLUSION',
        duration: '5 min',
        teacher: ['Summarise'],
        pupils: ['Copy the summary'],
        assessment: ['Books marked'],
      },
    ],
  },
}

const render = (template, overrides) =>
  renderPlanHtml(
    template.content,
    templatePreviewMeta(template, overrides),
    templateCurriculumMode(template),
  )

// ── Curriculum ───────────────────────────────────────────────────────────────

assert.equal(templateCurriculumMode(TEMPLATE), 'cbc')
assert.equal(templateCurriculumMode({ curriculum: 'OBC' }), 'previous')
assert.equal(templateCurriculumMode({ curriculum: '2013' }), 'previous')
assert.equal(templateCurriculumMode({ curriculum: 'previous' }), 'previous')
assert.equal(templateCurriculumMode({ curriculum: '' }), 'cbc')
assert.equal(templateCurriculumMode(null), 'cbc')
// The plan's own header answers when the bank row has no curriculum recorded.
assert.equal(
  templateCurriculumMode({ content: { header: { curriculum: 'obc' } } }),
  'previous',
)
assert.equal(templateSyllabusHint(TEMPLATE), 'CBC')
assert.equal(templateSyllabusHint({ curriculum: 'OBC' }), 'OBC')

// ── The meta a template is drawn with ────────────────────────────────────────

const meta = templatePreviewMeta(TEMPLATE)
assert.equal(meta.format, 'classic', 'a template renders the single bordered progression table')
assert.equal(meta.lessonFormat.headerStyle, 'ministry', 'the masthead carries MINISTRY OF EDUCATION')
assert.equal(meta.teacherName, TEMPLATE_BLANK)
assert.equal(meta.date, TEMPLATE_BLANK)
assert.equal(meta.time, TEMPLATE_BLANK)
assert.equal(meta.school, '', 'a template names no school')
// Coordinates prefer the plan header (which keeps the syllabus code) over the
// bank's stripped search coordinate.
assert.equal(meta.topic, '4.5 Fractions')
assert.equal(meta.subtopic, '4.5.1 Equivalent fractions')
assert.equal(meta.subject, 'Mathematics')
assert.equal(meta.klass, 'Grade 4')
assert.equal(meta.duration, '40')

// A numeric durationMinutes is a duration, not a miss.
assert.equal(
  templatePreviewMeta({ content: { header: { durationMinutes: 30 } } }).duration,
  '30',
)
// With nothing recorded the renderer's own default stands.
assert.equal(templatePreviewMeta({ content: {} }).duration, '40')

// An override wins, and an explicit empty string prints nothing rather than a
// blank rule — the two are different answers.
const used = templatePreviewMeta(TEMPLATE, { teacherName: 'Mrs Banda', date: '' })
assert.equal(used.teacherName, 'Mrs Banda')
assert.equal(used.date, '')
assert.equal(used.time, TEMPLATE_BLANK, 'an unmentioned field keeps its blank')

// ── The rendered document ────────────────────────────────────────────────────

const html = render(TEMPLATE)

// 1. Masthead.
assert.match(html, /MINISTRY OF EDUCATION/, 'the Ministry line prints')
assert.match(html, /class="lp-title">Lesson Plan</, 'the LESSON PLAN title prints')

// 2. Header fields — labels bold, blanks preserved, Sub-Topic full width.
assert.match(html, /<b>Name of Teacher:<\/b> <span class="val">______<\/span>/)
assert.match(html, /<b>Date:<\/b> <span class="val">______<\/span>/)
assert.match(html, /<b>Class:<\/b> <span class="val">Grade 4<\/span>/)
assert.match(html, /<b>Duration:<\/b> <span class="val">40 minutes<\/span>/)
assert.match(html, /<b>No of pupils:<\/b>[\s\S]*?B: ______/)
assert.match(
  html,
  /<td class="item span2" colspan="2"><b>Sub-Topic:<\/b>/,
  'Sub-Topic spans both columns',
)

// 3. The progression table: bordered, four columns, STAGES first, ASSESSMENT
//    (not ASSESSMENT CRITERIA) last, and a <thead> so the paginator can repeat
//    the header row on a continuation sheet.
assert.match(html, /<div class="progression-title">LESSON PROGRESSION<\/div>/)
assert.match(html, /<table class="lp-table official-table" border="1"/)
assert.match(html, /<thead><tr><th[^>]*>STAGES<\/th>/)
assert.match(html, /<th[^>]*>TEACHER'S ACTIVITIES<\/th>/)
assert.match(html, /<th[^>]*>LEARNERS' ACTIVITIES<\/th>/)
assert.match(html, /<th[^>]*>ASSESSMENT<\/th>/)
assert.doesNotMatch(html, /ASSESSMENT CRITERIA/, 'the classic table says ASSESSMENT')
assert.match(html, /border:1px solid #000/, 'cells carry their borders inline')

// The duration is a separate node from the stage name. This is the regression:
// `modern`'s stage head emitted `INTRODUCTION<span class="duration">5 min</span>`,
// which is a block-level line only when a stylesheet says so — and with none
// loaded it read "INTRODUCTION5 min".
assert.match(html, /<td class="stage"[^>]*>INTRODUCTION<span class="t">\(5 min\)<\/span><\/td>/)
assert.doesNotMatch(html, /class="duration"/, 'no float-right duration in the classic table')

// Every stage the plan carries is rendered, in order.
const stageCells = html.match(/<td class="stage"/g) || []
assert.equal(stageCells.length, TEMPLATE.content.stages.length, 'all stage rows render')
assert.match(html, /LESSON DEVELOPMENT<br>Activity 1: Folding paper/)
assert.ok(
  html.indexOf('INTRODUCTION<span') < html.indexOf('CONCLUSION<span'),
  'stages keep their order',
)

// Cell items carry the en dash the studio prints.
assert.match(html, /<div class="li">&ndash; Fold strips in pairs<\/div>/)

// 4. Sections, before and after the table.
for (const label of [
  'GENERAL COMPETENCES', 'SPECIFIC COMPETENCE', 'LESSON GOAL', 'RATIONALE',
  'PRIOR KNOWLEDGE', 'REFERENCES', 'MATERIALS', 'EXPECTED STANDARD',
  'REMEDIAL WORK', 'EXTENSION ACTIVITY', 'LESSON EVALUATION',
]) {
  assert.match(html, new RegExp(`<b>${label}:</b>`), `${label} is on the page`)
}
// References are one line, semicolon-separated.
assert.match(html, /<b>REFERENCES:<\/b> MoE Grade 4 Mathematics syllabus; Pupil book 4/)
// The evaluation block ends the document with its ruled lines.
assert.match(html, /<b>Successes:<\/b><span class="rule"><\/span>/)
assert.ok(
  html.indexOf('LESSON EVALUATION') > html.indexOf('LESSON PROGRESSION'),
  'the evaluation block follows the table',
)

// 5. An OBC template renders OBC's own vocabulary, not CBC's relabelled.
const OBC_TEMPLATE = {
  ...TEMPLATE,
  curriculum: 'OBC',
  content: {
    ...TEMPLATE.content,
    specificOutcomes: ['State two equivalent fractions'],
    prerequisiteKnowledge: 'Pupils can name halves.',
  },
}
const obcHtml = render(OBC_TEMPLATE)
assert.match(obcHtml, /STAGE\/TIME/, 'the OBC table names its own first column')
assert.match(obcHtml, /LEARNING POINT/, 'OBC has a LEARNING POINT column')
assert.match(obcHtml, /<b>SPECIFIC OUTCOMES:<\/b>/)
assert.match(obcHtml, /<b>PRE-REQUISITE:<\/b>/)
assert.doesNotMatch(obcHtml, /SPECIFIC COMPETENCE/, 'OBC does not borrow CBC vocabulary')

// 6. A template whose plan has no stages still renders the official five rows
//    rather than an empty table.
const bare = render({ ...TEMPLATE, content: { ...TEMPLATE.content, stages: [] } })
assert.equal((bare.match(/<td class="stage"/g) || []).length, 5)

// 7. XSS: template content is server-anonymised but still user-authored.
const nasty = render({
  ...TEMPLATE,
  content: { ...TEMPLATE.content, lessonGoal: '<img src=x onerror=alert(1)>' },
})
assert.doesNotMatch(nasty, /<img src=x/)
assert.match(nasty, /&lt;img src=x/)

console.log('templatePlanPreview: all assertions passed')
