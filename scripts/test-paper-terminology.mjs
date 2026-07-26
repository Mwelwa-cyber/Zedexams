/**
 * The server's copy of the paper vocabulary must match the canonical config,
 * and must render the same wording (§4.1).
 *
 * functions/ cannot import from src/, so the vocabulary crosses as generated
 * JSON. Two things can go wrong with that arrangement, and both are silent:
 *
 *  1. Someone edits src/config/paperTerminology.js and forgets to re-sync, so
 *     the generator keeps being told the old word while the studio shows the
 *     new one.
 *  2. The server's directive builder drifts from the client's, so the prompt
 *     and any client-side check disagree about what a level may say.
 *
 * The first is caught by comparing bytes. The second by rendering the SAME
 * directive on both sides and comparing the text — which is the only comparison
 * that means anything, since the two are separate implementations by necessity.
 *
 * Run: node scripts/test-paper-terminology.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  PAPER_TERMS, INSTRUCTION_REGISTER, FORBIDDEN_ON_PAPER, CURRICULA,
  buildTerminologyDirective, findForbiddenTerms, termFor, normalizeCurriculum,
  advancedTermsForLevel, findAdvancedTerms, isKnownCurriculum, DEFAULT_CURRICULUM,
} from '../src/config/paperTerminology.js'
import { renderTerminologyJson, TERMINOLOGY_JSON_PATH } from './sync-paper-terminology.mjs'

const require = createRequire(import.meta.url)
const server = require('../functions/teacherTools/paperTerminology.js')

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

console.log('\n— the generated copy is current —')

test('functions/data/paperTerminology.json matches the config', () => {
  const onDisk = readFileSync(TERMINOLOGY_JSON_PATH, 'utf8')
  assert.equal(
    onDisk, renderTerminologyJson(),
    'stale — run `npm run sync:paper-terminology` after editing src/config/paperTerminology.js',
  )
})

test('the server sees every term the config declares', () => {
  for (const [topic, group] of Object.entries(PAPER_TERMS)) {
    for (const key of Object.keys(group)) {
      for (const curriculum of CURRICULA) {
        assert.equal(
          server.termFor(topic, key, curriculum), termFor(topic, key, curriculum),
          `${topic}.${key} (${curriculum})`,
        )
      }
    }
  }
})

test('the server forbids exactly the same internal terms', () => {
  assert.deepEqual(server.FORBIDDEN_ON_PAPER, FORBIDDEN_ON_PAPER)
  assert.deepEqual(server.CURRICULA, CURRICULA)
})

console.log('\n— both sides render the same directive —')

test('every level and curriculum produces identical wording', () => {
  // The comparison that matters: two implementations, one output. If they can
  // diverge, the prompt and the studio disagree about what a paper may say.
  for (const formality of Object.keys(INSTRUCTION_REGISTER)) {
    for (const curriculum of CURRICULA) {
      for (const subject of ['Mathematics', 'English', '']) {
        const args = { formality, curriculum, subject }
        assert.equal(
          server.buildTerminologyDirective(args),
          buildTerminologyDirective(args),
          `${formality} / ${curriculum} / ${subject || '(no subject)'}`,
        )
      }
    }
  }
})

test('an unknown level and curriculum fall back the same way on both sides', () => {
  const args = { formality: 'made-up', curriculum: 'martian', subject: 'Mathematics' }
  assert.equal(server.buildTerminologyDirective(args), buildTerminologyDirective(args))
  assert.equal(server.normalizeCurriculum('martian'), 'cbc')
})

test('EVERY spelling resolves identically — including the one the caller passes', () => {
  // This test is here because its absence hid a live bug. The parity checks only
  // exercised 'cbc'/'obc', while generateAssessment passes inputs.framework — the
  // YEAR. The server did not know the aliases, so a '2013' paper fell through to
  // the CBC default and was told to say "regroup" to a teacher who marks with
  // "borrow". Covering only the canonical values tested the boundary we control
  // instead of the one the caller uses.
  // Numeric values included: a callable payload or a JSON round trip can deliver
  // the framework year as a number, and only one side coercing would diverge.
  for (const spelling of [
    'cbc', 'obc', 'CBC', 'OBC', 'previous', '2013', '2023', 2013, 2023, '', null, 'martian',
  ]) {
    assert.equal(
      server.normalizeCurriculum(spelling), normalizeCurriculum(spelling),
      `normalizeCurriculum(${JSON.stringify(spelling)})`,
    )
    const args = { formality: 'standard', curriculum: spelling, subject: 'Mathematics' }
    assert.equal(
      server.buildTerminologyDirective(args), buildTerminologyDirective(args),
      `directive for ${JSON.stringify(spelling)}`,
    )
  }
  // And the consequence, stated directly: the framework year picks the word.
  assert.match(server.buildTerminologyDirective({ formality: 'standard', curriculum: '2013', subject: 'Mathematics' }), /borrow/)
  assert.match(server.buildTerminologyDirective({ formality: 'standard', curriculum: 2013, subject: 'Mathematics' }), /borrow/)
  assert.match(server.buildTerminologyDirective({ formality: 'standard', curriculum: '2023', subject: 'Mathematics' }), /regroup/)
})

test('both sides agree on which values were RECOGNISED, not just what they became', () => {
  // Two normalisers that agree on the output but disagree on whether it was a
  // fallback would report a drifted paper as a correct one.
  assert.equal(server.DEFAULT_CURRICULUM, DEFAULT_CURRICULUM)
  for (const v of ['cbc', 'obc', '2013', '2023', 2013, 'previous', 'nonsense', '', null]) {
    assert.equal(
      server.isKnownCurriculum(v), isKnownCurriculum(v),
      `isKnownCurriculum(${JSON.stringify(v)})`,
    )
  }
})

test('the leak detector agrees on both sides', () => {
  const samples = [
    'Simplify 6/8 and show your working.',
    'The raster fallback for this LaTeX diagram failed.',
    'an svg figure',
    'The Latvian flag',
    '',
  ]
  for (const sample of samples) {
    assert.deepEqual(
      server.findForbiddenTerms(sample), findForbiddenTerms(sample),
      JSON.stringify(sample),
    )
  }
})

test('both sides agree on what wording is too advanced for a level', () => {
  // The safeguard has to hold on the server, because that is where generated
  // text is checked. A client/server disagreement here would mean the studio
  // showing a paper as clean that the generator flagged, or the reverse.
  for (const formality of Object.keys(INSTRUCTION_REGISTER)) {
    for (const curriculum of CURRICULA) {
      assert.deepEqual(
        server.advancedTermsForLevel(formality, curriculum),
        advancedTermsForLevel(formality, curriculum),
        `${formality} / ${curriculum}`,
      )
    }
  }
  const samples = [
    'Add fractions with the same denominator',
    'Circle the red ones.',
    'You may borrow a pencil.',
    'Regroup the tens.',
  ]
  for (const sample of samples) {
    for (const formality of ['spoken', 'simple', 'standard']) {
      for (const curriculum of CURRICULA) {
        assert.deepEqual(
          server.findAdvancedTerms(sample, formality, curriculum),
          findAdvancedTerms(sample, formality, curriculum),
          `${JSON.stringify(sample)} @ ${formality}/${curriculum}`,
        )
      }
    }
  }
})

console.log(`\n✓ paper terminology mirror — ${passed} tests passed`)