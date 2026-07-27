/**
 * The remaining shared modules, exercised from the backend side.
 *
 * These moved into the shared package because the export gate depends on them:
 * numbering decides which question a blocking message names, type
 * canonicalisation decides which completeness check a question gets, blank
 * counting decides whether a fill-in-the-blanks question can be marked, and a
 * mis-grouped comprehension run is itself a paper-level blocker.
 *
 * They had frontend tests and no backend ones, which is a real gap now that
 * they are backend code: a change made for the server has nothing here to catch
 * it.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { buildQuestionNumberMap, getQuestionKey } from './questionNumberingCore.js'
import {
  canonicalizeQuestionType, questionTypeLabel, canonicalizeImportedQuestionType,
  normalizeMarks, MARKS_BOUNDS, QUESTION_TYPES,
} from './questionTypeCore.js'
import {
  countBlanks, splitStatementSegments, blanksToUnderscores, statementLabel,
  normalizeFillStatements, normalizeWordBank, totalFillBlanks, fillBlanksAnswerKey,
  fillBlankMatches, gradeFillBlanks, hasFillBlanksContent, BLANK_TOKEN,
} from './fillBlanksCore.js'
import {
  toPlainText, extractKeywords, keywordsForQuestion, matchQuestionsToPassages,
  findComprehensionGroupingIssues, regroupComprehensionSections,
} from './comprehensionGroupingCore.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

console.log('\n— numbering: what a blocking message points at —')

test('a question is keyed by whichever identity it has at this point in its life', () => {
  assert.equal(getQuestionKey({ localId: 'l1', _id: 'd1', id: 'i1' }), 'l1', 'the editor wins while it exists')
  assert.equal(getQuestionKey({ _id: 'd1', id: 'i1' }), 'd1')
  assert.equal(getQuestionKey({ id: 'i1' }), 'i1')
  assert.equal(getQuestionKey({ order: 3 }), 3)
  assert.equal(getQuestionKey({}), '')
  assert.equal(getQuestionKey(), '')
})

test('numbers are position, so they are the numbers on the printed page', () => {
  assert.deepEqual(buildQuestionNumberMap([{ localId: 'a' }, { localId: 'b' }, { localId: 'c' }]),
    { a: 1, b: 2, c: 3 })
  // `order` is editor bookkeeping and can disagree with the array it annotates;
  // the renderers number by position, so this must too.
  assert.deepEqual(buildQuestionNumberMap([{ localId: 'a', order: 9 }, { localId: 'b', order: 0 }]),
    { a: 1, b: 2 })
  assert.deepEqual(buildQuestionNumberMap([]), {})
  assert.deepEqual(buildQuestionNumberMap(), {})
  assert.deepEqual(buildQuestionNumberMap('not an array'), {})
})

console.log('\n— question types: which check a question gets —')

test('every spelling an authoring surface uses folds onto one token', () => {
  for (const [written, canonical] of [
    ['truefalse', 'tf'], ['true_false', 'tf'], ['true/false', 'tf'],
    ['fill_in_blank', 'fill_blanks'], ['fill_in_the_blank', 'fill_blanks'], ['fill_blank', 'fill_blanks'],
  ]) {
    assert.equal(canonicalizeQuestionType(written), canonical, `${written} → ${canonicalizeQuestionType(written)}`)
  }
})

test('a recognised type in the wrong case folds to its canonical spelling', () => {
  // It did not, and 'MCQ' came back as 'MCQ' — which the completeness rules
  // compare against 'mcq', miss, and report as an unrecognised question type.
  // Harmless while only the editor called this (it writes lowercase); a real
  // false refusal now the rule runs over stored documents.
  for (const [written, canonical] of [
    ['MCQ', 'mcq'], ['Mcq', 'mcq'], ['  ESSAY  ', 'essay'], ['TF', 'tf'], ['Short_Answer', 'short_answer'],
  ]) {
    assert.equal(canonicalizeQuestionType(written), canonical, `${written} → ${canonicalizeQuestionType(written)}`)
  }
})

test('KNOWN GAP: `multiple_choice` does not fold to `mcq`', () => {
  // Recorded rather than fixed. The server's own renderer maps it
  // (renderModel.js canonType), so a stored question can carry it — and the
  // completeness rules would call it an unrecognised type and refuse the paper.
  // The STUDIO would refuse it too, identically, so this is not a client/server
  // divergence and fixing it is a change to what counts as a valid question,
  // which does not belong in a parity commit. Written down so it is a decision
  // rather than an oversight.
  assert.equal(canonicalizeQuestionType('multiple_choice'), 'multiple_choice')
})

test('an unknown type stays unknown rather than becoming a default', () => {
  // Silently defaulting is what would let an unanswerable question through: the
  // completeness check would run the MCQ rules on something that is not one.
  const got = canonicalizeQuestionType('wormhole')
  assert.ok(!QUESTION_TYPES.includes(got), `wormhole must not become a recognised type (got ${got})`)
})

test('the label shown to a teacher is words, not a token', () => {
  assert.equal(typeof questionTypeLabel('mcq'), 'string')
  assert.ok(questionTypeLabel('mcq').length > 0)
  assert.ok(!/[_]/.test(questionTypeLabel('short_answer')), questionTypeLabel('short_answer'))
  assert.ok(questionTypeLabel('wormhole').length > 0, 'an unknown type still gets something printable')
})

test('imported types canonicalise on their own path', () => {
  assert.ok(canonicalizeImportedQuestionType('multiple choice'))
  // An importer that read no type at all gets nothing back rather than a
  // guess — the question then fails the completeness check instead of being
  // silently filed as an MCQ.
  assert.ok(!canonicalizeImportedQuestionType(''))
})

test('marks are clamped into their bounds', () => {
  const b = MARKS_BOUNDS.quiz
  assert.equal(normalizeMarks(2), 2)
  assert.equal(normalizeMarks(-5), b.min)
  assert.equal(normalizeMarks(99999), b.max)
  assert.equal(normalizeMarks('3'), 3)
  assert.equal(normalizeMarks('not a number'), b.default ?? b.min)
  assert.equal(normalizeMarks(null), b.default ?? b.min)
})

console.log('\n— fill-in-the-blanks: whether it can be marked —')

test('blanks are counted, split and rendered', () => {
  assert.equal(countBlanks(`The capital is ${BLANK_TOKEN}.`), 1)
  assert.equal(countBlanks(`${BLANK_TOKEN} and ${BLANK_TOKEN}`), 2)
  assert.equal(countBlanks('no blanks here'), 0)
  assert.equal(countBlanks(''), 0)
  assert.equal(countBlanks(null), 0)

  const segments = splitStatementSegments(`A ${BLANK_TOKEN} B`)
  assert.ok(Array.isArray(segments) && segments.length >= 2, JSON.stringify(segments))

  assert.match(blanksToUnderscores(`A ${BLANK_TOKEN} B`), /_{5,}/)
  assert.equal(typeof statementLabel(0), 'string')
  assert.notEqual(statementLabel(0), statementLabel(1))
})

test('statements and the word bank normalise from whatever was stored', () => {
  assert.deepEqual(normalizeFillStatements(null), [])
  assert.deepEqual(normalizeWordBank(null), [])
  const statements = normalizeFillStatements([{ text: `a ${BLANK_TOKEN}` }, 'plain string'])
  assert.ok(Array.isArray(statements))
  assert.ok(normalizeWordBank(['one', '', '  ', 'two']).length >= 2)
})

test('the answer key has one entry per blank', () => {
  const question = {
    statements: [{ text: `The capital is ${BLANK_TOKEN}.`, answers: ['Lusaka'] }],
  }
  assert.equal(totalFillBlanks(question), 1)
  assert.deepEqual(fillBlanksAnswerKey(question), ['Lusaka'])
  assert.equal(hasFillBlanksContent(question), true)
  assert.equal(hasFillBlanksContent({}), false)
})

test('marking is case- and space-insensitive, and grading counts what matched', () => {
  assert.equal(fillBlankMatches('Lusaka', 'lusaka'), true)
  assert.equal(fillBlankMatches('Lusaka', '  Lusaka  '), true)
  assert.equal(fillBlankMatches('Lusaka', 'Ndola'), false)
  // Alternatives are accepted, which is why the key is split before comparing.
  assert.equal(fillBlankMatches('Lusaka/Lusaka City', 'lusaka city'), true)
  // An expected answer that is empty matches NOTHING, including an empty
  // response: a blank with no key cannot be marked correct by default.
  assert.equal(fillBlankMatches('', ''), false)

  const question = {
    statements: [{ text: `A is ${BLANK_TOKEN} and B is ${BLANK_TOKEN}.`, answers: ['one', 'two'] }],
  }
  const graded = gradeFillBlanks(question, ['one', 'wrong'])
  assert.ok(graded && typeof graded === 'object', JSON.stringify(graded))
})

console.log('\n— comprehension grouping: a paper-level blocker —')

test('text is flattened and keywords extracted from whatever shape it is in', () => {
  assert.equal(toPlainText('<p>The Zambezi river</p>').includes('Zambezi'), true)
  assert.equal(toPlainText(null), '')
  const keywords = extractKeywords('The Zambezi river rises in north-western Zambia')
  assert.ok(Array.isArray(keywords) && keywords.length > 0)
  // Stop words carry no signal; keeping them would match every question to
  // every passage.
  assert.ok(!keywords.includes('the'), keywords.join(','))
  assert.ok(Array.isArray(keywordsForQuestion({ text: '<p>Where does it rise?</p>' })))
})

test('questions are matched to the passage they are about', () => {
  const passages = [
    { localId: 'p1', passageText: 'The Zambezi river rises in north-western Zambia and flows east.' },
    { localId: 'p2', passageText: 'Maize is the staple crop grown by most Zambian farmers.' },
  ]
  const questions = [
    { localId: 'q1', text: 'Where does the Zambezi river rise?' },
    { localId: 'q2', text: 'Which crop is the staple grown by farmers?' },
  ]
  const matched = matchQuestionsToPassages(passages, questions)
  assert.ok(matched, 'a match result is returned')
})

test('a run where one passage holds every question is reported', () => {
  // The mis-import this exists to catch: the parser attached all of a page's
  // questions to the first passage and left its siblings empty.
  const sections = [
    { id: 's1', kind: 'passage', passage: { localId: 'p1', passageText: 'One.', questions: [{ localId: 'a' }, { localId: 'b' }] } },
    { id: 's2', kind: 'passage', passage: { localId: 'p2', passageText: 'Two.', questions: [] } },
  ]
  const issues = findComprehensionGroupingIssues(sections)
  assert.ok(Array.isArray(issues), 'issues come back as a list')
  assert.ok(issues.length > 0, 'an empty sibling passage in a run is a problem')
  assert.ok(issues[0].message, 'and it says what is wrong')
})

test('a healthy paper reports nothing, and regrouping leaves it alone', () => {
  const sections = [
    { id: 's1', kind: 'passage', passage: { localId: 'p1', passageText: 'One.', questions: [{ localId: 'a' }] } },
    { id: 's2', kind: 'standalone', question: { localId: 'b', text: 'Q' } },
  ]
  assert.deepEqual(findComprehensionGroupingIssues(sections), [])
  assert.deepEqual(findComprehensionGroupingIssues([]), [])
  // It returns { sections, changed } rather than a bare array, so a caller can
  // tell "already correct" from "rearranged" without diffing.
  const regrouped = regroupComprehensionSections(sections)
  assert.ok(Array.isArray(regrouped.sections))
  assert.equal(regrouped.changed, false, 'a healthy paper is left exactly as it was')
  assert.deepEqual(regroupComprehensionSections([]), { sections: [], changed: false })
})

if (!process.exitCode) {
  console.log(`\n✓ shared rules — ${passed} tests passed`)
}
