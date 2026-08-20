/**
 * test:spelling-stages — mastery, spacing, and the coach's one automatable rule.
 *
 * Every rule below fails invisibly. A word that masters in one sitting still
 * disappears from the pool and looks learnt; a missed word that returns next
 * stage still returns; a chunk list that does not rebuild its word still
 * renders as three friendly boxes. So they are asserted here, on the pure
 * functions, and against the words actually shipped.
 */
import assert from 'node:assert/strict'

import { GAMES_SEED } from '../src/data/gamesSeed.js'
import {
  MASTERY_SESSIONS,
  SPACING,
  STAGE_WORDS,
  TRICKY_GATE,
  composeStage,
  dueWords,
  entryFor,
  isMastered,
  recordCorrect,
  recordMiss,
  sessionsToMastery,
  starsForStage,
  trickyPoolOpen,
  trickyWords,
} from '../src/features/games/lib/spellingStagesCore.js'
import { coachFor, validateChunks } from '../src/features/games/lib/spellingCoachCore.js'

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

const items = (...words) => words.map((word) => ({ word, clue: `clue for ${word}` }))

console.log('spelling-stages')

/* ── mastery ───────────────────────────────────────────────────────── */

test('three rights in ONE session is not mastery', () => {
  let pool = {}
  for (let i = 0; i < 5; i += 1) pool = recordCorrect(pool, 'RECEIVE', { session: 's1', stage: 1 })
  assert.equal(entryFor(pool, 'RECEIVE').correct, 1, 'a session counts once, however many times the word came up')
  assert.equal(isMastered(entryFor(pool, 'RECEIVE')), false)
  assert.equal(sessionsToMastery(entryFor(pool, 'RECEIVE')), 2)
})

test('three rights in three SEPARATE sessions is', () => {
  let pool = {}
  for (const session of ['s1', 's2', 's3']) pool = recordCorrect(pool, 'RECEIVE', { session, stage: 1 })
  assert.equal(entryFor(pool, 'RECEIVE').correct, MASTERY_SESSIONS)
  assert.equal(isMastered(entryFor(pool, 'RECEIVE')), true)
  assert.equal(sessionsToMastery(entryFor(pool, 'RECEIVE')), 0)
})

test('a miss resets the count but keeps the history', () => {
  let pool = {}
  pool = recordCorrect(pool, 'SEPARATE', { session: 's1', stage: 1 })
  pool = recordCorrect(pool, 'SEPARATE', { session: 's2', stage: 2 })
  pool = recordMiss(pool, 'SEPARATE', { stage: 3 })
  const entry = entryFor(pool, 'SEPARATE')
  assert.equal(entry.correct, 0, 'a word just got wrong is not two-thirds learnt')
  assert.deepEqual(entry.sessions, [])
  assert.equal(entry.misses, 1, 'the miss history is what makes a word tricky — it must survive')
  // And a second miss keeps climbing.
  assert.equal(entryFor(recordMiss(pool, 'SEPARATE', { stage: 4 }), 'SEPARATE').misses, 2)
})

/* ── spacing ───────────────────────────────────────────────────────── */

test('a missed word comes back 2 stages later, then 5, then 11', () => {
  let pool = recordMiss({}, 'NECESSARY', { stage: 4 })
  assert.equal(entryFor(pool, 'NECESSARY').dueAt, 4 + SPACING[0])
  assert.deepEqual(dueWords(pool, 5), [], 'not due yet')
  assert.deepEqual(dueWords(pool, 6), ['NECESSARY'])

  pool = recordCorrect(pool, 'NECESSARY', { session: 's1', stage: 6 })
  assert.equal(entryFor(pool, 'NECESSARY').dueAt, 6 + SPACING[1])
  pool = recordCorrect(pool, 'NECESSARY', { session: 's2', stage: 11 })
  assert.equal(entryFor(pool, 'NECESSARY').dueAt, 11 + SPACING[2])
})

test('a mastered word never comes due again', () => {
  let pool = {}
  for (const [i, session] of ['s1', 's2', 's3'].entries()) {
    pool = recordCorrect(pool, 'ISLAND', { session, stage: i })
  }
  assert.deepEqual(dueWords(pool, 999), [], 'mastered is mastered')
})

/* ── composing a stage ─────────────────────────────────────────────── */

test('an unmastered word cannot arrive as a NEW word the stage after it was missed', () => {
  // The whole point of the spacing. Excluding only the words picked from the
  // pool would let a missed word return immediately through the fresh draw.
  const bank = items('ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET')
  const pool = recordMiss({}, 'ALPHA', { stage: 4 })
  const stage = composeStage({ items: bank, pool, stage: 5, salt: 'learner-1' })
  assert.ok(!stage.words.some((item) => item.word === 'ALPHA'), 'ALPHA is not due until stage 6')
  const later = composeStage({ items: bank, pool, stage: 6, salt: 'learner-1' })
  assert.ok(later.words.some((item) => item.word === 'ALPHA'), 'and at stage 6 it comes back')
  assert.deepEqual(later.fromPool, ['ALPHA'])
})

test('the draw is deterministic, and different per learner', () => {
  const bank = items('ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET')
  const once = composeStage({ items: bank, pool: {}, stage: 3, salt: 'learner-1' })
  const again = composeStage({ items: bank, pool: {}, stage: 3, salt: 'learner-1' })
  assert.deepEqual(once.words.map((w) => w.word), again.words.map((w) => w.word), 'a reload is not a reshuffle')
  const other = composeStage({ items: bank, pool: {}, stage: 3, salt: 'learner-2' })
  assert.notDeepEqual(once.words.map((w) => w.word), other.words.map((w) => w.word))
})

test('a stage is eight words, and a short pack reports the shortfall', () => {
  const big = items(...Array.from({ length: 20 }, (_, i) => `WORD${i}`))
  assert.equal(composeStage({ items: big, pool: {}, stage: 1 }).words.length, STAGE_WORDS)
  const small = composeStage({ items: items('ONE', 'TWO'), pool: {}, stage: 1 })
  assert.equal(small.words.length, 2)
  assert.equal(small.shortfall, STAGE_WORDS - 2, 'the gap is reported rather than hidden by repeating')
})

test('the tricky pool opens at ten missed words, and lists the worst first', () => {
  let pool = {}
  for (let i = 0; i < 9; i += 1) pool = recordMiss(pool, `W${i}`, { stage: 1 })
  assert.equal(trickyPoolOpen(pool), false, `${TRICKY_GATE} is the gate`)
  pool = recordMiss(pool, 'W9', { stage: 1 })
  assert.equal(trickyPoolOpen(pool), true)
  pool = recordMiss(pool, 'W3', { stage: 2 })
  assert.equal(trickyWords(pool)[0], 'W3', 'the word missed most often comes first')
  // A word that has since been mastered leaves the tricky list.
  let mastered = pool
  for (const session of ['a', 'b', 'c']) mastered = recordCorrect(mastered, 'W3', { session, stage: 3 })
  assert.ok(!trickyWords(mastered).includes('W3'))
})

test('stars are accuracy only, never time', () => {
  assert.equal(starsForStage(8), 3)
  assert.equal(starsForStage(6), 2)
  assert.equal(starsForStage(3), 1)
})

/* ── the coach ─────────────────────────────────────────────────────── */

test('chunks must rebuild the word, or there is no coach', () => {
  assert.equal(validateChunks('SEPARATE', ['SEP', 'A', 'RATE']).ok, true)
  assert.equal(validateChunks('SEPARATE', ['SEP', 'RATE']).reason, 'does-not-rebuild')
  assert.equal(validateChunks('SEPARATE', ['SEP', '', 'ARATE']).reason, 'empty-chunk')
  assert.equal(validateChunks('SEPARATE', []).reason, 'no-chunks')
  // Case is not the learner's problem.
  assert.equal(validateChunks('SEPARATE', ['sep', 'a', 'rate']).ok, true)
})

test('a word with no chunks gets NO coach, rather than a guessed break', () => {
  assert.equal(coachFor({ answer: 'NECESSARY' }), null)
  assert.equal(coachFor({ answer: 'NECESSARY', chunks: ['NEC', 'SSARY'] }), null, 'a broken cut is no cut')
  const good = coachFor({ answer: 'NECESSARY', chunks: ['NEC', 'ESS', 'AR', 'Y'], strategy: 'syllables', trap: 1 })
  assert.equal(good.chunks.length, 4)
  assert.equal(good.trap, 1)
  assert.match(good.label, /Syllables/)
})

test('an out-of-range trap index is dropped, not rendered', () => {
  const coach = coachFor({ answer: 'NIGHT', chunks: ['N', 'IGHT'], strategy: 'family', trap: 7 })
  assert.equal(coach.trap, null, 'a trap pointing at no chunk would highlight nothing')
  assert.equal(coachFor({ answer: 'NIGHT', chunks: ['N', 'IGHT'], strategy: 'nonsense' }).strategy, 'syllables')
})

/* ── the shipped content ───────────────────────────────────────────── */

test('every shipped chunk list rebuilds its own word', () => {
  for (const pack of GAMES_SEED.filter((g) => g.type === 'word_builder')) {
    for (const question of pack.questions) {
      if (!question.chunks) continue
      const check = validateChunks(question.answer, question.chunks)
      assert.equal(
        check.ok, true,
        `${pack.id}: "${question.answer}" is cut into ${question.chunks.join('|')} which rebuilds to "${check.rebuilt}"`,
      )
      if (Number.isInteger(question.trap)) {
        assert.ok(
          question.trap >= 0 && question.trap < question.chunks.length,
          `${pack.id}: "${question.answer}" marks chunk ${question.trap}, but it has ${question.chunks.length}`,
        )
      }
    }
  }
})

if (failures > 0) {
  console.error(`\nspelling-stages — ${failures} failed`)
  process.exit(1)
}
console.log('spelling-stages — all passed')
