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
  // Real implementations — these are pure and the resolver uses them to
  // normalise grade ("4" / "G4" / "Grade 4" → "G4") and subject
  // ("Integrated Science" → "integrated_science") on both sides of the
  // approvedSyllabi mismatch check. Without them, the resolver would
  // refuse every task wired from the admin Live Monitor test button.
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

const RICH_MODULE = {
  id: 'mod-1', grade: '7', subject: 'Mathematics', term: 1,
  topic: 'Fractions', subtopic: 'Adding fractions',
  outcomes: [
    'Add fractions with the same denominator.',
    'Identify equivalent fractions.',
  ],
  contentSummary: 'Adding fractions with like denominators.',
  competencies: ['competency code MATH-7-FR-A'],
  vocabulary: ['numerator', 'denominator', 'equivalent'],
  teachingMaterials: ['Fraction strips', 'Number line'],
  learnerActivities: ['Solve worksheet 7-2'],
  assessmentCriteria: ['Demonstrates correct denominator handling'],
  sourceDocId: 'syll-1',
  sourceStoragePath: 'syllabi/g7-mathematics-2024.pdf',
}
const RICH_SYLLABI = {
  'syll-1': {
    grade: '7', subject: 'Mathematics',
    storagePath: 'syllabi/g7-mathematics-2024.pdf', sha256: 'abc123',
  },
}

await test('succeeds when KB + approvedSyllabi + excerpts all line up', async () => {
  state.module = RICH_MODULE
  state.topic = null
  fakeAdmin.__syllabi = RICH_SYLLABI
  const r = await resolveStrictCurriculumRef(baseInputs)
  assert(r.ok === true, `expected ok=true, got reason=${r.reason || '?'}`)
  assert(r.curriculumRef.sourceDocId === 'syll-1', 'sourceDocId not set')
  assert(r.curriculumRef.citedExcerpts.length > 0, 'cited excerpts missing')
  assert(r.curriculumRef.sourceChecksums.length === 1, 'sourceChecksums must be populated')
  assert(r.curriculumRef.kbVersion === 'cbc-kb-test', 'kbVersion not propagated')
  assert(r.matchedModule, 'matchedModule must be returned alongside curriculumRef')
  assert(r.matchKind === 'subtopic_exact', `matchKind wrong: ${r.matchKind}`)
})

// ── v2 agent output contract ─────────────────────────────────────────
console.log('\nCurriculum Reader v2 — agent output contract')

const RUNNER_PATH = join(__dirname, '..', 'functions', 'agents', 'learnerAi', 'runners', 'curriculumReader.js')
// Stub the logger so importing the runner doesn't pull in admin SDK
// timers via writeAgentLog. We import the runner only for its pure
// projectAgentOutput / derive* / computeConfidenceScore helpers.
const origLoad2 = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === '../logger') {
    return {
      writeAgentLog: async () => {}, updateLiveAgentState: async () => {},
      writeTaskStep: async () => {},
    }
  }
  if (request === '../v2Collections') {
    return {
      TASK_STATUS: {CHECKING: 'checking'},
      TASK_STEP_STATUS: {RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed'},
      SEVERITY: {INFO: 'info', WARNING: 'warning'},
    }
  }
  if (request === '../curriculumResolver') {
    return {resolveStrictCurriculumRef}
  }
  return origLoad2.call(this, request, parent, ...rest)
}
const reader = await import(RUNNER_PATH)
Module._load = origLoad

const baseTask = {
  id: 't1', taskType: 'practice_quiz',
  grade: '7', subject: 'Mathematics', term: '1',
  topic: 'Fractions', subtopic: 'Adding fractions', lessonNumber: 2,
  assessmentType: null,
}

await test('projectAgentOutput emits all 14 v2 fields on subtopic_exact match', async () => {
  state.module = RICH_MODULE
  state.topic = null
  fakeAdmin.__syllabi = RICH_SYLLABI
  const resolved = await resolveStrictCurriculumRef(baseInputs)
  const out = reader.projectAgentOutput({task: baseTask, resolved})
  assert(out.status === 'ok', `expected status=ok, got ${out.status}`)
  assert(out.matchKind === 'subtopic_exact', 'matchKind wrong')
  assert(out.confidenceScore >= 0.8, `expected confidence >= 0.8 (got ${out.confidenceScore})`)
  assert(out.competencies.length >= 1, 'competencies must populate from module.competencies')
  assert(out.learningOutcomes.length >= 1, 'learningOutcomes must populate from module.outcomes')
  assert(out.keyConcepts.length >= 1, 'keyConcepts must populate (vocabulary)')
  assert(out.suggestedContent.length >= 1, 'suggestedContent must populate (teachingMaterials)')
  assert(out.curriculumDocumentPath === 'syllabi/g7-mathematics-2024.pdf', 'doc path wrong')
  assert(out.curriculumVersion === 'cbc-kb-test', 'version wrong')
  assert(out.citedExcerpts.length >= 1, 'citedExcerpts must propagate from resolver')
  assert(out.sourceChecksums.length >= 1, 'sourceChecksums must propagate')
  assert(out.lessonNumber === 2, 'lessonNumber must echo from task')
})

await test('topic-only match → status=needs_review with sparse KB', async () => {
  // Topic-only fallback: lookupSubtopicModule returns null, lookupTopic hits.
  // To exercise the < 0.6 threshold:
  //   - matchKind=topic_only       → baseline 0.5
  //   - only one citable field     → +0.05 (one excerpt)
  //   - no outcomes[]              → no bonus
  //   - no competencies[]          → no bonus
  //   - syllabus carries no sha256 → no sourceChecksums bonus
  //   total: 0.55 → status='needs_review'
  state.module = null
  state.topic = {
    id: 'top-1', grade: '7', subject: 'Mathematics', term: 1,
    topic: 'Fractions',
    contentSummary: 'Fractions overview.',
    sourceDocId: 'syll-bare',
  }
  fakeAdmin.__syllabi = {
    'syll-bare': {
      grade: '7', subject: 'Mathematics',
      storagePath: 'syllabi/g7-bare.pdf',
      // no sha256 → sourceChecksums stays empty in the curriculumRef
    },
  }
  const resolved = await resolveStrictCurriculumRef(baseInputs)
  assert(resolved.ok === true, `expected resolver to succeed on topic-only path: ${resolved.reason || ''}`)
  assert(resolved.matchKind === 'topic_only', `matchKind wrong: ${resolved.matchKind}`)
  const out = reader.projectAgentOutput({task: baseTask, resolved})
  assert(out.status === 'needs_review',
    `topic-only sparse KB must yield needs_review, got status=${out.status} conf=${out.confidenceScore}`)
  assert(out.confidenceScore < 0.6,
    `expected confidence < 0.6 (got ${out.confidenceScore})`)
})

await test('grade + subject mismatch checks normalize before comparing', async () => {
  // Admin Live Monitor test button writes task.grade='4' /
  // task.subject='Integrated Science'. parseSyllabusUpload writes
  // approvedSyllabi as grade='G4' / subject='integrated_science'
  // (canonical KB shape). The mismatch check must normalize both
  // sides — pre-fix it refused every such task with
  // source_doc_grade_mismatch.
  state.module = {
    id: 'mod-1', grade: 'G4', subject: 'integrated_science', term: 1,
    topic: 'Blood Circulatory System', subtopic: 'The Heart',
    outcomes: ['Identifies heart chambers correctly.'],
    sourceDocId: 'syll-canon',
  }
  state.topic = null
  fakeAdmin.__syllabi = {
    'syll-canon': {
      grade: 'G4', subject: 'integrated_science',
      storagePath: 'syllabus-uploads/v1/G4 Integrated Science.xlsx',
      sha256: 'abc',
    },
  }
  const r = await resolveStrictCurriculumRef({
    grade: '4', subject: 'Integrated Science',
    topic: 'Blood Circulatory System', subtopic: 'The Heart', term: 1,
  })
  assert(r.ok === true,
    `normalised lookup must succeed, got refusal=${r.reason || '?'}`)
})

await test('confidenceScore monotone in cited-excerpt count', async () => {
  const low = reader.computeConfidenceScore({
    matchKind: 'subtopic_exact',
    citedExcerpts: [1],
    competencies: [], outcomes: [], sourceChecksums: [],
  })
  const high = reader.computeConfidenceScore({
    matchKind: 'subtopic_exact',
    citedExcerpts: [1, 2, 3, 4, 5],
    competencies: [], outcomes: [], sourceChecksums: [],
  })
  assert(low < high, `expected low(${low}) < high(${high}) when cited excerpt count rises`)
})

await test('task.assessmentType is echoed onto output', async () => {
  state.module = RICH_MODULE
  state.topic = null
  fakeAdmin.__syllabi = RICH_SYLLABI
  const resolved = await resolveStrictCurriculumRef(baseInputs)
  const out = reader.projectAgentOutput({
    task: {...baseTask, assessmentType: 'end_of_term_test'},
    resolved,
  })
  assert(out.assessmentType === 'end_of_term_test',
    `expected assessmentType=end_of_term_test, got ${out.assessmentType}`)
})

await test('keyConcepts derived from vocabulary[] when present', async () => {
  assert.deepEqual = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || `${JSON.stringify(a)} !== ${JSON.stringify(b)}`)
  }
  const kc = reader.deriveKeyConcepts({
    vocabulary: ['numerator', 'denominator', 'equivalent'],
    assessmentCriteria: ['should-not-be-used'],
    contentSummary: 'also-should-not-be-used',
  })
  assert.deepEqual(kc, ['numerator', 'denominator', 'equivalent'],
    `vocabulary must win: got ${JSON.stringify(kc)}`)
})

await test('suggestedContent falls back to learnerActivities when no teachingMaterials', async () => {
  const sc1 = reader.deriveSuggestedContent({
    teachingMaterials: ['Number line'],
    learnerActivities: ['should-not-be-used'],
  })
  assert(sc1[0] === 'Number line' && sc1.length === 1, `teachingMaterials must win: ${JSON.stringify(sc1)}`)
  const sc2 = reader.deriveSuggestedContent({learnerActivities: ['Solve worksheet 7-2']})
  assert(sc2[0] === 'Solve worksheet 7-2', `fallback to learnerActivities failed: ${JSON.stringify(sc2)}`)
})

// Restore module loader
Module._load = origLoad

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
