#!/usr/bin/env node
/**
 * Unit test for the source-doc linking added to
 * functions/teacherTools/parseSyllabusUpload.js.
 *
 * The strict learner-AI resolver
 * (functions/agents/learnerAi/curriculumResolver.js) refuses every
 * task whose matched KB module has no `sourceDocId`, so an admin
 * uploading a syllabus through the UI would see every agent stay
 * idle. The parser now emits one approvedSyllabi doc per upload and
 * stamps the id onto every parsed draftTopic, plus aliases the parsed
 * subtopic fields into the names `pickExcerpts` reads
 * (competencies / outcomes / learnerActivities / contentSummary /
 * assessmentCriteria).
 *
 * This file tests the pure builders in isolation — Firestore writes
 * stay covered by the integration tests that hit a live emulator.
 *
 * Run: npm run test:parse-syllabus-upload  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PARSER_PATH = join(
  __dirname, '..', 'functions', 'teacherTools', 'parseSyllabusUpload.js',
)

// The parser pulls in firebase-functions/v2/storage + firebase-admin at
// module load (for the trigger registration), but the pure helpers we
// want to test don't touch either. Stub both so the file loads under
// plain Node without admin credentials.
const fakeAdmin = {
  firestore: () => ({}),
  storage: () => ({}),
}
fakeAdmin.firestore.FieldValue = { serverTimestamp: () => '__ts__' }
const fakeStorageTrigger = {
  onObjectFinalized: () => () => undefined,
}

// cbcKnowledge pulls in a fan-out of teacher-tool modules at require
// time. The parser only needs two pure helpers from it
// (normalizeGrade, normalizeSubject); stub the rest so the file loads
// under plain Node without the functions/ install tree.
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

// exceljs is only needed by the workbook-parsing path, which these
// pure-helper tests never exercise. Returning a no-op constructor is
// enough to make the require() succeed at module load.
const fakeExcelJS = {
  Workbook: class { async xlsx() {} },
}

const origLoad = Module._load
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === 'firebase-functions/v2/storage') return fakeStorageTrigger
  if (request === 'exceljs') return fakeExcelJS
  if (request === './cbcKnowledge') return fakeCbcKnowledge
  return origLoad.call(this, request, parent, ...rest)
}

const mod = await import(PARSER_PATH)
Module._load = origLoad

const {
  buildApprovedSyllabusId,
  buildApprovedSyllabusRecord,
  deriveExcerptAliases,
} = mod.__test__

let pass = 0, fail = 0
const failures = []
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

console.log('\nparseSyllabusUpload — approvedSyllabi linking')

await test('buildApprovedSyllabusId returns null when grade/subject missing', () => {
  assert(buildApprovedSyllabusId({}, 'x.xlsx') === null, 'must refuse on missing hints')
  assert(buildApprovedSyllabusId({ grade: 'G4' }, 'x.xlsx') === null, 'subject required')
  assert(buildApprovedSyllabusId({ subject: 'integrated_science' }, 'x.xlsx') === null, 'grade required')
})

await test('buildApprovedSyllabusId is deterministic and slug-safe', () => {
  const id = buildApprovedSyllabusId(
    { grade: 'G4', subject: 'integrated_science', term: 1 },
    'Grade 4 Integrated Science Syllabus.xlsx',
  )
  assert(typeof id === 'string' && id.length > 0, 'id must be a non-empty string')
  assert(/^[a-z0-9-]+$/.test(id), `id must be lowercase-slug-only, got "${id}"`)
  // Re-running over the same file produces the same id (idempotent).
  const again = buildApprovedSyllabusId(
    { grade: 'G4', subject: 'integrated_science', term: 1 },
    'Grade 4 Integrated Science Syllabus.xlsx',
  )
  assert(id === again, 'id must be deterministic')
})

await test('buildApprovedSyllabusRecord stores grade/subject in canonical KB shape', () => {
  const rec = buildApprovedSyllabusRecord({
    ctx: {
      filePath: 'syllabus-uploads/v1/Grade 4 Integrated Science Syllabus.xlsx',
      filename: 'Grade 4 Integrated Science Syllabus.xlsx',
      sha256: 'deadbeef',
      version: 'cbc-kb-2026-04-seed',
    },
    hints: { grade: 'G4', subject: 'integrated_science', subjectDisplay: 'Integrated Science', term: 1 },
    ts: () => '__ts__',
  })
  assert(rec, 'record must be returned')
  assert(rec.grade === 'G4', `grade must normalize to "G4", got "${rec.grade}"`)
  assert(rec.subject === 'integrated_science', `subject must canonicalize, got "${rec.subject}"`)
  assert(rec.subjectDisplay === 'Integrated Science', 'subjectDisplay must round-trip')
  assert(rec.term === 1, 'term must be coerced to a number')
  assert(rec.storagePath === 'syllabus-uploads/v1/Grade 4 Integrated Science Syllabus.xlsx', 'storagePath must round-trip')
  assert(rec.sha256 === 'deadbeef', 'sha256 must round-trip')
  assert(rec.kbVersion === 'cbc-kb-2026-04-seed', 'kbVersion must round-trip')
  assert(rec.approvedBy === 'syllabus-upload-parser', 'approvedBy must be stamped')
  assert(rec.uploadedAt === '__ts__' && rec.approvedAt === '__ts__', 'timestamps must use the injected sentinel')
})

await test('buildApprovedSyllabusRecord returns null when hints are unparseable', () => {
  assert(buildApprovedSyllabusRecord({ ctx: { filename: 'x.xlsx' }, hints: {}, ts: () => 't' }) === null,
    'must refuse on missing grade/subject')
})

console.log('\nparseSyllabusUpload — deriveExcerptAliases')

await test('aliases nothing when the draft has no subtopics / competencies', () => {
  const out = deriveExcerptAliases({ topic: 'Empty', subtopics: [] })
  assert(Object.keys(out).length === 0, 'must not invent fields out of thin air')
})

await test('keyCompetencies + per-subtopic specificCompetence flow into competencies', () => {
  const out = deriveExcerptAliases({
    keyCompetencies: ['Inquiry skill A', 'Inquiry skill B'],
    subtopics: [
      { name: 'Sub 1', specificCompetence: 'Specific A' },
      { name: 'Sub 2', specificCompetence: 'Specific B' },
    ],
  })
  assert(Array.isArray(out.competencies), 'competencies must be present')
  assert(out.competencies.length === 4, `expected 4 competencies, got ${out.competencies.length}`)
  assert(out.competencies.includes('Inquiry skill A'), 'top-level competency missing')
  assert(out.competencies.includes('Specific B'), 'subtopic-level competency missing')
})

await test('expectedStandard becomes both outcomes and assessmentCriteria', () => {
  const out = deriveExcerptAliases({
    subtopics: [
      { name: 'Sub 1', expectedStandard: 'Identifies heart chambers correctly.' },
      { name: 'Sub 2', expectedStandard: 'Describes circulation flow.' },
    ],
  })
  assert(Array.isArray(out.outcomes) && out.outcomes.length === 2, 'outcomes must surface')
  assert(Array.isArray(out.assessmentCriteria) && out.assessmentCriteria.length === 2, 'assessmentCriteria must mirror outcomes')
})

await test('learningActivities flatten into learnerActivities', () => {
  const out = deriveExcerptAliases({
    subtopics: [
      { name: 'Sub 1', learningActivities: ['Watch demo', 'Label diagram'] },
      { name: 'Sub 2', learningActivities: ['Group discussion'] },
    ],
  })
  assert(Array.isArray(out.learnerActivities), 'learnerActivities must be present')
  assert(out.learnerActivities.length === 3, `expected 3, got ${out.learnerActivities.length}`)
  assert(out.learnerActivities[0] === 'Watch demo', 'order/content wrong')
})

await test('contentSummary lists subtopic names', () => {
  const out = deriveExcerptAliases({
    subtopics: [
      { name: 'The Heart' },
      { name: 'Blood Vessels' },
    ],
  })
  assert(typeof out.contentSummary === 'string', 'contentSummary must be a string')
  assert(out.contentSummary.includes('The Heart'), 'must mention each subtopic')
  assert(out.contentSummary.includes('Blood Vessels'), 'must mention each subtopic')
})

await test('placeholder "(unnamed sub-topic)" labels are skipped in contentSummary', () => {
  const out = deriveExcerptAliases({
    subtopics: [
      { name: 'The Heart' },
      { name: '(unnamed sub-topic)' },
    ],
  })
  assert(out.contentSummary && !out.contentSummary.includes('unnamed'),
    `placeholder leaked into summary: "${out.contentSummary}"`)
})

console.log('')
if (fail > 0) {
  console.log(`${pass} passed, ${fail} failed`)
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
} else {
  console.log(`${pass} passed`)
}
