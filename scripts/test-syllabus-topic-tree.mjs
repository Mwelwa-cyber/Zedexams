/**
 * Topic-hierarchy tests — src/utils/syllabusTopicTree.js and its CommonJS
 * server mirror functions/teacherTools/syllabusTopicTree.js.
 *
 * Two jobs:
 *   1. pin the behaviour (sub-topics stop masquerading as topics; nothing is
 *      lost; an already-clean catalogue is untouched);
 *   2. prove the client and server copies agree, because the picker offers the
 *      teacher a topic list while resolveCbcContext grounds the generator on
 *      the same hierarchy — divergence means a teacher picks a topic the AI's
 *      curriculum module has never heard of.
 *
 * Run: node scripts/test-syllabus-topic-tree.mjs
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  parseTopicCode, looksLikeTopicFragment, normalizeTopicTree, normalizeTopicLookup,
} from '../src/utils/syllabusTopicTree.js'

const require = createRequire(import.meta.url)
const server = require('../functions/teacherTools/syllabusTopicTree.js')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

const asObject = (map) => {
  const out = {}
  for (const [k, v] of map) out[k] = Array.from(v).sort()
  return out
}

/* ── parseTopicCode ─────────────────────────────────────────────────────── */

test('parses a topic code and splits off its title', () => {
  const p = parseTopicCode('7.4.0 Plants and Animals')
  assert.equal(p.code, '7.4.0')
  assert.equal(p.title, 'Plants and Animals')
  // Trailing zeros are stripped, so "7.4.0" and the prefix "7.4" are one node.
  assert.equal(p.key, '7.4')
  assert.equal(p.parentKey, '7')
})

test('a sub-topic code points at its parent topic', () => {
  assert.equal(parseTopicCode('7.4.3 Fruits and seeds').parentKey, '7.4')
  assert.equal(parseTopicCode('7.4.0 Plants and Animals').key, '7.4')
})

test('a two-segment code (the 2023 catalogue) has no parent among topics', () => {
  const p = parseTopicCode('4.4 PLANT AND ANIMALS')
  assert.equal(p.key, '4.4')
  assert.equal(p.parentKey, '4')
})

test('repairs a code whose own dots were spaced apart', () => {
  // "11. 10 Food allergies" is topic 11.10 — NOT topic 11 titled "10 Food
  // allergies", which would invent a phantom parent that adopts every 11.x
  // topic on the sheet.
  const p = parseTopicCode('11. 10 Food allergies')
  assert.equal(p.key, '11.10')
  assert.equal(p.title, 'Food allergies')
})

test('an un-numbered label has no code', () => {
  assert.equal(parseTopicCode('READING'), null)
  assert.equal(parseTopicCode(''), null)
  assert.equal(parseTopicCode(null), null)
})

/* ── looksLikeTopicFragment ─────────────────────────────────────────────── */

test('recognises page-break prose scraps as fragments', () => {
  assert.equal(looksLikeTopicFragment('and Non-metals'), true)
  assert.equal(looksLikeTopicFragment('food. 7.2.2.3 State the importance of fruits'), true)
})

test('never calls a real heading a fragment', () => {
  assert.equal(looksLikeTopicFragment('READING'), false)
  assert.equal(looksLikeTopicFragment('Number and Notation'), false)
  assert.equal(looksLikeTopicFragment('7.4.0 Plants and Animals'), false)
  // A real Grade 10 English topic whose code does not parse (the "3-4" form
  // span). It carries an outcome-shaped code but no prose before it, so it is
  // a heading — dropping it would silently lose the topic.
  assert.equal(looksLikeTopicFragment('3-4.1.1. SELECTED PRESCRIBED TEXT'), false)
})

/* ── normalizeTopicTree ─────────────────────────────────────────────────── */

// The exact Grade 7 Integrated Science shape reported from the Studio.
const GRADE_7_SCIENCE = new Map([
  ['7.4.0 Plants and Animals', new Set(['7.4.1 The flower', '7.4.2 Pollination'])],
  ['7.4.3 Fruits and seeds', new Set(['Why plants produce seeds'])],
  ['7.4.4 Seed dispersal', new Set(['Ways seeds are dispersed'])],
  ['7.4.5 Propagation', new Set(['Methods of plant propagation'])],
])

test('sub-topics stop masquerading as topics', () => {
  const { topics } = normalizeTopicTree(GRADE_7_SCIENCE)
  assert.deepEqual([...topics.keys()], ['7.4.0 Plants and Animals'])
})

test('a demoted topic becomes a sub-topic — nothing is lost', () => {
  const { topics, demoted } = normalizeTopicTree(GRADE_7_SCIENCE)
  const subs = topics.get('7.4.0 Plants and Animals')
  for (const heading of ['7.4.3 Fruits and seeds', '7.4.4 Seed dispersal', '7.4.5 Propagation']) {
    assert.ok(subs.has(heading), `${heading} should survive as a sub-topic`)
  }
  // …and so do the sub-topics that hung off it.
  assert.ok(subs.has('Why plants produce seeds'))
  assert.ok(subs.has('7.4.1 The flower'))
  assert.equal(demoted.length, 3)
})

test('the picker gains sub-topics it previously had none of', () => {
  const before = GRADE_7_SCIENCE.get('7.4.3 Fruits and seeds').size
  const { topics } = normalizeTopicTree(GRADE_7_SCIENCE)
  // Before: picking "Plants and Animals" offered 2 sub-topics and the other
  // three headings sat beside it as topics. After: one topic carrying all 8 —
  // its own 2, the 3 demoted headings, and the 3 sub-topics they held.
  assert.equal(before, 1)
  assert.equal(topics.get('7.4.0 Plants and Animals').size, 8)
})

test('a prose fragment folds back into the topic it was split from', () => {
  const input = new Map([
    ['7.2.0 Health', new Set(['7.2.1 Diseases'])],
    ['food. 7.2.2.3 State the importance of fruits', new Set(['Seeds used as food'])],
    ['7.3.0 The Environment', new Set(['7.3.1 Separating substances'])],
  ])
  const { topics, folded } = normalizeTopicTree(input)
  assert.deepEqual([...topics.keys()], ['7.2.0 Health', '7.3.0 The Environment'])
  assert.ok(topics.get('7.2.0 Health').has('Seeds used as food'))
  assert.equal(folded.length, 1)
})

test('an already-clean two-level catalogue is untouched', () => {
  // The 2023 shape: "4.4 …" has parent "4", which is not a topic, so every
  // entry stays a topic and its sub-topics stay put.
  const input = new Map([
    ['4.1 THE HUMAN BODY', new Set(['The skeleton', 'Joints'])],
    ['4.4 PLANT AND ANIMALS', new Set(['Flowers'])],
  ])
  const { topics, demoted, folded } = normalizeTopicTree(input)
  assert.deepEqual(asObject(topics), asObject(input))
  assert.equal(demoted.length, 0)
  assert.equal(folded.length, 0)
})

test('an un-numbered sheet never collapses into its first entry', () => {
  // ECE / Lower Primary strand sheets carry no codes at all. Fragment folding
  // must not run there, or every strand would be swallowed by the first one.
  const input = new Map([
    ['READING', new Set(['Phonics'])],
    ['WRITING', new Set(['Letter formation'])],
    ['listening and speaking', new Set(['Rhymes'])],
  ])
  const { topics } = normalizeTopicTree(input)
  assert.equal(topics.size, 3)
})

test('a three-deep leak lands on the real topic, not on another leaked one', () => {
  const input = new Map([
    ['5.1.0 Matter', new Set([])],
    ['5.1.2 States of matter', new Set([])],
    ['5.1.2.4 Evaporation', new Set(['Drying clothes'])],
  ])
  const { topics } = normalizeTopicTree(input)
  assert.deepEqual([...topics.keys()], ['5.1.0 Matter'])
  assert.ok(topics.get('5.1.0 Matter').has('5.1.2.4 Evaporation'))
  assert.ok(topics.get('5.1.0 Matter').has('Drying clothes'))
})

test('a spaced code no longer adopts its siblings', () => {
  // The Grade 11 Home Economics regression: "11. 10 Food allergies" once
  // parsed as topic "11" and swallowed all 18 of its siblings.
  const input = new Map([
    ['11.1 Preparation and methods of cooking food', new Set(['Boiling'])],
    ['11.2 Cooking different types of food.', new Set(['Cereals'])],
    ['11. 10 Food allergies', new Set(['Common allergens'])],
  ])
  const { topics } = normalizeTopicTree(input)
  assert.equal(topics.size, 3)
})

test('normalizeTopicLookup walks every grade+subject key', () => {
  const lookup = new Map([
    ['G7|integrated_science', GRADE_7_SCIENCE],
    ['G4|english', new Map([['Reading', new Set(['Comprehension'])]])],
  ])
  const out = normalizeTopicLookup(lookup)
  assert.equal(out.get('G7|integrated_science').size, 1)
  assert.equal(out.get('G4|english').size, 1)
  // A fresh outer Map — the caller's lookup is never mutated.
  assert.notEqual(out, lookup)
  assert.equal(lookup.get('G7|integrated_science').size, 4)
})

/* ── client / server mirror ─────────────────────────────────────────────── */

const MIRROR_FIXTURES = [
  GRADE_7_SCIENCE,
  new Map([
    ['4.1 THE HUMAN BODY', new Set(['The skeleton'])],
    ['4.4 PLANT AND ANIMALS', new Set(['Flowers'])],
  ]),
  new Map([
    ['7.2.0 Health', new Set(['7.2.1 Diseases'])],
    ['food. 7.2.2.3 State the importance of fruits', new Set(['Seeds used as food'])],
    ['and Non-metals', new Set([])],
  ]),
  new Map([
    ['READING', new Set(['Phonics'])],
    ['listening and speaking', new Set(['Rhymes'])],
  ]),
  new Map([
    ['11.1 Preparation and methods of cooking food', new Set(['Boiling'])],
    ['11. 10 Food allergies', new Set(['Common allergens'])],
  ]),
  new Map(),
]

test('the server mirror produces identical trees', () => {
  for (const fixture of MIRROR_FIXTURES) {
    const mine = normalizeTopicTree(fixture)
    const theirs = server.normalizeTopicTree(fixture)
    assert.deepEqual(asObject(theirs.topics), asObject(mine.topics))
    assert.deepEqual(theirs.demoted, mine.demoted)
    assert.deepEqual(theirs.folded, mine.folded)
  }
})

test('the server mirror parses codes identically', () => {
  const labels = [
    '7.4.0 Plants and Animals', '7.4.3 Fruits and seeds', '4.4 PLANT AND ANIMALS',
    '11. 10 Food allergies', 'READING', '', '1) Introduction', '12.5.4 The rise',
  ]
  for (const label of labels) {
    assert.deepEqual(server.parseTopicCode(label), parseTopicCode(label), label)
    assert.equal(server.looksLikeTopicFragment(label), looksLikeTopicFragment(label), label)
  }
})

console.log(`✓ syllabus topic tree — ${passed} tests passed`)
