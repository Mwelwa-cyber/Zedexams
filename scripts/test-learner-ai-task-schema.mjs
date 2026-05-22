#!/usr/bin/env node
/**
 * Static schema test for the learner-AI pipeline (v2).
 *
 * What this catches:
 *   1. firestore.rules whitelists every v2 collection.
 *   2. firestore.indexes.json carries the essential composite indexes.
 *   3. The dispatcher's status machine + supervisor's step planner
 *      use the v2 status enum (matches src/schemas/learnerAi.js).
 *   4. The Zod schemas validate a happy-path doc for every collection.
 *
 * Fails the build on any drift between these three layers.
 *
 * Run: npm run test:learner-ai-schema  (also via npm run test:all)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = join(__dirname, '..')

const rules = readFileSync(join(REPO, 'firestore.rules'), 'utf8')
const indexes = JSON.parse(readFileSync(join(REPO, 'firestore.indexes.json'), 'utf8'))

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === 'function') {
      return r.then(() => { pass++; console.log(`  ok  ${name}`) })
              .catch(err => { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) })
    }
    pass++; console.log(`  ok  ${name}`)
  } catch (err) {
    fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

console.log('\nv2 Firestore rules — all 10 collections present')

const V2_COLLECTIONS = [
  'aiAgentTasks',
  'aiAgentLogs',
  'aiGeneratedContent',
  'aiLiveAgentStates',
  'aiTaskSteps',
  'aiAgentControls',
  'aiSupervisorLogs',
  'curriculumUpdateReports',
  'assessmentStandards',
  'learnerWeaknessProfiles',
]
for (const c of V2_COLLECTIONS) {
  test(`rules whitelist /${c}/{id}`, () => {
    assert(rules.includes(`match /${c}/{`),
      `firestore.rules missing match block for ${c}`)
  })
}

test('aiAgentTasks create requires status=queued + no pipeline prefill', () => {
  const headerIdx = rules.indexOf('match /aiAgentTasks/')
  assert(headerIdx >= 0)
  const block = rules.slice(headerIdx, headerIdx + 2500)
  assert(block.includes("incoming().status == 'queued'"),
    'aiAgentTasks create rule must pin status to queued')
  for (const field of ['startedAt', 'completedAt', 'resultContentId', 'errorMessage']) {
    assert(block.includes(`'${field}' in incoming()`),
      `aiAgentTasks create rule does not block prefilled ${field}`)
  }
})

test('aiGeneratedContent learner read gated to published only', () => {
  const headerIdx = rules.indexOf('match /aiGeneratedContent/')
  assert(headerIdx >= 0)
  const block = rules.slice(headerIdx, headerIdx + 800)
  assert(block.includes("resource.data.status == 'published'"),
    'aiGeneratedContent learner-read rule missing published predicate')
})

test('aiAgentLogs is admin-read, no client write', () => {
  const headerIdx = rules.indexOf('match /aiAgentLogs/')
  assert(headerIdx >= 0)
  const block = rules.slice(headerIdx, headerIdx + 400)
  assert(block.includes('allow read:  if isAdmin();') ||
         block.includes('allow read: if isAdmin();'),
    'aiAgentLogs must be admin-read only')
  assert(block.includes('allow write: if false;'),
    'aiAgentLogs must deny all client writes')
})

test('aiAgentControls write requires admin + valid shape', () => {
  const headerIdx = rules.indexOf('match /aiAgentControls/')
  assert(headerIdx >= 0)
  const block = rules.slice(headerIdx, headerIdx + 600)
  assert(block.includes('incoming().enabled is bool'),
    'aiAgentControls write rule must validate enabled:bool')
  assert(block.includes('incoming().paused is bool'),
    'aiAgentControls write rule must validate paused:bool')
})

test('learnerWeaknessProfiles gated to own learnerId or admin', () => {
  const headerIdx = rules.indexOf('match /learnerWeaknessProfiles/')
  assert(headerIdx >= 0)
  const block = rules.slice(headerIdx, headerIdx + 500)
  assert(block.includes('resource.data.learnerId == request.auth.uid'),
    'learnerWeaknessProfiles read rule must scope to own learnerId')
})

console.log('\nv2 composite indexes — essential indexes present')

const requiredIndexShapes = [
  { collectionGroup: 'aiAgentTasks',            fields: ['status', 'createdAt'] },
  { collectionGroup: 'aiAgentTasks',            fields: ['agentName', 'status', 'updatedAt'] },
  { collectionGroup: 'aiAgentTasks',            fields: ['taskType', 'status', 'createdAt'] },
  { collectionGroup: 'aiAgentLogs',             fields: ['taskId', 'createdAt'] },
  { collectionGroup: 'aiAgentLogs',             fields: ['agentName', 'severity', 'createdAt'] },
  { collectionGroup: 'aiTaskSteps',             fields: ['taskId', 'stepNumber'] },
  { collectionGroup: 'aiGeneratedContent',      fields: ['status', 'subject', 'grade', 'createdAt'] },
  { collectionGroup: 'aiGeneratedContent',      fields: ['type', 'status', 'createdAt'] },
  { collectionGroup: 'aiSupervisorLogs',        fields: ['actionTaken', 'createdAt'] },
  { collectionGroup: 'curriculumUpdateReports', fields: ['status', 'checkedAt'] },
  { collectionGroup: 'assessmentStandards',     fields: ['grade', 'subject', 'assessmentType'] },
  { collectionGroup: 'learnerWeaknessProfiles', fields: ['learnerId', 'lastUpdated'] },
]
for (const want of requiredIndexShapes) {
  test(`composite index ${want.collectionGroup}:(${want.fields.join(', ')})`, () => {
    const match = indexes.indexes.find(idx =>
      idx.collectionGroup === want.collectionGroup &&
      idx.fields.length === want.fields.length &&
      idx.fields.every((f, i) => f.fieldPath === want.fields[i])
    )
    assert(match, `missing composite index ${want.collectionGroup}:(${want.fields.join(', ')})`)
  })
}

console.log('\nDispatcher uses v2 status enum')

const dispatcher = readFileSync(
  join(REPO, 'functions', 'agents', 'learnerAi', 'dispatcher.js'),
  'utf8',
)
const v2Constants = readFileSync(
  join(REPO, 'functions', 'agents', 'learnerAi', 'v2Collections.js'),
  'utf8',
)
for (const status of [
  'queued', 'running', 'thinking', 'generating', 'checking', 'waiting',
  'passed_quality_check', 'failed_quality_check',
  'needs_review', 'approved', 'published', 'rejected', 'regenerating', 'error',
]) {
  test(`v2Collections.js declares status '${status}'`, () => {
    assert(v2Constants.includes(`"${status}"`),
      `v2Collections.js does not reference status '${status}'`)
  })
}
test('dispatcher imports TASK_STATUS from v2Collections', () => {
  assert(dispatcher.includes('TASK_STATUS') && dispatcher.includes('./v2Collections'),
    'dispatcher must use the canonical TASK_STATUS enum')
})

console.log('\nZod schemas accept a happy-path doc for every collection')

const { COLLECTION_SCHEMAS, validateWrite, canTransitionTaskStatus } =
  await import('../src/schemas/learnerAi.js')

const now = new Date()
const happyPath = {
  aiAgentTasks: {
    taskType: 'practice_quiz', agentName: 'practiceQuiz', status: 'queued',
    grade: '7', subject: 'Mathematics', term: '1',
    topic: 'Fractions', subtopic: 'Adding fractions', lessonNumber: 1,
    assessmentType: null,
    startedAt: null, completedAt: null,
    resultContentId: null, errorMessage: null,
    createdAt: now, updatedAt: now,
  },
  aiAgentLogs: {
    taskId: 't1', agentName: 'practiceQuiz', action: 'generate',
    message: 'wrote artifact', taskType: 'practice_quiz',
    grade: '7', subject: 'Mathematics', topic: 'Fractions',
    severity: 'info', createdAt: now,
  },
  aiGeneratedContent: {
    type: 'practice_quiz', source: 'ai', status: 'needs_review',
    grade: '7', subject: 'Mathematics', term: '1',
    topic: 'Fractions', subtopic: 'Adding fractions', lessonNumber: 1,
    curriculumReference: {
      documentPath: 'syllabi/g7-math.pdf',
      competency: 'MATH-7-FR-A',
      learningOutcome: 'Add fractions with the same denominator',
      sourceVersion: 'cbc-kb-2026-04-seed',
    },
    content: { questions: [] },
    qualityCheck: {}, zambianStandardsCheck: {}, supervisorDecision: {},
    version: 1, createdBy: 'ai', reviewedBy: null,
    createdAt: now, updatedAt: now,
  },
  aiLiveAgentStates: {
    agentName: 'practiceQuiz', status: 'idle', currentTaskId: null,
    currentTask: null, progress: 0,
    grade: null, subject: null, term: null, topic: null, subtopic: null,
    lastMessage: null, updatedAt: now,
  },
  aiTaskSteps: {
    taskId: 't1', agentName: 'practiceQuiz', stepNumber: 1,
    stepTitle: 'Generate practice quiz', message: '', status: 'queued',
    progress: 0, createdAt: now,
  },
  aiAgentControls: {
    enabled: true, paused: false, pauseReason: null,
    updatedBy: 'admin-uid', updatedAt: now,
  },
  aiSupervisorLogs: {
    taskId: 't1', agentName: 'AI Supervisor Agent',
    contentType: 'practice_quiz',
    grade: '7', subject: 'Mathematics', term: '1',
    topic: 'Fractions', subtopic: 'Adding fractions',
    actionTaken: 'sent_for_review',
    reason: 'deterministic_grounding_passed', confidenceScore: 0.9,
    checkedBy: 'AI Supervisor Agent', createdAt: now,
  },
  curriculumUpdateReports: {
    sourceName: 'ZedExams', sourceUrl: 'https://example.zedexams.com',
    trustLevel: 'high', updateType: 'syllabus',
    affectedGrades: ['7'], affectedSubjects: ['Mathematics'],
    summary: 'stub', recommendation: 'noop',
    status: 'pending_review',
    checkedAt: now, reviewedBy: null, reviewedAt: null,
  },
  assessmentStandards: {
    country: 'Zambia', level: 'junior_secondary',
    grade: '7', subject: 'Mathematics',
    assessmentType: 'end_of_term_test',
    structure: {
      headerFields: ['School name', 'Date'],
      sections: [{ name: 'Section A' }],
      instructions: ['Answer all questions'],
      markDistribution: { sectionA: 50, sectionB: 50 },
      timeLimit: '120 minutes',
    },
    sourceReference: 'ECZ 2024 syllabus', approvedByAdmin: false,
    updatedAt: now,
  },
  learnerWeaknessProfiles: {
    learnerId: 'learner-1', grade: '7', subject: 'Mathematics',
    weakTopics: ['Fractions'], weakSubtopics: ['Adding fractions'],
    repeatedMistakes: [{ mistake: 'denominators' }],
    recommendedNotes: [], recommendedQuizzes: [],
    lastUpdated: now,
  },
}

for (const name of Object.keys(COLLECTION_SCHEMAS)) {
  test(`Zod ${name} happy-path validates`, () => {
    const parsed = validateWrite(name, happyPath[name])
    assert(parsed != null, 'validateWrite returned no result')
  })
}

console.log('\ncanTransitionTaskStatus accepts only legal transitions')
test('queued → running is legal', () => assert(canTransitionTaskStatus('queued', 'running')))
test('queued → published is illegal', () => assert(!canTransitionTaskStatus('queued', 'published')))
test('passed_quality_check → published is legal', () => assert(canTransitionTaskStatus('passed_quality_check', 'published')))
test('published → anything else is illegal', () => assert(!canTransitionTaskStatus('published', 'rejected')))

console.log('\naiAgentTasks.assessmentType is pinned to ASSESSMENT_TYPES')

const { aiAgentTaskWriteSchema, ASSESSMENT_TYPES, curriculumReaderOutputSchema } =
  await import('../src/schemas/learnerAi.js')

test('assessmentType=null is allowed', () => {
  const ok = aiAgentTaskWriteSchema.safeParse({
    ...happyPath.aiAgentTasks,
    assessmentType: null,
  })
  assert(ok.success, `assessmentType null must validate: ${ok.error && ok.error.message}`)
})
for (const t of ASSESSMENT_TYPES.options) {
  test(`assessmentType='${t}' is allowed`, () => {
    const ok = aiAgentTaskWriteSchema.safeParse({
      ...happyPath.aiAgentTasks,
      assessmentType: t,
    })
    assert(ok.success, `assessmentType=${t} must validate: ${ok.error && ok.error.message}`)
  })
}
test('assessmentType="nonsense" is rejected', () => {
  const bad = aiAgentTaskWriteSchema.safeParse({
    ...happyPath.aiAgentTasks,
    assessmentType: 'nonsense',
  })
  assert(!bad.success, 'invalid assessmentType must be rejected')
})

console.log('\ncurriculumReaderOutputSchema accepts the agent contract shape')

test('curriculumReaderOutputSchema happy-path validates', () => {
  const out = curriculumReaderOutputSchema.parse({
    grade: '7', subject: 'Mathematics', term: '1',
    topic: 'Fractions', subtopic: 'Adding fractions', lessonNumber: 2,
    assessmentType: 'topic_test',
    competencies: ['Solve fractional arithmetic'],
    learningOutcomes: ['Add fractions with same denominator'],
    keyConcepts: ['numerator', 'denominator'],
    suggestedContent: ['Fraction strips', 'Practice worksheet 7-2'],
    curriculumDocumentPath: 'syllabi/g7-math.pdf',
    curriculumVersion: 'cbc-kb-2026-04-seed',
    confidenceScore: 0.85,
    status: 'ok', matchKind: 'subtopic_exact',
    citedExcerpts: [{ text: 'Add fractions with like denominators.', anchor: 'content' }],
    sourceChecksums: [{ storagePath: 'syllabi/g7-math.pdf', sha256: 'abc' }],
    sourceDocId: 'g7-math', moduleId: 'mod-1',
  })
  assert(out.status === 'ok', 'status must be preserved')
  assert(out.confidenceScore === 0.85, 'confidenceScore must be preserved')
})
test('curriculumReaderOutputSchema rejects out-of-range confidence', () => {
  const bad = curriculumReaderOutputSchema.safeParse({
    grade: '7', subject: 'Mathematics', term: '1', topic: 'Fractions', subtopic: null,
    lessonNumber: null, assessmentType: null,
    competencies: [], learningOutcomes: [], keyConcepts: [], suggestedContent: [],
    curriculumDocumentPath: '', curriculumVersion: '',
    confidenceScore: 1.5,
    status: 'ok', matchKind: 'subtopic_exact',
    citedExcerpts: [], sourceChecksums: [], sourceDocId: '', moduleId: '',
  })
  assert(!bad.success, 'confidenceScore > 1 must be rejected')
})
test('curriculumReaderOutputSchema rejects unknown status', () => {
  const bad = curriculumReaderOutputSchema.safeParse({
    grade: '7', subject: 'Mathematics', term: '1', topic: 'Fractions', subtopic: null,
    lessonNumber: null, assessmentType: null,
    competencies: [], learningOutcomes: [], keyConcepts: [], suggestedContent: [],
    curriculumDocumentPath: '', curriculumVersion: '',
    confidenceScore: 0.5,
    status: 'unknown', matchKind: 'subtopic_exact',
    citedExcerpts: [], sourceChecksums: [], sourceDocId: '', moduleId: '',
  })
  assert(!bad.success, 'unknown status must be rejected')
})

setTimeout(() => {
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('\nfailures:')
    for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
    process.exit(1)
  }
}, 100)
