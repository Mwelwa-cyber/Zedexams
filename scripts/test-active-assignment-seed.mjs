#!/usr/bin/env node
/**
 * Tests for the shared active-assignment studio seed.
 * Run: npm run test:active-assignment-seed
 *
 * Covers the pure pieces: the assignment→seed projection, priority resolution,
 * and the localStorage round-trip (via a tiny in-memory window.localStorage).
 */
import {
  assignmentSelectorSeed,
  resolveStudioSeed,
  writeActiveAssignmentSeed,
  readActiveAssignmentSeed,
} from '../src/utils/activeAssignmentSeed.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }
function eq(a, b, m) { assert(a === b, `${m || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

// Minimal in-memory localStorage so the read/write helpers exercise real code.
function installFakeStorage() {
  const store = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)) },
      removeItem: (k) => { store.delete(k) },
    },
  }
  return store
}

console.log('\nassignmentSelectorSeed')
test('projects a CBC assignment to a server-ready seed', () => {
  const seed = assignmentSelectorSeed({ grade: 'G5', subject: 'mathematics', curriculumType: 'cbc' })
  eq(seed.curriculum, 'cbc')
  eq(seed.grade, 'G5')
  eq(seed.subject, 'mathematics')
})
test('maps previous-curriculum assignments to "previous"', () => {
  const seed = assignmentSelectorSeed({ grade: 'G8', subject: 'english', curriculumType: 'previous' })
  eq(seed.curriculum, 'previous')
})
test('unknown curriculum falls back to cbc', () => {
  eq(assignmentSelectorSeed({ grade: 'G5', curriculumType: 'zzz' }).curriculum, 'cbc')
})
test('null assignment → null', () => {
  eq(assignmentSelectorSeed(null), null)
})
test('assignment with neither grade nor subject → null', () => {
  eq(assignmentSelectorSeed({ curriculumType: 'cbc' }), null)
})
test('grade-only assignment still seeds', () => {
  const seed = assignmentSelectorSeed({ grade: 'G3', curriculumType: 'cbc' })
  eq(seed.grade, 'G3')
  eq(seed.subject, '')
})

console.log('\nresolveStudioSeed priority')
test('a URL deep-link wins over active + profile', () => {
  const seed = resolveStudioSeed({
    urlSeed: { grade: 'G7', subject: 'science', topic: 'Cells' },
    activeSeed: { grade: 'G5', subject: 'mathematics', curriculum: 'cbc' },
    profileSeed: { grade: 'G1', subject: 'english', curriculum: 'cbc' },
  })
  eq(seed.grade, 'G7')
  eq(seed.subject, 'science')
})
test('a URL seed carrying only a topic still wins', () => {
  const seed = resolveStudioSeed({
    urlSeed: { topic: 'Fractions' },
    activeSeed: { grade: 'G5', subject: 'mathematics', curriculum: 'cbc' },
  })
  eq(seed.topic, 'Fractions')
})
test('an empty URL seed falls through to the active assignment', () => {
  const seed = resolveStudioSeed({
    urlSeed: {},
    activeSeed: { grade: 'G5', subject: 'mathematics', curriculum: 'cbc' },
    profileSeed: { grade: 'G1', subject: 'english', curriculum: 'cbc' },
  })
  eq(seed.grade, 'G5')
  eq(seed.subject, 'mathematics')
})
test('no URL + no active falls through to the profile default', () => {
  const seed = resolveStudioSeed({
    urlSeed: null,
    activeSeed: null,
    profileSeed: { grade: 'G1', subject: 'english', curriculum: 'previous' },
  })
  eq(seed.grade, 'G1')
  eq(seed.curriculum, 'previous')
})
test('nothing available → null', () => {
  eq(resolveStudioSeed({}), null)
  eq(resolveStudioSeed(), null)
})
test('active seed with neither grade nor subject is skipped', () => {
  const seed = resolveStudioSeed({
    activeSeed: { curriculum: 'cbc' },
    profileSeed: { grade: 'G2', subject: 'english', curriculum: 'cbc' },
  })
  eq(seed.grade, 'G2')
})

console.log('\nwrite / read round-trip')
test('writes then reads back the active-assignment seed', () => {
  installFakeStorage()
  writeActiveAssignmentSeed('uid-1', { grade: 'G6', subject: 'mathematics', curriculumType: 'cbc' })
  const seed = readActiveAssignmentSeed('uid-1')
  eq(seed.grade, 'G6')
  eq(seed.subject, 'mathematics')
  eq(seed.curriculum, 'cbc')
})
test('a null assignment clears any stored seed', () => {
  installFakeStorage()
  writeActiveAssignmentSeed('uid-1', { grade: 'G6', subject: 'mathematics', curriculumType: 'cbc' })
  writeActiveAssignmentSeed('uid-1', null)
  eq(readActiveAssignmentSeed('uid-1'), null)
})
test('seeds are namespaced per uid', () => {
  installFakeStorage()
  writeActiveAssignmentSeed('uid-1', { grade: 'G6', subject: 'mathematics', curriculumType: 'cbc' })
  eq(readActiveAssignmentSeed('uid-2'), null)
})
test('read without a uid → null', () => {
  installFakeStorage()
  eq(readActiveAssignmentSeed(''), null)
})
test('read with no storage available → null (no throw)', () => {
  globalThis.window = undefined
  eq(readActiveAssignmentSeed('uid-1'), null)
})
test('write with no storage available is a no-op (no throw)', () => {
  globalThis.window = undefined
  writeActiveAssignmentSeed('uid-1', { grade: 'G6', subject: 'mathematics', curriculumType: 'cbc' })
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { console.log('\nfailures:'); failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`)); process.exit(1) }
