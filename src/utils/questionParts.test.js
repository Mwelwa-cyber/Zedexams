import assert from 'node:assert/strict'
import {
  subPartLabel,
  countPartBlanks,
  splitPartBlanks,
  normalizeSubPart,
  normalizeSubParts,
  sumSubPartMarks,
  hasSubParts,
  emptySubPart,
  SUBPART_FORMATS,
} from './questionParts.js'

// ── subPartLabel: a, b, c … z, aa ──────────────────────────────────────────
function runLabelTest() {
  assert.equal(subPartLabel(0), 'a')
  assert.equal(subPartLabel(1), 'b')
  assert.equal(subPartLabel(2), 'c')
  assert.equal(subPartLabel(25), 'z')
  assert.equal(subPartLabel(26), 'aa')
  assert.equal(subPartLabel(-1), '', 'negative index → empty label')
  assert.equal(subPartLabel(1.5), '', 'non-integer → empty label')
  console.log('runLabelTest passed')
}

// ── Blank detection: underscores, dots and ellipsis all count ──────────────
function runBlankTest() {
  assert.equal(countPartBlanks('called ____ here'), 1, 'underscore run = one blank')
  assert.equal(countPartBlanks('called .... here'), 1, 'dot run = one blank')
  assert.equal(countPartBlanks('called … here'), 1, 'ellipsis = one blank')
  assert.equal(countPartBlanks('a __ b __ c'), 2, 'two blanks counted')
  assert.equal(countPartBlanks('no blanks here'), 0)

  const segs = splitPartBlanks('Foods belong to the group called ____ today')
  assert.equal(segs.length, 2, 'one blank → two segments')
  assert.equal(segs[0], 'Foods belong to the group called ')
  assert.equal(segs[1], ' today')
  assert.deepEqual(splitPartBlanks(''), [''], 'empty text → ["" ]')
  console.log('runBlankTest passed')
}

// ── normalizeSubPart: defaults, aliases, clamps ────────────────────────────
function runNormalizeTest() {
  const def = normalizeSubPart({})
  assert.equal(def.text, '')
  assert.equal(def.answer, '')
  assert.equal(def.marks, 1, 'marks default to 1')
  assert.equal(def.answerFormat, 'inline', 'format defaults to inline')
  assert.equal(def.answerLines, null)

  // `prompt`/`correctAnswer` aliases (AI + lesson-activity convention).
  const aliased = normalizeSubPart({ prompt: 'P', correctAnswer: 'A', marks: 2 })
  assert.equal(aliased.text, 'P', 'prompt aliases text')
  assert.equal(aliased.answer, 'A', 'correctAnswer aliases answer')
  assert.equal(aliased.marks, 2)

  // Bad format falls back to inline; lines clamp to 0..20.
  assert.equal(normalizeSubPart({ answerFormat: 'bogus' }).answerFormat, 'inline')
  assert.equal(normalizeSubPart({ answerFormat: 'lines', answerLines: 99 }).answerLines, 20)
  assert.equal(normalizeSubPart({ marks: -3 }).marks, 1, 'negative marks fall back to default 1')
  assert.equal(normalizeSubPart({ marks: 5000 }).marks, 99, 'marks clamp to 99')
  assert.ok(SUBPART_FORMATS.has('inline') && SUBPART_FORMATS.has('lines') && SUBPART_FORMATS.has('none'))
  console.log('runNormalizeTest passed')
}

// ── normalizeSubParts / sumSubPartMarks / hasSubParts ──────────────────────
function runArrayTest() {
  assert.deepEqual(normalizeSubParts(null), [])
  assert.deepEqual(normalizeSubParts('x'), [])
  const parts = normalizeSubParts([
    { text: 'a', marks: 1 },
    null,
    { text: 'b', marks: 2 },
    'junk',
  ])
  assert.equal(parts.length, 2, 'non-object entries dropped')
  assert.equal(sumSubPartMarks([{ marks: 1 }, { marks: 1 }, { marks: 1 }]), 3, 'marks auto-sum')
  assert.equal(sumSubPartMarks([]), 0)

  assert.equal(hasSubParts({ subParts: [{ text: 'a' }] }), true)
  assert.equal(hasSubParts({ subParts: [] }), false)
  assert.equal(hasSubParts({}), false)
  assert.equal(hasSubParts({ subParts: 'x' }), false)

  const blank = emptySubPart()
  assert.equal(blank.answerFormat, 'inline')
  assert.equal(blank.marks, 1)
  console.log('runArrayTest passed')
}

runLabelTest()
runBlankTest()
runNormalizeTest()
runArrayTest()
console.log('All questionParts tests passed ✔')
