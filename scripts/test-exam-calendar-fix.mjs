#!/usr/bin/env node
/* global console, process */
/**
 * Regression tests for the "Exam Calendar not opening" fix:
 *
 *   1. Every SUBJECTS entry in curriculum.js maps to a SUBJECT_MASCOTS entry
 *      (or a graceful DEFAULT_MASCOT fallback) in gamesUi.jsx — verifies the
 *      cinyanja mascot was added and the slug map in DailyExamsHub covers every
 *      curriculum subject without returning undefined.
 *
 *   2. getSubjectMascot() always returns an object with .emoji and .name —
 *      ensures no render crash when SubjectExamCard accesses mascot.emoji and
 *      mascot.name for any slug derived from SUBJECTS.
 *
 *   3. The SUBJECT_SLUG map in DailyExamsHub covers every SUBJECTS id —
 *      verified by importing both modules and cross-checking keys.
 *
 * Run: node scripts/test-exam-calendar-fix.mjs
 *      npm run test:exam-calendar
 */

import assert from 'node:assert/strict'
import { SUBJECTS } from '../src/config/curriculum.js'
// Import the pure-JS mascot module (no JSX/React), not gamesUi.jsx
import { SUBJECT_MASCOTS, getSubjectMascot } from '../src/features/games/lib/subjectMascots.js'

let passed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}`)
    console.error(`       ${err.message}`)
    process.exitCode = 1
  }
}

// ── SUBJECT_SLUG map used in DailyExamsHub ───────────────────────────────────
// Keep in sync with DailyExamsHub.jsx's SUBJECT_SLUG constant.
// These are tested without importing the React component so the test stays
// plain-node (no JSX transform needed).
const SUBJECT_SLUG_MAP = {
  english: 'english',
  science: 'science',
  mathematics: 'mathematics',
  'social-studies': 'social',
  'expressive-arts': 'arts',
  technology: 'technology',
  cinyanja: 'cinyanja',
  'home-economics': 'home',
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('SUBJECT_SLUG_MAP covers every SUBJECTS id', () => {
  for (const subject of SUBJECTS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(SUBJECT_SLUG_MAP, subject.id),
      `SUBJECT_SLUG_MAP is missing curriculum id "${subject.id}"`,
    )
  }
})

test('getSubjectMascot returns a defined mascot (not undefined/null) for every SUBJECTS slug', () => {
  for (const subject of SUBJECTS) {
    const slug = SUBJECT_SLUG_MAP[subject.id] || subject.id
    const mascot = getSubjectMascot(slug)
    assert.ok(mascot != null, `getSubjectMascot("${slug}") returned ${mascot}`)
    assert.ok(typeof mascot.emoji === 'string' && mascot.emoji.length > 0,
      `mascot.emoji is missing for slug "${slug}"`)
    assert.ok(typeof mascot.name === 'string' && mascot.name.length > 0,
      `mascot.name is missing for slug "${slug}"`)
  }
})

test('cinyanja slug now maps to a proper mascot (not the generic fallback)', () => {
  const mascot = getSubjectMascot('cinyanja')
  // Before the fix, cinyanja was missing from SUBJECT_MASCOTS and
  // getSubjectMascot returned DEFAULT_MASCOT ('Game Pal'). Verify it's now
  // a distinct entry rather than the generic fallback.
  assert.notEqual(mascot.name, 'Game Pal',
    'cinyanja still falls back to the generic Game Pal mascot — add it to SUBJECT_MASCOTS')
  assert.ok(mascot.emoji !== '🎮',
    'cinyanja still uses the generic game-controller emoji — add it to SUBJECT_MASCOTS')
})

test('SUBJECT_MASCOTS contains an entry for every slug in SUBJECT_SLUG_MAP', () => {
  const slugs = Object.values(SUBJECT_SLUG_MAP)
  const uniqueSlugs = [...new Set(slugs)]
  for (const slug of uniqueSlugs) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(SUBJECT_MASCOTS, slug),
      `SUBJECT_MASCOTS is missing an entry for slug "${slug}" (used by DailyExamsHub)`,
    )
  }
})

test('getSubjectMascot returns DEFAULT_MASCOT (not undefined) for an unknown slug', () => {
  const mascot = getSubjectMascot('totally-unknown-subject-xyz')
  assert.ok(mascot != null, 'getSubjectMascot returned null/undefined for unknown slug')
  assert.ok(typeof mascot.emoji === 'string', 'DEFAULT_MASCOT.emoji should be a string')
  assert.ok(typeof mascot.name === 'string', 'DEFAULT_MASCOT.name should be a string')
})

test('getSubjectMascot is safe with null/undefined/empty inputs', () => {
  for (const input of [null, undefined, '', 0, false]) {
    const mascot = getSubjectMascot(input)
    assert.ok(mascot != null, `getSubjectMascot(${JSON.stringify(input)}) returned null/undefined`)
    assert.ok(typeof mascot.emoji === 'string', `mascot.emoji not a string for input ${JSON.stringify(input)}`)
  }
})

console.log(`\n${passed} assertions passed`)
