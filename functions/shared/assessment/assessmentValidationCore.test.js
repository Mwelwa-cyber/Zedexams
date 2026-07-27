/**
 * The shared completeness rules, from the server's side of the boundary.
 *
 * These same rules are exercised through the studio by the Vitest specs and
 * through the export callable by exportReadiness.test.js. What is checked HERE
 * is the rule set itself, per question type, because that is the level a
 * regression is cheapest to read at — and because the modules only became
 * backend code when they moved, so the backend suite had no direct coverage of
 * them at all.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  collectQuestionIssues, collectAssessmentIssues, entriesFromStoredQuestions, optionHasContent,
} from './assessmentValidationCore.js'
import { richTextHasContent, richTextIsEmpty, decodeEntities, visibleText } from './richTextContentCore.js'

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

/**
 * Issue ids carry the question's identity (and, for options, the option index),
 * which is what makes them addressable. These tests are about WHICH rule fired,
 * so the identity is stripped off here — leaving it in would make every
 * assertion restate the fixture's own id back at itself.
 */
const ids = (issues) => issues.map((i) => i.id.replace(/-q1(-\d+)?$/, ''))
const check = (question) => collectQuestionIssues(question, { identity: 'q1', label: 'Question 1' })

console.log('\n— what an empty question looks like —')

test('rich text with nothing visible in it is empty', () => {
  for (const blank of ['', '   ', '<p></p>', '<p><br></p>', '<p>&nbsp;</p>', '<p>\u200b</p>', '<p>&#160;</p>']) {
    assert.equal(richTextHasContent(blank), false, JSON.stringify(blank))
    assert.equal(richTextIsEmpty(blank), true, JSON.stringify(blank))
  }
})

test('content without text still counts as content', () => {
  // The reason a tag strip cannot be the rule: each of these is a finished
  // question with nothing to strip down to.
  for (const held of [
    '<p><img src="leaf.png" alt="A labelled leaf"></p>',
    '<span data-latex="\\frac{1}{2}"></span>',
    '<span data-math-fraction data-numerator="1" data-denominator="2"></span>',
    '<span data-number-base data-value="101" data-base="2"></span>',
    '<table><tr><td>3</td></tr></table>',
  ]) {
    assert.equal(richTextHasContent(held), true, held)
  }
})

test('an empty table is scaffolding, not content', () => {
  assert.equal(richTextHasContent('<table><tr><td></td><td></td></tr></table>'), false)
})

test('TipTap docs are read as trees, not as their JSON', () => {
  assert.equal(richTextHasContent({ type: 'doc', content: [] }), false)
  assert.equal(richTextHasContent({ type: 'doc', content: [{ type: 'paragraph' }] }), false)
  assert.equal(richTextHasContent({
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
  }), true)
  assert.equal(richTextHasContent({
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'x.png' } }] }],
  }), true, 'an image node is content with no text of its own')
})

test('entities and invisible characters are normalised, not counted', () => {
  assert.equal(decodeEntities('&nbsp;&amp;&#65;'), '\u00a0&A')
  assert.equal(visibleText('&nbsp; \u200b\ufeff'), '')
  assert.equal(visibleText('&nbsp;a'), 'a')
  // An unknown entity is left alone rather than mangled into something else.
  assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;')
})

console.log('\n— per-type completeness —')

test('a finished short-answer question has no issues', () => {
  assert.deepEqual(check({ type: 'short_answer', text: '<p>Explain why.</p>' }), [])
})

test('empty question text is reported', () => {
  assert.deepEqual(ids(check({ type: 'short_answer', text: '<p><br></p>' })), ['question-text'])
})

test('MCQ: needs two options, filled, with an answer chosen', () => {
  assert.deepEqual(ids(check({ type: 'mcq', text: '<p>Q</p>', options: ['only one'] })), ['opt-count'])
  const empties = ids(check({ type: 'mcq', text: '<p>Q</p>', options: ['A', ''], correctAnswer: 0 }))
  assert.ok(empties.includes('opt-empty'))
  assert.deepEqual(
    ids(check({ type: 'mcq', text: '<p>Q</p>', options: ['A', 'B'], correctAnswer: null })),
    ['correct'],
  )
  assert.deepEqual(check({ type: 'mcq', text: '<p>Q</p>', options: ['A', 'B'], correctAnswer: 1 }), [])
})

test('MCQ: an option image needs alt text', () => {
  const issues = ids(check({
    type: 'mcq', text: '<p>Q</p>', options: ['', 'B'], correctAnswer: 1,
    optionMedia: [{ imageUrl: 'a.png' }, null],
  }))
  assert.ok(issues.includes('opt-alt'), issues.join(','))
  assert.ok(!issues.includes('opt-empty'), 'an option with media is not empty')
})

test('true/false shares the MCQ rules', () => {
  assert.deepEqual(check({ type: 'tf', text: '<p>Q</p>', options: ['True', 'False'], correctAnswer: 0 }), [])
  assert.deepEqual(ids(check({ type: 'true_false', text: '<p>Q</p>', options: ['True'] })), ['opt-count'])
})

test('numeric needs a number', () => {
  assert.deepEqual(ids(check({ type: 'numeric', text: '<p>Q</p>' })), ['numeric'])
  assert.deepEqual(ids(check({ type: 'numeric', text: '<p>Q</p>', correctAnswer: 'ten' })), ['numeric'])
  assert.deepEqual(check({ type: 'numeric', text: '<p>Q</p>', correctAnswer: '10' }), [])
  assert.deepEqual(check({ type: 'numeric', text: '<p>Q</p>', correctAnswer: 0 }), [], 'zero is an answer')
})

test('fill-in-the-blanks needs statements, blanks, and a key', () => {
  assert.deepEqual(ids(check({ type: 'fill_blanks', text: '<p>Q</p>' })), ['fill-blanks'])
  assert.deepEqual(
    ids(check({ type: 'fill_blanks', text: '<p>Q</p>', statements: [{ text: 'No blank here' }] })),
    ['fill-blanks'],
  )
  assert.deepEqual(
    ids(check({ type: 'fill_blanks', text: '<p>Q</p>', statements: [{ text: 'The capital is ____.' }] })),
    ['fill-blanks'], 'a blank with no expected answer cannot be marked',
  )
})

test('matching needs two pairs, each with a match', () => {
  assert.deepEqual(ids(check({ type: 'matching', text: '<p>Q</p>', matchingLeft: ['a'], matchingRight: ['b'] })), ['matching'])
  assert.deepEqual(check({
    type: 'matching', text: '<p>Q</p>',
    matchingLeft: ['a', 'b'], matchingRight: ['x', 'y'], matchingAnswer: [0, 1],
  }), [])
})

test('sequence needs two items in a real order', () => {
  assert.deepEqual(ids(check({ type: 'sequence', text: '<p>Q</p>', sequenceItems: ['one'] })), ['sequence'])
  assert.deepEqual(
    ids(check({ type: 'sequence', text: '<p>Q</p>', sequenceItems: ['a', 'b'], sequenceAnswer: [1, 1] })),
    ['sequence'], 'duplicate positions are not an order',
  )
  assert.deepEqual(check({
    type: 'sequence', text: '<p>Q</p>', sequenceItems: ['a', 'b'], sequenceAnswer: [1, 2],
  }), [])
})

test('hotspot and diagram-label need a figure and a marked answer', () => {
  assert.deepEqual(ids(check({ type: 'hotspot', text: '<p>Q</p>' })), ['hotspot'])
  assert.deepEqual(
    ids(check({ type: 'hotspot', text: '<p>Q</p>', imageUrl: 'x.png' })),
    ['hotspot'], 'an image with no target cannot be marked',
  )
  assert.deepEqual(check({
    type: 'hotspot', text: '<p>Q</p>', imageUrl: 'x.png', correctRegion: { x: 10, y: 20 },
  }), [])
  assert.deepEqual(ids(check({ type: 'diagram_label', text: '<p>Q</p>' })), ['diagram-label'])
  assert.deepEqual(check({
    type: 'diagram_label', text: '<p>Q</p>',
    imageDiagram: { libraryKey: 'anything' }, diagramLabels: [{ text: 'Stem' }],
  }), [])
})

test('an unrecognised type is a blocker, named in words', () => {
  const issues = check({ type: 'wormhole', text: '<p>Q</p>' })
  assert.deepEqual(ids(issues), ['type'])
  assert.ok(!/wormhole/.test(issues[0].label) || /".+"/.test(issues[0].label), issues[0].label)
})

test('text-answer types never block on a missing answer', () => {
  for (const type of ['short_answer', 'short', 'diagram', 'essay', 'fill']) {
    assert.deepEqual(check({ type, text: '<p>Q</p>' }), [], type)
  }
})

test('optionHasContent reads strings, docs and stringified docs', () => {
  assert.equal(optionHasContent('Lusaka'), true)
  assert.equal(optionHasContent('  '), false)
  assert.equal(optionHasContent(null), false)
  assert.equal(optionHasContent(0), false)
  assert.equal(optionHasContent({ type: 'doc', content: [] }), false)
  assert.equal(optionHasContent(JSON.stringify({
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
  })), true)
})

console.log('\n— the paper —')

test('paper details are required', () => {
  const { issues } = collectAssessmentIssues({ paper: {}, entries: [] })
  const found = issues.map((i) => i.id)
  for (const required of ['title', 'subject', 'grade', 'no-questions']) {
    assert.ok(found.includes(required), `${required} is missing from ${found.join(',')}`)
  }
})

test('a passage needs its text and at least one question', () => {
  const { issues } = collectAssessmentIssues({
    paper: { title: 'T', subject: 'S', grade: 7 },
    entries: entriesFromStoredQuestions([{ _id: 'q1', type: 'short_answer', text: '<p>Q</p>' }]),
    passages: [{ id: 'p1' }],
  })
  const found = issues.map((i) => i.id)
  assert.ok(found.includes('passage-text-p1'))
  assert.ok(found.includes('passage-questions-p1'))
})

test('a map section needs a map image, not passage text', () => {
  const { issues } = collectAssessmentIssues({
    paper: { title: 'T', subject: 'S', grade: 7 },
    entries: entriesFromStoredQuestions([{ _id: 'q1', type: 'short_answer', text: '<p>Q</p>' }]),
    passages: [{ id: 'p1', passageKind: 'map', questions: [{}] }],
  })
  assert.deepEqual(issues.map((i) => i.id), ['passage-map-image-p1'])
})

test('identity comes from the adapter, and position is a real identity', () => {
  const entries = entriesFromStoredQuestions([
    { _id: 'doc-1', text: '<p>ok</p>', type: 'short_answer' },
    { text: '', type: 'short_answer' },
  ])
  assert.equal(entries[0].identity, 'doc-1')
  assert.equal(entries[1].identity, 'position-2', 'never empty, so an issue is always attributable')
  assert.equal(entries[1].number, 2)

  const { issues } = collectAssessmentIssues({ paper: { title: 'T', subject: 'S', grade: 7 }, entries })
  const blank = issues.find((i) => i.id.startsWith('question-text-'))
  assert.equal(blank.localId, 'position-2')
  assert.match(blank.label, /^Question 2:/, 'named by display order, not by identity')
})

console.log('\n— the shapes only stored data produces —')

test('a question that is not an object at all is refused, not crashed on', () => {
  // The editor cannot make these. Firestore can hold them, and the callable
  // reads Firestore, so every one of them has to end in a refusal rather than
  // a 500 that tells the teacher nothing.
  for (const junk of [null, undefined, {}, { type: null }, { text: null }, []]) {
    const issues = collectQuestionIssues(junk, { identity: 'q1', label: 'Question 1' })
    assert.ok(Array.isArray(issues), `${JSON.stringify(junk)} produced no issue list`)
    assert.ok(issues.length > 0, `${JSON.stringify(junk)} passed as a finished question`)
  }
})

test('an issue with no identity is still an issue, not a crash', () => {
  const issues = collectQuestionIssues({ type: 'short_answer', text: '' }, {})
  assert.equal(issues.length, 1)
  assert.equal(issues[0].localId, null)
  assert.match(issues[0].id, /^question-text-unknown$/, issues[0].id)
})

test('options that are not an array, and media that is not, are handled', () => {
  assert.deepEqual(ids(check({ type: 'mcq', text: '<p>Q</p>', options: 'AB' })), ['opt-count'])
  assert.deepEqual(ids(check({ type: 'mcq', text: '<p>Q</p>', options: null })), ['opt-count'])
  // optionMedia missing entirely, and shorter than options: both are normal in
  // stored data and neither may throw.
  assert.deepEqual(check({
    type: 'mcq', text: '<p>Q</p>', options: ['A', 'B'], correctAnswer: 0, optionMedia: 'nonsense',
  }), [])
  assert.deepEqual(check({
    type: 'mcq', text: '<p>Q</p>', options: ['A', 'B'], correctAnswer: 0, optionMedia: [null],
  }), [])
})

test('a correct-answer index past the end of the options is refused', () => {
  assert.deepEqual(ids(check({ type: 'mcq', text: '<p>Q</p>', options: ['A', 'B'], correctAnswer: 5 })), ['correct'])
  assert.deepEqual(ids(check({ type: 'mcq', text: '<p>Q</p>', options: ['A', 'B'], correctAnswer: -1 })), ['correct'])
  assert.deepEqual(ids(check({ type: 'mcq', text: '<p>Q</p>', options: ['A', 'B'], correctAnswer: 1.5 })), ['correct'])
})

test('the paper collector survives arguments it was not given', () => {
  assert.ok(Array.isArray(collectAssessmentIssues().issues))
  assert.ok(Array.isArray(collectAssessmentIssues({}).issues))
  assert.ok(Array.isArray(collectAssessmentIssues({ entries: null, passages: null }).issues))
  assert.deepEqual(entriesFromStoredQuestions(null), [])
  assert.deepEqual(entriesFromStoredQuestions('not an array'), [])
  assert.deepEqual(entriesFromStoredQuestions([null, undefined]), [])
})

test('grade zero is a grade, and an empty string is not', () => {
  // `if (!grade)` would reject grade 0. It is not a CBC grade today, but the
  // rule is about the shape of the check, not about the curriculum.
  const withZero = collectAssessmentIssues({ paper: { title: 'T', subject: 'S', grade: 0 }, entries: [] })
  assert.ok(!withZero.issues.some((i) => i.id === 'grade'), 'grade 0 is set')
  const withEmpty = collectAssessmentIssues({ paper: { title: 'T', subject: 'S', grade: '' }, entries: [] })
  assert.ok(withEmpty.issues.some((i) => i.id === 'grade'))
})

test('a passage with no identity still produces an addressable issue', () => {
  const { issues } = collectAssessmentIssues({
    paper: { title: 'T', subject: 'S', grade: 7 },
    entries: entriesFromStoredQuestions([{ _id: 'q1', type: 'short_answer', text: '<p>Q</p>' }]),
    passages: [{}, null],
  })
  assert.ok(issues.some((i) => i.id === 'passage-text-unknown'), issues.map((i) => i.id).join(','))
})

test('an entry may carry its own label', () => {
  const { issues } = collectAssessmentIssues({
    paper: { title: 'T', subject: 'S', grade: 7 },
    entries: [{ question: { type: 'short_answer', text: '' }, identity: 'x', label: 'Passage question 4' }],
  })
  assert.match(issues.find((i) => i.id.startsWith('question-text-')).label, /^Passage question 4:/)
})

test('an entry with no number reads as "?" rather than "undefined"', () => {
  const { issues } = collectAssessmentIssues({
    paper: { title: 'T', subject: 'S', grade: 7 },
    entries: [{ question: { type: 'short_answer', text: '' }, identity: 'x' }],
  })
  const label = issues.find((i) => i.id.startsWith('question-text-')).label
  assert.match(label, /^Question \?:/, label)
  assert.ok(!/undefined|null|NaN/.test(label), label)
})

test('rich text handed things that are not text', () => {
  assert.equal(richTextHasContent(null), false)
  assert.equal(richTextHasContent(undefined), false)
  assert.equal(richTextHasContent(42), true, 'a number that was written down is content')
  assert.equal(richTextHasContent([{ type: 'text', text: 'x' }]), true, 'a bare fragment')
  assert.equal(richTextHasContent('{"type":"doc"'), true, 'malformed JSON is treated as the text it is')
  assert.equal(richTextHasContent({ type: 'unknownFutureNode' }), true,
    'an editor node this build does not know is content — never a reason to call a question blank')
  // A primitive that is not a string stringifies and is measured as that
  // string, so 0 and false both read as content. Recorded because it is
  // surprising, and matched deliberately: the DOM implementation did exactly
  // the same, and the parity corpus is what makes the swap safe. Changing it
  // is a change to what counts as an empty question, not a parity fix.
  assert.equal(richTextHasContent(0), true)
  assert.equal(richTextHasContent(false), true)
})

if (!process.exitCode) {
  console.log(`\n✓ shared assessment validation — ${passed} tests passed`)
}
