/**
 * The word pack: the join between the 879-word Grade 7 bank and the spelling
 * engine that plays it.
 *
 * The engine shipped reading ten words off its game document. The bank makes a
 * real ladder possible, and the ways that join can silently go wrong are the
 * ways it goes wrong quietly: chunks in the wrong case read as a different
 * word beside the tiles, a missing clue leaves a learner with a word and no
 * meaning, and a pack that yields nothing would leave the round empty rather
 * than falling back.
 *
 * Run: npm run test:spelling-pack
 */
import assert from 'node:assert/strict'
import { SPELLING_BANK } from '../src/data/spellingBank.js'
import { SPELLING_COACH } from '../src/data/spellingCoach.js'
import { GAMES_SEED } from '../src/data/gamesSeed.js'
import { isKnownPack, loadWordPack, toPackQuestions, WORD_PACKS } from '../src/features/games/lib/spellingPack.js'
import { playableWords } from '../src/features/games/lib/wordBuilderCore.js'
import { coachFor, validateChunks } from '../src/features/games/lib/spellingCoachCore.js'
import { composeStage } from '../src/features/games/lib/spellingStagesCore.js'

let passed = 0
const t = (name, fn) => { fn(); passed += 1; console.log('  ok ', name) }

/* ── the adapter ────────────────────────────────────────────────────── */

t('every bank word becomes a playable question', () => {
  const rows = toPackQuestions(SPELLING_BANK, SPELLING_COACH)
  assert.equal(rows.length, SPELLING_BANK.length)
  // `playableWords` drops anything that is not letters-only, which is what
  // would silently shrink the ladder. Nothing in the bank may be dropped.
  assert.equal(playableWords(rows).length, SPELLING_BANK.length)
})

t('the clue is the context sentence, not a definition', () => {
  const rows = toPackQuestions(SPELLING_BANK, SPELLING_COACH)
  const straight = rows.find((r) => r.answer === 'STRAIGHT')
  assert.equal(straight.question, 'Draw a ___ line with your ruler.')
  assert.ok(rows.every((r) => r.question.includes('___')),
    'every clue keeps its gap — a sentence with the word in it would be the answer')
})

t('chunks are uppercased to match the tiles they sit beside', () => {
  const rows = toPackQuestions(SPELLING_BANK, SPELLING_COACH)
  const separate = rows.find((r) => r.answer === 'SEPARATE')
  assert.deepEqual(separate.chunks, ['SEP', 'A', 'RATE'])
  assert.equal(separate.trap, 1)
})

t('a word with no authored cut carries no chunks at all', () => {
  const rows = toPackQuestions(
    [{ word: 'street', band: 'sound-out', sentence: 'The shop is on our ___.' }],
    {},
  )
  assert.equal(rows[0].chunks, undefined, 'no invented split — spellingCoachCore refuses to guess')
  assert.equal(coachFor(rows[0]), null)
})

t('every cut the pack emits still rebuilds its word', () => {
  // The one rule a machine can check, re-checked after the case change.
  const rows = toPackQuestions(SPELLING_BANK, SPELLING_COACH)
  const cut = rows.filter((r) => r.chunks)
  assert.ok(cut.length >= 70, `the coached words survive the adaptation (${cut.length})`)
  for (const row of cut) {
    const { ok, reason } = validateChunks(row.answer, row.chunks)
    assert.ok(ok, `${row.answer}: ${reason}`)
  }
})

t('the coach can be read off an adapted row', () => {
  const rows = toPackQuestions(SPELLING_BANK, SPELLING_COACH)
  const coach = coachFor(rows.find((r) => r.answer === 'NECESSARY'))
  assert.ok(coach, 'a coached word yields a coach')
  assert.deepEqual(coach.chunks, ['NEC', 'ESS', 'AR', 'Y'])
})

/* ── the pack is actually wired to the game ─────────────────────────── */

t('the Grade 7 spelling game names a pack this build knows', () => {
  const game = GAMES_SEED.find((g) => g.id === 'english_word_builder_g7')
  assert.ok(game, 'the Grade 7 word builder is seeded')
  assert.ok(isKnownPack(game.wordPack), `"${game.wordPack}" is a known pack`)
  assert.ok(game.questions.length > 0, 'and keeps its own questions as the fallback')
})

t('an unknown pack yields nothing, so the document\'s words stand', async () => {
  assert.equal(isKnownPack('no-such-pack'), false)
  assert.deepEqual(await loadWordPack('no-such-pack'), [])
  assert.deepEqual(await loadWordPack(undefined), [])
})

t('loading the real pack gives the whole bank', async () => {
  const rows = await loadWordPack('grade7-spelling')
  assert.equal(rows.length, SPELLING_BANK.length)
  assert.ok(rows.length > 800, `a real ladder's worth (${rows.length})`)
})

/* ── and the ladder it makes possible ───────────────────────────────── */

t('twelve stages draw nearly a hundred different words', async () => {
  // NOT "no repeats". `composeStage` reshuffles the whole pack per stage with
  // a stage-specific seed and takes the first eight; it holds no memory of
  // earlier stages, so two stages CAN land on the same word by chance. What
  // stops a word the learner MISSED coming back too early is the pool, which
  // is a different mechanism and has its own tests. Drawing 96 words from 879
  // collides a handful of times by simple arithmetic, and that is fine — the
  // claim worth pinning is that the ladder now has depth.
  const rows = await loadWordPack('grade7-spelling')
  const items = playableWords(rows)
  const seen = new Set()
  for (let stage = 0; stage < 12; stage += 1) {
    for (const w of composeStage({ items, pool: {}, stage, salt: 'g7', size: 8 }).words) seen.add(w.word)
  }
  assert.ok(seen.size >= 85, `twelve stages yield ${seen.size} distinct words, out of 96 drawn`)
})

t('the seeded ten could NOT have done that — the gap this closes', () => {
  const game = GAMES_SEED.find((g) => g.id === 'english_word_builder_g7')
  const items = playableWords(game.questions)
  const seen = new Set()
  for (let stage = 0; stage < 12; stage += 1) {
    for (const w of composeStage({ items, pool: {}, stage, salt: 'g7', size: 8 }).words) seen.add(w.word)
  }
  assert.ok(seen.size <= game.questions.length,
    'ten words can only ever yield ten distinct words, however many stages are played')
})

console.log(`\nspelling pack: ${passed} passed`)
