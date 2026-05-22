#!/usr/bin/env node
/**
 * No-guess gate behavioural test for the Curriculum Reader.
 *
 * The Reader (functions/agents/learnerAi/curriculumResolver.js) MUST:
 *   1. Refuse when no KB module / topic matches.
 *   2. Refuse when the module has no `sourceDocId` (i.e. before the
 *      backfill script runs).
 *   3. Refuse when the approved syllabus doc is missing.
 *   4. Refuse on grade/subject mismatch between module and syllabus.
 *   5. Succeed only when KB + approvedSyllabi line up AND cited
 *      excerpts are non-empty.
 *
 * It must NEVER fall back to "general CBC knowledge" — that's the
 * teacher-tool resolver's behavior and we deliberately do not mirror it
 * here.
 *
 * This test loads the resolver via Node's import-with-mocks pattern:
 *   - we stub firebase-admin's firestore() before requiring the module
 *   - we stub the cbcKnowledge lookup helpers
 * so we can assert behaviour without hitting Firebase.
 *
 * Run: npm run test:curriculum-reader  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESOLVER_PATH = join(__dirname, '..', 'functions', 'agents', 'learnerAi', 'curriculumResolver.js')

// ── Mock firebase-admin so the resolver loads in plain Node ─────────
const fakeAdmin = {
  firestore: () => ({
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({
          exists: !!(fakeAdmin.__syllabi[id]),
          id,
          data: () => fakeAdmin.__syllabi[id],
        }),
      }),
    }),
  }),
  __syllabi: {},
}
fakeAdmin.firestore.FieldValue = {serverTimestamp: () => '__ts__'}

// ── Mock cbcKnowledge lookups ──────────────────────────────────────
//
// Captured-reference trap: the resolver destructures
//   const { lookupSubtopicModule, lookupTopic } = require(...)
// at load time, so per-test reassignments after import do nothing.
// Instead, the mock's exported functions read from a mutable state
// closure that each test mutates.
const state = {
  module: null,
  topic: null,
}
const fakeCbc = {
  KB_VERSION: 'cbc-kb-test',
  lookupSubtopicModule: async () => state.module,
  lookupTopic: async () => state.topic,
}

// Patch require so curriculumResolver picks up our mocks
const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === '../../teacherTools/cbcKnowledge') return fakeCbc
  return origLoad.call(this, request, parent, ...rest)
}

const { resolveStrictCurriculumRef } = await import(RESOLVER_PATH)

let pass = 0, fail = 0
const failures = []
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

const baseInputs = {
  grade: '7', subject: 'Mathematics', topic: 'Fractions',
  subtopic: 'Adding fractions', term: 1,
}

console.log('\nThe Curriculum Reader refuses to guess')

await test('refuses when grade/subject/topic missing', async () => {
  const r = await resolveStrictCurriculumRef({})
  assert(r.ok === false, 'must refuse on missing inputs')
  assert(r.reason === 'missing_required_inputs', `wrong reason: ${r.reason}`)
})

await test('refuses when KB has no module and no topic match', async () => {
  state.module = null
  state.topic = null
  const r = await resolveStrictCurriculumRef(baseInputs)
  assert(r.ok === false, 'must refuse on full KB miss')
  assert(r.reason === 'no_curriculum_match', `wrong reason: ${r.reason}`)
})

await test('refuses when module has no sourceDocId (pre-backfill state)', async () => {
  state.module = {
    id: 'mod-1', grade: '7', subject: 'Mathematics', term: 1,
    topic: 'Fractions', subtopic: 'Adding fractions',
    outcomes: ['outcome a'], contentSummary: 'summary',
    // NOTE: no sourceDocId — must refuse, not fall back to general knowledge.
  }
  state.topic = null
  const r = await resolveStrictCurriculumRef(baseInputs)
  assert(r.ok === false, 'must refuse modules without sourceDocId')
  assert(r.reason === 'no_source_doc_ref', `wrong reason: ${r.reason}`)
})

await test('refuses when approvedSyllabi doc is missing', async () => {
  state.module = {
    id: 'mod-1', grade: '7', subject: 'Mathematics', term: 1,
    topic: 'Fractions', subtopic: 'Adding fractions',
    outcomes: ['outcome a'],
    sourceDocId: 'syll-missing',
  }
  state.topic = null
  fakeAdmin.__syllabi = {} // no syllabus
  const r = await resolveStrictCurriculumRef(baseInputs)
  assert(r.ok === false, 'must refuse when approvedSyllabi lookup fails')
  assert(r.reason === 'source_doc_not_found', `wrong reason: ${r.reason}`)
})

await test('refuses on grade mismatch between module and syllabus', async () => {
  state.module = {
    id: 'mod-1', grade: '7', subject: 'Mathematics', term: 1,
    topic: 'Fractions', subtopic: 'Adding fractions',
    outcomes: ['outcome a'], sourceDocId: 'syll-1',
  }
  state.topic = null
  fakeAdmin.__syllabi = {
    'syll-1': { grade: '5', subject: 'Mathematics', storagePath: 'syllabi/x.pdf' },
  }
  const r = await resolveStrictCurriculumRef(baseInputs)
  assert(r.ok === false, 'must refuse on grade mismatch')
  assert(r.reason === 'source_doc_grade_mismatch', `wrong reason: ${r.reason}`)
})

await test('refuses on subject mismatch between module and syllabus', async () => {
  state.module = {
    id: 'mod-1', grade: '7', subject: 'Mathematics', term: 1,
    topic: 'Fractions', subtopic: 'Adding fractions',
    outcomes: ['outcome a'], sourceDocId: 'syll-1',
  }
  state.topic = null
  fakeAdmin.__syllabi = {
    'syll-1': { grade: '7', subject: 'English', storagePath: 'syllabi/x.pdf' },
  }
  const r = await resolveStrictCurriculumRef(baseInputs)
  assert(r.ok === false, 'must refuse on subject mismatch')
  assert(r.reason === 'source_doc_subject_mismatch', `wrong reason: ${r.reason}`)
})

await test('refuses when module has no cited-excerpt content', async () => {
  state.module = {
    id: 'mod-1', grade: '7', subject: 'Mathematics', term: 1,
    topic: 'Fractions', subtopic: 'Adding fractions',
    sourceDocId: 'syll-1',
    // no outcomes, no contentSummary, no anything → no excerpts
  }
  state.topic = null
  fakeAdmin.__syllabi = {
    'syll-1': { grade: '7', subject: 'Mathematics', storagePath: 'syllabi/x.pdf', sha256: 'abc' },
  }
  const r = await resolveStrictCurriculumRef(baseInputs)
  assert(r.ok === false, 'must refuse when there are no cited excerpts')
  assert(r.reason === 'no_cited_excerpts', `wrong reason: ${r.reason}`)
})

await test('succeeds when KB + approvedSyllabi + excerpts all line up', async () => {
  state.module = {
    id: 'mod-1', grade: '7', subject: 'Mathematics', term: 1,
    topic: 'Fractions', subtopic: 'Adding fractions',
    outcomes: ['Add fractions with the same denominator.'],
    contentSummary: 'Adding fractions with like denominators.',
    competencies: ['competency code MATH-7-FR-A'],
    sourceDocId: 'syll-1',
    sourceStoragePath: 'syllabi/g7-mathematics-2024.pdf',
  }
  state.topic = null
  fakeAdmin.__syllabi = {
    'syll-1': {
      grade: '7', subject: 'Mathematics',
      storagePath: 'syllabi/g7-mathematics-2024.pdf', sha256: 'abc123',
    },
  }
  const r = await resolveStrictCurriculumRef(baseInputs)
  assert(r.ok === true, `expected ok=true, got reason=${r.reason || '?'}`)
  assert(r.curriculumRef.sourceDocId === 'syll-1', 'sourceDocId not set')
  assert(r.curriculumRef.citedExcerpts.length > 0, 'cited excerpts missing')
  assert(r.curriculumRef.sourceChecksums.length === 1, 'sourceChecksums must be populated')
  assert(r.curriculumRef.kbVersion === 'cbc-kb-test', 'kbVersion not propagated')
})

// Restore module loader
Module._load = origLoad

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
