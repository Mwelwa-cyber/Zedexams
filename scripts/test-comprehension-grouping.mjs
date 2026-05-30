/**
 * Regression test for the comprehension-passage grouping bug.
 *
 * Reading-comprehension papers often lay out every passage first ("Text 1",
 * "Text 2", "Text 3") and THEN a single shared run of questions ("Now do
 * questions 46 – 60"). The line-by-line importer attached that whole run to the
 * LAST passage, so Text 3 showed 15 questions while Text 1 and Text 2 showed 0.
 *
 * The fix (regroupComprehensionBlocks in documentQuizParserCore.js, backed by
 * the keyword matcher in src/utils/comprehensionGrouping.js) reattaches each
 * question to the passage it actually refers to. This test exercises the REAL
 * exported functions end-to-end so it guards the path the importer runs.
 *
 * Expected grouping for the G7 English 2023 paper:
 *   Text 1 — Q46-50 (Kaulu, witchdoctor, calabash, quivering)
 *   Text 2 — Q51-55 (hatchlings, crocodile jaw, reptiles, semiaquatic, touch)
 *   Text 3 — Q56-60 (class members, games, volleyball, football, netball, Venn)
 */

import assert from 'node:assert/strict'
import { processImportedQuestionBlocks } from '../src/components/quiz/documentQuizParserCore.js'
import {
  extractKeywords,
  assignByKeywords,
  keywordsForQuestion,
  matchQuestionsToPassages,
  regroupComprehensionSections,
  moveQuestionToPassage,
  findComprehensionGroupingIssues,
} from '../src/utils/comprehensionGrouping.js'

// ─── helpers ───────────────────────────────────────────────────────────────

function block(text, overrides = {}) {
  return { text, assets: [], source: 'docx', numberedList: false, ...overrides }
}

function mcqBlock(number, stem, options, answerLetter) {
  const answerText = options['ABCD'.indexOf(answerLetter)]
  return [
    block(`${number}. ${stem}`),
    block(`A   ${options[0]}`),
    block(`B   ${options[1]}`),
    block(`C   ${options[2]}`),
    block(`D   ${options[3]}`),
    block(`Answer: ${answerLetter}  —  ${answerText}`),
  ]
}

// The real failure mode: all three passages first, then ALL of Q46-60.
function makeAllPassagesFirstFixture() {
  return [
    block('Reading Comprehension — Questions 46 – 60'),

    block('Text 1'),
    block('Once upon a time the grandson of a headman developed a bad cough. The villagers called in a witchdoctor who used a calabash. Ancestor Kaulu was angry because the villagers did not offer him beer. The boy lay quivering. Calabashes are used as containers.'),

    block('Text 2'),
    block('Crocodiles are large semiaquatic reptiles. A crocodile has a powerful jaw. Their hatchlings emerge from eggs. Crocodiles are sensitive to touch through their jaw.'),

    block('Text 3'),
    block('The class members were asked about the games they play. A Venn diagram shows learners who play volleyball, football and netball. Some play volleyball and football, others play netball.'),

    // The shared instruction that must NOT end up inside Q46.
    block('Now do questions 46 – 60.'),

    ...mcqBlock(46, 'According to the text, why was ancestor Kaulu angry with the villagers? They …', ['bewitched the boy.', 'did not give him some beer.', 'did not understand what the calabash said.', 'offered him some beer.'], 'B'),
    ...mcqBlock(47, 'Who did the villagers call in to heal the boy?', ['a witchdoctor.', 'a teacher.', 'a doctor.', 'a headman.'], 'A'),
    ...mcqBlock(48, 'The boy lay quivering because he was …', ['happy.', 'very ill.', 'hungry.', 'asleep.'], 'B'),
    ...mcqBlock(49, 'What did ancestor Kaulu want from the villagers?', ['some beer.', 'a calabash.', 'a cough.', 'a headman.'], 'A'),
    ...mcqBlock(50, 'The primary traditional use of a calabash is as a …', ['container.', 'drum.', 'plate.', 'pot.'], 'A'),

    ...mcqBlock(51, 'The word hatchlings means young animals that have recently emerged from the …', ['womb.', 'water.', 'leaves.', 'eggs.'], 'D'),
    ...mcqBlock(52, 'Which part of the crocodile is described as powerful?', ['the tail.', 'the jaw.', 'the eyes.', 'the legs.'], 'B'),
    ...mcqBlock(53, 'Crocodiles are described as large semiaquatic …', ['birds.', 'fish.', 'reptiles.', 'mammals.'], 'C'),
    ...mcqBlock(54, 'Crocodiles are sensitive to … through their jaw.', ['light.', 'sound.', 'touch.', 'smell.'], 'C'),
    ...mcqBlock(55, 'The prefix semi in the word semiaquatic means …', ['full.', 'large.', 'quick.', 'half.'], 'D'),

    ...mcqBlock(56, 'According to the Venn diagram, the class members were asked about the … they play.', ['games.', 'songs.', 'books.', 'subjects.'], 'A'),
    ...mcqBlock(57, 'How many learners in the diagram play volleyball only?', ['three.', 'four.', 'five.', 'six.'], 'A'),
    ...mcqBlock(58, 'The diagram shows learners who play football and …', ['cricket.', 'netball.', 'rugby.', 'tennis.'], 'B'),
    ...mcqBlock(59, 'Which sport appears in the Venn diagram alongside volleyball and netball?', ['hockey.', 'football.', 'golf.', 'boxing.'], 'B'),
    ...mcqBlock(60, 'The Venn diagram is about the games the class members …', ['watch.', 'play.', 'buy.', 'sell.'], 'B'),
  ]
}

function passageSections(result) {
  return result.sections.filter(s => s.kind === 'passage')
}

function questionNumbersOf(passageSection) {
  return (passageSection.passage?.questions || [])
    .map(q => Number(q.sourceQuestionNumber))
    .filter(Boolean)
}

// ─── Test 1: unit — keyword extraction + assignment ─────────────────────────

function runKeywordUnitTest() {
  const kws = extractKeywords('According to the text, ancestor Kaulu was angry.')
  assert.ok(kws.includes('kaulu'), 'extractKeywords keeps discriminating words')
  assert.ok(!kws.includes('the'), 'extractKeywords drops stopwords')
  assert.ok(!kws.includes('according'), 'extractKeywords drops comprehension scaffolding words')
  assert.ok(!kws.includes('46'), 'extractKeywords drops bare numbers')

  const passages = [['kaulu', 'calabash', 'witchdoctor'], ['crocodile', 'hatchlings', 'reptiles'], ['volleyball', 'netball', 'football']]
  const questions = [
    ['kaulu', 'angry'],         // → 0
    ['crocodile', 'jaw'],       // → 1
    ['volleyball', 'netball'],  // → 2
  ]
  assert.deepEqual(assignByKeywords(passages, questions), [0, 1, 2], 'assignByKeywords picks best passage')

  // Tiptap JSON shape must tokenise too.
  const jsonText = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'semiaquatic reptiles' }] }] }
  assert.ok(keywordsForQuestion({ text: jsonText, options: [] }).includes('semiaquatic'),
    'keywordsForQuestion reads Tiptap JSON')

  console.log('test-comprehension-grouping: keyword unit — PASSED')
}

// ─── Test 2: parser end-to-end (the core bug) ───────────────────────────────

function runParserGroupingTest() {
  const result = processImportedQuestionBlocks(makeAllPassagesFirstFixture(), [])
  const passages = passageSections(result)

  assert.equal(passages.length, 3, `expected 3 passages, got ${passages.length}`)

  const counts = passages.map(p => (p.passage?.questions || []).length)
  assert.deepEqual(counts, [5, 5, 5],
    `each passage must hold 5 questions — got ${counts.join(', ')} (Text 3 must NOT show 15, Text 1/2 must NOT show 0)`)

  assert.deepEqual(questionNumbersOf(passages[0]), [46, 47, 48, 49, 50], 'Text 1 must contain Q46-50')
  assert.deepEqual(questionNumbersOf(passages[1]), [51, 52, 53, 54, 55], 'Text 2 must contain Q51-55')
  assert.deepEqual(questionNumbersOf(passages[2]), [56, 57, 58, 59, 60], 'Text 3 must contain Q56-60')

  // "Now do questions 46 – 60" must not appear inside any question body, and
  // Q46 must start with its real stem.
  const q46 = passages[0].passage.questions.find(q => Number(q.sourceQuestionNumber) === 46)
  const q46Text = typeof q46.text === 'string' ? q46.text : JSON.stringify(q46.text)
  assert.ok(!/now\s+do\s+questions/i.test(q46Text), '"Now do questions 46–60" must not be inside Q46')
  assert.ok(/^According to the text/i.test(q46Text), `Q46 must start with its real stem, got: ${q46Text.slice(0, 60)}`)

  const everyStem = result.sections
    .flatMap(s => s.kind === 'passage' ? s.passage.questions : [s.question])
    .map(q => (typeof q.text === 'string' ? q.text : JSON.stringify(q.text)))
    .join(' | ')
  assert.ok(!/now\s+do\s+questions/i.test(everyStem), '"Now do questions" must not appear in any question stem')

  // Grouping validation must report no issue once regrouped.
  assert.equal(findComprehensionGroupingIssues(result.sections).length, 0,
    'a correctly grouped import must raise no grouping issue')

  console.log('test-comprehension-grouping: parser end-to-end grouping — PASSED')
}

// ─── Test 3: editor sections regroup + validation + manual move ─────────────

function makeDegenerateSections() {
  const mk = (id, title, text, questions) => ({
    id,
    kind: 'passage',
    partId: null,
    passage: { id: `p-${id}`, title, passageText: text, passageKind: 'comprehension', questions },
  })
  const q = (n, text, options) => ({ localId: `q${n}`, sourceQuestionNumber: n, text, options, type: 'mcq' })
  // All 15 questions wrongly piled onto Text 3.
  return [
    mk('s1', 'Text 1', 'Kaulu witchdoctor calabash quivering villagers beer boy', []),
    mk('s2', 'Text 2', 'crocodile jaw hatchlings reptiles semiaquatic touch eggs', []),
    mk('s3', 'Text 3', 'volleyball football netball venn class members games', [
      q(46, 'Why was ancestor Kaulu angry?', ['beer', 'calabash', 'witchdoctor', 'boy']),
      q(47, 'Who healed the boy?', ['witchdoctor', 'teacher', 'doctor', 'headman']),
      q(48, 'The boy lay quivering because he was ill', ['happy', 'ill', 'hungry', 'asleep']),
      q(49, 'What did Kaulu want?', ['beer', 'calabash', 'cough', 'headman']),
      q(50, 'A calabash is used as a container', ['container', 'drum', 'plate', 'pot']),
      q(51, 'Hatchlings emerge from eggs', ['womb', 'water', 'leaves', 'eggs']),
      q(52, 'The crocodile jaw is powerful', ['tail', 'jaw', 'eyes', 'legs']),
      q(53, 'Crocodiles are semiaquatic reptiles', ['birds', 'fish', 'reptiles', 'mammals']),
      q(54, 'Crocodiles sense touch through the jaw', ['light', 'sound', 'touch', 'smell']),
      q(55, 'The prefix semi in semiaquatic means half', ['full', 'large', 'quick', 'half']),
      q(56, 'Class members were asked about games', ['games', 'songs', 'books', 'subjects']),
      q(57, 'Learners who play volleyball only', ['three', 'four', 'five', 'six']),
      q(58, 'Football and netball players', ['cricket', 'netball', 'rugby', 'tennis']),
      q(59, 'Volleyball netball and football in the venn', ['hockey', 'football', 'golf', 'boxing']),
      q(60, 'The venn diagram games the class play', ['watch', 'play', 'buy', 'sell']),
    ]),
  ]
}

function runEditorRegroupTest() {
  const sections = makeDegenerateSections()

  // Before: degenerate grouping must be flagged.
  const before = findComprehensionGroupingIssues(sections)
  assert.equal(before.length, 1, 'degenerate grouping must be flagged before regroup')
  assert.equal(before[0].severity, 'error', 'grouping issue must be an error (publish blocker)')

  const { sections: regrouped, changed } = regroupComprehensionSections(sections)
  assert.ok(changed, 'regroupComprehensionSections must report a change')
  const counts = regrouped.map(s => s.passage.questions.length)
  assert.deepEqual(counts, [5, 5, 5], `editor regroup must produce 5/5/5 — got ${counts.join(', ')}`)
  assert.deepEqual(regrouped[0].passage.questions.map(q => q.sourceQuestionNumber), [46, 47, 48, 49, 50])
  assert.deepEqual(regrouped[1].passage.questions.map(q => q.sourceQuestionNumber), [51, 52, 53, 54, 55])
  assert.deepEqual(regrouped[2].passage.questions.map(q => q.sourceQuestionNumber), [56, 57, 58, 59, 60])
  // Every moved question must carry its new passageId.
  assert.ok(regrouped[0].passage.questions.every(q => q.passageId === 'p-s1'), 'moved questions get the new passageId')

  // After: no grouping issue remains.
  assert.equal(findComprehensionGroupingIssues(regrouped).length, 0, 'no grouping issue after regroup')

  // Manual move: pull Q46 from Text 1 into Text 2, then check it landed.
  const moved = moveQuestionToPassage(regrouped, 's1', 'q46', 's2')
  assert.ok(!moved[0].passage.questions.some(q => q.localId === 'q46'), 'Q46 left Text 1')
  const q46InS2 = moved[1].passage.questions.find(q => q.localId === 'q46')
  assert.ok(q46InS2, 'Q46 landed in Text 2')
  assert.equal(q46InS2.passageId, 'p-s2', 'moved question carries destination passageId')
  // Destination stays ordered by question number (46 sorts before 51).
  assert.equal(moved[1].passage.questions[0].sourceQuestionNumber, 46, 'destination re-sorted by number')

  console.log('test-comprehension-grouping: editor regroup + move + validation — PASSED')
}

// ─── Test 4: correctly-interleaved papers are left untouched ────────────────

function runNoFalsePositiveTest() {
  // Two passages, each already with its own question — no empty passage, so the
  // importer must NOT shuffle anything.
  const blocks = [
    block('Read the passage and answer the questions that follow.'),
    block('Story 1'),
    block('The sun is a star at the centre of our solar system. It gives light and heat.'),
    ...mcqBlock(1, 'The sun is at the centre of our solar …', ['galaxy', 'system', 'planet', 'moon'], 'B'),
    block('Story 2'),
    block('Plants make food through photosynthesis using sunlight and chlorophyll.'),
    ...mcqBlock(2, 'Plants make food through …', ['digestion', 'photosynthesis', 'respiration', 'absorption'], 'B'),
  ]
  const result = processImportedQuestionBlocks(blocks, [])
  const passages = passageSections(result)
  assert.equal(passages.length, 2, 'two passages expected')
  assert.deepEqual(passages.map(p => p.passage.questions.length), [1, 1],
    'interleaved papers must keep their original 1/1 grouping (no false regroup)')
  assert.equal(matchQuestionsToPassages([], []).length, 0, 'matchQuestionsToPassages handles empty input')

  console.log('test-comprehension-grouping: interleaved papers untouched — PASSED')
}

// ─── run ─────────────────────────────────────────────────────────────────────

runKeywordUnitTest()
runParserGroupingTest()
runEditorRegroupTest()
runNoFalsePositiveTest()

console.log('test-comprehension-grouping: ALL PASSED')
