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
 * Run: node src/utils/lessonPlanToDocx.test.js
 */

import { Packer } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import { sanitizeXmlText } from './xmlText.js'
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
// Two-column header (matches the on-screen layout): labels + pupil fields.
assert(cbcXml.includes('NAME OF TEACHER'), 'CBC: two-column header shows NAME OF TEACHER label')
assert(cbcXml.includes('TOTAL NO. OF PUPILS'), 'CBC: header adds the Total no. of pupils field')
assert(cbcXml.includes('GIRLS') && cbcXml.includes('BOYS'), 'CBC: header adds Girls / Boys fields')
assert(cbcXml.includes('Jemareen Academy'), 'CBC: school name appears as the masthead title')

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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll lessonPlanToDocx tests passed.')
