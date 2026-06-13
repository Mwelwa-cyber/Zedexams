#!/usr/bin/env node
/**
 * Regression test for the Lesson Plan Studio curated-topics lookup
 * (public/studio/02b-curriculum-topics.js).
 *
 * Bug it guards against: curriculumTopics was keyed by grade ONLY, so Grade 4
 * Science topics ("The Human Body", "Plants") were injected into the generator
 * prompt for EVERY Grade 4 subject. The model then rejected valid topics like
 * "Prepositions" for Grade 4 English, claiming the official English topics were
 * Human Body + Plants. curatedTopicsFor(grade, subject) must be subject-scoped.
 *
 * Run: npm run test:studio-topics
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'studio', '02b-curriculum-topics.js'),
  'utf8',
)

// The studio files are plain browser scripts that attach to `window`. Eval the
// source against a stub window and read the exposed lookup back off it.
const win = {}
// eslint-disable-next-line no-new-func
new Function('window', src)(win)

const curatedTopicsFor = win.curatedTopicsFor

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

test('exposes a curatedTopicsFor function', () => {
  assert(typeof curatedTopicsFor === 'function', 'curatedTopicsFor not exposed on window')
})

test('Grade 4 Integrated Science returns the science topics', () => {
  const t = curatedTopicsFor('Grade 4', 'Integrated Science')
  assert(Object.keys(t).length === 2, `expected 2 topics, got ${Object.keys(t).length}`)
  assert(Array.isArray(t['The Human Body']), 'missing The Human Body')
  assert(t['Plants'].includes('Parts of a plant'), 'missing Plants subtopics')
})

test('Grade 4 English Language is NOT poisoned by science topics', () => {
  const t = curatedTopicsFor('Grade 4', 'English Language')
  assert(Object.keys(t).length === 0, `expected no curated topics for English, got ${JSON.stringify(Object.keys(t))}`)
  assert(!('The Human Body' in t), 'English must never inherit Science topics')
})

test('subject match is case/punctuation tolerant', () => {
  const t = curatedTopicsFor('Grade 4', 'integrated   science')
  assert('The Human Body' in t, 'normalised subject lookup failed')
})

test('"(Learning Area)" suffix is stripped before matching', () => {
  const t = curatedTopicsFor('Grade 4', 'Integrated Science (Learning Area)')
  assert('The Human Body' in t, 'Learning Area suffix not stripped')
})

test('missing grade returns empty object', () => {
  const t = curatedTopicsFor('Grade 9', 'Integrated Science')
  assert(Object.keys(t).length === 0, 'unknown grade should be empty')
})

test('missing subject argument returns empty object (no grade-only leak)', () => {
  const t = curatedTopicsFor('Grade 4', '')
  assert(Object.keys(t).length === 0, 'empty subject must not return a grade dump')
})

test('Grade 5 Integrated Science returns Matter', () => {
  const t = curatedTopicsFor('Grade 5', 'Integrated Science')
  assert('Matter' in t, 'missing Grade 5 Matter topic')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
