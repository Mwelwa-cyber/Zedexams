#!/usr/bin/env node
/**
 * Tests for the dedicated Fill-in-the-Blanks question type:
 *   - the pure helpers in src/utils/fillBlanks.js
 *   - deterministic grading + scoring via src/utils/quizScoring.js
 *   - that the question schema accepts a fill_blanks question
 *
 * Run: npm run test:fill-blanks
 */

import {
  countBlanks,
  splitStatementSegments,
  blanksToUnderscores,
  statementLabel,
  normalizeFillStatements,
  totalFillBlanks,
  fillBlanksAnswerKey,
  fillBlanksLayout,
  fillBlankMatches,
  gradeFillBlanks,
  hasFillBlanksContent,
} from '../src/utils/fillBlanks.js'
import { isQuestionCorrect, computeQuizScore, isFillBlanksType } from '../src/utils/quizScoring.js'
import { questionWriteSchema } from '../src/editor/schema/question.js'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass += 1 } else { fail += 1; console.error(`  ✗ ${name}`) }
}
function eq(name, a, b) {
  check(`${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
    JSON.stringify(a) === JSON.stringify(b))
}

// ── Blank detection / splitting ───────────────────────────────────
eq('countBlanks none', countBlanks('No blanks here.'), 0)
eq('countBlanks one', countBlanks('We use ____ to wash.'), 1)
eq('countBlanks long run', countBlanks('A __________ B.'), 1)
eq('countBlanks two', countBlanks('Plants need ____ and ____ to grow.'), 2)
eq('countBlanks non-string', countBlanks(null), 0)

eq('split none', splitStatementSegments('plain'), ['plain'])
eq('split one', splitStatementSegments('a ____ b'), ['a ', ' b'])
eq('split two', splitStatementSegments('x ____ y ____ z'), ['x ', ' y ', ' z'])

check('underscores replaced', blanksToUnderscores('We use ____ now', '----').includes('----'))
eq('underscores default keeps text', blanksToUnderscores('hi'), 'hi')

// ── Statement labels (A..Z, AA..) ─────────────────────────────────
eq('label 0', statementLabel(0), 'A')
eq('label 3', statementLabel(3), 'D')
eq('label 25', statementLabel(25), 'Z')
eq('label 26', statementLabel(26), 'AA')

// ── Normalisation aligns answers to blanks ────────────────────────
const norm = normalizeFillStatements([
  { text: 'Plants need ____ and ____.', answers: ['water', 'sunlight', 'extra'] },
  { text: 'No blank yet', answers: ['x'] },
])
eq('normalize trims extra answers', norm[0].answers, ['water', 'sunlight'])
eq('normalize keeps 0-blank slot', norm[1].answers.length, 0)

// ── Answer key + layout ordering across statements ────────────────
const fb = {
  type: 'fill_blanks',
  text: 'Fill in the blanks.',
  wordBank: ['soap', 'germs', 'water', 'sunlight'],
  statements: [
    { text: 'We use ____ to wash.', answers: ['soap'] },
    { text: 'Dirty hands carry ____.', answers: ['germs'] },
    { text: 'Plants need ____ and ____.', answers: ['water', 'sunlight'] },
  ],
}
eq('totalFillBlanks', totalFillBlanks(fb), 4)
eq('answer key order', fillBlanksAnswerKey(fb), ['soap', 'germs', 'water', 'sunlight'])
const layout = fillBlanksLayout(fb)
eq('layout count', layout.length, 3)
eq('layout flat index of 3rd statement', layout[2].startFlatIndex, 2)
eq('layout blanks on 3rd', layout[2].blanks, 2)
eq('hasContent true', hasFillBlanksContent(fb), true)
eq('hasContent false', hasFillBlanksContent({ statements: [{ text: '   ' }] }), false)

// ── Matching (case / whitespace / alternatives) ───────────────────
check('match exact', fillBlankMatches('soap', 'soap'))
check('match case-insensitive', fillBlankMatches('Soap', 'soap'))
check('match trims + collapses', fillBlankMatches('water', '  water '))
check('match alternative slash', fillBlankMatches('sunlight/sun', 'sun'))
check('match alternative pipe', fillBlankMatches('big|large', 'large'))
check('no match wrong', !fillBlankMatches('soap', 'water'))
check('empty key never matches', !fillBlankMatches('', ''))

// ── Grading ───────────────────────────────────────────────────────
const allRight = gradeFillBlanks(fb, ['soap', 'germs', 'water', 'sunlight'])
eq('grade all correct', allRight.allCorrect, true)
eq('grade correctBlanks', allRight.correctBlanks, 4)

const partial = gradeFillBlanks(fb, ['soap', 'WRONG', 'water', 'sunlight'])
eq('grade partial not all', partial.allCorrect, false)
eq('grade partial count', partial.correctBlanks, 3)
eq('grade perBlank', partial.perBlank, [true, false, true, true])

const empty = gradeFillBlanks(fb, [])
eq('grade empty not correct', empty.allCorrect, false)

// ── Scoring integration ───────────────────────────────────────────
check('isFillBlanksType', isFillBlanksType('fill_blanks'))
const scoreQ = { ...fb, id: 'q1', marks: 4, topic: 'Hygiene' }
check('isQuestionCorrect all', isQuestionCorrect(scoreQ, ['soap', 'germs', 'water', 'sunlight']))
check('isQuestionCorrect partial -> false', !isQuestionCorrect(scoreQ, ['soap', 'germs', 'water', 'x']))
const scored = computeQuizScore([scoreQ], { q1: ['soap', 'germs', 'water', 'sunlight'] })
eq('computeQuizScore full marks', scored.score, 4)
eq('computeQuizScore total', scored.total, 4)
const scoredPartial = computeQuizScore([scoreQ], { q1: ['soap', 'germs', 'water', 'x'] })
eq('computeQuizScore partial = 0 (all-or-nothing)', scoredPartial.score, 0)

// ── Schema accepts a fill_blanks question ─────────────────────────
const baseDoc = {
  type: 'fill_blanks',
  topic: 'Hygiene',
  marks: 4,
  order: 0,
  text: 'Fill in the blanks using the words provided below.',
  options: [],
  correctAnswer: '',
  wordBank: ['soap', 'germs', 'water', 'sunlight'],
  wordBankReuse: false,
  statements: [
    { text: 'We use ____ to wash.', answers: ['soap'] },
    { text: 'Plants need ____ and ____.', answers: ['water', 'sunlight'] },
  ],
  contentVersion: 3,
}
const okParse = questionWriteSchema.safeParse(baseDoc)
check('schema accepts fill_blanks', okParse.success)
if (!okParse.success) console.error('   schema error:', okParse.error.issues?.[0])

// strict: a stray key on a statement is rejected
const strayDoc = {
  ...baseDoc,
  statements: [{ text: 'a ____ b', answers: ['x'], bogus: true }],
}
check('schema rejects stray statement key', !questionWriteSchema.safeParse(strayDoc).success)

console.log(`\nfill-blanks: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
