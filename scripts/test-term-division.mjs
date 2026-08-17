#!/usr/bin/env node
/**
 * scripts/test-term-division.mjs
 *
 * Dividing a subject's syllabus across Term 1/2/3. The claims worth pinning:
 *
 *   • Nothing is invented. Every row the learner sees is a title already in
 *     the catalogue — the module divides, it does not author.
 *   • Nothing is lost or repeated. The three terms are consecutive slices of
 *     the published order, so concatenating them reproduces the catalogue
 *     exactly.
 *   • The unit of division is the SUB-TOPIC, so a wide topic takes a wider
 *     share of the year without anyone scoring topics by hand.
 *   • No term is ever empty, and the three tabs are never identical — that
 *     was the bug this exists to fix.
 */

import assert from 'node:assert/strict'
import {
  TERMS, buildTermUnits, divideUnits, deriveTermPlan, topicTagLabel,
} from '../src/config/termDivision.js'
import { TOPICS, getTopics, getSubtopics } from '../src/config/curriculum.js'
import { getTermPlan } from '../src/config/gradeTermPlan.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`) }

/** Every subject+grade the learner catalogue publishes. */
const CATALOGUE = Object.keys(TOPICS).flatMap((subjectId) =>
  Object.keys(TOPICS[subjectId]).map((g) => ({ subjectId, grade: Number(g) })))

const subsOf = (subjectId, grade) => (topic) => getSubtopics(subjectId, grade, topic) || []

// ── the unit list ───────────────────────────────────────────────────

test('a topic with sub-topics contributes one unit per sub-topic', () => {
  const units = buildTermUnits(
    ['Unit 1: Fractions', 'Unit 9: Inequalities'],
    (t) => (t === 'Unit 1: Fractions' ? ['Addition', 'Subtraction', 'Division'] : ['Open Sentence']),
  )
  assert.deepEqual(units.map((u) => u.title),
    ['Addition', 'Subtraction', 'Division', 'Open Sentence'])
  // The parent travels with the unit — it is the strand tag on the row, and
  // the boundary the split prefers to cut on.
  assert.deepEqual(units.map((u) => u.parent),
    ['Unit 1: Fractions', 'Unit 1: Fractions', 'Unit 1: Fractions', 'Unit 9: Inequalities'])
  assert.deepEqual(units.map((u) => u.parentIndex), [0, 0, 0, 1])
})

test('a topic with no sub-topics stands as one unit, with no parent', () => {
  const units = buildTermUnits(['Debate', 'Reading Aloud'], () => [])
  assert.deepEqual(units, [
    { title: 'Debate', parent: null, parentIndex: 0 },
    { title: 'Reading Aloud', parent: null, parentIndex: 1 },
  ])
})

test('blank and junk entries are dropped rather than rendered as empty rows', () => {
  const units = buildTermUnits(['Real', '', null, '   '], (t) => (t === 'Real' ? ['A', '', null] : []))
  assert.deepEqual(units.map((u) => u.title), ['A'])
  assert.deepEqual(buildTermUnits(null, null), [])
  assert.deepEqual(buildTermUnits(['A'], 'not a function').map((u) => u.title), ['A'])
})

// ── the division ────────────────────────────────────────────────────

test('the three terms are consecutive slices — nothing lost, nothing repeated', () => {
  for (const { subjectId, grade } of CATALOGUE) {
    const units = buildTermUnits(getTopics(subjectId, grade) || [], subsOf(subjectId, grade))
    const byTerm = divideUnits(units)
    assert.ok(byTerm, `${subjectId} G${grade}: expected a division`)
    const rejoined = TERMS.flatMap((t) => byTerm[t])
    assert.deepEqual(rejoined.map((u) => u.title), units.map((u) => u.title),
      `${subjectId} G${grade}: the terms do not rejoin into the syllabus`)
  }
})

test('no term is ever empty, and no two terms are identical', () => {
  for (const { subjectId, grade } of CATALOGUE) {
    const byTerm = divideUnits(buildTermUnits(getTopics(subjectId, grade) || [], subsOf(subjectId, grade)))
    for (const t of TERMS) {
      assert.ok(byTerm[t].length > 0, `${subjectId} G${grade}: term ${t} is empty`)
    }
    // The original bug: three tabs showing the same list.
    const seen = TERMS.map((t) => byTerm[t].map((u) => u.title).join('|'))
    assert.equal(new Set(seen).size, 3, `${subjectId} G${grade}: terms are not distinct`)
  }
})

test('each term gets roughly a third — no term is double another', () => {
  for (const { subjectId, grade } of CATALOGUE) {
    const byTerm = divideUnits(buildTermUnits(getTopics(subjectId, grade) || [], subsOf(subjectId, grade)))
    const sizes = TERMS.map((t) => byTerm[t].length)
    const total = sizes.reduce((a, b) => a + b, 0)
    const share = total / 3
    for (const size of sizes) {
      // A term may drift to land on a topic boundary; it may not drift so far
      // that one term carries the year and another carries a fortnight.
      assert.ok(size >= share * 0.5 && size <= share * 1.6,
        `${subjectId} G${grade}: lopsided split ${sizes.join('/')}`)
    }
  }
})

test('a catalogue too small to divide returns null rather than an empty term', () => {
  assert.equal(divideUnits(buildTermUnits(['Only', 'Two'], () => [])), null)
  assert.equal(divideUnits([]), null)
  assert.equal(divideUnits(null), null)
  assert.equal(deriveTermPlan(['Only', 'Two'], () => []), null)
  // Exactly three is the smallest catalogue that can fill three terms.
  const three = divideUnits(buildTermUnits(['A', 'B', 'C'], () => []))
  assert.deepEqual(TERMS.map((t) => three[t].map((u) => u.title)), [['A'], ['B'], ['C']])
  // …including three sub-topics of ONE topic, where the only topic boundaries
  // are the two ends of the list. Snapping to either would empty a term.
  const single = divideUnits(buildTermUnits(['Solo'], () => ['s1', 's2', 's3']))
  assert.deepEqual(TERMS.map((t) => single[t].map((u) => u.title)), [['s1'], ['s2'], ['s3']])
})

// ── width, and cutting on a topic boundary ──────────────────────────

test('a wide topic takes a wider share of the year', () => {
  // Two topics of one sub-topic each, then one topic of six. Dividing by
  // TOPIC would give the wide one a third of the year; dividing by sub-topic
  // gives it three quarters, which is what its breadth actually is.
  const topics = ['Narrow A', 'Narrow B', 'Wide']
  const subs = (t) => (t === 'Wide' ? ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'] : [])
  const byTerm = divideUnits(buildTermUnits(topics, subs))
  const wideUnits = TERMS.flatMap((t) => byTerm[t]).filter((u) => u.parent === 'Wide')
  assert.equal(wideUnits.length, 6)
  // It spans more than one term — a topic wider than a term's share is cut,
  // not crammed.
  const termsTouched = TERMS.filter((t) => byTerm[t].some((u) => u.parent === 'Wide'))
  assert.ok(termsTouched.length >= 2, 'a topic wider than a term should span terms')
})

test('a cut moves to a nearby topic boundary rather than splitting a topic', () => {
  // 9 units, ideal cuts at 3 and 6. Topic boundaries sit at 4 and 7 — one
  // step away — so both cuts snap and every topic stays whole.
  const topics = ['A', 'B', 'C']
  const subs = (t) => ({ A: ['a1', 'a2', 'a3', 'a4'], B: ['b1', 'b2', 'b3'], C: ['c1', 'c2'] }[t])
  const byTerm = divideUnits(buildTermUnits(topics, subs))
  assert.deepEqual(TERMS.map((t) => byTerm[t].map((u) => u.title)), [
    ['a1', 'a2', 'a3', 'a4'], ['b1', 'b2', 'b3'], ['c1', 'c2'],
  ])
})

test('the split does not snap to a boundary that would empty a term', () => {
  // One huge topic then two single-unit ones: the only boundaries are late in
  // the list. Terms 1 and 2 cut inside the big topic rather than collapsing.
  const subs = (t) => (t === 'Huge' ? Array.from({ length: 12 }, (_, i) => `h${i + 1}`) : [])
  const byTerm = divideUnits(buildTermUnits(['Huge', 'Small A', 'Small B'], subs))
  for (const t of TERMS) assert.ok(byTerm[t].length > 0, `term ${t} emptied`)
  assert.equal(TERMS.reduce((n, t) => n + byTerm[t].length, 0), 14)
})

// ── the rows the learner sees ───────────────────────────────────────

test('every derived row is a title the catalogue already publishes', () => {
  for (const { subjectId, grade } of CATALOGUE) {
    const topics = getTopics(subjectId, grade) || []
    const known = new Set(topics.flatMap((t) => {
      const s = getSubtopics(subjectId, grade, t) || []
      return s.length ? s : [t]
    }))
    for (const row of deriveTermPlan(topics, subsOf(subjectId, grade))) {
      assert.ok(known.has(row.title),
        `${subjectId} G${grade}: "${row.title}" is not in the catalogue`)
      assert.ok(TERMS.includes(row.term), `${subjectId} G${grade}: bad term ${row.term}`)
      assert.ok(['speak', 'read', 'write', 'struct'].includes(row.tone),
        `${subjectId} G${grade}: unknown tone ${row.tone}`)
    }
  }
})

test('rows carry no icon — the screen falls back to the subject icon', () => {
  // Deliberate: an emoji per sub-topic would be decoration presented as
  // curriculum, 75 of them for Grade 7 Mathematics alone.
  for (const row of deriveTermPlan(getTopics('mathematics', 7), subsOf('mathematics', 7))) {
    assert.equal(row.icon, undefined)
  }
})

test('the strand tag names the parent topic, without its numbering', () => {
  const rows = deriveTermPlan(getTopics('mathematics', 7), subsOf('mathematics', 7))
  const addition = rows.find((r) => r.title === 'Operations on Fractions')
  assert.equal(addition.strand, 'Fractions', 'expected "Unit 1: Fractions" to tag as "Fractions"')
  // A row that IS a topic has no parent to name, so it shows no tag.
  const english = deriveTermPlan(getTopics('english', 7), subsOf('english', 7))
  assert.ok(english.every((r) => r.strand === null))
})

test('topicTagLabel strips numbering but never returns nothing', () => {
  assert.equal(topicTagLabel('Unit 1: Fractions'), 'Fractions')
  assert.equal(topicTagLabel('Unit 12: Solid Shapes'), 'Solid Shapes')
  assert.equal(topicTagLabel('7.1 The Human Body'), 'The Human Body')
  assert.equal(topicTagLabel('Topic 3 - Energy'), 'Energy')
  assert.equal(topicTagLabel('Health'), 'Health')
  // A title that is only a number keeps it rather than rendering an empty pill.
  assert.equal(topicTagLabel('7.1'), '7.1')
  assert.equal(topicTagLabel(''), '')
  assert.equal(topicTagLabel(null), '')
})

// ── the whole learner catalogue ─────────────────────────────────────

test('every subject at every grade now has three real terms', () => {
  for (const { subjectId, grade } of CATALOGUE) {
    const plan = getTermPlan(subjectId, grade)
      || deriveTermPlan(getTopics(subjectId, grade) || [], subsOf(subjectId, grade))
    assert.ok(plan, `${subjectId} G${grade} has no term plan at all`)
    for (const t of TERMS) {
      assert.ok(plan.some((r) => r.term === t), `${subjectId} G${grade}: term ${t} is empty`)
    }
  }
})

test('an authored plan is never replaced by a derived one', () => {
  // The page prefers gradeTermPlan; these two must keep their owner-written
  // allocation, icons and strands.
  for (const id of ['english', 'science']) {
    const authored = getTermPlan(id, 7)
    assert.ok(authored && authored.every((r) => r.icon), `${id}: authored rows lost their icons`)
  }
})

console.log(`\n${passed} term-division tests passed`)
