/**
 * Regression tests for the lesson-plan Word (.docx) export.
 *
 * Guards the corrupt-download bug shown in the field: a Grade 2 lesson plan
 * that Word refused to open — "Word found unreadable content … recover?" on
 * desktop, and "This version of Word can't open files that contain alternate
 * formats" on Word for Android. Both are Word's reaction to characters XML 1.0
 * forbids leaking into document.xml. AI-generated lesson content (and the saved
 * plans it produces) can carry a stray control byte or a lone surrogate from a
 * truncated emoji, and a single one silently corrupted the whole Word file even
 * though the studio preview and the PDF looked fine.
 *
 * Two layers:
 *   1. unit — sanitizeXmlText strips the illegal characters and keeps the legal
 *      ones (tab/newline/CR, whole emoji).
 *   2. end-to-end — a plan whose fields carry control bytes / a lone surrogate
 *      still packs into a well-formed document.xml with no illegal characters,
 *      and the readable text survives.
 *
 * The illegal characters (and the matcher used to assert their absence) are
 * built via fromCharCode so this source file stays free of raw control bytes
 * and lone surrogate units.
 *
 * Run: node src/engines/export-engine/lessonPlanToDocx.test.js
 */

import { Packer } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import { sanitizeXmlText } from '../../utils/xmlText.js'
import { buildLessonPlanDocument } from './lessonPlanToDocx.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const cc = (n) => String.fromCharCode(n)
const NUL = cc(0)
const BS = cc(8)
const VT = cc(0x0b)
const US = cc(31)
const NONCHAR = cc(0xfffe) + cc(0xffff)
const HI = cc(0xd83e) // high surrogate of 🦅
const LO = cc(0xdd85) // low surrogate of 🦅

// Matches any character XML 1.0 forbids: control range + non-characters, or a
// lone surrogate. Built from code points so this file holds no raw illegal char.
const CTRL = `${cc(0x00)}-${cc(0x08)}${cc(0x0b)}${cc(0x0c)}${cc(0x0e)}-${cc(0x1f)}${cc(0xfffe)}${cc(0xffff)}`
const HIR = `${cc(0xd800)}-${cc(0xdbff)}`
const LOR = `${cc(0xdc00)}-${cc(0xdfff)}`
const ILLEGAL_RE = new RegExp(`[${CTRL}]|[${HIR}](?![${LOR}])|(?<![${HIR}])[${LOR}]`)

console.log('sanitizeXmlText — unit')
assert(sanitizeXmlText(`a${NUL}b${BS}c${US}d${VT}e`) === 'abcde', 'control chars (NUL/BS/US/VT) removed')
assert(sanitizeXmlText('keep\tthese\nlegal\rchars') === 'keep\tthese\nlegal\rchars', 'tab / newline / CR kept')
assert(sanitizeXmlText(`emoji ${HI}${LO} stays`) === `emoji ${HI}${LO} stays`, 'whole emoji (surrogate pair) survives')
assert(sanitizeXmlText(`lone${HI}high`) === 'lonehigh', 'lone high surrogate removed')
assert(sanitizeXmlText(`lone${LO}low`) === 'lonelow', 'lone low surrogate removed')
assert(sanitizeXmlText(`non${NONCHAR}char`) === 'nonchar', 'the two XML non-characters removed')
assert(sanitizeXmlText(null) === '' && sanitizeXmlText(undefined) === '', 'nullish → empty string')

console.log('\nend-to-end — a dirty plan still packs a well-formed document.xml')
// v3 plan (has `stages`); smuggle control bytes / a lone surrogate into the
// header, a CAPS field, and a progression cell — every text funnel path.
const dirtyPlan = {
  schemaVersion: '3.0',
  header: {
    school: `Lusaka${US} Primary`,
    teacherName: 'Mrs. Banda',
    subject: `Mathematics${NUL}`,
    topic: `Exploring My World${HI}`,
    class: 'Grade 2',
    durationMinutes: 40,
  },
  lessonGoal: `Learners explore${BS} their world.`,
  stages: [
    {
      name: `Introduction${VT}`,
      durationMinutes: 5,
      teacherActivities: [`Show real objects${NUL}`],
      learnerActivities: [`Observe${LO} and name them`],
      assessmentCriteria: ['Names three objects'],
    },
  ],
  remedialWork: `Re-teach with extra examples${US}.`,
}

const doc = buildLessonPlanDocument(dirtyPlan)
const buf = await Packer.toBuffer(doc)
assert(Buffer.from(buf).slice(0, 2).toString('latin1') === 'PK', 'output is a PK-signed zip (.docx)')

const parts = unzipSync(new Uint8Array(buf))
const docXml = strFromU8(parts['word/document.xml'])
assert(!ILLEGAL_RE.test(docXml), 'packed document.xml contains no XML-illegal characters')
assert(docXml.includes('Exploring My World'), 'readable topic text survives sanitising')
assert(docXml.includes('Learners explore'), 'readable lesson goal survives sanitising')
assert(docXml.includes('Show real objects'), 'readable activity text survives sanitising')

// docProps/core.xml carries the document title — it must be clean too.
const coreXml = strFromU8(parts['docProps/core.xml'])
assert(!ILLEGAL_RE.test(coreXml), 'packed docProps/core.xml (title) contains no XML-illegal characters')

console.log('\nheader + curriculum-aware body')
// The studio supplies the lesson coordinates via a header object built from its
// meta. The CBC body must surface them (previously the studio passed no header,
// so the .docx came out with no teacher/subject/topic — "Word not working").
const cbcPlan = {
  schemaVersion: '3.0',
  header: { school: 'Jemareen Academy', teacherName: 'Mr. Phiri', subject: 'Science', topic: 'The Human Heart', subtopic: 'Blood Circulation', class: 'Grade 6', durationMinutes: 40 },
  generalCompetences: ['Communication'],
  specificCompetence: 'Describe how the heart pumps blood.',
  learningEnvironment: { artificial: 'Classroom' },
  stages: [{ name: 'INTRODUCTION', durationMinutes: 5, teacherActivities: ['Ask about pulse'], learnerActivities: ['Feel pulse'], assessmentCriteria: ['Locates pulse'] }],
}
const cbcDoc = buildLessonPlanDocument(cbcPlan, { curriculumMode: 'cbc' })
const cbcXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(cbcDoc)))['word/document.xml'])
assert(cbcXml.includes('Mr. Phiri'), 'CBC: teacher name from header appears in the .docx')
assert(cbcXml.includes('The Human Heart'), 'CBC: topic from header appears in the .docx')
assert(cbcXml.includes('Blood Circulation'), 'CBC: sub-topic from header appears in the .docx')
assert(cbcXml.includes('SPECIFIC COMPETENCE'), 'CBC: shows SPECIFIC COMPETENCE label')
assert(cbcXml.includes('LEARNING ENVIRONMENT'), 'CBC: shows LEARNING ENVIRONMENT label')
// The clean two-column header (§4.3): label and value in one cell, underlined
// labels, no rules bracketing the block.
assert(cbcXml.includes('Name of Teacher'), 'CBC: two-column header shows the Name of Teacher label')
assert(cbcXml.includes('No of pupils'), 'CBC: header carries the pupil-count field')
assert(cbcXml.includes('B: ______') && cbcXml.includes('G: ______'), 'CBC: pupil-count blanks sit with their label')
assert(cbcXml.includes('Jemareen Academy'), 'CBC: school name appears as the masthead title')
assert(cbcXml.includes('<w:u w:val="single"/>'), 'CBC: header labels are underlined')

console.log('\n§4 compactness rules survive the Word export')
// §4.1 — cells carry dash lines, never a numbered/bulleted list. `numPr` is how
// docx marks a list paragraph; the progression table must contain none.
assert(!cbcXml.includes('<w:numPr>'), '§4.1: no bullet/number list markers anywhere in the document')
assert(cbcXml.includes('\u2013 Ask about pulse'), '§4.1: activity cells render as dash lines')
// §4.1 — the header row repeats on a page break and body rows may split.
assert(cbcXml.includes('<w:tblHeader/>'), '§4.1: the progression header row repeats on page breaks')
assert((cbcXml.match(/LESSON PROGRESSION/g) || []).length === 1, '§4.1: the progression block is emitted once')
// §4.5 — one ruled line per evaluation field, no underscore runs.
assert(!/_{20,}/.test(cbcXml), '§4.5: no 60-underscore evaluation rows')
assert(cbcXml.includes('Successes') && cbcXml.includes('Way forward'), '§4.5: CBC evaluation fields present')
// §2.3 — an unselected environment prints nothing, and never "Not applicable".
const naDoc = buildLessonPlanDocument(
  { ...cbcPlan, learningEnvironment: { natural: 'Not applicable for this lesson.', artificial: 'Classroom with chalkboard.', technological: 'N/A' } },
  { curriculumMode: 'cbc', learningEnvironments: ['Artificial'] },
)
const naXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(naDoc)))['word/document.xml'])
assert(!/not applicable/i.test(naXml), '§2.3: no "Not applicable" text in the Word export')
assert((naXml.match(/LEARNING ENVIRONMENT/g) || []).length === 1, '§2.3: exactly one LEARNING ENVIRONMENT line')
assert(naXml.includes('Classroom'), '§2.3: Simple mode prints the place')

console.log('\n§2.5 margins reach the page geometry')
const { resolveLessonFormat } = await import('../../utils/lessonPlanFormat.js')
const narrowDoc = buildLessonPlanDocument(cbcPlan, {
  curriculumMode: 'cbc',
  lessonFormat: resolveLessonFormat({ pageBudget: '1', marginMm: 10 }),
})
const narrowXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(narrowDoc)))['word/document.xml'])
// 10 mm = 567 twips. A margin the preview honours but the export ignores is
// exactly how a "2 page" plan came out of Word at four.
assert(/w:top="56[67]"/.test(narrowXml), '§2.5: the chosen margin reaches the Word page geometry')
assert(/w:w="11906"/.test(narrowXml), '§2.5: the page is A4')

console.log('\n§2.4 optional sections')
const trimmedDoc = buildLessonPlanDocument(
  { ...cbcPlan, rationale: 'Because.', remedialWork: 'Re-teach.', stages: [...cbcPlan.stages, { name: 'HOMEWORK', durationMinutes: 2, teacherActivities: ['Set task'], learnerActivities: ['Write it'], assessmentCriteria: ['Recorded'] }] },
  { curriculumMode: 'cbc', lessonFormat: resolveLessonFormat({ pageBudget: '2', sections: { rationale: false, remedialWork: false, homework: false } }) },
)
const trimmedXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(trimmedDoc)))['word/document.xml'])
assert(!trimmedXml.includes('RATIONALE'), '§2.4: a switched-off section prints no label')
assert(!trimmedXml.includes('REMEDIAL WORK'), '§2.4: remedial work can be dropped')
assert(!trimmedXml.includes('Set task'), '§2.4: the homework ROW is dropped, not just its label')

console.log('\n§4.3 header style')
const ministryDoc = buildLessonPlanDocument(cbcPlan, {
  curriculumMode: 'cbc',
  lessonFormat: resolveLessonFormat({ pageBudget: '2', headerStyle: 'ministry' }),
})
const ministryXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(ministryDoc)))['word/document.xml'])
assert(ministryXml.includes('MINISTRY OF EDUCATION'), '§4.3: Ministry header prints the ministry line')
assert(ministryXml.indexOf('MINISTRY OF EDUCATION') < ministryXml.indexOf('Jemareen Academy'), '§4.3: the ministry line sits above the school')
assert(!cbcXml.includes('MINISTRY OF EDUCATION'), '§4.3: School header does not print a ministry line')

console.log('\n§4.7 structured cell content')
const blockDoc = buildLessonPlanDocument({
  schemaVersion: '3.0',
  header: { teacherName: 'Mrs. Zulu', subject: 'Numeracy', class: 'Grade 3' },
  stages: [{
    name: 'Lesson Development',
    durationMinutes: 20,
    teacherActivities: ['Demonstrate adding with regrouping:', '#sum: 38677 + 11314'],
    learnerActivities: ['#expand: 38677'],
    learningPoint: 'Adding by place value.',
  }],
}, { curriculumMode: 'previous' })
const blockXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(blockDoc)))['word/document.xml'])
assert(!blockXml.includes('#sum:') && !blockXml.includes('#expand:'), '§4.7: block notation never reaches the page')
assert(blockXml.includes('TTh'), '§4.7: the worked sum carries its place-value headings')
assert(blockXml.includes('30 000 + 8 000 + 600 + 70 + 7'), '§4.7: expanded notation renders its parts')

// Previous (Outcomes-Based) curriculum: SPECIFIC OUTCOMES instead of
// competences, and NO learning-environment / specific-competence sections.
const prevPlan = {
  schemaVersion: '3.0',
  header: { teacherName: 'Mrs. Zulu', subject: 'Mathematics', topic: 'Fractions', class: 'Grade 5', durationMinutes: 40 },
  rationale: 'Fractions underpin division.',
  prerequisiteKnowledge: 'Whole numbers',
  specificOutcomes: ['Identify a fraction', 'Compare two fractions'],
  stages: [{ name: 'DEVELOPMENT', durationMinutes: 20, teacherActivities: ['Demonstrate'], learnerActivities: ['Practise'], methods: 'Demonstration' }],
  homework: 'Exercise 4 page 22',
}
const prevDoc = buildLessonPlanDocument(prevPlan, { curriculumMode: 'previous' })
const prevXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(prevDoc)))['word/document.xml'])
assert(prevXml.includes('SPECIFIC OUTCOMES'), 'previous: shows SPECIFIC OUTCOMES label')
assert(prevXml.includes('Identify a fraction'), 'previous: outcome text appears in the .docx')
assert(prevXml.includes('Mrs. Zulu'), 'previous: teacher name from header appears in the .docx')
assert(!prevXml.includes('LEARNING ENVIRONMENT'), 'previous: omits the CBC-only LEARNING ENVIRONMENT section')
assert(!prevXml.includes('SPECIFIC COMPETENCE'), 'previous: omits the CBC-only SPECIFIC COMPETENCE section')
assert(prevXml.includes('HOMEWORK'), 'previous: shows HOMEWORK / EXERCISE')

console.log('\n§4.6 OBC template parity')
assert(prevXml.includes('STAGE/TIME'), 'OBC: the first column is STAGE/TIME')
assert(/TEACHER(&apos;|&#39;|')S ACTIVITY/.test(prevXml), 'OBC: TEACHER\u2019S ACTIVITY column')
assert(prevXml.includes('LEARNING POINT'), 'OBC: LEARNING POINT replaces ASSESSMENT CRITERIA')
assert(!prevXml.includes('ASSESSMENT CRITERIA'), 'OBC: no CBC assessment-criteria column')
assert(prevXml.includes('Grade'), 'OBC: the header says Grade, not Class')
assert(prevXml.includes('PRE-REQUISITE'), 'OBC: PRE-REQUISITE, not Prior Knowledge')
assert(!prevXml.includes('PRIOR KNOWLEDGE'), 'OBC: no CBC Prior Knowledge label')
assert(prevXml.includes('EVALUATION'), 'OBC: ends in EVALUATION')
assert(prevXml.includes('LESSON LEARNT'), 'OBC: ends in LESSON LEARNT')
assert(!prevXml.includes('Successes'), 'OBC: does not borrow the CBC evaluation prompts')
assert(!prevXml.includes('EXPECTED STANDARD'), 'OBC: no CBC Expected Standard field')

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll lessonPlanToDocx tests passed.')
