/**
 * test:learner-grade-games — every grade open to learners has a game to play.
 *
 * ── The failure this exists to catch ────────────────────────────────────
 *
 * The games hub is grade-scoped and refuses another grade's pack outright
 * (`buildCatalogue`), which is correct: a Grade 7 learner must not be handed
 * a Grade 5 pack, or score against one on the same leaderboard. The cost is
 * that content is per-grade, and a grade with no pack for a mechanic renders
 * that mechanic as an EMPTY ROW — a valid render, no error, nothing red.
 *
 * On 2026-08-20 the learner app was open to Grade 7 alone (`LEARNER_GRADES`)
 * and the bundled seed carried exactly two live Grade 7 packs. So the hub
 * named four games and offered two, and the daily-challenge rotation — which
 * reads the same grade-scoped pool — rotated between those same two, every
 * day, for every learner in the product. Nothing in lint, the build, the
 * Vitest suite or the seed's own fallback test could see it: each of those
 * asks whether the code works, and the code worked.
 *
 * So the check is on the DATA, and it is keyed to the rollout list rather
 * than to a grade number: open a grade in `LEARNER_GRADES` without seeding
 * it and this fails, which is the moment the gap is cheap to fix.
 */
import assert from 'node:assert/strict'

import { LEARNER_GRADES } from '../src/config/curriculum.js'
import {
  CATALOGUE_MECHANICS,
  GAMES_SEED,
  PLAYABLE_GAME_TYPES,
  RETIRED_GAME_TYPES,
  isDemoGame,
} from '../src/data/gamesSeed.js'
import { ZAMBIA_PROVINCES_GEO } from '../src/data/zambiaGeography.js'
import { SPELLING_BANK } from '../src/data/spellingBank.js'
import { SPELLING_CHOICE_BANK } from '../src/data/spellingChoiceBank.js'
import { isKnownPack } from '../src/features/games/lib/spellingPack.js'
import { CHOICE_WORDS_PER_RIDE } from '../src/features/games/lib/spellingRideCore.js'

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

/** What a learner of this grade can actually reach: active, not retired, their grade. */
function playablePacks(grade) {
  return GAMES_SEED.filter((g) => (
    g.active !== false
    && !RETIRED_GAME_TYPES.has(g.type)
    && Number(g.grade) === Number(grade)
  ))
}

console.log('learner-grade-games')

assert.ok(LEARNER_GRADES.length > 0, 'no grade is open to learners at all')

for (const grade of LEARNER_GRADES) {
  const packs = playablePacks(grade)

  test(`grade ${grade} has a pack for every catalogue mechanic`, () => {
    const missing = CATALOGUE_MECHANICS
      .filter((m) => !packs.some((p) => p.type === m.type))
      .map((m) => `${m.name} (${m.type})`)
    assert.deepEqual(
      missing, [],
      `the hub names every mechanic and renders an empty row for one with no pack at this grade. `
      + `Missing at grade ${grade}: ${missing.join(', ')}. Add a pack to src/data/gamesSeed.js.`,
    )
  })

  test(`grade ${grade} has more than one game in the daily rotation`, () => {
    // getTodaysChallenge picks by `dateKeyToInt(dateId) % available.length`
    // over every active game at the grade — so a pool of one is the same
    // game every day, for ever.
    assert.ok(
      packs.length > 1,
      `grade ${grade} has ${packs.length} playable pack(s); the daily challenge would serve the same one every day`,
    )
  })

  test(`grade ${grade} can reach every engine that has a pack for it`, () => {
    // Not every playable type is a catalogue mechanic — `map_place` (Know
    // Zambia) lists as its own row instead, precisely so it does not print
    // "coming soon" on a grade with no map pack. So this checks the other
    // direction: a pack whose type has no engine would render a card that
    // opens on the "not wired yet" screen.
    for (const pack of packs) {
      assert.ok(
        PLAYABLE_GAME_TYPES.has(pack.type),
        `${pack.id} is type "${pack.type}", which no engine plays — its card would open on nothing`,
      )
    }
  })

  test(`grade ${grade} has something a learner can play WITHOUT paying`, () => {
    // PlayGame locks a game with `!isDemoGame(game) && !canAccessFullContent`.
    // Until 2026-08-20 every free game in the seed was Grade 1-4 — grades no
    // learner can reach — so a Grade 7 learner with no subscription opened the
    // hub and found ten games and ten padlocks. Nothing could see it: every
    // test asks whether the lock WORKS, and the lock worked.
    const free = packs.filter(isDemoGame)
    assert.ok(
      free.length > 0,
      `every game at grade ${grade} is locked to a paying learner. `
      + 'Add at least one id to DEFAULT_DEMO_GAME_IDS in src/data/gamesSeed.js.',
    )
  })

  test(`grade ${grade} has a timed quiz for the daily challenge to land on`, () => {
    assert.ok(
      packs.some((p) => p.type === 'timed_quiz'),
      `grade ${grade} has no timed_quiz pack. The rotation would only ever offer a mechanic game as "today's quiz".`,
    )
  })

  test(`every grade ${grade} pack carries the content its engine reads`, () => {
    for (const pack of packs) {
      // Two mechanics legitimately ship no questions, because their content
      // is not per-pack: number_target generates its tiles from the level
      // (numberPathCore), and map_place reads the province outlines, label
      // anchors and hints from the bundled dataset. Both are still checked —
      // against the thing they DO read, so "no questions" can never be the
      // way a pack with no content at all slips through.
      if (pack.type === 'number_target') {
        assert.ok(Number(pack.rounds) > 0, `${pack.id}: number_target needs a rounds count`)
        continue
      }
      if (pack.type === 'fraction_ladder') {
        // Its questions are the ladder's, checked in full by
        // test:fraction-ladder — including that every printed answer key
        // actually marks correct. Here we only insist it has a ladder at all.
        assert.ok(
          pack.questions.length >= 9,
          `${pack.id}: ${pack.questions.length} questions across nine levels is not a ladder`,
        )
        continue
      }
      // Spelling Ride's content is the WORD PACK, not the document — 879
      // reviewed Grade 7 words fetched on demand, because putting them on the
      // seed would put a spelling bank in the bundle of a child opening a
      // maths game. So it is checked against what it actually reads, the same
      // way number_target and map_place are: a pack this build can load, with
      // enough words behind it, and enough Word Choice sentences for a full
      // ride of that mode.
      if (pack.type === 'spelling_ride') {
        assert.ok(
          isKnownPack(pack.wordPack),
          `${pack.id}: names word pack "${pack.wordPack}", which this build cannot load`,
        )
        assert.ok(
          SPELLING_BANK.length >= 100,
          `${pack.id}: the bundled bank holds ${SPELLING_BANK.length} words — a nine-town ride would repeat`,
        )
        assert.ok(
          SPELLING_CHOICE_BANK.length >= CHOICE_WORDS_PER_RIDE,
          `${pack.id}: ${SPELLING_CHOICE_BANK.length} Word Choice sentences cannot fill a ${CHOICE_WORDS_PER_RIDE}-sentence ride`,
        )
        continue
      }
      if (pack.type === 'map_place') {
        const provinces = Object.keys(ZAMBIA_PROVINCES_GEO.provinces || {})
        assert.equal(
          provinces.length, 10,
          `${pack.id}: the map engine reads src/data/zambiaGeography.js, which holds ${provinces.length} provinces, not 10`,
        )
        continue
      }
      assert.ok(
        Array.isArray(pack.questions) && pack.questions.length >= 5,
        `${pack.id}: only ${pack.questions?.length ?? 0} questions — a round would run out`,
      )
      for (const q of pack.questions) {
        assert.ok(q.answer, `${pack.id}: a question has no answer`)
        // A timed quiz shows its options; the other mechanics build their own
        // (letters, pairs), so an empty options array is correct for them.
        if (pack.type === 'timed_quiz' || pack.type === 'punctuation') {
          assert.ok(q.options.length >= 3, `${pack.id}: "${q.question}" offers ${q.options.length} options`)
          assert.ok(
            q.options.includes(q.answer),
            `${pack.id}: the answer "${q.answer}" is not one of its own options — unanswerable`,
          )
          assert.equal(
            new Set(q.options).size, q.options.length,
            `${pack.id}: "${q.question}" repeats an option`,
          )
        }
        if (pack.type === 'word_builder') {
          assert.match(q.answer, /^[A-Z]+$/, `${pack.id}: "${q.answer}" must be plain uppercase letters`)
          assert.ok(q.answer.length <= 10, `${pack.id}: "${q.answer}" is ${q.answer.length} letters — the slot row wraps twice`)
          assert.ok(q.question, `${pack.id}: "${q.answer}" has no clue`)
        }
      }
    }
  })
}

test('the seed carries the open grades and nothing else', () => {
  // A pack for a grade no learner can reach is dead weight in every bundle
  // the app ships, and it is invisible: the hub filters by grade, so a
  // hundred unreachable packs and none look exactly the same on screen.
  const grades = [...new Set(GAMES_SEED.map((g) => Number(g.grade)))].sort((a, b) => a - b)
  const open = [...LEARNER_GRADES].map(Number).sort((a, b) => a - b)
  assert.deepEqual(
    grades, open,
    `the seed holds grades [${grades}] but only [${open}] are open to learners. `
    + 'Either open the grade (LEARNER_GRADES + DAILY_EXAM_GRADES) or take its packs out.',
  )
})

test('no seed pack is of a mechanic whose engine was retired', () => {
  // RETIRED_GAME_TYPES stays — a live Firestore doc written before the 2026-08
  // redesign can still carry one, and PlayGame shows it a retirement card. But
  // the bundled seed must not ship one: it would be a card that cannot open.
  const retired = GAMES_SEED.filter((g) => RETIRED_GAME_TYPES.has(g.type)).map((g) => g.id)
  assert.deepEqual(retired, [], `retired mechanics still in the seed: ${retired.join(', ')}`)
})

if (failures > 0) {
  console.error(`\nlearner-grade-games — ${failures} failed`)
  process.exit(1)
}
console.log('learner-grade-games — all passed')
