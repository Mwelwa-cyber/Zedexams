/**
 * Spelling Ride — every decision the game makes, with no canvas and no React.
 *
 * A learner cycles down a three-lane road. Rows of letters come towards them,
 * **each row filling all three lanes**, and they steer into the letter that
 * comes next in the word. This module owns the pacing, the distractors, the
 * route, the repetition and the scoring; `spellingRideRoad.js` owns where a
 * thing is drawn and `SpellingRideGame.jsx` owns the screen.
 *
 * ── The three rules that are the game, not decoration ───────────────────
 *
 *   EVERY ROW FILLS ALL THREE LANES. There is no empty lane to dodge into, so
 *   a run cannot be completed by avoiding letters and every row is a CHOICE.
 *   That is what makes the record a measurement of spelling rather than of
 *   thumb position, and §8's report only means anything while it holds.
 *   `buildLetterStep` and `buildChoiceStep` both return exactly three options
 *   and `test:spelling-ride` fails if either ever returns another number.
 *
 *   SPACING IS TIME, NEVER PIXELS. `rowGapPx = speed × secondsPerRow`. A fixed
 *   pixel gap means the thinking time silently shrinks every time the bike
 *   speeds up — the learner is given less time to spell exactly as the words
 *   get harder, and nothing on screen says so. Speed rises across a run; the
 *   seconds between rows do not, and the guard measures the minimum over a
 *   long autoplay run rather than trusting the formula.
 *
 *   EVERY ROW ADVANCES THE WORD BY ONE STEP, right or wrong. A learner who
 *   cannot spell `necessary` is not trapped on its second `s` — they see the
 *   whole word finished, with their own wrong letter in it and the right one
 *   spoken back. Being stuck is what makes a child stop playing, and a word
 *   they never complete is a word they never see.
 *
 * ── What is mutable here, and why that is deliberate ────────────────────
 *
 * `advance()` MUTATES the ride. Sixty frames a second through an immutable
 * state tree would allocate a new object graph per frame on the cheap Android
 * handsets this is built for, which is the one thing §7 asks it not to do. So
 * the ride is a mutable state machine whose every DECISION is a pure function
 * — `nextChallenge`, `letterDistractors`, `scoreForLetter`, `heartsAfter` —
 * and those are what the tests drive. Events come back on a reused array.
 */

import {
  entryFor,
  isMastered,
  recordCorrect,
  recordMiss,
  dueWords,
  trickyWords,
  hashString,
  seededRng,
  shuffleWith,
} from './spellingStagesCore.js'
import { laneOptions, normaliseSentence } from './spellingSentenceCore.js'

/* ══════════════════════════════════════════════════════════════════════
 *  1. Modes, difficulty and pacing
 * ══════════════════════════════════════════════════════════════════════ */

/** The three ways a word can be asked for. */
export const RIDE_MODES = Object.freeze([
  {
    id: 'spell',
    name: 'Spell It',
    blurb: 'The word is said and shown, then it hides. Collect the letters in order.',
  },
  {
    id: 'dictation',
    name: 'Dictation',
    blurb: 'You only hear the word. This is how spelling is really examined.',
  },
  {
    id: 'choice',
    name: 'Word Choice',
    blurb: 'Whole words in the lanes. Pick the one the sentence needs.',
  },
])

export const RIDE_MODE_IDS = Object.freeze(RIDE_MODES.map((m) => m.id))

/**
 * Speed in px/s and the SECONDS between rows.
 *
 * The seconds are the thinking time and they are the number that matters; the
 * speed only decides how far apart that puts the rows on screen.
 */
export const RIDE_DIFFICULTIES = Object.freeze({
  easy: { id: 'easy', name: 'Easy', blurb: 'gentle ride', speed: 120, secondsPerRow: 3.0 },
  medium: { id: 'medium', name: 'Medium', blurb: 'a bit of pace', speed: 165, secondsPerRow: 2.6 },
  hard: { id: 'hard', name: 'Hard', blurb: 'full speed', speed: 215, secondsPerRow: 2.2 },
})

export const RIDE_DIFFICULTY_IDS = Object.freeze(Object.keys(RIDE_DIFFICULTIES))

/** Anything unrecognised rides at Medium rather than throwing at a learner. */
export function difficultyOf(id) {
  return RIDE_DIFFICULTIES[id] || RIDE_DIFFICULTIES.medium
}

/**
 * The gap between two rows, in pixels of road.
 *
 * THE WHOLE POINT OF THIS FUNCTION IS THAT SPEED IS AN ARGUMENT. A constant
 * here — the bug this replaces — makes the seconds fall as the bike speeds up.
 */
export function rowGapPx(speed, secondsPerRow) {
  return Math.max(1, Number(speed) || 0) * Math.max(0.1, Number(secondsPerRow) || 0)
}

/** The inverse, for a test that has measured a gap and wants the seconds. */
export function secondsBetween(gapPx, speed) {
  const v = Math.max(1, Number(speed) || 0)
  return (Number(gapPx) || 0) / v
}

/**
 * How fast the bike is going at a given town.
 *
 * It rises, and it is CAPPED — a ride that accelerates without limit ends as
 * a reflex test. The seconds between rows never move, so the extra speed
 * spreads the rows further apart rather than hurrying the learner.
 */
export const SPEED_STEP_PER_TOWN = 6
export const MAX_SPEED_GAIN = 40

export function speedAtTown(baseSpeed, townIndex) {
  const gain = Math.min(MAX_SPEED_GAIN, Math.max(0, Number(townIndex) || 0) * SPEED_STEP_PER_TOWN)
  return (Number(baseSpeed) || 0) + gain
}

/* ══════════════════════════════════════════════════════════════════════
 *  2. The route
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Nine towns down the T1, Lusaka to Livingstone, each one a BAND of the
 * bundled Grade 7 bank.
 *
 * THE BANDS ARE THE BANK'S, NOT A SECOND LADDER. `spellingBank.js` groups its
 * 879 words by what makes them hard and states that the band order IS the
 * difficulty ladder. Spelling Ride could have shipped its own 215-word list
 * with its own idea of difficulty — the prototype did — and then there would
 * be two Grade 7 spelling ladders in one product, disagreeing, with an admin
 * screen editing only one of them. So the towns are a ROUTE over the existing
 * ladder: the names and the mileage are the ride's, the words and their order
 * of difficulty are the bank's.
 *
 * `band: null` on a town would mean "any word", which no town needs today —
 * but `wordsForTown` handles it, because a bank that loses a band should cost
 * a town its theme and not its words.
 */
export const RIDE_TOWNS = Object.freeze([
  { name: 'Lusaka', band: 'sound-out', set: 'Words that behave' },
  { name: 'Chilanga', band: 'irregular', set: 'Sight words' },
  { name: 'Kafue', band: 'double', set: 'Double letters' },
  { name: 'Mazabuka', band: 'silent', set: 'Silent letters' },
  { name: 'Monze', band: 'ie-ei', set: '-ie and -ei' },
  { name: 'Choma', band: 'suffix', set: 'Suffix rules' },
  { name: 'Kalomo', band: 'unstressed', set: '-tion and hidden vowels' },
  { name: 'Zimba', band: 'homophone', set: 'Sound-alike words' },
  { name: 'Livingstone', band: 'subject', set: 'Science and Social Studies' },
])

/** Words completed before the next town. */
export const WORDS_PER_TOWN = 4

/** Word Choice is a fixed set rather than a route — twelve sentences. */
export const CHOICE_WORDS_PER_RIDE = 12

export function townAt(index) {
  const i = Math.max(0, Math.min(RIDE_TOWNS.length - 1, Math.floor(Number(index) || 0)))
  return RIDE_TOWNS[i]
}

/**
 * The words a town may draw from: its own band, or the whole pack when that
 * band is empty.
 *
 * A TOWN IS NEVER EMPTY. A band the pack does not carry — an admin-authored
 * pack, a future grade, a bank that dropped a band — would otherwise be a
 * town with no words and a ride that stops at Kafue forever.
 */
export function wordsForTown(items = [], townIndex = 0) {
  const town = townAt(townIndex)
  if (!town.band) return items
  const inBand = items.filter((item) => item.band === town.band)
  return inBand.length ? inBand : items
}

/* ══════════════════════════════════════════════════════════════════════
 *  3. Distractors
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * The letters a Grade 7 actually reaches for instead of each one: vowel
 * swaps, `c/k/s`, `b/d/p`, `m/n`, `i/e/y`, `f/v`.
 *
 * A RANDOM LETTER IS NOT A DISTRACTOR. `Q` beside the `s` of `necessary` is
 * ruled out on sight, which makes the row easier than no row at all — and it
 * makes the resulting data worthless, because a learner who picks the right
 * letter from three implausible ones has demonstrated nothing.
 */
export const LETTER_CONFUSIONS = Object.freeze({
  a: 'eu', b: 'dp', c: 'sk', d: 'bt', e: 'ai', f: 'v', g: 'jq', h: 'n', i: 'ey',
  j: 'g', k: 'cq', l: 'r', m: 'n', n: 'mh', o: 'ua', p: 'bq', q: 'kg', r: 'l',
  s: 'cz', t: 'd', u: 'oa', v: 'fw', w: 'v', x: 's', y: 'i', z: 's',
})

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

function pickFrom(list, rng) {
  return list[Math.floor(rng() * list.length)]
}

/**
 * Two wrong letters for one right one.
 *
 * One from the confusion table, one from ELSEWHERE IN THE SAME WORD — a
 * transposition, which is the other mistake spellers actually make. The
 * alphabet is only ever the last resort for a word that offers neither.
 *
 * NEITHER IS EVER THE CORRECT LETTER. That is the invariant the whole row
 * depends on: two right lanes would mark a right answer wrong.
 */
export function letterDistractors(correct, word, rng = Math.random) {
  const right = String(correct || '').toLowerCase()
  const out = new Set()

  const confusable = LETTER_CONFUSIONS[right] || ''
  if (confusable.length) out.add(pickFrom(confusable.split(''), rng))

  const elsewhere = String(word || '')
    .toLowerCase()
    .split('')
    .filter((letter) => letter !== right && /[a-z]/.test(letter))
  if (elsewhere.length && rng() < 0.7) out.add(pickFrom(elsewhere, rng))

  let guard = 0
  while (out.size < 2 && guard < 200) {
    guard += 1
    const letter = ALPHABET[Math.floor(rng() * 26)]
    if (letter !== right) out.add(letter)
  }
  // `out` cannot contain `right`: the confusion table never maps a letter to
  // itself, `elsewhere` filters it out and the loop refuses it. Filtered again
  // anyway, because this is the one place a bug would be invisible on screen.
  return [...out].filter((letter) => letter !== right).slice(0, 2)
}

/* ══════════════════════════════════════════════════════════════════════
 *  4. Challenges
 * ══════════════════════════════════════════════════════════════════════ */

let challengeSeq = 0

/** One row: the right answer and two wrong ones, in lane order. */
export function buildLetterStep(letter, word, rng = Math.random) {
  const options = [String(letter).toLowerCase(), ...letterDistractors(letter, word, rng)]
  return {
    correct: String(letter).toLowerCase(),
    options: shuffleWith(options, rng),
  }
}

/**
 * A word to spell, one row per letter.
 *
 * `mode` decides how it is PRESENTED (shown then hidden, or spoken only), not
 * how it is built — which is why a word missed in Dictation can come back in
 * Spell It without being rebuilt.
 */
export function buildWordChallenge(item, { mode = 'spell', rng = Math.random } = {}) {
  const word = String(item?.word || '').toUpperCase()
  challengeSeq += 1
  return {
    id: `c${challengeSeq}`,
    kind: mode === 'choice' ? 'spell' : mode,
    word,
    band: item?.band || null,
    clue: String(item?.clue || ''),
    // The pre-generated pronunciation, when an admin has voiced this word.
    // Threaded onto the challenge so the ride plays the free static file
    // rather than spending one of the learner's 60 daily AI calls per word —
    // a nine-town ride is up to 36 words, which without this would exhaust
    // the allowance in a single sitting. Same field the ladder's round reads.
    audio: String(item?.audio || ''),
    prompt: '',
    wordy: false,
    steps: word.split('').map((letter) => buildLetterStep(letter, word, rng)),
    filled: [],
    missed: false,
  }
}

/** A gap-fill sentence, resolved in one row of three whole words. */
export function buildChoiceChallenge(item, { rng = Math.random } = {}) {
  const sentence = normaliseSentence(item)
  challengeSeq += 1
  return {
    id: `c${challengeSeq}`,
    kind: 'choice',
    word: sentence.answer,
    band: 'homophone',
    clue: sentence.note,
    prompt: sentence.text,
    wordy: true,
    steps: [{ correct: sentence.answer, options: laneOptions(sentence, rng) }],
    filled: [],
    missed: false,
  }
}

/* ══════════════════════════════════════════════════════════════════════
 *  5. Repetition — inside the ride and across sessions
 * ══════════════════════════════════════════════════════════════════════ */

/** A missed word comes back about this many words later, then again later. */
export const REPEAT_GAPS = Object.freeze([3, 10])

/**
 * The words this ride opens with: the learner's own unfinished business.
 *
 * §3.5's "again in a later session" is not a second mechanism — it is this
 * one, reading the pool the ladder and the ride both write to. A word missed
 * yesterday is `due` today, so it is drawn first; a word mastered three
 * sessions running is not drawn at all.
 *
 * Capped, because a ride that opens with thirty tricky words is a punishment
 * for having struggled. The rest of the ride is fresh words from the town.
 */
export const CARRIED_WORDS = 4

export function carriedForwardWords({ items = [], pool = {}, stage = 0, rng = Math.random } = {}) {
  const byWord = new Map(items.map((item) => [item.word, item]))
  const due = dueWords(pool, stage)
  const tricky = trickyWords(pool)
  // Due first (their spacing has elapsed), then the worst of the tricky list
  // for a learner whose spacing has not come round yet but who is plainly
  // still struggling. Deduplicated, because a word is usually both.
  const ordered = [...new Set([...due, ...tricky])]
    .map((word) => byWord.get(word))
    .filter(Boolean)
  return shuffleWith(ordered.slice(0, CARRIED_WORDS * 2), rng).slice(0, CARRIED_WORDS)
}

/**
 * The next challenge: a word that is due back first, then a fresh one from
 * the town.
 *
 * The in-ride repeat queue is checked BEFORE the town's own words, because a
 * word the learner has just got wrong is the most valuable thing the ride can
 * show them and a town's word list is the least urgent.
 */
export function nextChallenge(ride) {
  const rng = ride.rng

  if (ride.mode === 'choice') {
    const item = ride.choiceQueue[ride.choiceAt % Math.max(1, ride.choiceQueue.length)]
    ride.choiceAt += 1
    return buildChoiceChallenge(item, { rng })
  }

  for (let i = 0; i < ride.repeats.length; i += 1) {
    if (ride.repeats[i].dueAtWord <= ride.wordsDone) {
      const due = ride.repeats.splice(i, 1)[0]
      const item = ride.byWord.get(due.word)
      if (item) return buildWordChallenge(item, { mode: ride.mode, rng })
      break
    }
  }

  if (ride.carried.length) {
    const item = ride.carried.shift()
    return buildWordChallenge(item, { mode: ride.mode, rng })
  }

  const pool = wordsForTown(ride.items, ride.townIndex)
  // Not-seen-this-ride first, so a town of forty words does not serve the
  // same six. Falls back to the whole town once they have all been seen —
  // repeating beats stopping.
  const unseen = pool.filter((item) => !ride.seen.has(item.word))
  const source = unseen.length ? unseen : pool
  const item = source.length ? source[Math.floor(rng() * source.length)] : null
  if (!item) return null
  ride.seen.add(item.word)
  return buildWordChallenge(item, { mode: ride.mode, rng })
}

/** Queue a missed word to come back, at both spacings, without duplicating. */
export function scheduleRepeats(ride, word) {
  if (!word || word.length < 2) return
  if (!ride.byWord.has(word)) return
  for (const gap of REPEAT_GAPS) {
    const dueAtWord = ride.wordsDone + gap
    if (ride.repeats.some((r) => r.word === word && r.dueAtWord === dueAtWord)) continue
    ride.repeats.push({ word, dueAtWord })
  }
}

/* ══════════════════════════════════════════════════════════════════════
 *  6. Scoring, damage and repair
 * ══════════════════════════════════════════════════════════════════════ */

export const MAX_HEARTS = 5
/** Six right in a row mends a bike part. The way back up, not just a slower death. */
export const REPAIR_STREAK = 6
export const WORD_BONUS = 50
export const FREEZE_SECONDS = 1.15

/** A right letter is worth more inside a streak, capped so it cannot run away. */
export function scoreForLetter(streak) {
  return 10 + Math.min(20, Math.max(0, Math.floor(Number(streak) || 0)) * 2)
}

/** Does this streak mend a part? Only on the beat, and only below the cap. */
export function repairsAt(streak, hearts, max = MAX_HEARTS) {
  const s = Math.floor(Number(streak) || 0)
  return s > 0 && s % REPAIR_STREAK === 0 && hearts < max
}

/* ══════════════════════════════════════════════════════════════════════
 *  7. The ride
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Where a row is created, in track units, and how far it has to travel.
 *
 * TRACK UNITS ARE SCREEN PIXELS OF ROAD, and that is load-bearing rather than
 * incidental: the difficulty table's speeds (120 / 165 / 215) are px/s, so a
 * row's journey has to be measured in the same pixels the road is drawn in or
 * the numbers mean nothing. `resolveAt` is therefore the rider's line —
 * supplied by the view, because only the view knows how tall the road is.
 *
 * THE BUG THIS REPLACES. `RESOLVE_Y` was a constant 0, so every row travelled
 * from −70 to 0 while `trackToScreen` mapped −70…riderY onto the whole road.
 * The rows resolved perfectly, on time, at the right pacing — and lived in the
 * top five pixels of the tarmac at zero opacity. The game was completely
 * correct and completely invisible, which no unit test could see: the core's
 * tests drive `advance` and never ask where a row was drawn, and the renderer's
 * tests ask about geometry and never see a ride. It took a screenshot.
 */
export const SPAWN_Y = -70

/** The rider's line, when the view has not said. A phone-ish road. */
export const DEFAULT_RESOLVE_AT = 604

/** Unresolved rows allowed on the road at once. */
export const LOOKAHEAD = 2

/**
 * A ride, ready to be advanced.
 *
 * `resolveAt` is where the rider sits, in track pixels — so `advance` can be
 * driven by a node test with no canvas at all. The renderer maps track units
 * onto the screen and never back.
 */
export function createRide({
  mode = 'spell',
  difficulty = 'medium',
  items = [],
  choiceItems = [],
  pool = {},
  stage = 0,
  session = 'ride',
  resolveAt = DEFAULT_RESOLVE_AT,
  seed = '',
  rng = null,
} = {}) {
  const diff = difficultyOf(difficulty)
  const draw = rng || (seed ? seededRng(hashString(String(seed))) : Math.random)
  const playable = items.filter((item) => item && typeof item.word === 'string' && item.word.length >= 2)

  const ride = {
    mode: RIDE_MODE_IDS.includes(mode) ? mode : 'spell',
    difficulty: diff.id,
    secondsPerRow: diff.secondsPerRow,
    baseSpeed: diff.speed,
    speed: diff.speed,
    resolveAt: Math.max(120, Number(resolveAt) || DEFAULT_RESOLVE_AT),
    rng: draw,

    items: playable,
    byWord: new Map(playable.map((item) => [item.word, item])),
    seen: new Set(),
    choiceQueue: shuffleWith(choiceItems.slice(), draw),
    choiceAt: 0,
    carried: [],
    repeats: [],

    pool: { ...pool },
    stage: Math.max(0, Math.floor(Number(stage) || 0)),
    session: String(session),

    townIndex: 0,
    wordsThisTown: 0,
    wordsDone: 0,

    hearts: MAX_HEARTS,
    score: 0,
    streak: 0,
    bestStreak: 0,
    distance: 0,
    elapsed: 0,

    lane: 1,
    rows: [],
    active: null,
    spawning: null,
    spawnStep: 0,
    blankRows: 0,
    freeze: 0,
    shake: 0,
    // Road travelled since the last row was created. THE spacing counter —
    // see the gate in `advance`.
    sinceSpawn: 0,

    running: true,
    over: false,
    outcome: null,
    atTown: false,

    stats: { letters: 0, correct: 0, words: 0, byWord: Object.create(null) },
    // Two arrays, drained into each other, so a frame allocates nothing. See
    // `takeEvents` for why the queue is not simply cleared at the top of
    // `advance`.
    events: [],
    eventBuffer: [],
    lastSpawnAt: -1,
  }

  ride.carried = carriedForwardWords({ items: playable, pool, stage: ride.stage, rng: draw })
  spawnRow(ride)
  return ride
}

/** Steer. Refused while the bike is frozen after a mistake, and once over. */
export function steer(ride, lane) {
  if (!ride.running || ride.over || ride.freeze > 0) return ride.lane
  ride.lane = Math.max(0, Math.min(2, Math.floor(Number(lane))))
  return ride.lane
}

function emit(ride, event) {
  ride.events.push(event)
}

/**
 * Put one row on the road.
 *
 * A word's rows are spawned one at a time from the challenge being built, and
 * a blank row's worth of road is left between two words so a learner can see
 * where one ends.
 */
export function spawnRow(ride) {
  // A BLANK ROW COSTS A FULL GAP. Resetting the counter here is the whole
  // reason this branch exists: the road between two words has to be as long as
  // the road between two letters, or the first letter of a new word arrives a
  // single frame after the last letter of the old one. That is what the
  // measured-minimum guard caught, and a formula alone would never have.
  if (ride.blankRows > 0) {
    ride.blankRows -= 1
    ride.sinceSpawn = 0
    ride.lastSpawnAt = ride.elapsed
    return null
  }

  if (!ride.spawning || ride.spawnStep >= ride.spawning.steps.length) {
    const challenge = nextChallenge(ride)
    if (!challenge) return null
    ride.spawning = challenge
    ride.spawnStep = 0
    if (!ride.active) startResolving(ride, challenge)
  }

  const step = ride.spawning.steps[ride.spawnStep]
  const row = {
    y: SPAWN_Y,
    challenge: ride.spawning,
    stepIndex: ride.spawnStep,
    options: step.options,
    correctLane: step.options.indexOf(step.correct),
    resolved: false,
    chosenLane: -1,
    ok: false,
    age: 0,
  }
  ride.rows.push(row)
  ride.spawnStep += 1
  if (ride.spawnStep >= ride.spawning.steps.length) ride.blankRows = 1
  ride.sinceSpawn = 0
  ride.lastSpawnAt = ride.elapsed
  return row
}

/** Hand the word bar over to a challenge, and say it. */
export function startResolving(ride, challenge) {
  ride.active = challenge
  challenge.filled = challenge.filled || []
  challenge.revealUntil = ride.mode === 'spell' ? ride.elapsed + REVEAL_SECONDS : 0
  emit(ride, { type: 'present', challenge })
}

/** How long Spell It shows the word before hiding it. */
export const REVEAL_SECONDS = 2.2

/**
 * Answer one row with whatever lane the rider is in.
 *
 * There is no "no answer" branch, because there is no empty lane: the rider is
 * always in one of three, so every row that reaches them is answered.
 */
export function resolveRow(ride, row) {
  row.resolved = true
  row.chosenLane = ride.lane
  const challenge = row.challenge
  const chosen = row.options[ride.lane]
  const right = challenge.steps[row.stepIndex].correct
  const ok = chosen === right
  row.ok = ok

  challenge.filled[row.stepIndex] = { text: chosen, ok }
  recordLetter(ride, challenge.word, ok)

  if (ok) {
    ride.streak += 1
    ride.bestStreak = Math.max(ride.bestStreak, ride.streak)
    ride.score += scoreForLetter(ride.streak)
    emit(ride, { type: 'right', lane: ride.lane, letter: chosen })
    if (repairsAt(ride.streak, ride.hearts)) {
      ride.hearts += 1
      emit(ride, { type: 'repair', hearts: ride.hearts })
    }
  } else {
    ride.streak = 0
    ride.hearts -= 1
    ride.shake = 0.45
    ride.freeze = FREEZE_SECONDS
    challenge.missed = true
    emit(ride, {
      type: 'wrong',
      lane: ride.lane,
      chosen,
      right,
      challenge,
      // The correction is the lesson, so the screen and the voice both need to
      // know which it is: a whole word for Word Choice, a word-then-letters
      // spelling for the other two.
      spoken: challenge.kind === 'choice' ? right : challenge.word,
      spellOut: challenge.kind !== 'choice',
    })
    if (ride.hearts <= 0) {
      ride.hearts = 0
      finishRide(ride, 'wrecked')
      return
    }
  }

  if (row.stepIndex === challenge.steps.length - 1) finishChallenge(ride, challenge)
}

function recordLetter(ride, word, ok) {
  ride.stats.letters += 1
  if (ok) ride.stats.correct += 1
  const bucket = ride.stats.byWord[word] || (ride.stats.byWord[word] = { right: 0, wrong: 0, attempts: 0 })
  bucket.attempts += 1
  if (ok) bucket.right += 1
  else bucket.wrong += 1
}

/**
 * A word is finished. Bank it, and decide whether the town is done.
 *
 * THE POOL IS WRITTEN PER WORD, NOT PER LETTER. Mastery is a claim about
 * spelling a word, and a learner who gets six of nine letters right has not
 * two-thirds mastered it. A word with no wrong letters counts as one mastery
 * session; a word with any wrong letter is a miss, which resets the count and
 * schedules the word to return in a LATER SESSION — that is §3.5's third leg,
 * and it is the same pool the ladder reads.
 */
export function finishChallenge(ride, challenge) {
  ride.wordsDone += 1
  ride.wordsThisTown += 1
  ride.stats.words += 1

  const word = challenge.word
  if (ride.byWord.has(word) || ride.mode === 'choice') {
    ride.pool = challenge.missed
      ? recordMiss(ride.pool, word, { stage: ride.stage, at: Date.now() })
      : recordCorrect(ride.pool, word, { session: ride.session, stage: ride.stage, at: Date.now() })
    // Read by `finishRide`, which banks a missed word the wreck interrupted.
    challenge.banked = true
  }

  if (challenge.missed) {
    scheduleRepeats(ride, word)
  } else {
    ride.score += WORD_BONUS
    emit(ride, { type: 'wordDone', word })
  }

  // Hand the bar to whatever is already on the road, so the learner is never
  // looking at a finished word while its successor's letters arrive.
  ride.active = null
  const next = ride.rows.find((row) => !row.resolved && row.challenge !== challenge)
  if (next) startResolving(ride, next.challenge)
  else if (ride.spawning && ride.spawning !== challenge) startResolving(ride, ride.spawning)

  if (ride.mode === 'choice') {
    if (ride.wordsDone >= CHOICE_WORDS_PER_RIDE) finishRide(ride, 'finished')
    return
  }
  if (ride.wordsThisTown >= WORDS_PER_TOWN) arriveTown(ride)
}

/** Reached a town: the ride pauses on a progress card. */
export function arriveTown(ride) {
  ride.wordsThisTown = 0
  ride.running = false
  ride.atTown = true
  emit(ride, { type: 'town', index: ride.townIndex, town: townAt(ride.townIndex) })
  if (ride.townIndex >= RIDE_TOWNS.length - 1) finishRide(ride, 'arrived')
}

/**
 * Leave a town for the next one. The road is CLEARED, which is what lets the
 * speed rise without the rows already in flight arriving early — the seconds
 * between rows are a promise about the road ahead, not only about the formula.
 */
export function departTown(ride) {
  if (ride.over) return ride
  ride.townIndex = Math.min(RIDE_TOWNS.length - 1, ride.townIndex + 1)
  ride.speed = speedAtTown(ride.baseSpeed, ride.townIndex)
  ride.rows.length = 0
  ride.spawning = null
  ride.spawnStep = 0
  ride.blankRows = 0
  ride.active = null
  ride.atTown = false
  ride.running = true
  ride.freeze = 0
  ride.sinceSpawn = 0
  spawnRow(ride)
  return ride
}

/**
 * End the run. `reason` is 'wrecked' | 'finished' | 'arrived' | 'ended'.
 *
 * A WORD THE LEARNER WAS GETTING WRONG WHEN THE BIKE DIED IS STILL RECORDED.
 * The bike wrecks on the fifth wrong letter, and `resolveRow` ends the run
 * there and then — so `finishChallenge`, which is what banks a word into the
 * pool, never runs for it. Without this the word that actually ended the ride
 * is the one word the learner's record has nothing to say about, and it is
 * the last one it should forget.
 *
 * KEYED ON `banked`, NOT ON HOW FULL THE WORD IS. The wreck can land on the
 * word's LAST letter, which leaves it looking complete — so a length check
 * banks the wreck-in-the-middle case and silently misses the wreck-on-the-last
 * -letter one, which is the more common of the two.
 *
 * Only a MISSED word is banked. An unfinished word with no wrong letters is
 * not a success: the learner never reached the end of it, so it earns neither
 * a mastery session nor a miss.
 */
export function finishRide(ride, reason = 'ended') {
  if (ride.over) return ride
  const unfinished = ride.active
  if (unfinished && unfinished.missed && !unfinished.banked) {
    ride.pool = recordMiss(ride.pool, unfinished.word, { stage: ride.stage, at: Date.now() })
    unfinished.banked = true
  }
  ride.over = true
  ride.running = false
  ride.atTown = false
  ride.outcome = reason
  emit(ride, { type: 'over', reason })
  return ride
}

/**
 * Everything that has happened since the caller last asked.
 *
 * THE QUEUE IS DRAINED BY THE READER, NOT CLEARED BY THE WRITER, and that is a
 * bug fix rather than a preference. `advance` used to empty `ride.events` at
 * the top of the frame, which quietly discarded every event emitted OUTSIDE a
 * frame — the first challenge of a ride, and the first challenge after every
 * town, both of which are announced by `spawnRow` from `createRide` and
 * `departTown`. The symptom was not an error: the word simply was not spoken
 * when the learner left a town, nine times a ride, and the screen still looked
 * right. The guard caught it as a repeat that "never came back", because the
 * events that would have reported it were gone.
 *
 * Copied into a second, reused array so the caller can iterate it safely while
 * the ride goes on emitting, and so a frame still allocates nothing.
 */
export function takeEvents(ride) {
  const out = ride.eventBuffer
  out.length = 0
  for (let i = 0; i < ride.events.length; i += 1) out.push(ride.events[i])
  ride.events.length = 0
  return out
}

/**
 * One frame. Returns every event since the last call — including any raised
 * between frames by `createRide`, `departTown` or `finishRide`.
 */
export function advance(ride, dt) {
  const step = Math.max(0, Math.min(0.05, Number(dt) || 0))
  if (!ride.running || ride.over) return takeEvents(ride)

  ride.elapsed += step
  if (ride.shake > 0) ride.shake -= step

  // Frozen after a mistake: the road stops, so the learner reads the
  // correction instead of watching the next row arrive during it.
  if (ride.freeze > 0) {
    ride.freeze -= step
    return takeEvents(ride)
  }

  ride.distance += ride.speed * step
  // Accrued only while the road is MOVING — the freeze after a mistake stops
  // the road, so reading a correction never eats the next row's thinking time.
  ride.sinceSpawn += ride.speed * step

  for (let i = 0; i < ride.rows.length; i += 1) {
    const row = ride.rows[i]
    row.y += ride.speed * step
    if (!row.resolved && row.y >= ride.resolveAt) {
      resolveRow(ride, row)
      if (ride.over || !ride.running) break
    } else if (row.resolved) {
      row.age += step
    }
  }

  // Compacted in place. `filter` here would allocate a new array sixty times
  // a second for the life of the ride.
  let keep = 0
  for (let i = 0; i < ride.rows.length; i += 1) {
    const row = ride.rows[i]
    if (row.y < ride.resolveAt + 200 && row.age < 0.45) {
      ride.rows[keep] = row
      keep += 1
    }
  }
  ride.rows.length = keep

  if (ride.running && !ride.over) {
    let pending = 0
    for (let i = 0; i < ride.rows.length; i += 1) if (!ride.rows[i].resolved) pending += 1
    // TIME, EXPRESSED AS DISTANCE. `sinceSpawn` accrues at `speed`, so
    // reaching `speed × secondsPerRow` takes `secondsPerRow` at any speed —
    // which is the spec's formula and the property the guard measures. The
    // LOOKAHEAD gate can only ever DELAY a spawn, never bring one forward, so
    // it cannot shorten the gap it is measured against.
    if (pending < LOOKAHEAD && ride.sinceSpawn >= rowGapPx(ride.speed, ride.secondsPerRow)) spawnRow(ride)
  }

  return takeEvents(ride)
}

/* ══════════════════════════════════════════════════════════════════════
 *  8. What the ride is worth, and what it reports
 * ══════════════════════════════════════════════════════════════════════ */

/** Letter accuracy across the ride, 0–100. */
export function rideAccuracy(ride) {
  return ride.stats.letters ? Math.round((ride.stats.correct / ride.stats.letters) * 100) : 0
}

/**
 * The words that gave trouble, worst first — the report's whole content.
 *
 * Ranked by wrong letters and then by how bad the word was proportionally, so
 * a nine-letter word missed twice does not outrank a four-letter word missed
 * twice on length alone.
 */
export function troubleWords(stats) {
  return Object.entries(stats?.byWord || {})
    .map(([word, row]) => ({
      word,
      right: row.right || 0,
      wrong: row.wrong || 0,
      attempts: row.attempts || 0,
      accuracy: row.attempts ? Math.round((row.right / row.attempts) * 100) : 0,
    }))
    .filter((row) => row.wrong > 0)
    .sort((a, b) => (b.wrong - a.wrong) || (a.accuracy - b.accuracy) || (a.word < b.word ? -1 : 1))
}

/** The report as a CSV, for a teacher who wants it in a spreadsheet. */
export function reportCsv(stats, { mode = '', difficulty = '' } = {}) {
  const header = ['word', 'letters_right', 'letters_wrong', 'accuracy_percent', 'mode', 'difficulty']
  const rows = Object.entries(stats?.byWord || {}).map(([word, row]) => {
    const attempts = (row.right || 0) + (row.wrong || 0)
    return [
      // A word cannot contain a comma or a quote — it is A–Z — but the mode
      // and difficulty are strings from a caller, so every field is escaped.
      csvCell(word), row.right || 0, row.wrong || 0,
      attempts ? Math.round(((row.right || 0) / attempts) * 100) : 0,
      csvCell(mode), csvCell(difficulty),
    ].join(',')
  })
  return [header.join(','), ...rows].join('\n')
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The ride, in the shape `useGameFinish` takes.
 *
 * A LETTER IS AN ANSWER. `correct`/`wrong` count letters rather than words,
 * because a letter is what the learner actually chose and what the accuracy on
 * every other surface of this game is computed from. Counting words instead
 * would report a learner who got eight of nine letters of `necessary` right as
 * having answered one question wrongly.
 */
export function rideResult({ game, ride }) {
  return {
    game,
    score: Math.max(0, Math.floor(ride.score)),
    correct: ride.stats.correct,
    wrong: Math.max(0, ride.stats.letters - ride.stats.correct),
    accuracy: rideAccuracy(ride),
    bestStreak: ride.bestStreak,
    timeSpent: Math.max(0, Math.round(ride.elapsed)),
  }
}

/**
 * Bank the ride into the learner's spelling record.
 *
 * IDEMPOTENT BY `runId`, and returns the record BY IDENTITY when it has
 * already settled — so `if (next === prev)` skips the Firestore write as well
 * as the reward, exactly as `applyStageResult` does for a stage.
 *
 * IT AWARDS NO STARS, and that is the point of it being its own function
 * rather than a call to `applyStageResult`. Stars belong to the ladder's
 * stages: a ride is practice over the same words, so it moves mastery and
 * spacing and leaves the map alone. Anything else would let a learner star a
 * chapter they never opened.
 */
export function settleRide(progress, { pool = null, runId = '' } = {}) {
  const id = String(runId || '')
  const settled = Array.isArray(progress?.settledRuns) ? progress.settledRuns : []
  if (id && settled.includes(id)) return progress
  return {
    ...progress,
    pool: pool || progress?.pool || {},
    stagesPlayed: Math.max(0, Math.floor(Number(progress?.stagesPlayed) || 0)) + 1,
    settledRuns: id ? [...settled, id].slice(-12) : settled,
  }
}

/** Words this learner has mastered, for the results screen's one warm line. */
export function masteredIn(before = {}, after = {}) {
  return Object.keys(after).filter((word) => (
    isMastered(entryFor(after, word)) && !isMastered(entryFor(before, word))
  ))
}
