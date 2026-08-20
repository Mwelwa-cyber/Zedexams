/**
 * The spelling learning system, end to end, as pure logic.
 *
 * `test:spelling-stages` already covers mastery and spacing and
 * `test:spelling-bank` covers the shipped content. This file covers the four
 * things that were added to turn those into a connected system — the ladder,
 * the coach's three phases, the content rules the admin tool enforces, and the
 * learner record that has to survive a device change.
 *
 * Plain node. Run: node scripts/test-spelling-system.mjs
 */
import assert from 'node:assert/strict'

import {
  STAGE_WORDS,
  recordCorrect,
  recordMiss,
  entryFor,
  isMastered,
  trickyRecord,
  trickyRecords,
  stageSummary,
  MASTERY_SESSIONS,
} from '../src/features/games/lib/spellingStagesCore.js'
import {
  buildChapters,
  buildStageMap,
  chapterForStage,
  currentStage,
  recordStageStars,
  stagesInChapter,
  starsFor,
  totalStars,
  wordsForStage,
  wordsForTrickyStage,
  chapterTableFor,
  TRICKY_STAGE,
  UNBANDED,
} from '../src/features/games/lib/spellingMapCore.js'
import {
  coachFor,
  coachOutcome,
  rebuildOptions,
  tapChunk,
  validateChunks,
  SIMPLE_LABEL,
} from '../src/features/games/lib/spellingCoachCore.js'
import {
  validateWord,
  normaliseWord,
  renderInlineMarkup,
  servableToLearner,
  chunksRebuild,
  sentenceLeaksWord,
  americanisms,
  wordDocId,
  fillGap,
} from '../src/features/games/lib/spellingContentCore.js'
import {
  applyStageResult,
  betterEntry,
  emptyProgress,
  mergeProgress,
  normaliseProgress,
  resumeIsLive,
  serialiseProgress,
  trimPool,
  MAX_POOL_WORDS,
} from '../src/features/games/lib/spellingProgressCore.js'
import {
  decoysFor,
  decoyCountFor,
  tilesWithDecoys,
  playableWords,
  guessFrom,
} from '../src/features/games/lib/wordBuilderCore.js'

let passed = 0
const failures = []
function check(cond, msg) {
  if (cond) { passed += 1; return }
  failures.push(msg)
}
function section(name) { return (cond, msg) => check(cond, `${name}: ${msg}`) }

/* A tiny deterministic rng so every deal in this file is reproducible. */
function rngFrom(seed) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ══ 1. the ladder ═══════════════════════════════════════════════════ */
{
  const t = section('ladder')
  const bands = [
    { id: 'sound-out', title: 'Sound it out', blurb: 'a' },
    { id: 'double', title: 'Double trouble', blurb: 'b' },
    { id: 'silent', title: 'Silent letters', blurb: 'c' },
    { id: 'tiny', title: 'Too small', blurb: 'd' },
  ]
  const counts = { 'sound-out': 24, double: 17, silent: 8, tiny: 5 }
  const chapters = buildChapters({ bands, counts })

  t(chapters.length === 3, 'a band too small to fill one stage yields no chapter')
  t(chapters[0].stageCount === 3, 'a 24-word band is 3 stages')
  t(chapters[1].stageCount === 2, '17 words floors to 2 stages, never a short third')
  t(chapters[0].firstStage === 1 && chapters[0].lastStage === 3, 'stage numbers are 1-based')
  t(chapters[1].firstStage === 4, 'stage numbers keep counting across a chapter boundary')
  t(chapters[2].lastStage === 6, 'the ladder ends where the last chapter does')
  t(chapters.every((c) => c.total === 3), 'every chapter knows how many chapters there are')
  t(stagesInChapter(0) === 0 && stagesInChapter(-5) === 0, 'a negative or empty band is no stages')

  t(chapterForStage(chapters, 4).id === 'double', 'a stage resolves to its own chapter')
  t(chapterForStage(chapters, 99) === null, 'a stage past the ladder resolves to no chapter')

  /* stars are kept, never replaced */
  let stars = {}
  stars = recordStageStars(stars, 1, 3)
  t(starsFor(stars, 1) === 3, 'a 3-star clear records 3 stars')
  const same = recordStageStars(stars, 1, 1)
  t(same === stars, 'a worse replay is a no-op, identically — nothing to write')
  t(starsFor(same, 1) === 3, 'a worse replay never takes a star away')
  stars = recordStageStars(stars, 2, 1)
  stars = recordStageStars(stars, 2, 2)
  t(starsFor(stars, 2) === 2, 'a better replay raises the rating')
  t(totalStars(stars) === 5, 'total stars adds up across the ladder')
  t(totalStars(recordStageStars({}, 1, 99)) === 3, 'stars are clamped to 3')

  /* current stage and locks */
  t(currentStage({}, chapters) === 1, 'a new learner is on stage 1')
  t(currentStage({ 1: 3, 2: 1 }, chapters) === 3, 'the current stage is the first one not cleared')
  t(currentStage({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3 }, chapters) === 6,
    'a learner who has cleared everything sits on the last stage, not a locked void')

  const map = buildStageMap({ bands, counts, stars: { 1: 3, 2: 2 }, pool: {} })
  const flat = map.chapters.flatMap((c) => c.nodes)
  t(flat.filter((n) => n.state === 'current').length === 1, 'exactly one node is current')
  t(flat.find((n) => n.stage === 3).state === 'current', 'stage 3 is the live one')
  t(flat.find((n) => n.stage === 4).state === 'locked', 'stage 4 is locked')
  t(flat.find((n) => n.stage === 1).state === 'done' && flat.find((n) => n.stage === 1).stars === 3,
    'a cleared stage keeps its stars on the map')
  t(map.chapters[0].progressPct === 67, 'a chapter reports its own progress')
  t(map.chapters[2].locked === true, 'a chapter the ladder has not reached is locked')
  t(map.trickyOpen === false, 'no tricky node without enough tricky words')
  t(!flat.some((n) => n.id === TRICKY_STAGE), 'and no gold node is drawn')
}

/* ══ 1b. a game with its own words still gets a ladder ═══════════════ */
{
  const t = section('chapter fallback')
  const declared = [
    { id: 'double', title: 'Double trouble', blurb: 'b' },
    { id: 'silent', title: 'Silent letters', blurb: 'c' },
  ]
  const items = [
    ...Array.from({ length: 9 }, (_, i) => ({ word: `S${i}`, band: 'silent' })),
    ...Array.from({ length: 9 }, (_, i) => ({ word: `D${i}`, band: 'double' })),
  ]

  const table = chapterTableFor(items, declared)
  t(table.bands.map((b) => b.id).join() === 'double,silent',
    'the declared order is the ladder, not the order the words arrived in')

  // A game document carrying its own words with a band nothing declared.
  const custom = chapterTableFor(
    Array.from({ length: 10 }, (_, i) => ({ word: `W${i}`, band: 'animals' })),
    declared,
  )
  t(custom.bands.length === 1 && custom.bands[0].id === 'animals',
    'an undeclared band still becomes a chapter')
  t(custom.bands[0].title === 'Animals', 'and gets a readable name')
  t(buildChapters(custom).length === 1, 'so the ladder is not empty')

  // And words with no band at all.
  const bare = chapterTableFor(Array.from({ length: 9 }, (_, i) => ({ word: `W${i}` })), declared)
  t(bare.bands[0].id === UNBANDED, 'words with no band land in one implicit chapter')
  t(bare.counts[UNBANDED] === 9, 'which counts them all')
  t(buildChapters(bare).length === 1,
    'a game with its own unbanded words gets a ladder — an empty map has no way in')

  const stage = wordsForStage({
    items: [
      ...Array.from({ length: 9 }, (_, i) => ({ word: `BARE${i}` })),
      ...Array.from({ length: 9 }, (_, i) => ({ word: `BANDED${i}`, band: 'silent' })),
    ],
    pool: {}, stage: 1, band: UNBANDED, salt: 'x',
  })
  t(stage.words.every((w) => !w.band), 'the implicit chapter draws only the unbanded words')
}

/* ══ 2. the personal tricky node ═════════════════════════════════════ */
{
  const t = section('tricky node')
  const bands = [{ id: 'a', title: 'A', blurb: '' }]
  const counts = { a: 80 }
  let pool = {}
  for (let i = 0; i < 11; i += 1) pool = recordMiss(pool, `WORD${i}`, { stage: 1 })

  const map = buildStageMap({ bands, counts, stars: { 1: 2, 2: 2 }, pool })
  t(map.trickyOpen === true, '11 unmastered missed words opens the tricky node')
  t(map.trickyCount === 11, 'and it says how many')
  const nodes = map.chapters[0].nodes
  const goldAt = nodes.findIndex((n) => n.id === TRICKY_STAGE)
  const currentAt = nodes.findIndex((n) => n.state === 'current')
  t(goldAt >= 0, 'the gold node is drawn')
  t(goldAt === currentAt - 1, 'and it sits immediately before the stage the learner is on')

  const thin = buildStageMap({ bands, counts, stars: {}, pool: {} })
  t(!thin.chapters[0].nodes.some((n) => n.id === TRICKY_STAGE),
    'another learner on the same stage does NOT have the node — the map is personal')

  // Clearing the tricky node banks the words but never a star or a stage.
  const before = { stars: { 1: 2 }, pool, stagesPlayed: 0 }
  const after = applyStageResult(before, { stage: 'tricky', stars: 3, pool, runId: 'r1' })
  t(starsFor(after.stars, 'tricky') === 0 && Object.keys(after.stars).length === 1,
    'the tricky node earns no stars — it is practice, not progress')
  t(currentStage(after.stars, buildChapters({ bands, counts })) === 2,
    'and clearing it does not skip a stage of the ladder')
}

/* ══ 3. a stage draws from its own chapter ═══════════════════════════ */
{
  const t = section('stage draw')
  const items = []
  for (let i = 0; i < 20; i += 1) items.push({ word: `DOUBLE${i}`, band: 'double' })
  for (let i = 0; i < 20; i += 1) items.push({ word: `SILENT${i}`, band: 'silent' })

  const stage = wordsForStage({ items, pool: {}, stage: 1, band: 'double', salt: 'g' })
  t(stage.words.length === STAGE_WORDS, 'a stage is eight words')
  t(stage.words.every((w) => w.band === 'double'), 'every word comes from the stage\'s own chapter')
  t(stage.narrowed === false, 'a chapter with enough words is not narrowed')

  const again = wordsForStage({ items, pool: {}, stage: 1, band: 'double', salt: 'g' })
  t(JSON.stringify(again.words) === JSON.stringify(stage.words),
    'the same stage deals the same words — a reload is not a reshuffle')
  const other = wordsForStage({ items, pool: {}, stage: 2, band: 'double', salt: 'g' })
  t(JSON.stringify(other.words) !== JSON.stringify(stage.words), 'a different stage deals differently')

  const thinBand = wordsForStage({ items, pool: {}, stage: 1, band: 'nothing-here', salt: 'g' })
  t(thinBand.narrowed === true, 'a chapter that cannot fill a stage reports it')
  t(thinBand.words.length === STAGE_WORDS, 'and falls back to the whole grade rather than serving a short stage')

  /* the tricky stage draws the learner's own words, worst first */
  let pool = {}
  pool = recordMiss(pool, 'DOUBLE1', { stage: 1 })
  pool = recordMiss(pool, 'DOUBLE1', { stage: 2 })
  pool = recordMiss(pool, 'SILENT3', { stage: 1 })
  pool = recordMiss(pool, 'GONE-FROM-PACK', { stage: 1 })
  const tricky = wordsForTrickyStage({ items, pool })
  t(tricky.words[0].word === 'DOUBLE1', 'the most-missed word comes first')
  t(tricky.words.length === 2, 'a tricky word the pack no longer serves is dropped, never faked')
}

/* ══ 4. the coach ════════════════════════════════════════════════════ */
{
  const t = section('coach')
  const separate = {
    answer: 'separate',
    chunks: ['sep', 'a', 'rate'],
    trap: 1,
    strategy: 'syllables',
    why: 'Say it in three.',
    hook: 'There is a rat in sepa<u>rat</u>e',
    hookNote: 'The middle is an a, not an e.',
    related: ['desperate', 'celebrate'],
  }

  t(validateChunks('separate', ['sep', 'a', 'rate']).ok, 'a cut that rebuilds the word is valid')
  t(!validateChunks('separate', ['sep', 'e', 'rate']).ok, 'a cut that rebuilds the WRONG word is refused')
  t(validateChunks('separate', ['sep', '', 'rate']).reason === 'empty-chunk', 'an empty chunk is refused')
  t(validateChunks('separate', []).reason === 'no-chunks', 'no chunks is refused')

  const coach = coachFor(separate)
  t(coach !== null, 'an authored word gets a coach')
  t(coach.chunks.join('') === 'SEPARATE', 'the chunks rebuild the word on screen too')
  t(coach.trap === 1, 'the trap is the chunk that catches people')
  t(coach.hook.length > 0 && coach.hookNote.length > 0, 'the hook and its note both reach the screen')
  t(coach.related.length === 2, 'the transfer words reach the screen')

  t(coachFor({ answer: 'street' }) === null,
    'a word with no authored cut gets NO coach — never an invented syllable break')
  t(coachFor({ answer: 'x', chunks: ['a', 'b'] }) === null, 'nor does a cut that does not rebuild')

  const noNote = coachFor({ ...separate, hookNote: '' })
  t(noNote.hook === '', 'a hook with no note is not shown — the hook alone is just a pun')

  const selfRef = coachFor({ ...separate, related: ['separate', 'desperate'] })
  t(!selfRef.related.includes('SEPARATE'), 'the transfer list never contains the word itself')

  /* age-appropriate vocabulary */
  const young = coachFor({ ...separate, strategy: 'root+affix' }, { grade: 4 })
  t(young.simple === true && young.label === SIMPLE_LABEL['root+affix'],
    'a younger learner is told "the word inside the word", never "root + affix"')
  const older = coachFor({ ...separate, strategy: 'root+affix' }, { grade: 7 })
  t(older.simple === false && older.label.includes('Root'), 'an older learner gets the real term')

  /* the rebuild is a RECONSTRUCTION */
  const opts = rebuildOptions(coach.chunks, rngFrom(7))
  t(opts.length === 3, 'every chunk is an option')
  t(opts.map((o) => o.index).sort().join('') === '012', 'and each is offered exactly once')
  t(opts.map((o) => o.index).join('') !== '012',
    'the options are SHUFFLED — in order it would be a left-to-right tap, not a rebuild')

  /* a wrong tap costs nothing and the option stays available */
  let placed = []
  let step = tapChunk(placed, 2, 3)
  t(step.accepted === false && step.placed === placed,
    'an out-of-order tap is refused, and refused by identity — nothing is taken away')
  step = tapChunk(placed, 0, 3); placed = step.placed
  t(step.accepted && !step.done, 'the first chunk lands')
  step = tapChunk(placed, 2, 3)
  t(step.accepted === false && step.placed.length === 1,
    'a wrong second choice preserves the correct progress already made')
  step = tapChunk(placed, 1, 3); placed = step.placed
  step = tapChunk(placed, 2, 3); placed = step.placed
  t(step.done === true, 'the word completes on the last chunk')

  /* skipping is not failing */
  const done = coachOutcome('completed')
  const skipped = coachOutcome('skipped')
  const none = coachOutcome('unavailable')
  t(done.coached && !skipped.coached, 'only a completed rebuild counts as coached')
  t([done, skipped, none].every((o) => o.returnsLater),
    'the word comes back later whatever happened — coaching is help, never a second test')
  t([done, skipped, none].every((o) => o.scaffoldingRemoved),
    'and it comes back with no chunks, no trap and no hook')
}

/* ══ 5. content rules ════════════════════════════════════════════════ */
{
  const t = section('content')
  const good = {
    word: 'neighbour',
    grade: 7,
    band: 'silent',
    contextSentence: 'Our ___ helped us carry the water.',
    chunks: ['neigh', 'bour'],
    trap: 1,
    strategy: 'trap',
    why: 'The -eigh- is the bit people miss.',
    relatedWords: ['weigh', 'eight'],
    status: 'approved',
    approved: true,
  }
  const bands = new Set(['silent', 'double'])
  t(validateWord(good, { bands }).length === 0, 'a well-formed word passes')
  t(servableToLearner(good, { bands }) === true, 'and is servable')

  const problems = (patch) => validateWord({ ...good, ...patch }, { bands })

  t(problems({ chunks: ['neig', 'bour'] }).some((p) => p.includes('rebuild')),
    'a cut that does not rebuild the word is refused')
  t(problems({ contextSentence: 'Our neighbour helped ___ us.' }).some((p) => p.includes('prints')),
    'a sentence printing its own answer is refused — that is copying, not spelling')
  t(problems({ contextSentence: 'Our ___ helped ___ us.' }).some((p) => p.includes('exactly one')),
    'two gaps are refused')
  t(problems({ contextSentence: 'Our ___ helped us' }).some((p) => p.includes('end with')),
    'a sentence with no full stop is flagged')
  t(problems({ word: 'neighbor', contextSentence: 'Our ___ helped us carry the water.' })
    .some((p) => p.includes('American')), 'the American form is refused')
  t(problems({ contextSentence: 'The ___ chose a nice color.' }).some((p) => p.includes('colour')),
    'and so is an Americanism in the sentence')
  t(problems({ band: 'not-a-band' }).some((p) => p.includes('not a chapter')),
    'a band this grade does not have is refused')
  t(problems({ word: 'extraordinarily' }).some((p) => p.includes('too long')),
    'a word too long for the tile row on a phone is refused')
  t(problems({ word: 'a' }).some((p) => p.includes('two letters')), 'a one-letter word is refused')
  t(problems({ word: 'ne1ghbour' }).some((p) => p.includes('letters only')), 'digits are refused')
  t(problems({ strategy: null }).some((p) => p.includes('strategy')), 'a cut with no strategy is refused')
  t(problems({ why: '' }).some((p) => p.includes('why people get it wrong')),
    'a cut with no explanation is refused — the cut alone teaches very little')
  t(problems({ hook: 'Say neigh!', hookNote: '' }).some((p) => p.includes('note')),
    'a hook with no note is refused')
  t(problems({ trap: 9 }).some((p) => p.includes('Trap')), 'a trap outside the chunks is refused')
  t(problems({ relatedWords: ['neighbour'] }).some((p) => p.includes('itself')),
    'a related list containing the word itself is refused')

  /* a word with NO cut is completely fine — most words have none */
  const bare = { word: 'street', band: 'silent', contextSentence: 'Our shop is at the end of this ___.' }
  t(validateWord(bare, { bands }).length === 0, 'a word with no cut is publishable')
  t(validateWord({ ...bare, why: 'because' }, { bands }).some((p) => p.includes('nothing to attach')),
    'but an explanation with no chunks has nothing to attach to')

  /* approval is a HUMAN act this only reads back, and it fails closed */
  t(servableToLearner({ ...good, approved: false }, { bands }) === false, 'unapproved is never served')
  t(servableToLearner({ ...good, status: 'pending' }, { bands }) === false, 'pending is never served')
  t(servableToLearner({ ...good, active: false }, { bands }) === false, 'deactivated is never served')
  t(servableToLearner({ ...good, approved: true, chunks: ['x'] }, { bands }) === false,
    'an approved record that fails a machine check is STILL refused — approval sits on the checks')

  /* the primitives, and proof each can fail */
  t(chunksRebuild('cat', ['c', 'at']) && !chunksRebuild('cat', ['c', 'ot']), 'chunksRebuild both ways')
  t(sentenceLeaksWord('her', 'Give ___ the book.') === false,
    '"her" inside "there" would not trip it — the check is whole-word')
  t(sentenceLeaksWord('there', 'Put it over ___, over there.') === true, 'a real leak is caught')
  t(americanisms('The color of the center was gray.').length === 3,
    'the British-spelling check catches a deliberately American sentence')
  t(americanisms('We practise every day and the practice was long.').length === 0,
    'practice/practise is never flagged — both are correct British forms')

  /* normalisation and identity */
  const norm = normaliseWord({ word: '  NEIGHBOUR ', sentence: 'Our ___ came.', transfer: ['Weigh'] })
  t(norm.word === 'neighbour', 'the word is trimmed and lowercased')
  t(norm.contextSentence === 'Our ___ came.', 'the legacy `sentence` field is read')
  t(norm.relatedWords[0] === 'weigh', 'the legacy `transfer` field is read')
  t(norm.status === 'draft' && norm.approved === false, 'a new record is a draft and unapproved')
  t(wordDocId({ grade: 7, word: 'Neighbour' }) === 'g7_neighbour', 'the doc id is derived, so import converges')
  t(wordDocId({ grade: 7, word: 'Neighbour' }) === wordDocId({ grade: '7', word: 'neighbour ' }),
    'and is stable across a string grade and stray whitespace')
  t(fillGap('stretch', '___ your arms.') === 'Stretch your arms.',
    'a word that leads its sentence is capitalised when the gap is filled')
  t(fillGap('friend', 'My best ___ lives in Kitwe.') === 'My best friend lives in Kitwe.', 'and otherwise is not')

  /* the tiny bit of markup a hook may carry */
  t(renderInlineMarkup('There is <u>a rat</u> in sepa<u>rat</u>e') === 'There is <u>a rat</u> in sepa<u>rat</u>e',
    'the emphasis a hook depends on survives — flattening it would lose the teaching')
  t(!renderInlineMarkup('<script>alert(1)</script>').includes('<script'),
    'a script tag never renders as markup')
  t(renderInlineMarkup('<script>x</script>').includes('&lt;script&gt;'),
    'it is ESCAPED rather than stripped, so an admin can SEE what they typed')
  t(renderInlineMarkup('<b onclick="evil()">hi</b>') === '<b>hi</b>',
    'attributes are dropped wholesale — "which attributes are safe" has a long history of wrong answers')
  t(renderInlineMarkup('<img src=x onerror=y>').includes('&lt;img'), 'an image tag is escaped')
  t(renderInlineMarkup('a<br/>b') === 'a<br>b', 'a line break is normalised and kept')
  t(renderInlineMarkup('') === '' && renderInlineMarkup(null) === '', 'nothing in, nothing out')
}

/* ══ 6. the learner record ═══════════════════════════════════════════ */
{
  const t = section('progress')
  t(JSON.stringify(normaliseProgress(undefined)) === JSON.stringify(emptyProgress()),
    'anything unusable normalises to an empty record')
  t(normaliseProgress({ stars: { 3: 9, x: 2, 4: 0 } }).stars['3'] === 3,
    'stars are clamped and non-numeric stages dropped')
  t(Object.keys(normaliseProgress({ stars: { x: 2, 4: 0 } }).stars).length === 0,
    'a zero-star stage is not recorded as cleared')

  /* a stage pays out once per run */
  const start = { stars: {}, pool: {}, stagesPlayed: 0, settledRuns: [] }
  const once = applyStageResult(start, { stage: 4, stars: 3, runId: 'run-a' })
  const twice = applyStageResult(once, { stage: 4, stars: 3, runId: 'run-a' })
  t(once.stagesPlayed === 1, 'a finished stage counts once')
  t(twice === once, 'the SAME run settling again is refused by identity — no duplicate reward')
  const replay = applyStageResult(once, { stage: 4, stars: 1, runId: 'run-b' })
  t(starsFor(replay.stars, 4) === 3, 'and a worse replay in a NEW run still never lowers the rating')
  t(replay.resume === null, 'settling clears the resume')

  /* merging two honest records */
  const phone = { stars: { 1: 3, 2: 1 }, pool: {}, updatedAtMs: 100 }
  const laptop = { stars: { 2: 3, 3: 2 }, pool: {}, updatedAtMs: 200 }
  const merged = mergeProgress(phone, laptop)
  t(starsFor(merged.stars, 1) === 3, 'a star only the older record has survives the merge')
  t(starsFor(merged.stars, 2) === 3, 'and the better of two ratings wins')
  t(starsFor(merged.stars, 3) === 2, 'as does a star only the newer record has')
  t(JSON.stringify(mergeProgress(phone, laptop).stars) === JSON.stringify(mergeProgress(laptop, phone).stars),
    'the merge is symmetric — neither device is privileged')

  let ahead = {}
  for (let i = 0; i < MASTERY_SESSIONS; i += 1) ahead = recordCorrect(ahead, 'WORD', { session: `s${i}`, stage: i })
  const behind = recordMiss({}, 'WORD', { stage: 1 })
  t(isMastered(entryFor(ahead, 'WORD')), 'the phone mastered the word')
  t(isMastered(betterEntry(ahead.WORD, behind.WORD)), 'and the merge keeps it mastered')
  t(isMastered(betterEntry(behind.WORD, ahead.WORD)), 'in both directions')
  t(betterEntry(ahead.WORD, behind.WORD).misses === 1, 'while keeping the miss history from the other device')

  const mergedPool = mergeProgress({ pool: ahead }, { pool: behind })
  t(isMastered(entryFor(mergedPool.pool, 'WORD')), 'no route through the merge un-masters a word')

  /* resume */
  const live = { stage: 4, band: 'double', runId: 'r', session: 's', words: ['A', 'B', 'C'], index: 1, startedAtMs: 1000 }
  t(resumeIsLive(live, { now: 2000 }), 'a half-finished stage is offered')
  t(!resumeIsLive({ ...live, index: 3 }, { now: 2000 }), 'a finished one is not')
  t(!resumeIsLive({ ...live }, { now: 1000 + 1000 * 60 * 60 * 24 * 4 }), 'a stale one is not')
  t(!resumeIsLive(null), 'and neither is nothing')
  t(normaliseProgress({ resume: { stage: 4, words: [] } }).resume === null,
    'a resume with no words is dropped rather than resuming into an empty stage')
  t(normaliseProgress({ resume: { ...live } }).resume.session === 's',
    'the resume carries its session id — or a learner could bank two mastery sessions in one sitting')

  /* the pool is bounded, and it drops the right ones */
  let big = {}
  for (let i = 0; i < 10; i += 1) {
    big = recordCorrect(big, `MASTERED${i}`, { session: 'a', stage: 1, at: i })
    big = recordCorrect(big, `MASTERED${i}`, { session: 'b', stage: 2, at: i })
    big = recordCorrect(big, `MASTERED${i}`, { session: 'c', stage: 3, at: i })
  }
  for (let i = 0; i < 10; i += 1) big = recordMiss(big, `TRICKY${i}`, { stage: 1, at: 100 + i })
  const trimmed = trimPool(big, 12)
  t(Object.keys(trimmed.pool).length === 12, 'the pool is trimmed to its cap')
  t(trimmed.droppedUnmastered === 0, 'and drops only MASTERED words while there are any')
  t(Object.keys(trimmed.pool).filter((w) => w.startsWith('TRICKY')).length === 10,
    'every unmastered word survives — that is the real learning state')
  t(trimPool(big, 500).pool === big, 'a pool under the cap is returned untouched')

  const forced = trimPool(big, 4)
  t(forced.droppedUnmastered > 0, 'with nothing mastered left to drop it takes unmastered ones')
  t(forced.droppedUnmastered === 6, 'and reports exactly how many, rather than hiding it')

  const wire = serialiseProgress({ stars: { 1: 3 }, pool: big }, { uid: 'u1', max: MAX_POOL_WORDS })
  t(wire.uid === 'u1' && wire.totalStars === 3, 'the wire record carries the owner and the star total')
  t(!('updatedAtMs' in wire), 'and not the client clock — the server stamps the write')
}

/* ══ 7. the round: tiles, decoys, undo ═══════════════════════════════ */
{
  const t = section('round')
  t(decoyCountFor(3) === 0, 'a very short word gets no decoys — there is nothing to hide among')
  t(decoyCountFor(6) === 1 && decoyCountFor(8) === 2 && decoyCountFor(12) === 3,
    'longer words earn more decoys')

  for (const word of ['NEIGHBOUR', 'SEPARATE', 'BECAUSE', 'FEBRUARY', 'EMBARRASS']) {
    const decoys = decoysFor(word, rngFrom(word.length))
    const letters = new Set(word.split(''))
    t(decoys.every((d) => !letters.has(d)),
      `no decoy for ${word} is a letter the word needs — that would make it unspellable`)
    const tiles = tilesWithDecoys(word, rngFrom(3))
    const own = tiles.filter((tile) => !tile.decoy).map((tile) => tile.letter).sort().join('')
    t(own === word.split('').sort().join(''),
      `${word} still has every one of its own letters, repeats included`)
    t(tiles.length === word.length + decoys.length, `${word} gets exactly its letters plus its decoys`)
  }

  /* repeated letters: BEGINNING has three N's and they must all be tappable */
  const tiles = tilesWithDecoys('BEGINNING', rngFrom(11))
  t(tiles.filter((tile) => tile.letter === 'N' && !tile.decoy).length === 3,
    'a word with a repeated letter gets one tile per occurrence')

  /* undo: the guess reads off placed indices, so removing one is a pure slice */
  const placed = [0, 1, 2]
  t(guessFrom(placed, tiles) === placed.map((i) => tiles[i].letter).join(''), 'the guess reads off the tiles')
  t(guessFrom(placed.slice(0, -1), tiles).length === 2, 'undo shortens the guess by one')
  t(guessFrom([], tiles) === '', 'clearing empties it')

  /* the band travels, so a stage can be filtered to its chapter */
  const words = playableWords([
    { answer: 'street', question: 'Our shop is at the end of this ___.', band: 'sound-out' },
    { answer: 'a', question: 'too short' },
    { answer: 'two words', question: 'has a space' },
  ])
  t(words.length === 1, 'a word too short or carrying a space cannot become tap tiles')
  t(words[0].band === 'sound-out', 'and the band travels with the word')
}

/* ══ 8. the end of a stage ═══════════════════════════════════════════ */
{
  const t = section('stage results')
  const words = [{ word: 'ALPHA' }, { word: 'BETA' }, { word: 'GAMMA' }, { word: 'DELTA' }]

  // ALPHA arrives already twice-right; a third right in a NEW session masters it.
  let before = {}
  before = recordCorrect(before, 'ALPHA', { session: 's1', stage: 1 })
  before = recordCorrect(before, 'ALPHA', { session: 's2', stage: 2 })
  before = recordMiss(before, 'BETA', { stage: 1 })

  let after = recordCorrect(before, 'ALPHA', { session: 's3', stage: 3 })
  after = recordMiss(after, 'GAMMA', { stage: 3 })
  after = recordMiss(after, 'BETA', { stage: 3 })
  after = recordCorrect(after, 'DELTA', { session: 's3', stage: 3 })

  const summary = stageSummary({ before, after, words, firstTryCorrect: 2 })
  t(summary.mastered.join() === 'ALPHA', 'a word that crossed the line this stage is newly mastered')
  t(summary.addedTricky.join() === 'GAMMA',
    'BETA was already tricky, so missing it again is not "added" — that would read as going backwards')
  t(summary.returning.every((r) => r.dueAt > 0), 'every unmastered word is scheduled to return')
  t(!summary.returning.some((r) => r.word === 'ALPHA'), 'and a mastered word is not')
  t(summary.stars === 1 && summary.accuracy === 50, '2 of 4 first time is one star')

  const perfect = stageSummary({ before: {}, after: {}, words, firstTryCorrect: 4 })
  t(perfect.stars === 3, 'every word right first time is three stars')
  t(stageSummary({ before: {}, after: {}, words, firstTryCorrect: 3 }).stars === 2, 'most of them is two')

  /* mastery survives a repeat inside one stage but is never granted by it */
  let sameSitting = {}
  for (let i = 0; i < 5; i += 1) sameSitting = recordCorrect(sameSitting, 'ONCE', { session: 'one', stage: 1 })
  t(!isMastered(entryFor(sameSitting, 'ONCE')),
    'five rights in one sitting is not mastery — that is short-term memory')
  t(entryFor(sameSitting, 'ONCE').sessions.length === 1, 'and only one session was banked')

  /* the tricky record the Tricky Words screen reads */
  let record = {}
  record = recordMiss(record, 'HARD', { stage: 1, at: 10 })
  record = recordMiss(record, 'HARD', { stage: 2, at: 20 })
  record = recordCorrect(record, 'HARD', { session: 'x', stage: 3, at: 30 })
  const tricky = trickyRecord(record, 'HARD')
  t(tricky.attempts === 3 && tricky.misses === 2 && tricky.correct === 1, 'attempts, misses and corrects add up')
  t(tricky.firstTryAccuracy === 33, 'first-try accuracy is over attempts')
  t(tricky.lastMissedAt === 20 && tricky.lastAttemptedAt === 30, 'last attempted and last missed are separate facts')
  t(tricky.consecutiveSessions === 1 && tricky.sessionsToMastery === 2, 'and it says how far mastery is')
  t(trickyRecords(record).length === 1, 'the list renders from the same record')

  /* a mastered word leaves the active tricky list but keeps its history */
  let done = record
  done = recordCorrect(done, 'HARD', { session: 'y', stage: 4, at: 40 })
  done = recordCorrect(done, 'HARD', { session: 'z', stage: 5, at: 50 })
  t(trickyRecords(done).length === 0, 'a mastered word leaves the tricky list')
  t(entryFor(done, 'HARD').misses === 2, 'and its miss history is kept')
}

/* ── report ─────────────────────────────────────────────────────────── */

if (failures.length) {
  console.error(`\nspelling system: ${failures.length} FAILED\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`spelling system: ${passed} checks passed`)
