#!/usr/bin/env node
/**
 * Regression test for the "one subject, multiple grade sheets" layout
 * added to functions/teacherTools/parseSyllabusUpload.js.
 *
 * The CDC 2024 Science (Grades 4-6) and Social Studies (Grades 4-7)
 * primary syllabi ship as a single .xlsx with sheets named "Grade 4",
 * "Grade 5", "Grade 6" (one sheet per grade) instead of the older
 * single-"Syllabus"-sheet layout the parser was originally built for.
 * Without the fix the parser silently skipped every sheet, the
 * Curriculum Replace Studio reported "0 topics extracted", and admins
 * had no way to upload these workbooks.
 *
 * This file covers three things:
 *   1. gradeFromSheetName    — pure helper, sheet name → grade key.
 *   2. parseFilenameHints    — strips "(Grades 4-6)" so the subject
 *                              resolves to integrated_science instead
 *                              of "science_grades_4_6".
 *   3. parseWorkbook         — end-to-end against an in-memory ExcelJS
 *                              workbook that mirrors the CDC layout.
 *
 * Run: npm run test:parse-syllabus-grade-sheets  (also via test:all)
 */

import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const PARSER_PATH = join(
  REPO_ROOT, 'functions', 'teacherTools', 'parseSyllabusUpload.js',
)
// On Windows, ESM dynamic-import refuses bare absolute paths ("M:\..."). Use
// the file:// URL form, which works on both Windows and POSIX.
const PARSER_URL = pathToFileURL(PARSER_PATH).href

// The parser registers a Storage trigger and calls firebase-admin at
// module load. Stub these (plus exceljs and cbcKnowledge) so the file
// loads under plain Node without functions/node_modules or admin
// credentials — the npm test:all suite runs root-only.
const fakeAdmin = {
  firestore: () => ({}),
  storage: () => ({}),
}
fakeAdmin.firestore.FieldValue = { serverTimestamp: () => '__ts__' }
const fakeStorageTrigger = { onObjectFinalized: () => () => undefined }
const fakeExcelJS = { Workbook: class { async xlsx() {} } }
const fakeCbcKnowledge = {
  normalizeGrade: (g) => {
    if (g == null) return ''
    const raw = String(g).trim().toUpperCase().replace(/\s+/g, '')
    if (!raw) return ''
    if (/^G\d+$/.test(raw)) return raw
    if (/^\d+$/.test(raw)) return `G${raw}`
    const m = raw.match(/^GRADE(\d+)$/)
    if (m) return `G${m[1]}`
    return raw
  },
  normalizeSubject: (s) =>
    String(s || '').toLowerCase().replace(/[^a-z]/g, '_'),
}

const origLoad = Module._load
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === 'firebase-functions/v2/storage') return fakeStorageTrigger
  if (request === 'exceljs') return fakeExcelJS
  if (request === './cbcKnowledge') return fakeCbcKnowledge
  return origLoad.call(this, request, parent, ...rest)
}

const mod = await import(PARSER_URL)
Module._load = origLoad

const {
  gradeFromSheetName,
  parseFilenameHints,
  parseWorkbook,
  GRADE_SHEET_REGEX,
} = mod.__test__

// Hand-rolled fake of the ExcelJS Worksheet shape that parseSyllabusSheet
// reads. The npm test:all suite runs at the repo root and never installs
// functions/node_modules, so pulling in the real exceljs would break CI.
// The surface is small enough that a minimal stand-in covers everything
// parseWorkbook needs: sheet.name, actualRowCount, getRow(r), and
// row.eachCell + row.getCell that mirror exceljs's 1-based indexing.
function makeSheet(name, rows) {
  const trimmedRows = rows.map((cells) => cells.map(
    (v) => (v == null ? '' : v),
  ))
  function makeCell(value) {
    return { value }
  }
  function makeRow(rowCells) {
    return {
      getCell(col1) {
        const idx = col1 - 1
        return makeCell(idx < rowCells.length ? rowCells[idx] : '')
      },
      eachCell(optsOrFn, maybeFn) {
        const opts = typeof optsOrFn === 'object' ? optsOrFn : {}
        const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn
        const includeEmpty = opts.includeEmpty === true
        for (let i = 0; i < rowCells.length; i++) {
          const v = rowCells[i]
          const empty = v == null || v === ''
          if (!includeEmpty && empty) continue
          fn(makeCell(v), i + 1)
        }
      },
    }
  }
  const sheet = {
    name,
    actualRowCount: trimmedRows.length,
    rowCount: trimmedRows.length,
    getRow(r1) {
      const idx = r1 - 1
      return idx >= 0 && idx < trimmedRows.length ?
        makeRow(trimmedRows[idx]) :
        makeRow([])
    },
  }
  return sheet
}

function makeWorkbook(sheetSpecs) {
  return { worksheets: sheetSpecs.map((s) => makeSheet(s.name, s.rows)) }
}

let pass = 0
let fail = 0
const failures = []
async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('\nparseSyllabusUpload — gradeFromSheetName')

await test('"Grade 4" → "G4"', () => {
  assert(gradeFromSheetName('Grade 4') === 'G4', `got ${gradeFromSheetName('Grade 4')}`)
})

await test('case + whitespace insensitive', () => {
  assert(gradeFromSheetName('grade  5') === 'G5')
  assert(gradeFromSheetName('  GRADE 7  ') === 'G7')
})

await test('"Form 1" → "F1", "Level 4" → "L4"', () => {
  assert(gradeFromSheetName('Form 1') === 'F1', 'Form 1')
  assert(gradeFromSheetName('Level 4') === 'L4', 'Level 4')
})

await test('returns null for non-grade sheet names', () => {
  assert(gradeFromSheetName('Syllabus') === null, 'Syllabus')
  assert(gradeFromSheetName('Cover') === null, 'Cover')
  assert(gradeFromSheetName('English - Syllabus') === null, 'English - Syllabus')
  assert(gradeFromSheetName('') === null, 'empty')
  assert(gradeFromSheetName(null) === null, 'null')
})

await test('GRADE_SHEET_REGEX rejects ranges (one grade per sheet)', () => {
  assert(GRADE_SHEET_REGEX.test('Grade 4') === true, 'single must match')
  assert(GRADE_SHEET_REGEX.test('Grade 4-6') === false, 'range must not match')
  assert(GRADE_SHEET_REGEX.test('Grade 4 / 5') === false, 'slash must not match')
})

console.log('\nparseSyllabusUpload — parseFilenameHints')

await test('"Science Syllabus (Grades 4-6).xlsx" resolves to integrated_science', () => {
  const h = parseFilenameHints('Science Syllabus (Grades 4-6).xlsx')
  assert(h.subject === 'integrated_science',
    `subject expected "integrated_science", got "${h.subject}"`)
  assert(h.subjectDisplay === 'Science',
    `subjectDisplay expected "Science", got "${h.subjectDisplay}"`)
  assert(h.grade === null,
    `grade must be null for multi-grade workbook, got "${h.grade}"`)
  assert(h.isScheme === false, 'isScheme must be false')
})

await test('"Social Studies Syllabus (Grades 4-7).xlsx" handled the same way', () => {
  const h = parseFilenameHints('Social Studies Syllabus (Grades 4-7).xlsx')
  assert(h.subject === 'social_studies',
    `subject expected "social_studies", got "${h.subject}"`)
  assert(h.subjectDisplay === 'Social Studies',
    `subjectDisplay expected "Social Studies", got "${h.subjectDisplay}"`)
  assert(h.grade === null, 'grade must be null')
})

await test('single-grade filename still works (regression)', () => {
  const h = parseFilenameHints('Mathematics Grade 4 Syllabus.xlsx')
  assert(h.grade === 'G4', `grade expected "G4", got "${h.grade}"`)
  assert(h.subject === 'mathematics', `subject expected "mathematics", got "${h.subject}"`)
})

await test('"Grades" plural without parens does not leak into subject', () => {
  const h = parseFilenameHints('History Syllabus Grades 8-9.xlsx')
  assert(h.subject === 'history', `subject expected "history", got "${h.subject}"`)
  assert(h.subjectDisplay === 'History', `subjectDisplay got "${h.subjectDisplay}"`)
})

console.log('\nparseSyllabusUpload — parseWorkbook (multi-grade layout)')

function buildScienceWorkbook() {
  return makeWorkbook([
    {
      name: 'Grade 4',
      rows: [
        ['SCIENCE SYLLABUS — GRADE 4'],
        ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD'],
        ['4.1 The Human Body', '4.1.1 The Respiratory System', 'Demonstrate understanding of the respiratory system', '• Describing the respiratory system\n• Analysing main parts', 'Understanding demonstrated satisfactorily'],
        ['4.1 The Human Body', '4.1.2 Blood Circulatory System', 'Demonstrate understanding of the circulatory system', '• Describing blood circulation', 'Understanding demonstrated appropriately'],
        ['4.2 Nutrition and Health', '4.2.1 Classification of Food', 'Classify foods based on nutritional content', '• Collecting different foods', 'Foods classified correctly'],
      ],
    },
    {
      name: 'Grade 5',
      rows: [
        ['SCIENCE SYLLABUS — GRADE 5'],
        ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD'],
        ['5.1 The Human Body', '5.1.1 The Skeletal System', 'Demonstrate understanding of the skeletal system', '• Describing the skeletal system', 'Understanding demonstrated accordingly'],
      ],
    },
    {
      name: 'Grade 6',
      rows: [
        ['SCIENCE SYLLABUS — GRADE 6'],
        ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD'],
        ['6.1 The Human Body', '6.1.1 The Digestive System', 'Demonstrate understanding of the digestive system', '• Describing the digestive system', 'Understanding demonstrated appropriately'],
      ],
    },
  ])
}

await test('Grade 4/5/6 sheets each yield topic docs with the correct grade', async () => {
  const wb = buildScienceWorkbook()
  const filenameHints = parseFilenameHints('Science Syllabus (Grades 4-6).xlsx')
  const result = parseWorkbook(wb, {
    filename: 'Science Syllabus (Grades 4-6).xlsx',
    version: 'cbc-kb-2026-05-test',
    filenameHints,
  })
  assert(result.sheetsProcessed === 3,
    `expected 3 sheets processed, got ${result.sheetsProcessed}`)
  assert(result.topicDocs.length > 0, 'expected at least one topic doc')

  const byGrade = new Map()
  for (const t of result.topicDocs) {
    if (!byGrade.has(t.grade)) byGrade.set(t.grade, [])
    byGrade.get(t.grade).push(t)
  }
  assert(byGrade.has('G4'), `G4 topics missing — grades present: ${Array.from(byGrade.keys()).join(', ')}`)
  assert(byGrade.has('G5'), 'G5 topics missing')
  assert(byGrade.has('G6'), 'G6 topics missing')
  // Each grade should have at least one topic (G4 has two topics across 3 rows;
  // the parser collapses by topic name, so G4 should have 2 topics).
  assert(byGrade.get('G4').length === 2,
    `G4 expected 2 topics (Human Body + Nutrition), got ${byGrade.get('G4').length}`)
})

await test('topic subjects all pick up integrated_science from the filename', async () => {
  const wb = buildScienceWorkbook()
  const filenameHints = parseFilenameHints('Science Syllabus (Grades 4-6).xlsx')
  const result = parseWorkbook(wb, {
    filename: 'Science Syllabus (Grades 4-6).xlsx',
    version: 'cbc-kb-2026-05-test',
    filenameHints,
  })
  for (const t of result.topicDocs) {
    assert(t.subject === 'integrated_science',
      `topic "${t.topic}" got subject "${t.subject}", expected integrated_science`)
  }
})

await test('subtopics survive the round-trip with their per-row fields', async () => {
  const wb = buildScienceWorkbook()
  const filenameHints = parseFilenameHints('Science Syllabus (Grades 4-6).xlsx')
  const result = parseWorkbook(wb, {
    filename: 'Science Syllabus (Grades 4-6).xlsx',
    version: 'cbc-kb-2026-05-test',
    filenameHints,
  })
  const g4HumanBody = result.topicDocs.find(
    (t) => t.grade === 'G4' && /Human Body/i.test(t.topic),
  )
  assert(g4HumanBody, 'G4 Human Body topic should be present')
  assert(Array.isArray(g4HumanBody.subtopics) && g4HumanBody.subtopics.length === 2,
    `G4 Human Body expected 2 subtopics, got ${g4HumanBody.subtopics?.length}`)
  const respiratory = g4HumanBody.subtopics.find(
    (s) => /Respiratory/i.test(s.name),
  )
  assert(respiratory, 'Respiratory subtopic should be present')
  assert(/respiratory system/i.test(respiratory.specificCompetence),
    `specificCompetence missing or wrong: "${respiratory.specificCompetence}"`)
  assert(Array.isArray(respiratory.learningActivities) && respiratory.learningActivities.length === 2,
    `learningActivities expected 2 items, got ${respiratory.learningActivities?.length}`)
})

await test('legacy single-sheet "Syllabus" layout still parses (regression)', async () => {
  const wb = makeWorkbook([
    {
      name: 'Syllabus',
      rows: [
        ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCE', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD'],
        ['1.1 Numbers', '1.1.1 Counting', 'Count to 100', '• Count', 'Counts correctly'],
      ],
    },
  ])
  const filenameHints = parseFilenameHints('Mathematics Grade 4.xlsx')
  const result = parseWorkbook(wb, {
    filename: 'Mathematics Grade 4.xlsx',
    version: 'cbc-kb-2026-05-test',
    filenameHints,
  })
  assert(result.topicDocs.length === 1, `expected 1 topic doc, got ${result.topicDocs.length}`)
  assert(result.topicDocs[0].grade === 'G4', 'grade must come from filename hint')
  assert(result.topicDocs[0].subject === 'mathematics', 'subject must come from filename hint')
})

console.log('')
if (fail > 0) {
  console.log(`${pass} passed, ${fail} failed`)
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
} else {
  console.log(`${pass} passed`)
}
