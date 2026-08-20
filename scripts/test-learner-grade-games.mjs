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
import { CATALOGUE_MECHANICS, GAMES_SEED, PLAYABLE_GAME_TYPES, RETIRED_GAME_TYPES } from '../src/data/gamesSeed.js'
import { ZAMBIA_PROVINCES_GEO } from '../src/data/zambiaGeography.js'

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

if (failures > 0) {
  console.error(`\nlearner-grade-games — ${failures} failed`)
  process.exit(1)
}
console.log('learner-grade-games — all passed')
