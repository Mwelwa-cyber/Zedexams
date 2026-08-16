#!/usr/bin/env node
/**
 * A saved lesson plan carries its term into the library.
 *
 * The bug this pins: LessonPlanStudio stamped the term onto `inputs` and left
 * it off the `classification` object written directly beneath it. Only
 * `classification` reaches classifyForLibrary, so the term arrived undefined
 * and EVERY lesson plan — not only the ones missing a grade — filed under
 * Unsorted at the term level. The two objects sat four lines apart and looked
 * consistent, which is why this went unnoticed.
 *
 * Two halves, because neither alone catches it:
 *
 *   • a SOURCE check that every classification object the studio builds carries
 *     a term. The save sites are closures inside a 1400-line page component
 *     reading studio state that a unit test cannot assemble, so there is no
 *     honest behavioural way to reach them — and a source check is exactly what
 *     fails when someone adds a third save path and copies the old shape.
 *   • a BEHAVIOUR check that a term shaped the way the studio sends it (a bare
 *     numeric string, from meta.planned.termNumber) actually reaches a folder.
 *     Without this the source check would pass on a term the library drops.
 *
 * Run: npm run test:lesson-plan-term
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { classifyForLibrary, resolveTerm } from '../../../utils/libraryClassification.js'
import { LIBRARY_TYPES } from '../../../config/library.js'

const here = dirname(fileURLToPath(import.meta.url))
const STUDIO = resolve(here, '../pages/LessonPlanStudio.jsx')

/**
 * Every `classification: { … }` object literal in the studio, as source text.
 * Brace-counted rather than regex-matched to the first `}` — a nested object
 * would end the match early and silently shrink what is being checked.
 */
function classificationBlocks(source) {
  const blocks = []
  const marker = 'classification: {'
  let from = 0
  for (;;) {
    const start = source.indexOf(marker, from)
    if (start === -1) return blocks
    let depth = 0
    let i = start + marker.length - 1
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}' && --depth === 0) break
    }
    blocks.push(source.slice(start, i + 1))
    from = i + 1
  }
}

const source = readFileSync(STUDIO, 'utf8')
const blocks = classificationBlocks(source)

test('the studio still builds the classification objects this test checks', () => {
  // If a refactor renames or relocates them, this test must fail rather than
  // quietly verify nothing — zero blocks would otherwise pass every assertion
  // below by vacuous truth.
  assert.ok(blocks.length >= 2, `expected the studio's save paths, found ${blocks.length}`)
})

test('every save path files the plan under a term', () => {
  blocks.forEach((block, i) => {
    assert.match(
      block,
      /\bterm:/,
      `classification block ${i + 1} has no \`term:\` — a plan saved through it files under `
      + 'Unsorted at the term level. classifyForLibrary reads this object, never `inputs`.',
    )
  })
})

test('every save path also files it under a grade, subject and curriculum', () => {
  // The other three dimensions the same object owns. Listed explicitly so a
  // future save path cannot drop one the way this one dropped the term.
  for (const field of ['libraryType:', 'syllabusHint:', 'grade:', 'subject:']) {
    blocks.forEach((block, i) => {
      assert.ok(block.includes(field), `classification block ${i + 1} is missing ${field}`)
    })
  }
})

test('a bare numeric term string reaches a real folder', () => {
  // The studio sends String(meta.planned.termNumber) — '2', not 'Term 2'.
  assert.equal(resolveTerm('2'), 'Term 2')
  const coords = classifyForLibrary({
    libraryType: LIBRARY_TYPES.LESSON_PLANS,
    syllabusHint: 'CBC',
    grade: 'Nursery',
    subject: 'English Language',
    term: '2',
  })
  assert.equal(coords.term, 'Term 2')
  assert.ok(coords.path.includes('Term 2'), coords.path)
})

test('a plan with no term is filed as unsorted, not as Term 1', () => {
  // A plan generated without a term states none. Defaulting it would put work
  // into a term the teacher never chose, which is worse than Unsorted because
  // it looks decided.
  assert.equal(resolveTerm(null), null)
  const coords = classifyForLibrary({
    libraryType: LIBRARY_TYPES.LESSON_PLANS,
    syllabusHint: 'CBC',
    grade: 'Grade 4',
    subject: 'Mathematics',
    term: null,
  })
  assert.equal(coords.term, null)
})
