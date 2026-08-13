/**
 * Regression tests for the lesson-plan PDF export (buildPrintableHtml).
 *
 * Guards three things that quietly break a downloaded plan:
 *   1. Layout — the header must be a two-column <table> (NOT a CSS grid). The
 *      PDF download rasterises with html2canvas 1.x, which renders
 *      `display:grid` unreliably; a <table> always lays out correctly.
 *   2. Pagination — the fragmentation rules must live in the base stylesheet,
 *      not inside @media print. html2canvas reads SCREEN computed styles to
 *      decide where to cut a page; rules hidden behind @media print are
 *      invisible to it. NOTE the intent inverted in 2026-07: progression rows
 *      are now allowed to SPLIT (§4.1). Forcing every row to stay whole is what
 *      pushed a long Development row onto a fresh page and left the previous
 *      one half blank — the "big empty gap" the compactness work removes.
 *   3. Parity — the PDF renders through `renderPlanHtml`, the same function the
 *      studio preview uses, so the two cannot drift. A separate implementation
 *      here is what let the preview and the download disagree about the
 *      environment section, the evaluation blanks and the column widths.
 *
 * Run: node src/engines/export-engine/lessonPlanToPdf.test.js
 */

import { buildPrintableHtml } from './lessonPlanToPdf.js'
import { resolveLessonFormat } from '../../utils/lessonPlanFormat.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const plan = {
  schemaVersion: '3.0',
  header: {
    school: 'Jemareen Academy',
    teacherName: 'Chibuye Dorica',
    subject: 'Mathematics and Science',
    topic: 'Exploring my World',
    subtopic: 'Grouping things',
    class: 'Grade 2A',
    date: '26th March 2026',
    time: '07:00 - 08:00',
    durationMinutes: 60,
  },
  generalCompetences: ['Communication'],
  specificCompetence: 'Group objects by attribute',
  stages: [{ name: 'INTRODUCTION', durationMinutes: 5, teacherActivities: ['Show objects'], learnerActivities: ['Observe'], assessmentCriteria: ['Names objects'] }],
}

const html = buildPrintableHtml(plan, 'CBC Lesson Plan')

console.log('lesson-plan PDF — two-column header')
assert(html.includes('<table class="meta">'), 'header is a two-column <table>')
assert(!html.includes('<div class="meta">'), 'header does NOT use a CSS-grid div (html2canvas-unsafe)')
assert(!/table\.meta\{[^}]*display:grid/.test(html), 'no display:grid on the .meta header')
assert(html.includes('Name of Teacher'), 'shows the Name of Teacher label')
assert(html.includes('No of pupils'), 'shows the pupil-count field')
assert(html.includes('B: ______') && html.includes('G: ______'), 'pupil-count blanks sit with their label')
assert(html.includes('Jemareen Academy'), 'shows the school masthead')
assert(html.includes('Exploring my World') && html.includes('Grouping things'), 'shows topic and sub-topic')

console.log('\nlesson-plan PDF — fragmentation rules are screen-visible')
// html2canvas renders in screen media, so whatever governs page cutting has to
// be in the BASE stylesheet, not behind @media print.
assert(/\.lp-table tr\{[^}]*break-inside:auto/.test(html), 'progression rows may split (§4.1)')
assert(/\.lp-table thead\{display:table-header-group\}/.test(html), 'the header row repeats on each page')
assert(/\.stage-block\{[^}]*break-inside:avoid/.test(html), 'a per-stage block still stays whole')
const mp = html.indexOf('@media print{')
const printBlock = mp >= 0 ? html.slice(mp, html.indexOf('</style>', mp)) : ''
assert(printBlock.length > 0, '@media print block exists')
assert(!/break-inside/.test(printBlock), 'fragmentation rules are NOT trapped inside @media print')

console.log('\nlesson-plan PDF — §4 compactness rules reach the download')
assert(html.includes('class="li"') && html.includes('&ndash;'), '§4.1: cells carry dash lines')
assert(!/<ul|<ol/.test(html), '§4.1: no bullet or numbered lists anywhere')
assert(/width:18%/.test(html) && /width:34%/.test(html), '§4.1: the specified column widths')
assert(/class="stage"[^>]*hyphens:none/.test(html), '§4.1: the STAGES column cannot break mid-word')
assert(!/_{20,}/.test(html), '§4.5: no 60-underscore evaluation rows')
assert(html.includes('class="rule"'), '§4.5: one ruled line per evaluation field')

console.log('\nlesson-plan PDF — §2.3 learning environment')
const envHtml = buildPrintableHtml(
  { ...plan, learningEnvironment: { natural: 'Not applicable for this lesson.', artificial: 'Classroom with chalkboard.', technological: 'N/A' } },
  'CBC Lesson Plan',
  { learningEnvironments: ['Artificial'] },
)
assert(!/not applicable/i.test(envHtml), 'no "Not applicable" text in the PDF')
assert((envHtml.match(/LEARNING ENVIRONMENT/g) || []).length === 1, 'exactly one LEARNING ENVIRONMENT line')

console.log('\nlesson-plan PDF — §2.5 margins')
const narrow = buildPrintableHtml(plan, 'CBC Lesson Plan', {
  lessonFormat: resolveLessonFormat({ pageBudget: '1', marginMm: 10 }),
})
assert(narrow.includes('@page{size:A4;margin:10mm}'), 'the chosen margin reaches the @page rule')
assert(narrow.includes('--lp-table-pt:9pt'), 'the 1-page typography preset reaches the download')

console.log('\nlesson-plan PDF — §4.6 OBC parity')
const obc = buildPrintableHtml({
  schemaVersion: '3.0',
  header: { teacherName: 'Mrs. Zulu', subject: 'Numeracy', class: 'Grade 3' },
  specificOutcomes: ['Add whole numbers with sums up to 100 000.'],
  prerequisiteKnowledge: 'Learners have knowledge of addition.',
  stages: [{ name: 'Introduction', durationMinutes: 10, teacher: 'Ask place value.', pupils: '7 tens.', learningPoint: 'Naming the place value.' }],
}, 'Lesson Plan', { curriculumMode: 'previous' })
assert(obc.includes('STAGE/TIME') && obc.includes('LEARNING POINT'), 'OBC columns')
assert(obc.includes('PRE-REQUISITE') && obc.includes('LESSON LEARNT'), 'OBC field set and footer')
assert(!obc.includes('ASSESSMENT CRITERIA'), 'no CBC assessment-criteria column')

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll lessonPlanToPdf tests passed.')
