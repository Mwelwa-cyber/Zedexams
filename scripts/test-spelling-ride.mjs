/**
 * test:spelling-ride — the rules Spelling Ride would fail silently.
 *
 * Everything here is a property that LOOKS FINE ON SCREEN when it is broken.
 * A row with two right lanes plays perfectly and marks a right answer wrong;
 * a gap that shrinks as the bike speeds up feels like the game getting harder;
 * a distractor that is never the letter a child would reach for makes the
 * exercise easier AND the data worthless. None of those throws, and none of
 * them is visible in a screenshot.
 *
 * THE PACING TEST IS THE ONE TO KEEP. §3.2 asks for the minimum row gap to be
 * SAMPLED over a long autoplay run rather than derived from the formula, and
 * the difference is not academic: the formula was right and the measured
 * minimum was 0.017s, because the blank road between two words consumed no
 * time at all. A test that re-derived `speed × secondsPerRow` would have
 * agreed with the bug.
 *
 * Plain node, auto-discovered by scripts/run-all-tests.mjs.
 */
import assert from 'node:assert/strict'

import { SPELLING_BANK, SPELLING_BANDS } from '../src/data/spellingBank.js'
import { SPELLING_CHOICE_BANK, mergeChoiceItems } from '../src/data/spellingChoiceBank.js'
import {
  CHOICE_WORDS_PER_RIDE,
  LETTER_CONFUSIONS,
  MAX_HEARTS,
  REPAIR_STREAK,
  REPEAT_GAPS,
  RIDE_DIFFICULTIES,
  RIDE_MODE_IDS,
  RIDE_TOWNS,
  SPAWN_Y,
  WORDS_PER_TOWN,
  advance,
  buildChoiceChallenge,
  buildWordChallenge,
  carriedForwardWords,
  createRide,
  departTown,
  letterDistractors,
  reportCsv,
  repairsAt,
  rideResult,
  rowGapPx,
  scoreForLetter,
  secondsBetween,
  settleRide,
  speedAtTown,
  steer,
  troubleWords,
  wordsForTown,
} from '../src/features/games/lib/spellingRideCore.js'
import {
  depthScale,
  fadeIn,
  halfWidthAt,
  laneCentreAt,
  laneFromX,
  roadGeometry,
  trackToScreen,
} from '../src/features/games/lib/spellingRideRoad.js'
import {
  DISTRACTOR_COUNT,
  laneOptions,
  normaliseSentence,
  servableSentence,
  validateSentence,
} from '../src/features/games/lib/spellingSentenceCore.js'
// The PURE core, not `spellingSpeech.js` — that module reaches Firebase
// through `utils/tts` (the ElevenLabs ladder, #2564) and cannot be loaded
// under plain node. The accent order is the half worth testing anyway.
import { VOICE_PREFERENCE, resolveVoice } from '../src/features/games/lib/spellingVoiceCore.js'
import {
  emptyProgress,
  mergeProgress,
  normaliseProgress,
  recordRideBest,
  rideBest,
} from '../src/features/games/lib/spellingProgressCore.js'
import { entryFor, isMastered } from '../src/features/games/lib/spellingStagesCore.js'
import { americanisms, gapCount, sentenceLeaksWord } from '../src/features/games/lib/spellingContentCore.js'
import { MIN_COHORT, aggregateCohort, cohortCsv } from '../src/features/games/lib/spellingCohortCore.js'

let failures = 0
let count = 0
function test(name, fn) {
  count += 1
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('spelling-ride')

/* ── a pack big enough to ride a full route on ───────────────────────── */

const ITEMS = SPELLING_BANK.map((row) => ({
  word: row.word.toUpperCase(),
  band: row.band,
  clue: row.sentence,
})).filter((item) => /^[A-Z]+$/.test(item.word))

/**
 * Play a whole ride correctly, steering into the nearest unresolved row's
 * right lane every frame — and report what the road did while it happened.
 */
function autoplay({ difficulty = 'medium', mode = 'spell', items = ITEMS, seed = 'guard', maxFrames = 60 * 4000, wrongEvery = 0 } = {}) {
  const ride = createRide({ mode, difficulty, items, choiceItems: SPELLING_CHOICE_BANK, seed })
  const legGaps = []
  const laneCounts = new Set()
  const optionSets = []
  let lastSpawn = ride.lastSpawnAt
  let frames = 0
  let rows = 0

  while (!ride.over && frames < maxFrames) {
    let target = null
    for (const row of ride.rows) {
      if (!row.resolved && (!target || row.y > target.y)) target = row
    }
    if (target) {
      laneCounts.add(target.options.length)
      if (optionSets.length < 400) optionSets.push({ options: target.options, correctLane: target.correctLane })
      const wrong = wrongEvery && rows > 0 && rows % wrongEvery === 0
      const lane = wrong ? (target.correctLane + 1) % 3 : target.correctLane
      steer(ride, lane)
      rows += 1
    }
    advance(ride, 1 / 60)
    frames += 1
    if (ride.lastSpawnAt !== lastSpawn) {
      legGaps.push(ride.lastSpawnAt - lastSpawn)
      lastSpawn = ride.lastSpawnAt
    }
    if (ride.atTown && !ride.over) {
      departTown(ride)
      // A town CLEARS the road, so the gap across that boundary is not a gap
      // between two rows on one stretch of road and is not measured as one.
      lastSpawn = ride.lastSpawnAt
    }
  }
  return { ride, legGaps, laneCounts, optionSets, frames }
}

/* ══ 1. Pacing ═══════════════════════════════════════════════════════ */

test('the difficulty table is the one the specification states', () => {
  assert.deepEqual(
    Object.values(RIDE_DIFFICULTIES).map((d) => [d.id, d.speed, d.secondsPerRow]),
    [['easy', 120, 3.0], ['medium', 165, 2.6], ['hard', 215, 2.2]],
  )
})

test('the row gap is speed × seconds, so it is time and not pixels', () => {
  for (const d of Object.values(RIDE_DIFFICULTIES)) {
    assert.equal(rowGapPx(d.speed, d.secondsPerRow), d.speed * d.secondsPerRow)
    // The property that matters: at ANY speed, that gap is the same number of
    // seconds. A fixed pixel gap would fail this at the second speed.
    for (const speed of [d.speed, d.speed + 20, d.speed + 40]) {
      assert.ok(
        Math.abs(secondsBetween(rowGapPx(speed, d.secondsPerRow), speed) - d.secondsPerRow) < 1e-9,
        `${d.id} at ${speed}px/s: the gap is no longer ${d.secondsPerRow}s`,
      )
    }
  }
})

test('speed rises across the route and the thinking time never falls', () => {
  const base = RIDE_DIFFICULTIES.medium.speed
  let previousSpeed = 0
  for (let town = 0; town < RIDE_TOWNS.length; town += 1) {
    const speed = speedAtTown(base, town)
    assert.ok(speed >= previousSpeed, 'the bike must never slow down between towns')
    previousSpeed = speed
    assert.equal(
      secondsBetween(rowGapPx(speed, RIDE_DIFFICULTIES.medium.secondsPerRow), speed),
      RIDE_DIFFICULTIES.medium.secondsPerRow,
    )
  }
  assert.ok(speedAtTown(base, RIDE_TOWNS.length - 1) > base, 'the ride never got faster at all')
})

test('MEASURED over a full ride: the minimum gap is the difficulty\'s own seconds', () => {
  for (const id of ['easy', 'medium', 'hard']) {
    const { ride, legGaps } = autoplay({ difficulty: id })
    assert.ok(legGaps.length > 150, `${id}: only ${legGaps.length} rows sampled — not a long run`)
    assert.equal(ride.outcome, 'arrived', `${id}: a clean ride should reach Livingstone`)
    const min = Math.min(...legGaps)
    const target = RIDE_DIFFICULTIES[id].secondsPerRow
    // One frame of slack at 60fps and not a millisecond more. This is the
    // assertion that caught the blank-road bug.
    assert.ok(
      min >= target - 1 / 60,
      `${id}: the closest two rows ever came was ${min.toFixed(4)}s, against ${target}s`,
    )
  }
})

test('reading a correction does not eat the next row\'s thinking time', () => {
  // Every fourth row answered wrongly, so the freeze fires repeatedly. The
  // freeze stops the road, so gaps can only ever get LONGER.
  const { legGaps } = autoplay({ difficulty: 'hard', wrongEvery: 4, maxFrames: 60 * 600 })
  const min = Math.min(...legGaps)
  assert.ok(min >= RIDE_DIFFICULTIES.hard.secondsPerRow - 1 / 60, `a correction shortened a gap to ${min.toFixed(4)}s`)
})

/* ══ 2. Three lanes, always ══════════════════════════════════════════ */

test('every row fills all three lanes, with exactly one right answer', () => {
  for (const mode of RIDE_MODE_IDS) {
    const { laneCounts, optionSets } = autoplay({ mode, maxFrames: 60 * 900 })
    assert.deepEqual([...laneCounts], [3], `${mode}: a row was built with ${[...laneCounts]} lanes`)
    for (const { options, correctLane } of optionSets) {
      assert.equal(new Set(options).size, 3, `${mode}: two lanes held the same option — ${options.join('/')}`)
      assert.ok(correctLane >= 0 && correctLane <= 2, `${mode}: the right answer is in no lane`)
    }
  }
})

test('a run cannot be completed by avoiding letters — there is no empty lane', () => {
  const { optionSets } = autoplay({ maxFrames: 60 * 600 })
  for (const { options } of optionSets) {
    for (const option of options) {
      assert.ok(String(option).length > 0, 'a lane was empty, so a learner could dodge the choice')
    }
  }
})

/* ══ 3. Distractors ══════════════════════════════════════════════════ */

test('a distractor is never the letter it is standing in for', () => {
  let rng = 0
  const next = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648 }
  for (const row of SPELLING_BANK.slice(0, 200)) {
    const word = row.word.toUpperCase()
    for (const letter of word.toLowerCase()) {
      const out = letterDistractors(letter, word, next)
      assert.equal(out.length, 2, `${word}/${letter}: ${out.length} distractors`)
      assert.ok(!out.includes(letter), `${word}: "${letter}" was offered against itself`)
      assert.equal(new Set(out).size, 2, `${word}/${letter}: the two distractors are the same letter`)
    }
  }
})

test('distractors are plausible — the confusion table or the word itself', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  // Over many draws for one word, the great majority must come from a real
  // confusion or from a letter of the word. A purely random distractor is the
  // fallback for a letter that offers neither, not the normal case.
  const word = 'NECESSARY'
  let plausible = 0
  let total = 0
  for (let i = 0; i < 400; i += 1) {
    for (const letter of word.toLowerCase()) {
      for (const d of letterDistractors(letter, word, Math.random)) {
        total += 1
        const confusable = (LETTER_CONFUSIONS[letter] || '').includes(d)
        const inWord = word.toLowerCase().includes(d)
        if (confusable || inWord) plausible += 1
      }
    }
  }
  assert.ok(plausible / total > 0.85, `only ${Math.round((plausible / total) * 100)}% of distractors were plausible`)
  for (const [letter, confusions] of Object.entries(LETTER_CONFUSIONS)) {
    assert.ok(alphabet.includes(letter), `"${letter}" is not a letter`)
    assert.ok(!confusions.includes(letter), `"${letter}" is listed as confusable with itself`)
  }
})

/* ══ 4. Every row advances the word ══════════════════════════════════ */

test('a wrong letter still advances the word — nobody is trapped on one letter', () => {
  // Answer EVERYTHING wrongly for as long as the bike survives, then check
  // that the letters seen advanced through the word rather than repeating.
  const ride = createRide({ mode: 'spell', difficulty: 'easy', items: ITEMS, seed: 'trap' })
  const seen = []
  let frames = 0
  while (!ride.over && frames < 60 * 300) {
    let target = null
    for (const row of ride.rows) if (!row.resolved && (!target || row.y > target.y)) target = row
    if (target) steer(ride, (target.correctLane + 1) % 3)
    const before = ride.active
    advance(ride, 1 / 60)
    if (before && before.filled.length > seen.length && before === ride.active) {
      seen.push(before.filled.length)
    }
    frames += 1
  }
  assert.equal(ride.outcome, 'wrecked', 'answering everything wrongly should end the run')
  assert.ok(seen.length === 0 || seen.every((n, i) => i === 0 || n > seen[i - 1]), 'the word did not advance')
  assert.equal(ride.hearts, 0)
})

/* ══ 5. Damage and repair ════════════════════════════════════════════ */

test('five wrong letters end the run and six right ones mend a part', () => {
  assert.equal(MAX_HEARTS, 5)
  assert.equal(REPAIR_STREAK, 6)
  assert.ok(repairsAt(6, 4), 'six in a row must mend a part')
  assert.ok(!repairsAt(6, MAX_HEARTS), 'a whole bike cannot be mended further')
  assert.ok(!repairsAt(5, 3), 'five is not the beat')
  assert.ok(repairsAt(12, 3), 'the repair repeats every six')
  // The struggling learner must have a way back up, not just a slower death.
  const ride = createRide({ mode: 'spell', difficulty: 'easy', items: ITEMS, seed: 'repair' })
  ride.hearts = 2
  let frames = 0
  let mended = false
  while (!ride.over && frames < 60 * 400 && !mended) {
    let target = null
    for (const row of ride.rows) if (!row.resolved && (!target || row.y > target.y)) target = row
    if (target) steer(ride, target.correctLane)
    for (const event of advance(ride, 1 / 60)) if (event.type === 'repair') mended = true
    frames += 1
  }
  assert.ok(mended, 'a clean streak never mended the bike')
  assert.ok(ride.hearts > 2)
})

test('the streak bonus is capped, so one long run cannot dwarf the ride', () => {
  assert.equal(scoreForLetter(0), 10)
  assert.equal(scoreForLetter(5), 20)
  assert.equal(scoreForLetter(100), 30)
  assert.equal(scoreForLetter(1000), 30)
})

/* ══ 6. Repetition ═══════════════════════════════════════════════════ */

test('a missed word comes back later in the same ride', () => {
  const items = ITEMS.slice(0, 60)
  const ride = createRide({ mode: 'spell', difficulty: 'easy', items, seed: 'repeat' })
  const order = []
  let frames = 0
  let missed = null
  while (!ride.over && frames < 60 * 900) {
    let target = null
    for (const row of ride.rows) if (!row.resolved && (!target || row.y > target.y)) target = row
    // Miss the first word outright, then play perfectly.
    const deliberate = !missed && target
    if (target) steer(ride, deliberate ? (target.correctLane + 1) % 3 : target.correctLane)
    for (const event of advance(ride, 1 / 60)) {
      if (event.type === 'present') order.push(event.challenge.word)
      if (event.type === 'wrong' && !missed) missed = event.challenge.word
    }
    frames += 1
    if (ride.atTown && !ride.over) departTown(ride)
  }
  assert.ok(missed, 'nothing was missed, so nothing could come back')
  const appearances = order.filter((w) => w === missed).length
  assert.ok(appearances >= 2, `"${missed}" was missed and never came back (${appearances} appearance)`)
  assert.deepEqual(REPEAT_GAPS, [3, 10])
})

test('a missed word is scheduled to return in a LATER SESSION, in the shared record', () => {
  const items = ITEMS.slice(0, 40)
  const ride = createRide({ mode: 'spell', difficulty: 'easy', items, seed: 'cross', stage: 7, session: 's1' })
  let frames = 0
  let missed = null
  while (!ride.over && frames < 60 * 400 && !missed) {
    let target = null
    for (const row of ride.rows) if (!row.resolved && (!target || row.y > target.y)) target = row
    if (target) steer(ride, (target.correctLane + 1) % 3)
    for (const event of advance(ride, 1 / 60)) if (event.type === 'wrong') missed = event.challenge.word
    frames += 1
  }
  assert.ok(missed)
  // The word is finished (right or wrong, every row advances it), so the pool
  // carries it by the time the challenge completes.
  while (!ride.over && frames < 60 * 500 && !ride.pool[missed]) {
    let target = null
    for (const row of ride.rows) if (!row.resolved && (!target || row.y > target.y)) target = row
    if (target) steer(ride, (target.correctLane + 1) % 3)
    advance(ride, 1 / 60)
    frames += 1
  }
  const entry = entryFor(ride.pool, missed)
  assert.ok(entry.misses > 0, `${missed} was missed but the record does not say so`)
  assert.ok(entry.dueAt > 7, `${missed} is due at stage ${entry.dueAt}, which is not later than this one`)
  assert.ok(!isMastered(entry), 'a missed word must not read as mastered')

  // …and the NEXT ride opens with it.
  const carried = carriedForwardWords({ items, pool: ride.pool, stage: entry.dueAt, rng: () => 0.5 })
  assert.ok(carried.some((item) => item.word === missed), `${missed} was not carried into the next ride`)
})

test('a clean word counts one mastery session, and a miss resets the count', () => {
  const items = ITEMS.slice(0, 8)
  let pool = {}
  for (const session of ['s1', 's2', 's3']) {
    const ride = createRide({ mode: 'spell', difficulty: 'easy', items, pool, stage: 0, session, seed: `m-${session}` })
    let frames = 0
    while (!ride.over && frames < 60 * 400) {
      let target = null
      for (const row of ride.rows) if (!row.resolved && (!target || row.y > target.y)) target = row
      if (target) steer(ride, target.correctLane)
      advance(ride, 1 / 60)
      frames += 1
      if (ride.atTown && !ride.over) departTown(ride)
    }
    pool = ride.pool
  }
  const mastered = Object.keys(pool).filter((word) => isMastered(entryFor(pool, word)))
  assert.ok(mastered.length > 0, 'three clean sessions mastered nothing')
})

/* ══ 7. The route ════════════════════════════════════════════════════ */

test('the nine towns name real bands of the bundled bank', () => {
  assert.equal(RIDE_TOWNS.length, 9)
  const bands = new Set(SPELLING_BANDS.map((b) => b.id))
  for (const town of RIDE_TOWNS) {
    assert.ok(bands.has(town.band), `${town.name} names band "${town.band}", which the bank does not have`)
    assert.ok(wordsForTown(ITEMS, RIDE_TOWNS.indexOf(town)).length >= WORDS_PER_TOWN,
      `${town.name} cannot fill a ${WORDS_PER_TOWN}-word leg`)
  }
  assert.equal(RIDE_TOWNS[0].name, 'Lusaka')
  assert.equal(RIDE_TOWNS[RIDE_TOWNS.length - 1].name, 'Livingstone')
})

test('a town whose band is empty falls back to the whole pack rather than stalling', () => {
  const oneBand = ITEMS.filter((item) => item.band === 'silent')
  for (let i = 0; i < RIDE_TOWNS.length; i += 1) {
    assert.ok(wordsForTown(oneBand, i).length > 0, `town ${i} would have no words at all`)
  }
})

/* ══ 8. Word Choice ══════════════════════════════════════════════════ */

test('the Word Choice bank obeys the content rules', () => {
  const ids = new Set()
  for (const item of SPELLING_CHOICE_BANK) {
    assert.ok(item.id && !ids.has(item.id), `duplicate or missing id: ${item.id}`)
    ids.add(item.id)
    assert.equal(gapCount(item.text), 1, `"${item.id}" needs exactly one ___ gap`)
    assert.ok(!sentenceLeaksWord(item.answer, item.text), `"${item.id}" prints its own answer`)
    assert.equal(item.distractors.length, DISTRACTOR_COUNT, `"${item.id}" needs exactly two wrong options`)
    const lanes = new Set([item.answer.toLowerCase(), ...item.distractors.map((d) => d.toLowerCase())])
    assert.equal(lanes.size, 3, `"${item.id}" has two identical lanes`)
    // ANSWERS only — a distractor's job is to be the wrong spelling.
    assert.equal(americanisms(item.answer).length, 0, `"${item.id}" answers in the American form`)
    assert.deepEqual(validateSentence(item), [], `"${item.id}": ${validateSentence(item).join('; ')}`)
  }
  assert.ok(SPELLING_CHOICE_BANK.length >= CHOICE_WORDS_PER_RIDE, 'not enough sentences for one ride')
})

test('a Word Choice row is three whole words with the answer among them', () => {
  const item = SPELLING_CHOICE_BANK[0]
  const challenge = buildChoiceChallenge(item, { rng: () => 0.4 })
  assert.equal(challenge.steps.length, 1, 'a sentence resolves in one row')
  assert.equal(challenge.steps[0].options.length, 3)
  assert.ok(challenge.steps[0].options.includes(item.answer))
  assert.equal(challenge.wordy, true)
  assert.equal(challenge.prompt, item.text)
})

test('the lanes are shuffled, so the answer is not always in one place', () => {
  const item = { text: 'a ___ b', answer: 'x', distractors: ['y', 'z'] }
  const positions = new Set()
  for (let i = 0; i < 60; i += 1) positions.add(laneOptions(item, Math.random).indexOf('x'))
  assert.ok(positions.size > 1, 'the answer landed in the same lane every time')
})

test('Firestore sentences merge OVER the bundled bank without replacing it', () => {
  const merged = mergeChoiceItems(SPELLING_CHOICE_BANK, [
    { id: 'quiet-teacher', text: 'Stay ___ in the library.', answer: 'quiet', distractors: ['quite', 'quit'] },
    { id: 'brand-new', text: 'The ___ is broken.', answer: 'window', distractors: ['windo', 'windows'] },
  ])
  assert.equal(merged.length, SPELLING_CHOICE_BANK.length + 1, 'the merge replaced rather than folded')
  assert.equal(merged.find((i) => i.id === 'quiet-teacher').text, 'Stay ___ in the library.')
  assert.ok(merged.some((i) => i.id === 'brand-new'))
  // A malformed record is dropped, never rendered as a blank lane.
  const guarded = mergeChoiceItems(SPELLING_CHOICE_BANK, [{ id: 'broken', text: 'x ___', answer: 'a', distractors: ['b'] }])
  assert.equal(guarded.length, SPELLING_CHOICE_BANK.length)
  assert.equal(mergeChoiceItems(SPELLING_CHOICE_BANK, []).length, SPELLING_CHOICE_BANK.length)
})

test('a sentence is refused unless it can actually be played', () => {
  assert.deepEqual(validateSentence({ text: 'Be ___ now.', answer: 'quiet', distractors: ['quite', 'quit'] }), [])
  assert.ok(validateSentence({ text: 'Be quiet ___.', answer: 'quiet', distractors: ['quite', 'quit'] }).length)
  assert.ok(validateSentence({ text: 'Be ___ now.', answer: 'quiet', distractors: ['quite'] }).length)
  assert.ok(validateSentence({ text: 'Be ___ ___ now.', answer: 'quiet', distractors: ['quite', 'quit'] }).length)
  assert.ok(validateSentence({ text: 'Be ___ now.', answer: 'quiet', distractors: ['Quiet', 'quit'] }).length,
    'a distractor equal to the answer would mark a right answer wrong')
  assert.ok(validateSentence({ text: 'Pick a ___.', answer: 'color', distractors: ['colur', 'collor'] }).length,
    'the American form must be refused in an ANSWER')
})

test('an unreviewed sentence is never servable, whatever its flags say', () => {
  const good = { text: 'Be ___ now.', answer: 'quiet', distractors: ['quite', 'quit'], status: 'approved', approved: true, active: true }
  assert.equal(servableSentence(good), true)
  assert.equal(servableSentence({ ...good, status: 'pending' }), false)
  assert.equal(servableSentence({ ...good, approved: false }), false, 'approved and status must move together')
  assert.equal(servableSentence({ ...good, active: false }), false)
  // Flags cannot vouch for a record that fails a machine check.
  assert.equal(servableSentence({ ...good, distractors: ['quite'] }), false)
  assert.equal(normaliseSentence({}).distractors.length, 0)
})

/* ══ 9. The road ═════════════════════════════════════════════════════ */

test('the road recedes to a vanishing point rather than being a wall', () => {
  const geom = roadGeometry(390, 780)
  const near = halfWidthAt(geom.riderY, geom)
  const far = halfWidthAt(geom.roadTopY, geom)
  assert.ok(far < near / 4, `the road is ${far.toFixed(1)}px wide at the horizon and ${near.toFixed(1)}px at the rider`)
  assert.ok(halfWidthAt(geom.vanishY, geom) <= 0.001, 'the edges do not meet at the vanishing point')
  // Three lanes, symmetrical about the centre, and they narrow with the road.
  assert.ok(laneCentreAt(0, geom.riderY, geom) < geom.width / 2)
  assert.ok(laneCentreAt(2, geom.riderY, geom) > geom.width / 2)
  assert.equal(laneCentreAt(1, geom.riderY, geom), geom.width / 2)
  const spreadNear = laneCentreAt(2, geom.riderY, geom) - laneCentreAt(0, geom.riderY, geom)
  const spreadFar = laneCentreAt(2, geom.roadTopY, geom) - laneCentreAt(0, geom.roadTopY, geom)
  assert.ok(spreadFar < spreadNear, 'the lanes do not converge with distance')
})

test('a row crawls in the distance and sweeps past the rider', () => {
  const geom = roadGeometry(390, 780)
  const farStep = trackToScreen(-40, geom) - trackToScreen(-70, geom)
  const nearStep = trackToScreen(geom.resolveY, geom) - trackToScreen(geom.resolveY - 30, geom)
  assert.ok(nearStep > farStep * 4, 'the same step of road moves the same distance near and far — that is not perspective')
  assert.ok(depthScale(geom.roadTopY, geom) < depthScale(geom.riderY, geom))
  assert.ok(depthScale(geom.roadTopY, geom) >= 0.12, 'a far tile must be small, never invisible')
})

test('a row crosses the WHOLE road, and is visible for most of it', () => {
  // THE BUG THIS EXISTS FOR. The ride's track and the road's mapping are two
  // modules that have to agree about one number, and they did not: rows
  // resolved at track 0 while `trackToScreen` mapped −70…riderY across the
  // whole road, so every row lived in the top five pixels of the tarmac at
  // zero opacity. The game was completely correct and completely invisible.
  // Neither module's own tests could see it — the core never asks where a row
  // is drawn and the road never sees a ride — so the check belongs BETWEEN
  // them, which is worth the awkwardness of a test that spans two files.
  const geom = roadGeometry(390, 768)
  const ride = createRide({ items: ITEMS, resolveAt: geom.resolveY, seed: 'sweep' })
  const roadHeight = geom.resolveY - geom.roadTopY
  const swept = trackToScreen(ride.resolveAt, geom) - trackToScreen(SPAWN_Y, geom)
  assert.ok(
    swept > roadHeight * 0.9,
    `a row sweeps ${swept.toFixed(1)}px of a ${roadHeight.toFixed(1)}px road`,
  )
  // …and it is DRAWABLE, not merely present. A row halfway down the road that
  // renders at zero alpha is the same bug wearing a different number.
  const half = trackToScreen(ride.resolveAt / 2, geom)
  assert.ok(fadeIn(depthScale(half, geom)) > 0.3, 'a row halfway down the road is still faded out')
  assert.ok(depthScale(trackToScreen(ride.resolveAt, geom), geom) > 0.9, 'a row at the rider is not full size')

  // A ride built with no viewport at all — the node default — must still be
  // one somebody could see, or this guard only covers the caller that passes.
  const bare = createRide({ items: ITEMS, seed: 'bare' })
  assert.ok(bare.resolveAt > 300, `the default rider line is ${bare.resolveAt}px down a road`)
})

test('a tap anywhere on the screen picks a lane — there is nothing to miss', () => {
  for (const width of [320, 390, 520, 1440]) {
    assert.equal(laneFromX(0, width), 0)
    assert.equal(laneFromX(width / 2, width), 1)
    assert.equal(laneFromX(width - 1, width), 2)
    // Including the verge, and including a tap past the edge.
    assert.equal(laneFromX(-50, width), 0)
    assert.equal(laneFromX(width + 50, width), 2)
  }
})

/* ══ 10. Voice ═══════════════════════════════════════════════════════ */

test('the voice is a British-forms English, by a stated accent order', () => {
  const voice = (lang) => ({ lang, name: lang })
  assert.equal(VOICE_PREFERENCE[0], 'en-za')
  assert.equal(VOICE_PREFERENCE[1], 'en-gb')
  assert.ok(VOICE_PREFERENCE.indexOf('en-us') > VOICE_PREFERENCE.indexOf('en-gb'), 'a US voice must never outrank a British one')
  assert.equal(resolveVoice([voice('en-US'), voice('en-GB'), voice('en-ZA')]).lang, 'en-ZA')
  assert.equal(resolveVoice([voice('en-US'), voice('en-GB')]).lang, 'en-GB')
  assert.equal(resolveVoice([voice('en_US')]).lang, 'en_US', 'an underscore locale is still English')
  assert.equal(resolveVoice([voice('fr-FR'), voice('en-KE')]).lang, 'en-KE')
  // A device with no English and a device with no voices at all must both be
  // survivable — the game is fully playable without speech.
  assert.equal(resolveVoice([voice('fr-FR')]), null)
  assert.equal(resolveVoice([]), null)
  assert.equal(resolveVoice(null), null)
})

/* ══ 11. The record and the reward ═══════════════════════════════════ */

test('a ride is banked once, and never awards a star', () => {
  const before = { ...emptyProgress(), stars: { 1: 3 }, stagesPlayed: 4 }
  const after = settleRide(before, { pool: { NECESSARY: { correct: 1 } }, runId: 'run-1' })
  assert.equal(after.stagesPlayed, 5)
  assert.deepEqual(after.stars, { 1: 3 }, 'a ride must not star a chapter the learner never opened')
  // Idempotent BY IDENTITY, so the caller's `next !== current` skips the write.
  const again = settleRide(after, { pool: { OTHER: {} }, runId: 'run-1' })
  assert.equal(again, after, 'the same run settled twice')
})

test('a high score is per mode and per difficulty, and merges by the better of two devices', () => {
  let progress = emptyProgress()
  progress = recordRideBest(progress, { mode: 'spell', difficulty: 'medium', score: 1240 })
  assert.equal(rideBest(progress, 'spell', 'medium'), 1240)
  assert.equal(rideBest(progress, 'spell', 'hard'), 0, 'a difficulty must not inherit another\'s best')
  assert.equal(rideBest(progress, 'dictation', 'medium'), 0)
  // A worse ride is a no-op, by identity.
  assert.equal(recordRideBest(progress, { mode: 'spell', difficulty: 'medium', score: 900 }), progress)
  const phone = recordRideBest(emptyProgress(), { mode: 'spell', difficulty: 'medium', score: 2000 })
  const laptop = recordRideBest(emptyProgress(), { mode: 'spell', difficulty: 'medium', score: 1500 })
  assert.equal(rideBest(mergeProgress(phone, laptop), 'spell', 'medium'), 2000)
  assert.equal(rideBest(mergeProgress(laptop, phone), 'spell', 'medium'), 2000, 'the merge is not symmetrical')
  // And it survives a round trip through the stored shape.
  assert.equal(rideBest(normaliseProgress(JSON.parse(JSON.stringify(phone))), 'spell', 'medium'), 2000)
})

test('the ride reports LETTERS to the shared rewards path, not words', () => {
  const { ride } = autoplay({ maxFrames: 60 * 600 })
  const result = rideResult({ game: { id: 'g' }, ride })
  assert.equal(result.correct, ride.stats.correct)
  assert.equal(result.correct + result.wrong, ride.stats.letters)
  assert.ok(result.accuracy >= 0 && result.accuracy <= 100)
  assert.equal(result.game.id, 'g')
  assert.ok(Number.isInteger(result.timeSpent) && result.timeSpent >= 0)
  assert.ok(Number.isInteger(result.score) && result.score >= 0)
})

/* ══ 12. The report ══════════════════════════════════════════════════ */

test('the report ranks the words that gave the most trouble first', () => {
  const stats = {
    byWord: {
      NECESSARY: { right: 6, wrong: 3, attempts: 9 },
      SEPARATE: { right: 7, wrong: 1, attempts: 8 },
      RHYTHM: { right: 6, wrong: 0, attempts: 6 },
      BELIEVE: { right: 4, wrong: 3, attempts: 7 },
    },
  }
  const ranked = troubleWords(stats)
  assert.deepEqual(ranked.map((r) => r.word), ['BELIEVE', 'NECESSARY', 'SEPARATE'])
  assert.ok(!ranked.some((r) => r.word === 'RHYTHM'), 'a word with no misses is not "needs work"')
  assert.equal(ranked[0].accuracy, 57)
})

test('the CSV is a CSV, including when a field contains a comma', () => {
  const csv = reportCsv({ byWord: { NECESSARY: { right: 6, wrong: 3 } } }, { mode: 'spell, quick', difficulty: 'hard' })
  const lines = csv.split('\n')
  assert.equal(lines[0], 'word,letters_right,letters_wrong,accuracy_percent,mode,difficulty')
  assert.equal(lines[1], 'NECESSARY,6,3,67,"spell, quick",hard')
  assert.equal(reportCsv({}).split('\n').length, 1, 'an empty report is a header and nothing else')
})

/* ══ 13. Modes ═══════════════════════════════════════════════════════ */

test('a word plays the same however it is presented', () => {
  const item = { word: 'BELIEVE', band: 'ie-ei', clue: 'trust it' }
  const spell = buildWordChallenge(item, { mode: 'spell', rng: () => 0.5 })
  const dictation = buildWordChallenge(item, { mode: 'dictation', rng: () => 0.5 })
  assert.equal(spell.steps.length, 'BELIEVE'.length)
  assert.equal(dictation.steps.length, spell.steps.length)
  assert.equal(spell.kind, 'spell')
  assert.equal(dictation.kind, 'dictation')
  assert.equal(spell.wordy, false)
  for (const step of spell.steps) assert.equal(step.options.length, 3)
})

test('Word Choice is a fixed set and the letter modes are a nine-town route', () => {
  const { ride } = autoplay({ mode: 'choice', maxFrames: 60 * 900 })
  assert.equal(ride.outcome, 'finished')
  assert.equal(ride.wordsDone, CHOICE_WORDS_PER_RIDE)
  const letters = autoplay({ mode: 'dictation', maxFrames: 60 * 4000 })
  assert.equal(letters.ride.outcome, 'arrived')
  assert.equal(letters.ride.wordsDone, RIDE_TOWNS.length * WORDS_PER_TOWN)
})

/* ══ 14. The cohort report ═══════════════════════════════════════════ */

test('the cohort counts words the grade is still failing, and drops the ones it learned', () => {
  const learned = { misses: 4, correct: 3, sessions: ['a', 'b', 'c'] }
  const struggling = { misses: 2, correct: 0, sessions: [] }
  const clean = { misses: 0, correct: 1, sessions: ['a'] }
  const out = aggregateCohort([
    { NECESSARY: struggling, SEPARATE: struggling },
    { NECESSARY: struggling },
    { NECESSARY: learned },
    { SEPARATE: clean },
    { RHYTHM: struggling },
  ])
  assert.equal(out.learners, 5)
  assert.equal(out.words[0].word, 'NECESSARY', 'the worst word is not first')
  assert.equal(out.words[0].missedBy, 2)
  assert.equal(out.words[0].seenBy, 3)
  assert.equal(out.words[0].masteredBy, 1, 'a learner who mastered it is not counted as missing it')
  // The rate is of the learners who MET the word. Out of the whole cohort, a
  // word only a third of the grade has reached would look easy.
  assert.equal(out.words[0].missRate, 67)
  assert.ok(!out.words.some((row) => row.word === 'SEPARATE' && row.missedBy === 2))
})

test('a cohort too small to be anonymous does not print percentages', () => {
  const pool = { NECESSARY: { misses: 1, correct: 0, sessions: [] } }
  assert.equal(aggregateCohort([pool, pool, pool]).suppressed, true)
  assert.equal(aggregateCohort(Array.from({ length: MIN_COHORT }, () => pool)).suppressed, false)
  assert.equal(aggregateCohort([]).suppressed, false, 'no learners is not a suppressed cohort, it is an empty one')
  assert.equal(aggregateCohort(null).learners, 0)
})

test('the cohort report names no learner, in its output or its CSV', () => {
  const out = aggregateCohort([{ NECESSARY: { misses: 1, correct: 0, sessions: [] } }])
  const serialised = JSON.stringify(out) + cohortCsv(out)
  for (const field of ['uid', 'userId', 'displayName', 'email']) {
    assert.ok(!serialised.includes(field), `the cohort table carries "${field}"`)
  }
  assert.equal(cohortCsv(out).split('\n')[0].startsWith('word,'), true)
})

console.log('')
console.log(`spelling-ride — ${count} checks, ${failures} failed`)
if (failures) process.exit(1)
