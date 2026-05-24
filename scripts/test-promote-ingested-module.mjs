#!/usr/bin/env node
/**
 * Unit tests for the pure helpers in
 * functions/teacherTools/promoteIngestedCurriculumModule.js.
 *
 * Covers:
 *   - slug(): lowercase + hyphenate + 60-char cap
 *   - buildTopicId(): must match the same shape adminCbcKbService.js
 *     and importCurriculumModules.js produce, so promoted topics
 *     attach to the same KB card the admin would create by hand.
 *   - serialiseModule(): timestamps become ISO strings, nullable
 *     fields become null instead of undefined, no Firestore types
 *     leak to the SPA.
 *
 * Run: npm run test:promote-ingested-module
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'functions/teacherTools/promoteIngestedCurriculumModule.js')

// Stub firebase-admin + the two cbcKnowledge imports the module pulls
// in at require time. We only want to exercise pure helpers; the
// callable handlers themselves are not invoked here.
const fakeAdmin = {firestore: () => ({})}
fakeAdmin.firestore.FieldValue = {serverTimestamp: () => '__ts__'}

const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === 'firebase-functions/v2/https') {
    return {
      onCall: (_opts, handler) => handler,
      HttpsError: class extends Error {
        constructor(code, message) { super(message); this.code = code }
      },
    }
  }
  if (request === '../aiService') return {getUserRole: async () => 'admin'}
  if (request === './cbcKnowledge') {
    return {
      getActiveKbVersion: async () => 'cbc-kb-2026-04-seed',
      invalidateKbCache: () => {},
    }
  }
  return origLoad.call(this, request, parent, ...rest)
}
const mod = await import(SRC)
Module._load = origLoad
const {slug, buildTopicId, serialiseModule} = mod._internals

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'expected equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
}

console.log('\nslug')

test('lowercases + hyphenates', () => {
  assertEq(slug('Grade 7 Mathematics'), 'grade-7-mathematics')
})
test('collapses repeated separators', () => {
  assertEq(slug('Hello___World---Foo'), 'hello-world-foo')
})
test('strips leading/trailing hyphens', () => {
  assertEq(slug('-trim-me-'), 'trim-me')
})
test('caps at 60 chars', () => {
  const s = slug('x'.repeat(120))
  assert(s.length === 60, `length ${s.length}`)
})
test('handles null/empty', () => {
  assertEq(slug(null), '')
  assertEq(slug(''), '')
  assertEq(slug(undefined), '')
})

console.log('\nbuildTopicId — must match adminCbcKbService.js + importCurriculumModules.js')

test('grade+subject+topic → "{grade}-{subject}-{topic}" slug', () => {
  assertEq(
    buildTopicId('Grade 7', 'Mathematics', 'Number Operations'),
    'grade-7-mathematics-number-operations',
  )
})
test('numeric grade is accepted', () => {
  assertEq(buildTopicId(5, 'english', 'Reading'), '5-english-reading')
})
test('missing piece → null', () => {
  assertEq(buildTopicId('', 'maths', 'topic'), null)
  assertEq(buildTopicId('G7', '', 'topic'), null)
  assertEq(buildTopicId('G7', 'maths', ''), null)
  assertEq(buildTopicId(null, null, null), null)
})

console.log('\nserialiseModule')

test('serialises timestamps to ISO strings', () => {
  const fakeTs = {toDate: () => new Date('2026-05-24T12:34:56Z')}
  const snap = {
    id: 'abc123',
    data: () => ({
      source: 'cdc-repository',
      sourceUrl: 'https://x/y.pdf',
      grade: 7,
      subject: 'mathematics',
      term: 2,
      topic: 'Number',
      confidence: 'high',
      chunkCount: 4,
      byteLength: 1024,
      importedAt: fakeTs,
      reviewStatus: 'needs_check',
      importedBy: 'curriculumWatcher',
    }),
  }
  const out = serialiseModule(snap)
  assertEq(out.curriculumId, 'abc123')
  assertEq(out.grade, 7)
  assertEq(out.subject, 'mathematics')
  assertEq(out.confidence, 'high')
  assertEq(out.importedAt, '2026-05-24T12:34:56.000Z')
  assertEq(out.rejectedAt, null) // absent in input
  assertEq(out.promotedToTopicId, null)
})

test('missing fields default to null/empty rather than undefined', () => {
  const snap = {id: 'empty', data: () => ({})}
  const out = serialiseModule(snap)
  assertEq(out.grade, null)
  assertEq(out.subject, null)
  assertEq(out.term, null)
  assertEq(out.topic, null)
  assertEq(out.confidence, 'low')
  assertEq(out.chunkCount, 0)
  assertEq(out.importedAt, null)
  // Iterate keys: nothing should be `undefined` — the SPA renders these.
  for (const [k, v] of Object.entries(out)) {
    assert(v !== undefined, `key ${k} must not be undefined`)
  }
})

test('handles a Firestore Timestamp on rejectedAt too', () => {
  const fakeTs = {toDate: () => new Date('2026-05-25T08:00:00Z')}
  const snap = {id: 'r', data: () => ({rejectedAt: fakeTs, rejectedReason: 'wrong subject'})}
  const out = serialiseModule(snap)
  assertEq(out.rejectedAt, '2026-05-25T08:00:00.000Z')
  assertEq(out.rejectedReason, 'wrong subject')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
