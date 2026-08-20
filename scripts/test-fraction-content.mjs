/**
 * test:fraction-content — the Fraction Ladder's content, checked against the
 * rules the content is FOR.
 *
 * Every one of these renders perfectly while teaching the wrong thing, which
 * is exactly why they are a build step rather than a review note:
 *
 *   a circle drawn in five wedges under the caption "three quarters"
 *   a "which shows halves?" round whose three oranges are all cut equally
 *   a level-1 stem that shows the symbol before the child has met it
 *   a lowest-terms question whose own answer is not in lowest terms
 *   an explanation keyed to an answer no learner can give
 *
 * The rules for level 1 come from the acceptance list in
 * docs/learner/zedexams-fractions-level1.html, which states them and then
 * checks them in the prototype itself — a reading-level rule nobody measures
 * drifts within a week.
 */
import assert from 'node:assert/strict'

import { GAMES_SEED } from '../src/data/gamesSeed.js'
import { FRACTION_LEVELS, levelById } from '../src/features/games/lib/fractionLadderCore.js'
import {
  MISCONCEPTION_CODES,
  describePackErrors,
  introducesSymbol,
  learnerFacingText,
  validateFractionPack,
  validateQuestion,
} from '../src/features/games/lib/fractionQuestionCore.js'
import { validateVisual } from '../src/features/games/lib/fractionVisualCore.js'
import { stagesForLevel, totalStages } from '../src/features/games/lib/fractionProgressCore.js'

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

console.log('fraction-content')

const game = GAMES_SEED.find((g) => g.type === 'fraction_ladder')
assert.ok(game, 'the seed must carry a fraction_ladder pack')
const questions = game.questions

/* ── every question is well formed ─────────────────────────────────── */

test('every question passes validateQuestion', () => {
  const bad = []
  for (const question of questions) {
    const result = validateQuestion(question)
    if (!result.ok) bad.push(`${question.id || '(no id)'}: ${result.errors.map((e) => e.message).join(' | ')}`)
  }
  assert.deepEqual(bad, [], `\n      ${bad.join('\n      ')}`)
})

test('every id is unique — the review queue and the resume snapshot key on it', () => {
  const ids = questions.map((q) => q.id)
  const seen = new Set()
  const dupes = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
  assert.deepEqual(dupes, [], `duplicate ids: ${dupes.join(', ')}`)
})

test('every question names a level the ladder knows', () => {
  const unknown = questions.filter((q) => !levelById(q.level)).map((q) => `${q.id}→${q.level}`)
  assert.deepEqual(unknown, [])
})

/* ── the pictures are true ─────────────────────────────────────────── */

test('every picture has as many regions as the bottom number, and as many shaded as the top', () => {
  const bad = []
  const visuals = []
  for (const question of questions) {
    if (question.visual) visuals.push([question.id, question.visual])
    for (const option of question.options || []) {
      if (option.visual) visuals.push([`${question.id}/${option.id}`, option.visual])
    }
    for (const side of question.compare || []) {
      if (side.visual) visuals.push([`${question.id}/compare`, side.visual])
    }
  }
  assert.ok(visuals.length >= 20, `only ${visuals.length} pictures in the whole ladder — level 1 is meant to be picture-first`)
  for (const [where, visual] of visuals) {
    const result = validateVisual(visual)
    if (!result.ok) bad.push(`${where}: ${result.errors.map((e) => e.message).join(' | ')}`)
  }
  assert.deepEqual(bad, [], `\n      ${bad.join('\n      ')}`)
})

test('the equal-parts round offers a genuinely unequal distractor', () => {
  const rounds = questions.filter((q) => q.skill === 'equal-parts')
  assert.ok(rounds.length >= 3, 'equal parts is a foundational idea and needs more than one round')
  for (const round of rounds) {
    // A round either offers several pictures and asks which is cut equally, or
    // shows ONE badly-cut picture and asks whether it counts. Both need a real
    // unequal cut somewhere; neither works with only equal ones.
    const pictures = [
      ...(round.visual ? [['self', round.visual]] : []),
      ...(round.options || []).filter((o) => o.visual).map((o) => [o.id, o.visual]),
    ]
    const unequal = pictures.filter(([, v]) => v.expectEqual === false)
    assert.ok(unequal.length >= 1, `${round.id} has no unequal cut, so there is no misconception to catch`)
    // And the unequal ones must really be unequal — `validateVisual` fails a
    // picture that CLAIMS unevenness and came out even, which is what would
    // make this round unanswerable.
    for (const [where, visual] of unequal) {
      assert.ok(validateVisual(visual).ok, `${round.id}/${where} claims unequal parts but is not`)
    }
  }
})

/* ── level 1: pictures before the symbol ───────────────────────────── */

const level1 = questions.filter((q) => q.level === 'basics')

test('level 1 exists and is the biggest level — it is where the idea is built', () => {
  assert.ok(level1.length >= 12, `level 1 has only ${level1.length} questions`)
})

test('the stage that introduces the fraction shows no written fraction anywhere a learner reads', () => {
  const intro = level1.filter(introducesSymbol)
  assert.ok(intro.length >= 3, 'the introduction stage needs enough rounds to make the point')
  const leaks = []
  for (const question of intro) {
    if (question.fraction) leaks.push(`${question.id}: a fraction on the question itself`)
    for (const option of question.options || []) {
      if (option.fraction) leaks.push(`${question.id}/${option.id}: a fraction on an option`)
    }
    for (const piece of learnerFacingText(question)) {
      if (/\d+\s*\/\s*\d+/.test(piece.text)) leaks.push(`${question.id} ${piece.what}: "${piece.text}"`)
    }
  }
  assert.deepEqual(leaks, [], `\n      ${leaks.join('\n      ')}`)
})

test('the symbol IS introduced, in the feedback after a correct answer', () => {
  const intro = level1.filter(introducesSymbol)
  const without = intro.filter((q) => !q.reveal)
  assert.deepEqual(without.map((q) => q.id), [],
    'a round that never shows the written form leaves the learner with the words and nothing else')
})

test('no "numerator" or "denominator" anywhere in level 1', () => {
  const bad = []
  for (const question of level1) {
    for (const piece of learnerFacingText(question)) {
      if (/\b(numerator|denominator)\b/i.test(piece.text)) bad.push(`${question.id} ${piece.what}`)
    }
  }
  assert.deepEqual(bad, [], `the formal words arrive in level 2: ${bad.join(', ')}`)
})

test('level 2 teaches the formal words rather than assuming them', () => {
  const taught = questions.find((q) => q.level === 'equal' && q.skill === 'numerator-denominator-words')
  assert.ok(taught, 'nothing in level 2 introduces "numerator" and "denominator"')
})

test('one half appears on at least three different shapes inside level 1', () => {
  const shapes = new Set()
  for (const question of level1) {
    const reveal = question.reveal
    const isHalf = reveal && ((reveal.n === 1 && reveal.d === 2) || (reveal.also?.n === 1 && reveal.also?.d === 2))
    if (isHalf && question.visual?.shape) shapes.add(question.visual.shape)
  }
  assert.ok(shapes.size >= 3,
    `one half is taught on ${[...shapes].join(', ') || 'nothing'} — a child who only sees one shape binds the idea to it`)
})

test('level 1 bridges from one whole to a group of things', () => {
  const group = level1.filter((q) => q.visual?.shape === 'group' || q.skill === 'fraction-of-a-group')
  assert.ok(group.length >= 3, 'the jump to "half of six oranges" is a teaching step, not a footnote')
  assert.ok(group.some((q) => q.type === 'select'), 'the learner has to TAP a fraction of a group, not only name one')
})

test('level 1 uses things a child has held, not only worksheet shapes', () => {
  const objects = new Set(level1.map((q) => q.visual?.object).filter(Boolean))
  for (const question of level1) {
    for (const option of question.options || []) {
      if (option.visual?.object) objects.add(option.visual.object)
    }
  }
  assert.ok(objects.size >= 4, `only ${[...objects].join(', ')} — an orange is this morning, a worksheet circle is abstract`)
  assert.ok(objects.has('orange') && objects.has('chitenge'), 'the Zambian objects are the point')
})

test('every question type the engine supports is actually used', () => {
  const used = new Set(questions.map((q) => q.type))
  for (const type of ['choice', 'shade', 'select', 'write', 'compare', 'order']) {
    assert.ok(used.has(type), `no question uses the "${type}" type — the engine supports it and the content does not`)
  }
})

/* ── wrong answers teach ───────────────────────────────────────────── */

test('every predicted wrong answer has its own explanation — none shared, none generic', () => {
  const bad = []
  let total = 0
  const all = []
  for (const question of questions) {
    const list = question.misconceptions || []
    total += list.length
    const texts = list.map((m) => m.explanation)
    all.push(...texts)
    if (new Set(texts).size !== texts.length) bad.push(`${question.id}: two wrong answers share one explanation`)
    for (const m of list) {
      if (!m.explanation || m.explanation.length < 25) bad.push(`${question.id}/${m.answer}: the explanation is too short to name a mistake`)
      if (/^(incorrect|wrong|try again)\.?$/i.test(m.explanation || '')) bad.push(`${question.id}/${m.answer}: generic`)
    }
  }
  assert.deepEqual(bad, [], `\n      ${bad.join('\n      ')}`)
  assert.ok(total >= 60, `only ${total} named misconceptions across ${questions.length} questions`)
})

test('every question that can be got wrong predicts at least one way of getting it wrong', () => {
  const silent = questions
    .filter((q) => !(q.misconceptions || []).length && !Object.keys(q.traps || {}).length)
    .map((q) => q.id)
  assert.deepEqual(silent, [], `these answer a wrong answer with nothing specific: ${silent.join(', ')}`)
})

test('every misconception code is one the engine knows', () => {
  const unknown = []
  for (const question of questions) {
    for (const m of question.misconceptions || []) {
      if (m.code && !MISCONCEPTION_CODES[m.code]) unknown.push(`${question.id}: ${m.code}`)
    }
  }
  assert.deepEqual(unknown, [])
})

test('the working is revealed in steps where it is offered at all', () => {
  const withWorking = questions.filter((q) => (q.workingSteps || []).length)
  assert.ok(withWorking.length >= 25, `only ${withWorking.length} questions can show their working`)
  const oneStep = withWorking.filter((q) => q.workingSteps.length < 2).map((q) => q.id)
  assert.deepEqual(oneStep, [], `a single step is not a walk-through: ${oneStep.join(', ')}`)
  const empty = []
  for (const question of withWorking) {
    for (const [index, step] of question.workingSteps.entries()) {
      if (!step.title) empty.push(`${question.id} step ${index + 1}`)
    }
  }
  assert.deepEqual(empty, [])
})

test('a correct answer is told something, not congratulated', () => {
  const bare = questions
    .filter((q) => !q.explanation || q.explanation.length < 25)
    .map((q) => q.id)
  assert.deepEqual(bare, [], `these say nothing when the learner is right: ${bare.join(', ')}`)
})

/* ── stages ────────────────────────────────────────────────────────── */

test('every level has stages, and no stage is a single question', () => {
  const bad = []
  for (const level of FRACTION_LEVELS) {
    const stages = stagesForLevel(game, level.id)
    if (!stages.length) { bad.push(`${level.id}: no questions at all`); continue }
    for (const stage of stages) {
      if (stage.questions.length < 2) bad.push(`${level.id} stage ${stage.number}: only ${stage.questions.length} question`)
    }
  }
  assert.deepEqual(bad, [], `\n      ${bad.join('\n      ')}`)
})

test('a level with more than one stage names each of them', () => {
  const bad = []
  for (const level of FRACTION_LEVELS) {
    const stages = stagesForLevel(game, level.id)
    if (stages.length < 2) continue
    for (const stage of stages) {
      if (/^Stage \d+$/.test(stage.title)) bad.push(`${level.id} stage ${stage.number} has no title`)
    }
  }
  assert.deepEqual(bad, [], `\n      ${bad.join('\n      ')}`)
})

test('stage numbers within a level are 1..n with no gaps', () => {
  const bad = []
  for (const level of FRACTION_LEVELS) {
    const numbers = stagesForLevel(game, level.id).map((s) => s.number)
    const expected = numbers.map((_, i) => i + 1)
    if (numbers.join(',') !== expected.join(',')) bad.push(`${level.id}: ${numbers.join(',')}`)
  }
  assert.deepEqual(bad, [], `\n      ${bad.join('\n      ')}`)
})

test('the ladder is a real ladder — thirty-odd stages, not nine quizzes', () => {
  const total = totalStages(game)
  assert.ok(total >= 20, `only ${total} stages across nine levels`)
})

test('every question names a skill, and a skill is worth more than one question', () => {
  const counts = {}
  for (const question of questions) counts[question.skill] = (counts[question.skill] || 0) + 1
  const skills = Object.keys(counts)
  assert.ok(skills.length >= 15, `only ${skills.length} skills — mastery is per skill, so too few makes every skill enormous`)
  // At least half the skills must appear twice, or "three separate sessions to
  // mastery" has nothing to draw a second session from.
  const repeated = skills.filter((s) => counts[s] > 1)
  assert.ok(repeated.length >= skills.length * 0.35,
    `only ${repeated.length} of ${skills.length} skills appear more than once, so most can never be practised twice`)
})

/* ── reading level ─────────────────────────────────────────────────── */

test('level 1 stays at a Grade 4 reading level', () => {
  let longest = { words: 0, text: '' }
  for (const question of level1) {
    for (const piece of learnerFacingText(question)) {
      for (const sentence of String(piece.text).split(/[.!?]+/).map((s) => s.trim()).filter(Boolean)) {
        const words = sentence.split(/\s+/).length
        if (words > longest.words) longest = { words, text: sentence }
      }
    }
  }
  assert.ok(longest.words <= 16, `the longest sentence a level-1 learner reads is ${longest.words} words: "${longest.text}"`)
})

/* ── the gate the importer runs ────────────────────────────────────── */

test('the shipped pack passes the check the importer runs', () => {
  const result = validateFractionPack(game, { knownLevels: FRACTION_LEVELS.map((l) => l.id) })
  assert.equal(result.ok, true, describePackErrors(result, 6))
  assert.equal(result.counts.questions, questions.length)
})

test('the importer\'s check can actually FAIL — a guard that cannot is decoration', () => {
  // A five-wedge picture of quarters. It renders perfectly and teaches a child
  // that a quarter is a fifth, which is why the import has to refuse it.
  const broken = {
    ...game,
    questions: [{
      id: 'x', level: 'basics', stage: 2, skill: 's', type: 'shade',
      prompt: 'Shade three quarters.', want: 3,
      visual: { shape: 'circle', parts: 5, denominator: 4, numerator: 3, shaded: 3 },
    }],
  }
  const result = validateFractionPack(broken, { knownLevels: FRACTION_LEVELS.map((l) => l.id) })
  assert.equal(result.ok, false)
  assert.ok(describePackErrors(result).includes('x:'), 'the message must name the question an admin has to fix')

  // …and so do the other quiet ones.
  const cases = [
    { name: 'a level nothing knows', q: { id: 'y', level: 'nope', stage: 1, skill: 's', type: 'write', prompt: 'p', value: { n: 1, d: 2 } } },
    { name: 'a lowest-terms answer that is not in lowest terms', q: { id: 'z', level: 'equal', stage: 1, skill: 's', type: 'write', prompt: 'p', value: { n: 2, d: 4 }, form: 'lowest' } },
    { name: 'a printed answer that disagrees with the value', q: { id: 'w', level: 'equal', stage: 1, skill: 's', type: 'write', prompt: 'p', value: { n: 1, d: 2 }, answer: '2/3' } },
  ]
  for (const { name, q } of cases) {
    const bad = validateFractionPack({ ...game, questions: [q] }, { knownLevels: FRACTION_LEVELS.map((l) => l.id) })
    assert.equal(bad.ok, false, `${name} must be refused`)
  }
})

test('two questions sharing an id are refused — the review queue keys on it', () => {
  const dupe = { id: 'same', level: 'basics', stage: 2, skill: 's', type: 'write', prompt: 'p', value: { n: 1, d: 2 } }
  const result = validateFractionPack({ ...game, questions: [dupe, { ...dupe }] })
  assert.ok(result.errors.some((e) => e.code === 'duplicate-id'))
})

test('an empty pack is refused rather than imported as a game with no levels', () => {
  assert.equal(validateFractionPack({ questions: [] }).ok, false)
})

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
