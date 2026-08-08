'use strict';

// Unit tests for the past-paper AI import pure helpers. The import runs over an
// uploaded paper of ANY length and must capture every question of every type,
// so these tests pin the orchestration logic the redesign depends on:
//   - page-batch planning (no page cap)
//   - the loop-until-dry coverage loop (de-dupe new questions across rounds)
//   - multi-type normalisation (mcq/tf/short_answer/fill_blanks/essay/numeric)
//   - source-number gap detection + the completeness report
// The Claude calls + Firestore writes live in pastPaperImport.js and aren't
// exercised here (they need the functions/ runtime); this is the pure brain.

const assert = require('node:assert/strict');
const {
  dedupeExtractedQuestions,
  canWriteQuiz,
  canonicalType,
  questionKey,
  numberKey,
  sanitiseFigureBox,
  planPageBatches,
  selectNewQuestions,
  filterRecoveredToWanted,
  dedupeBySourceNumber,
  extractionProgress,
  summariseSeenStems,
  normaliseImportedQuestion,
  classifyContentRole,
  parseSourceNumber,
  findSourceNumberGaps,
  mergeAndRenumber,
  validateImport,
  computeConfidence,
  countByType,
  confidenceBand,
  countConfidenceBands,
  buildImportReport,
  canonicalPassageKind,
  normalisePassageRef,
  collectPassages,
  extractFigureDescription,
  textToParagraphHtml,
  normaliseTable,
  tableToHtml,
} = require('./pastPaperImportHelpers');

let pass = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    failures.push({name, message: err.message});
  }
}

function q(prompt, options, order) {
  return {prompt, options, correctAnswer: 0, explanation: '', order, requiresReview: true};
}

// ── dedupeExtractedQuestions (unchanged behaviour, regression-guarded) ──────
test('repeated question collapses to one, order re-sequenced', () => {
  const input = [
    q('What is the capital of Zambia?', ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'], 0),
    q('Which gas do plants absorb?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'], 1),
    q('What is the capital of Zambia?', ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'], 2),
  ];
  const out = dedupeExtractedQuestions(input);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => x.order), [0, 1]);
});

test('whitespace/case-only differences collapse', () => {
  const out = dedupeExtractedQuestions([
    q('What is  2 + 2?', ['3', '4', '5', '6'], 0),
    q('what is 2 + 2?', ['3', '4', '5', '6'], 1),
  ]);
  assert.equal(out.length, 1);
});

test('same stem, different options stays distinct', () => {
  const out = dedupeExtractedQuestions([
    q('Pick the odd one out.', ['cat', 'dog', 'cow', 'car'], 0),
    q('Pick the odd one out.', ['red', 'blue', 'green', 'seven'], 1),
  ]);
  assert.equal(out.length, 2);
});

// ── canWriteQuiz (IDOR guard) ───────────────────────────────────────────────
test('quiz-write authorisation', () => {
  assert.equal(canWriteQuiz({createdBy: 'teacher-1'}, 'teacher-1', false), true);
  assert.equal(canWriteQuiz({createdBy: 'teacher-2'}, 'teacher-1', false), false);
  assert.equal(canWriteQuiz({createdBy: 'teacher-2'}, 'teacher-1', true), true);
  assert.equal(canWriteQuiz(null, 'teacher-1', false), false);
  assert.equal(canWriteQuiz({}, 'teacher-1', false), false);
});

// ── canonicalType ───────────────────────────────────────────────────────────
test('type aliases fold to canonical editor types', () => {
  assert.equal(canonicalType('multiple_choice'), 'mcq');
  assert.equal(canonicalType('True/False'), 'tf');
  assert.equal(canonicalType('fill_in_the_blank'), 'fill_blanks');
  assert.equal(canonicalType('SHORT ANSWER'), 'short_answer');
  assert.equal(canonicalType('structured'), 'short_answer'); // unsupported → nearest
  assert.equal(canonicalType('matching'), 'short_answer');
  assert.equal(canonicalType('calculation'), 'numeric');
  assert.equal(canonicalType('mcq'), 'mcq'); // already canonical
  assert.equal(canonicalType('  '), ''); // empty
  assert.equal(canonicalType('nonsense'), ''); // unknown → empty (caller infers)
});

// ── planPageBatches — NO page cap ───────────────────────────────────────────
test('planPageBatches splits all pages, no cap', () => {
  const pages = Array.from({length: 26}, (_, i) => `p${i + 1}`);
  const batches = planPageBatches(pages, 4);
  assert.equal(batches.length, 7); // 26 / 4 → 7 batches (last has 2)
  // Every page is covered exactly once.
  const seen = batches.flatMap((b) => b.pages);
  assert.equal(seen.length, 26);
  assert.equal(batches[0].startPage, 1);
  assert.equal(batches[0].endPage, 4);
  assert.equal(batches[6].startPage, 25);
  assert.equal(batches[6].endPage, 26);
});

test('planPageBatches handles a 100-page paper without truncating', () => {
  const pages = Array.from({length: 100}, (_, i) => i);
  const batches = planPageBatches(pages, 4);
  assert.equal(batches.flatMap((b) => b.pages).length, 100);
});

test('planPageBatches: empty + single', () => {
  assert.equal(planPageBatches([], 4).length, 0);
  assert.equal(planPageBatches(['a'], 4).length, 1);
  assert.equal(planPageBatches(['a', 'b'], 1).length, 2); // size 1
});

// ── selectNewQuestions — coverage loop de-dupe ──────────────────────────────
test('selectNewQuestions only returns unseen questions, mutating the set', () => {
  const seen = new Set();
  const r1 = selectNewQuestions(seen, [
    q('A?', ['1', '2'], 0), q('B?', ['1', '2'], 1),
  ]);
  assert.equal(r1.fresh.length, 2);
  // Second round repeats A, adds C — only C is fresh.
  const r2 = selectNewQuestions(seen, [
    q('A?', ['1', '2'], 0), q('C?', ['1', '2'], 2),
  ]);
  assert.equal(r2.fresh.length, 1);
  assert.equal(r2.fresh[0].prompt, 'C?');
  assert.equal(seen.size, 3);
});

test('coverage loop converges: a fully-repeated round yields nothing fresh', () => {
  const seen = new Set();
  selectNewQuestions(seen, [q('A?', ['1', '2'], 0)]);
  const again = selectNewQuestions(seen, [q('A?', ['1', '2'], 0)]);
  assert.equal(again.fresh.length, 0); // → caller stops the loop
});

// ── number-aware de-dup: the scanned-paper over-extraction fix ──────────────
test('selectNewQuestions drops an OCR-drift re-read of an already-seen number', () => {
  const seenKeys = new Set();
  const seenNumbers = new Set();
  // Round 0 captures Q30.
  const r0 = selectNewQuestions(seenKeys, [
    {prompt: 'On the coat of arms, the ... stands for farming.', options: ['a', 'b', 'c', 'd'], sourceNumber: 30, order: 0},
  ], seenNumbers);
  assert.equal(r0.fresh.length, 1);
  // Round 1 re-reads the SAME question with OCR drift (different stem text) but
  // the same printed number — must NOT be treated as new.
  const r1 = selectNewQuestions(seenKeys, [
    {prompt: 'On the coat of arms the . stands for farmlng.', options: ['a', 'b', 'c', 'd'], sourceNumber: 30, order: 1},
    {prompt: 'Which is an element of weather?', options: ['a', 'b', 'c', 'd'], sourceNumber: 31, order: 2},
  ], seenNumbers);
  assert.equal(r1.fresh.length, 1); // only the genuinely-new Q31
  assert.equal(r1.fresh[0].sourceNumber, 31);
});

test('selectNewQuestions without seenNumbers keeps the original stem-only behaviour', () => {
  const seenKeys = new Set();
  // No seenNumbers passed → OCR-drifted re-reads (different stems) are NOT
  // collapsed (legacy behaviour preserved for callers that opt out).
  selectNewQuestions(seenKeys, [{prompt: 'Q30a', options: ['a', 'b'], sourceNumber: 30}]);
  const again = selectNewQuestions(seenKeys, [{prompt: 'Q30b', options: ['a', 'b'], sourceNumber: 30}]);
  assert.equal(again.fresh.length, 1);
});

test('dedupeBySourceNumber collapses same-number re-reads, keeps the first, leaves unnumbered alone', () => {
  const out = dedupeBySourceNumber([
    {prompt: 'Q1 read A', sourceNumber: 1},
    {prompt: 'Q2', sourceNumber: 2},
    {prompt: 'Q1 read B (ocr drift)', sourceNumber: 1}, // dup number → dropped
    {prompt: 'unnumbered one', sourceNumber: null},
    {prompt: 'unnumbered two', sourceNumber: null}, // both kept (no number)
  ]);
  assert.equal(out.removed, 1);
  assert.equal(out.questions.length, 4);
  assert.equal(out.questions[0].prompt, 'Q1 read A'); // first occurrence wins
  assert.ok(out.questions.every((x) => x.prompt !== 'Q1 read B (ocr drift)'));
});

test('mergeAndRenumber collapses a doubled scanned paper back to its real count', () => {
  // Simulates the production bug: a 4-question paper re-read twice with OCR
  // drift → 8 entries, none of them exact-stem duplicates, all with the right
  // printed numbers. Number-dedup must bring it back to 4.
  const doubled = [];
  for (const pass of ['', ' ']) { // second pass adds a stray space = OCR drift
    for (let n = 1; n <= 4; n++) {
      doubled.push({prompt: `Question ${n}${pass}`, options: ['a', 'b', 'c', 'd'], sourceNumber: n, order: doubled.length});
    }
  }
  assert.equal(doubled.length, 8);
  const {questions, duplicatesRemoved} = mergeAndRenumber(doubled);
  assert.equal(questions.length, 4); // ← the fix: 8 → 4, not 8
  assert.equal(duplicatesRemoved, 4);
  assert.deepEqual(questions.map((x) => x.sourceNumber), [1, 2, 3, 4]);
});

// ── extractionProgress — resume marker for the continuation loop ────────────
test('extractionProgress reports count + highest source number', () => {
  const p = extractionProgress([
    {prompt: 'Q1', sourceNumber: 1},
    {prompt: 'Q2', sourceNumber: 2},
    {prompt: 'Q3', sourceNumber: 3},
  ]);
  assert.equal(p.count, 3);
  assert.equal(p.maxSourceNumber, 3);
});

test('extractionProgress picks the MAX number even when out of order', () => {
  // The model can return questions out of order or with a late high number; the
  // resume marker must point past the furthest one captured, not the last one.
  const p = extractionProgress([
    {prompt: 'Q3', sourceNumber: 3},
    {prompt: 'Q40', sourceNumber: 40},
    {prompt: 'Q12', sourceNumber: '12'},
  ]);
  assert.equal(p.count, 3);
  assert.equal(p.maxSourceNumber, 40); // → next round asks for 41 onward
});

test('extractionProgress falls back to null number when none are printed', () => {
  const p = extractionProgress([
    {prompt: 'Q1'}, {prompt: 'Q2', sourceNumber: null},
  ]);
  assert.equal(p.count, 2);
  assert.equal(p.maxSourceNumber, null); // caller resumes by count instead
});

test('extractionProgress handles empty/garbage input', () => {
  assert.deepEqual(extractionProgress([]), {count: 0, maxSourceNumber: null});
  assert.deepEqual(extractionProgress(null), {count: 0, maxSourceNumber: null});
});

// ── summariseSeenStems ──────────────────────────────────────────────────────
test('summariseSeenStems is bounded in count and length', () => {
  const many = Array.from({length: 200}, (_, i) =>
    q('x'.repeat(300) + ` ${i}`, ['a', 'b'], i));
  const stems = summariseSeenStems(many, 60, 90);
  assert.equal(stems.length, 60); // capped count
  assert.ok(stems.every((s) => s.length <= 96)); // "NN. " + 90 chars
});

// ── normaliseImportedQuestion — multi-type ──────────────────────────────────
test('mcq with valid answer index', () => {
  const n = normaliseImportedQuestion(
    {type: 'mcq', prompt: 'Capital?', options: ['Lusaka', 'Ndola'], correctAnswer: 0}, 0);
  assert.equal(n.type, 'mcq');
  assert.equal(n.correctAnswer, 0);
  assert.equal(n.answerKnown, true);
});

test('mcq out-of-range answer defaults to 0, flagged unknown', () => {
  const n = normaliseImportedQuestion(
    {type: 'mcq', prompt: 'Q?', options: ['a', 'b'], correctAnswer: 7}, 0);
  assert.equal(n.correctAnswer, 0);
  assert.equal(n.answerKnown, false);
});

test('mcq with <2 options downgrades to short_answer (editor-safe)', () => {
  const n = normaliseImportedQuestion(
    {type: 'mcq', prompt: 'Define X', options: ['only one'], correctAnswer: 'only one'}, 0);
  assert.equal(n.type, 'short_answer');
  assert.deepEqual(n.options, []);
});

test('tf normalises options + boolean answer to index', () => {
  const t = normaliseImportedQuestion(
    {type: 'tf', prompt: 'Sky is blue?', correctAnswer: true}, 0);
  assert.deepEqual(t.options, ['True', 'False']);
  assert.equal(t.correctAnswer, 0);
  const f = normaliseImportedQuestion(
    {type: 'truefalse', prompt: 'Fish fly?', correctAnswer: false}, 0);
  assert.equal(f.correctAnswer, 1);
  assert.equal(f.type, 'tf');
});

test('short_answer keeps string answer, no options', () => {
  const n = normaliseImportedQuestion(
    {type: 'short_answer', prompt: 'Name the process', correctAnswer: 'photosynthesis'}, 0);
  assert.deepEqual(n.options, []);
  assert.equal(n.correctAnswer, 'photosynthesis');
  assert.equal(n.answerKnown, true);
});

test('fill_blanks treated as free-text answer', () => {
  const n = normaliseImportedQuestion(
    {type: 'fill_in_the_blank', prompt: 'Water is H__O', correctAnswer: '2'}, 0);
  assert.equal(n.type, 'fill_blanks');
  assert.equal(n.correctAnswer, '2');
});

test('essay never carries an answer', () => {
  const n = normaliseImportedQuestion(
    {type: 'essay', prompt: 'Discuss colonialism.', correctAnswer: 'long'}, 0);
  assert.equal(n.type, 'essay');
  assert.equal(n.correctAnswer, '');
  assert.equal(n.answerKnown, false);
});

test('numeric keeps a finite number; non-numeric downgrades to short_answer', () => {
  const ok = normaliseImportedQuestion(
    {type: 'numeric', prompt: '2+2?', correctAnswer: '4'}, 0);
  assert.equal(ok.type, 'numeric');
  assert.equal(ok.correctAnswer, 4);
  const bad = normaliseImportedQuestion(
    {type: 'numeric', prompt: 'Estimate', correctAnswer: 'about ten'}, 0);
  assert.equal(bad.type, 'short_answer');
  assert.equal(bad.correctAnswer, 'about ten');
});

test('missing type is inferred from options', () => {
  assert.equal(normaliseImportedQuestion({prompt: 'Q', options: ['a', 'b', 'c']}, 0).type, 'mcq');
  assert.equal(normaliseImportedQuestion({prompt: 'Q', options: []}, 0).type, 'short_answer');
});

test('empty prompt is rejected', () => {
  assert.equal(normaliseImportedQuestion({prompt: '   ', options: ['a', 'b']}, 0), null);
});

// ── Phase 5: stem-less spelling/punctuation items must survive normalisation ──
test('a stem-less item with a printed number + 2 options SURVIVES with an empty prompt', () => {
  const n = normaliseImportedQuestion({
    prompt: '', sourceNumber: 26, options: [
      'Cassava, maize potatoes and wheat are carbohydrate foods.',
      'Cassava, maize, potatoes and wheat are carbohydrate foods.',
    ],
  }, 0);
  assert.notEqual(n, null, 'must not be dropped — the reconciler fills the Part instruction later');
  assert.equal(n.prompt, '');
  assert.equal(n.type, 'mcq', 'the printed choices become MCQ options');
  assert.equal(n.options.length, 2);
  assert.equal(n.sourceNumber, 26);
});

test('a stem-less item with NO printed number is still rejected (cannot be trusted as a real question)', () => {
  assert.equal(
    normaliseImportedQuestion({prompt: '', options: ['a', 'b']}, 0), null,
    'no sourceNumber ⇒ not distinguishable from junk — drop it',
  );
});

test('a stem-less item with only 1 option is still rejected', () => {
  assert.equal(
    normaliseImportedQuestion({prompt: '', sourceNumber: 5, options: ['only one']}, 0), null,
  );
});

test('a stem-less item explicitly typed short_answer keeps its options (never wiped to [])', () => {
  const n = normaliseImportedQuestion({
    prompt: '', sourceNumber: 7, type: 'short_answer', options: ['a', 'b', 'c'],
  }, 0);
  assert.equal(n.type, 'mcq', 'forced back to mcq so the printed choices are not lost');
  assert.equal(n.options.length, 3);
});

// ── Phase 8: sourcePageNumber (real page) stays distinct from sourceNumber (printed number) ──
test('normaliseImportedQuestion carries sourcePageNumber separately from sourceNumber', () => {
  const n = normaliseImportedQuestion(
    {prompt: 'Q?', type: 'mcq', options: ['a', 'b'], sourceNumber: 23, sourcePageNumber: 6}, 0);
  assert.equal(n.sourceNumber, 23);
  assert.equal(n.sourcePageNumber, 6);
  assert.notEqual(n.sourceNumber, n.sourcePageNumber);
});

test('sourcePageNumber is omitted (not zero/null-written) when the model reports none', () => {
  const n = normaliseImportedQuestion({prompt: 'Q?', type: 'mcq', options: ['a', 'b'], sourceNumber: 1}, 0);
  assert.equal('sourcePageNumber' in n, false);
});

// ── Phase 4: worked-Example / instruction exclusion ─────────────────────────
test('classifyContentRole trusts an explicit contentRole from the model', () => {
  assert.equal(classifyContentRole({contentRole: 'example', prompt: 'Anything'}), 'example');
  assert.equal(classifyContentRole({contentRole: 'instruction', prompt: 'Choose the correct word.'}), 'instruction');
  assert.equal(classifyContentRole({contentRole: 'heading', prompt: 'SECTION B'}), 'heading');
  assert.equal(classifyContentRole({contentRole: 'question', prompt: 'Q1'}), 'question');
  assert.equal(classifyContentRole({contentRole: 'nonsense', prompt: 'Q1'}), 'question', 'unknown value ⇒ default');
});

test('classifyContentRole honours an explicit isExample flag', () => {
  assert.equal(classifyContentRole({isExample: true, prompt: 'Whatever text'}), 'example');
});

test('classifyContentRole rejects an unnumbered "Example:" block by text heuristic', () => {
  assert.equal(classifyContentRole({prompt: 'Example: The capital of Zambia is Lusaka.'}), 'example');
  assert.equal(classifyContentRole({prompt: 'Worked Example — solve for x.'}), 'example');
});

test('classifyContentRole does NOT misclassify a real numbered question mentioning "example"', () => {
  // A printed number is the deciding signal — a worked Example is NEVER given
  // its own printed question number on a real paper.
  assert.equal(
    classifyContentRole({prompt: 'Example of a renewable energy source?', sourceNumber: 14, options: ['Solar', 'Coal']}),
    'question',
  );
});

test('classifyContentRole defaults an ordinary question to "question"', () => {
  assert.equal(classifyContentRole({prompt: 'What is the capital of Zambia?', sourceNumber: 1}), 'question');
  assert.equal(classifyContentRole({}), 'question');
});

test('answer "never guess" — null answer leaves mcq unknown', () => {
  const n = normaliseImportedQuestion(
    {type: 'mcq', prompt: 'Q?', options: ['a', 'b', 'c', 'd'], correctAnswer: null}, 0);
  assert.equal(n.answerKnown, false);
  assert.equal(n.correctAnswer, 0);
});

// ── parseSourceNumber / findSourceNumberGaps ────────────────────────────────
test('parseSourceNumber pulls an int from many shapes', () => {
  assert.equal(parseSourceNumber(12), 12);
  assert.equal(parseSourceNumber('12'), 12);
  assert.equal(parseSourceNumber('Q12'), 12);
  assert.equal(parseSourceNumber('12.'), 12);
  assert.equal(parseSourceNumber(null), null);
  assert.equal(parseSourceNumber('none'), null);
  assert.equal(parseSourceNumber(0), null);
});

test('findSourceNumberGaps reports skipped numbers', () => {
  const qs = [1, 2, 3, 5, 6].map((n) => ({sourceNumber: n}));
  assert.deepEqual(findSourceNumberGaps(qs), [4]);
});

test('findSourceNumberGaps stays quiet when numbering is sparse/noisy', () => {
  // Only 1 of 5 carries a number → not enough signal.
  const qs = [{sourceNumber: 1}, {}, {}, {}, {}];
  assert.deepEqual(findSourceNumberGaps(qs), []);
});

test('findSourceNumberGaps ignores an absurd span', () => {
  const qs = [{sourceNumber: 1}, {sourceNumber: 2}, {sourceNumber: 1999}];
  assert.deepEqual(findSourceNumberGaps(qs), []);
});

test('no gaps on a clean 1..40 run', () => {
  const qs = Array.from({length: 40}, (_, i) => ({sourceNumber: i + 1}));
  assert.deepEqual(findSourceNumberGaps(qs), []);
});

// ── mergeAndRenumber ────────────────────────────────────────────────────────
test('mergeAndRenumber dedupes across batches + renumbers + counts removals', () => {
  const accum = [
    q('A?', ['1', '2'], 0),
    q('B?', ['1', '2'], 1),
    q('A?', ['1', '2'], 2), // dup from a later batch / round
    q('C?', ['1', '2'], 3),
  ];
  const {questions, duplicatesRemoved} = mergeAndRenumber(accum);
  assert.equal(questions.length, 3);
  assert.equal(duplicatesRemoved, 1);
  assert.deepEqual(questions.map((x) => x.order), [0, 1, 2]);
});

test('mergeAndRenumber preserves a 100-question paper in full', () => {
  const accum = Array.from({length: 100}, (_, i) => q(`Q${i}?`, ['a', 'b'], i));
  const {questions, duplicatesRemoved} = mergeAndRenumber(accum);
  assert.equal(questions.length, 100); // NOTHING dropped — the core fix
  assert.equal(duplicatesRemoved, 0);
});

// ── validateImport ──────────────────────────────────────────────────────────
test('validateImport flags gaps, missing answers, empty result', () => {
  const v = validateImport([
    {type: 'mcq', options: ['a', 'b'], answerKnown: true, sourceNumber: 1},
    {type: 'mcq', options: ['a', 'b'], answerKnown: false, sourceNumber: 3},
    {type: 'short_answer', options: [], answerKnown: false, sourceNumber: 4},
  ]);
  assert.ok(v.issues.some((i) => /skips/.test(i))); // gap: 2
  assert.ok(v.issues.some((i) => /no answer marked/.test(i)));

  const empty = validateImport([]);
  assert.ok(empty.issues.some((i) => /No questions/.test(i)));
});

test('validateImport is clean on a well-formed set', () => {
  const v = validateImport([
    {type: 'mcq', options: ['a', 'b'], answerKnown: true, sourceNumber: 1},
    {type: 'mcq', options: ['a', 'b'], answerKnown: true, sourceNumber: 2},
    {type: 'essay', options: [], answerKnown: false, sourceNumber: 3},
  ]);
  assert.deepEqual(v.issues, []);
});

// ── computeConfidence ───────────────────────────────────────────────────────
test('computeConfidence: 1.0 for a perfect set, lower with gaps/missing', () => {
  const perfect = Array.from({length: 10}, (_, i) =>
    ({type: 'mcq', options: ['a', 'b'], answerKnown: true, sourceNumber: i + 1}));
  assert.equal(computeConfidence(perfect), 1);

  const withGap = [
    {type: 'mcq', options: ['a', 'b'], answerKnown: true, sourceNumber: 1},
    {type: 'mcq', options: ['a', 'b'], answerKnown: true, sourceNumber: 2},
    {type: 'mcq', options: ['a', 'b'], answerKnown: true, sourceNumber: 5},
  ];
  assert.ok(computeConfidence(withGap) < 1);
  assert.equal(computeConfidence([]), 0);
  assert.ok(computeConfidence(perfect, {truncationHit: true}) < 1);
});

// ── countByType + buildImportReport ─────────────────────────────────────────
test('countByType tallies each type', () => {
  const c = countByType([
    {type: 'mcq'}, {type: 'mcq'}, {type: 'tf'}, {type: 'essay'},
  ]);
  assert.deepEqual(c, {mcq: 2, tf: 1, essay: 1});
});

test('buildImportReport assembles the studio report', () => {
  const questions = [
    {type: 'mcq', options: ['a', 'b'], answerKnown: true, sourceNumber: 1},
    {type: 'tf', options: ['True', 'False'], answerKnown: true, sourceNumber: 2},
    {type: 'short_answer', options: [], answerKnown: false, sourceNumber: 3},
  ];
  const report = buildImportReport({
    pagesProcessed: 8,
    segments: 2,
    questionsFound: 4,
    questionsImported: 3,
    duplicatesRemoved: 1,
    extractionRounds: 3,
    truncationHit: false,
    questions,
  });
  assert.equal(report.pagesProcessed, 8);
  assert.equal(report.questionsImported, 3);
  assert.equal(report.duplicatesRemoved, 1);
  assert.equal(report.withAnswerKey, 2);
  assert.equal(report.withoutAnswerKey, 1);
  assert.deepEqual(report.byType, {mcq: 1, tf: 1, short_answer: 1});
  assert.ok(report.confidence > 0 && report.confidence <= 1);
  // A removed duplicate is reported as an automatic correction.
  assert.ok(report.corrections.some((c) => /duplicate/.test(c)));
  // Extra rounds beyond #segments means the coverage loop recovered questions.
  assert.ok(report.corrections.some((c) => /loop-until-complete/.test(c)));
});

test('confidenceBand mirrors the shared 0.95/0.80 policy', () => {
  assert.equal(confidenceBand(0.97), 'auto');
  assert.equal(confidenceBand(0.85), 'review');
  assert.equal(confidenceBand(0.5), 'approve');
  assert.equal(confidenceBand(null), 'review'); // unknown → review, never auto
});

test('countConfidenceBands tallies only scored questions', () => {
  const bands = countConfidenceBands([
    {aiConfidence: 0.99},
    {aiConfidence: 0.9},
    {confidence: 0.4}, // falls back to raw confidence field
    {}, // no score — not counted
  ]);
  assert.equal(bands.auto, 1);
  assert.equal(bands.review, 1);
  assert.equal(bands.approve, 1);
  assert.equal(bands.scored, 3);
});

test('buildImportReport includes a confidence-band breakdown', () => {
  const report = buildImportReport({
    questionsImported: 2,
    questions: [
      {type: 'mcq', options: ['a', 'b'], answerKnown: true, aiConfidence: 0.98},
      {type: 'short_answer', options: [], answerKnown: false, aiConfidence: 0.6},
    ],
  });
  assert.equal(report.confidenceBands.auto, 1);
  assert.equal(report.confidenceBands.approve, 1);
  assert.equal(report.confidenceBands.scored, 2);
});

test('buildImportReport flags a truncation-limited run', () => {
  const report = buildImportReport({
    questionsImported: 50, questions: [{type: 'mcq', options: ['a', 'b'], answerKnown: true}],
    truncationHit: true, segments: 1, extractionRounds: 8,
  });
  assert.ok(report.issues.some((i) => /round limit/.test(i)));
  assert.equal(report.truncationHit, true);
});

// ── Passage capture ─────────────────────────────────────────────────────────
test('canonicalPassageKind folds figure/map words to "map", else comprehension', () => {
  assert.equal(canonicalPassageKind('comprehension'), 'comprehension');
  assert.equal(canonicalPassageKind('reading'), 'comprehension');
  assert.equal(canonicalPassageKind('map'), 'map');
  assert.equal(canonicalPassageKind('the diagram'), 'map');
  assert.equal(canonicalPassageKind('data table'), 'map');
  assert.equal(canonicalPassageKind(''), 'comprehension');
});

test('normalisePassageRef keeps ref/title/text, synthesises a ref when missing', () => {
  assert.equal(normalisePassageRef(null), null);
  assert.equal(normalisePassageRef({}), null);
  const p = normalisePassageRef({ ref: 'P1', title: 'The Pencil', text: 'Long ago...', kind: 'comprehension' });
  assert.equal(p.ref, 'P1');
  assert.equal(p.title, 'The Pencil');
  assert.equal(p.kind, 'comprehension');
  // No ref → synthesised from title so questions still group.
  const t = normalisePassageRef({ title: 'A Map of Zambia', kind: 'map' });
  assert.ok(t.ref.startsWith('title:'));
  assert.equal(t.kind, 'map');
});

test('normaliseImportedQuestion carries a passage descriptor through', () => {
  const n = normaliseImportedQuestion(
    { type: 'mcq', prompt: 'What does the writer mean?', options: ['a', 'b'], passage: { ref: 'P1', text: 'Story text', kind: 'comprehension' } }, 0);
  assert.ok(n.passage);
  assert.equal(n.passage.ref, 'P1');
});

test('collectPassages groups child questions and stamps passageId', () => {
  const qs = [
    { prompt: 'Q1', type: 'mcq', options: ['a', 'b'], order: 0 }, // standalone
    { prompt: 'Q2', type: 'short_answer', options: [], order: 1, passage: { ref: 'P1', title: 'The Pencil', text: 'A long passage about pencils.', kind: 'comprehension' } },
    { prompt: 'Q3', type: 'short_answer', options: [], order: 2, passage: { ref: 'P1', text: '', kind: 'comprehension' } },
  ];
  const { passages, questions } = collectPassages(qs);
  assert.equal(passages.length, 1);
  assert.equal(passages[0].id, 'p001');
  assert.equal(passages[0].title, 'The Pencil');
  assert.equal(passages[0].passageText, 'A long passage about pencils.'); // richest text kept
  assert.equal(passages[0].order, 1); // first child's order
  assert.equal(questions[0].passageId, null); // standalone
  assert.equal(questions[1].passageId, 'p001');
  assert.equal(questions[2].passageId, 'p001');
  assert.ok(!('passage' in questions[1])); // transient field stripped
});

test('collectPassages drops a lone text-less "passage" (misfire) to standalone', () => {
  const qs = [
    { prompt: 'Q1', type: 'mcq', options: ['a', 'b'], order: 0, passage: { ref: 'X', text: '', kind: 'comprehension' } },
  ];
  const { passages, questions } = collectPassages(qs);
  assert.equal(passages.length, 0);
  assert.equal(questions[0].passageId, null);
});

test('collectPassages keeps two distinct passages separate', () => {
  const qs = [
    { prompt: 'Q1', order: 0, passage: { ref: 'P1', text: 'First story', kind: 'comprehension' } },
    { prompt: 'Q2', order: 1, passage: { ref: 'P2', text: 'A map caption', kind: 'map' } },
  ];
  const { passages } = collectPassages(qs);
  assert.equal(passages.length, 2);
  assert.deepEqual(passages.map(p => p.passageKind), ['comprehension', 'map']);
});

test('textToParagraphHtml builds safe paragraph HTML, escapes, preserves breaks', () => {
  assert.equal(textToParagraphHtml(''), '');
  assert.equal(textToParagraphHtml('one line'), '<p>one line</p>');
  assert.equal(textToParagraphHtml('a\n\nb'), '<p>a</p><p>b</p>');
  assert.equal(textToParagraphHtml('a\nb'), '<p>a<br>b</p>');
  assert.equal(textToParagraphHtml('x < y & z'), '<p>x &lt; y &amp; z</p>'); // escaped
});

test('buildImportReport reports passagesCaptured + a correction line', () => {
  const report = buildImportReport({
    questionsImported: 5, passagesCaptured: 1,
    questions: [{ type: 'short_answer', options: [], answerKnown: false, passageId: 'p001' }],
  });
  assert.equal(report.passagesCaptured, 1);
  assert.ok(report.corrections.some(c => /reading passage/.test(c)));
});

// ── Table capture ───────────────────────────────────────────────────────────
test('normaliseTable cleans cells, squares ragged rows, needs >=2 cols + a row', () => {
  const t = normaliseTable({ headers: ['Town', 'Time'], rows: [['Lusaka', '09:30'], ['Nyimba']] });
  assert.deepEqual(t.headers, ['Town', 'Time']);
  assert.deepEqual(t.rows, [['Lusaka', '09:30'], ['Nyimba', '']]); // ragged row squared
  // headerless table keeps rows, drops the empty headers
  const h = normaliseTable({ rows: [['a', 'b'], ['c', 'd']] });
  assert.deepEqual(h.headers, []);
  assert.equal(h.rows.length, 2);
});

test('normaliseTable rejects non-tables (1 column, empty, junk)', () => {
  assert.equal(normaliseTable(null), null);
  assert.equal(normaliseTable({ headers: ['x'], rows: [['only one col']] }), null); // <2 cols
  assert.equal(normaliseTable({ headers: [], rows: [] }), null);
  assert.equal(normaliseTable({ rows: [['', '']] }), null); // all-empty rows dropped → none left
});

test('tableToHtml builds sanitiser-safe escaped table HTML', () => {
  const html = tableToHtml({ headers: ['A', 'B'], rows: [['1', '2 < 3'], ['x & y', 'z']] });
  assert.ok(html.startsWith('<table><thead><tr><th>A</th><th>B</th></tr></thead>'));
  assert.ok(html.includes('<td>2 &lt; 3</td>'));
  assert.ok(html.includes('<td>x &amp; y</td>'));
  assert.ok(html.endsWith('</tbody></table>'));
  assert.equal(tableToHtml(null), '');
  // headerless table omits <thead>
  assert.ok(!tableToHtml({ rows: [['a', 'b']] }).includes('<thead>'));
});

test('normaliseImportedQuestion carries a question-level table', () => {
  const n = normaliseImportedQuestion(
    { type: 'mcq', prompt: 'Read the table', options: ['a', 'b'], table: { headers: ['H1', 'H2'], rows: [['1', '2']] } }, 0);
  assert.ok(n.table);
  assert.deepEqual(n.table.headers, ['H1', 'H2']);
});

test('collectPassages keeps a shared table on the passage (and survives the misfire guard)', () => {
  const qs = [
    { prompt: 'Q1', order: 0, passage: { ref: 'T1', kind: 'map', table: { headers: ['Town', 'Time'], rows: [['Lusaka', '09:30']] } } },
  ];
  const { passages, questions } = collectPassages(qs);
  assert.equal(passages.length, 1); // table-only passage kept despite single question
  assert.ok(passages[0].table);
  assert.equal(passages[0].passageKind, 'map');
  assert.equal(questions[0].passageId, 'p001');
});

test('buildImportReport reports tablesCaptured + a correction line', () => {
  const report = buildImportReport({
    questionsImported: 3, tablesCaptured: 2,
    questions: [{ type: 'mcq', options: ['a', 'b'], answerKnown: true }],
  });
  assert.equal(report.tablesCaptured, 2);
  assert.ok(report.corrections.some(c => /table/.test(c)));
});

// ── Faithful-transcription fixes: section-scoped numbers, same-stem keeps,
// ── gap-recovery invention guard, figure/map capture ────────────────────────

test('numberKey scopes the printed number by section label', () => {
  assert.equal(numberKey({sourceNumber: 3, sectionLabel: 'SECTION B'}), 'section b#3');
  assert.equal(numberKey({sourceNumber: 3}), '#3');
  assert.equal(numberKey({sourceNumber: '  Q12. ', sectionLabel: ' Section  A '}), 'section a#12');
  assert.equal(numberKey({sourceNumber: null}), null);
  assert.equal(numberKey({}), null);
});

test('restart-numbering paper: Section B questions are NOT dropped as duplicates', () => {
  // ECZ Social Studies: Section A runs 1..3, Section B restarts at 1. The old
  // global number-dedup collided B's 1..3 with A's and silently dropped them —
  // then renumbering shifted content so positions no longer matched the paper.
  const paper = [
    {prompt: 'A1?', options: [], sourceNumber: 1, sectionLabel: 'SECTION A', order: 0},
    {prompt: 'A2?', options: [], sourceNumber: 2, sectionLabel: 'SECTION A', order: 1},
    {prompt: 'A3?', options: [], sourceNumber: 3, sectionLabel: 'SECTION A', order: 2},
    {prompt: 'B1?', options: [], sourceNumber: 1, sectionLabel: 'SECTION B', order: 3},
    {prompt: 'B2?', options: [], sourceNumber: 2, sectionLabel: 'SECTION B', order: 4},
    {prompt: 'B3?', options: [], sourceNumber: 3, sectionLabel: 'SECTION B', order: 5},
  ];
  const {questions, removed} = dedupeBySourceNumber(paper);
  assert.equal(questions.length, 6, 'all six questions must survive');
  assert.equal(removed, 0);
  // The whole merge keeps them too.
  const merged = mergeAndRenumber(paper);
  assert.equal(merged.questions.length, 6);
  assert.deepEqual(merged.questions.map(x => x.prompt), ['A1?', 'A2?', 'A3?', 'B1?', 'B2?', 'B3?']);
});

test('restart-numbering: selectNewQuestions keeps Section B Q1 when Section A Q1 is seen', () => {
  const seenKeys = new Set();
  const seenNumbers = new Set();
  selectNewQuestions(seenKeys, [
    {prompt: 'A1?', options: [], sourceNumber: 1, sectionLabel: 'SECTION A'},
  ], seenNumbers);
  const {fresh} = selectNewQuestions(seenKeys, [
    {prompt: 'B1?', options: [], sourceNumber: 1, sectionLabel: 'SECTION B'},
  ], seenNumbers);
  assert.equal(fresh.length, 1, 'restarted Q1 in a new section is a new question');
});

test('OCR-drift re-read (same section+number, drifted stem) still collapses', () => {
  const seenKeys = new Set();
  const seenNumbers = new Set();
  selectNewQuestions(seenKeys, [
    {prompt: 'Name the town of Mufulira.', options: [], sourceNumber: 7, sectionLabel: 'SECTION A'},
  ], seenNumbers);
  const {fresh} = selectNewQuestions(seenKeys, [
    // Re-OCR of the same printed question with drifting text.
    {prompt: 'Name the town of Mufülira.', options: [], sourceNumber: 7, sectionLabel: 'SECTION A'},
  ], seenNumbers);
  assert.equal(fresh.length, 0, 'same printed number in the same section is a re-read');
});

test('two DISTINCT questions sharing a verbatim stem are both kept when numbered (same batch)', () => {
  // Real papers repeat options-less stems verbatim ("Give a reason for your
  // answer."). The old stem-only dedup collapsed them, dropping questions and
  // shifting everything after — part of the "wrong questions" report. Distinct
  // same-stem questions are printed near each other, so they arrive TOGETHER
  // in one model response — the exception is deliberately batch-scoped.
  const paper = [
    {prompt: 'Give a reason for your answer.', options: [], sourceNumber: 9, order: 0},
    {prompt: 'Give a reason for your answer.', options: [], sourceNumber: 14, order: 1},
  ];
  const deduped = dedupeExtractedQuestions(paper);
  assert.equal(deduped.length, 2, 'distinct printed numbers ⇒ distinct questions');

  const seenKeys = new Set();
  const seenNumbers = new Set();
  const {fresh} = selectNewQuestions(seenKeys, paper, seenNumbers);
  assert.equal(fresh.length, 2, 'same-batch same-stem pair with distinct numbers both kept');
});

test('REGRESSION (review): cross-batch same-stem re-read with a DRIFTED number is dropped and never poisons seenNumbers', () => {
  // Round 0 captures Q12. Round 1 re-reads the SAME question (identical stem)
  // but misreads the printed number as 17. Keeping it would (a) import a
  // duplicate and (b) record '#17' so the REAL Q17 arriving later is dropped
  // and its gap is masked — the confirmed "seenNumbers poisoning" finding.
  const seenKeys = new Set();
  const seenNumbers = new Set();
  selectNewQuestions(seenKeys, [
    {prompt: 'What is 7 x 8?', options: ['54', '56', '58', '64'], sourceNumber: 12},
  ], seenNumbers);
  const round1 = selectNewQuestions(seenKeys, [
    {prompt: 'What is 7 x 8?', options: ['54', '56', '58', '64'], sourceNumber: 17},
  ], seenNumbers);
  assert.equal(round1.fresh.length, 0, 'cross-batch stem repeat is a re-read, drifted number or not');
  assert.equal(seenNumbers.has('#17'), false, 'the drifted number must NOT be recorded');
  // The genuine Q17 still gets in.
  const round2 = selectNewQuestions(seenKeys, [
    {prompt: 'Name the largest lake in Zambia.', options: [], sourceNumber: 17},
  ], seenNumbers);
  assert.equal(round2.fresh.length, 1, 'the REAL Q17 must survive');
});

test('REGRESSION (review): sectionLabel drift on a re-read cannot create a duplicate', () => {
  const seenKeys = new Set();
  const seenNumbers = new Set();
  selectNewQuestions(seenKeys, [
    {prompt: 'Explain the water cycle.', options: [], sourceNumber: 5, sectionLabel: 'SECTION B'},
  ], seenNumbers);
  // Continuation round re-emits the identical question but omits the label.
  const {fresh} = selectNewQuestions(seenKeys, [
    {prompt: 'Explain the water cycle.', options: [], sourceNumber: 5},
  ], seenNumbers);
  assert.equal(fresh.length, 0, 'label drift must not defeat the stem dedupe');
});

test('REGRESSION (review): a verbatim question re-numbered to a wanted gap is rejected end-to-end', () => {
  // The gap-recovery invention mode: paper is missing Q4; the model "finds" it
  // by re-numbering already-captured Q6 verbatim. filterRecoveredToWanted
  // passes it (the number IS wanted, by construction) — the cross-batch stem
  // dedupe is the layer that must kill it, leaving the gap honestly open.
  const seenKeys = new Set();
  const seenNumbers = new Set();
  const q6 = {prompt: 'Which river forms the border with Zimbabwe?', options: ['Kafue', 'Zambezi', 'Luangwa', 'Chambeshi'], sourceNumber: 6};
  selectNewQuestions(seenKeys, [q6], seenNumbers);
  const recovered = filterRecoveredToWanted([{...q6, sourceNumber: 4}], [4]);
  assert.equal(recovered.length, 1, 'the wanted-number filter alone cannot catch re-numbering');
  const {fresh} = selectNewQuestions(seenKeys, recovered, seenNumbers);
  assert.equal(fresh.length, 0, 'the cross-batch stem dedupe rejects the invented copy');
  assert.equal(seenNumbers.has('#4'), false, 'gap 4 stays open for the report/gate');
});

test('unnumbered identical stems still collapse (conservative default)', () => {
  const paper = [
    {prompt: 'Give a reason for your answer.', options: [], order: 0},
    {prompt: 'Give a reason for your answer.', options: [], order: 1},
  ];
  assert.equal(dedupeExtractedQuestions(paper).length, 1);
  const seenKeys = new Set();
  const {fresh} = selectNewQuestions(seenKeys, paper, new Set());
  assert.equal(fresh.length, 1);
});

test('gap-recovery invention guard: only the explicitly requested numbers survive', () => {
  // The model was asked for gaps [4, 7] but returned: a legit Q4, a re-worded
  // question re-numbered to 12 (NOT requested — an invention), and an
  // unnumbered fragment. Only Q4 may enter the paper.
  const recovered = [
    {prompt: 'What is the capital of Zambia?', sourceNumber: 4},
    {prompt: 'A re-worded question that is not printed on the paper.', sourceNumber: 12},
    {prompt: 'An unnumbered fragment.', sourceNumber: null},
  ];
  const kept = filterRecoveredToWanted(recovered, [4, 7]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].sourceNumber, 4);
  // Robust to empty/garbage inputs.
  assert.deepEqual(filterRecoveredToWanted(recovered, []), []);
  assert.deepEqual(filterRecoveredToWanted(null, [4]), []);
});

test('normaliseImportedQuestion carries the printed section label', () => {
  const n = normaliseImportedQuestion({prompt: 'Q?', type: 'short_answer', sectionLabel: ' SECTION B '}, 0);
  assert.equal(n.sectionLabel, 'SECTION B');
  const bare = normaliseImportedQuestion({prompt: 'Q?', type: 'short_answer'}, 0);
  assert.equal('sectionLabel' in bare, false, 'no label ⇒ field omitted (no Firestore undefined)');
});

// ── Figure/map capture ───────────────────────────────────────────────────────

test('sanitiseFigureBox clamps, rejects degenerate, keeps a full-page map', () => {
  assert.deepEqual(sanitiseFigureBox({x: 0.1, y: 0.2, w: 0.5, h: 0.4}), {x: 0.1, y: 0.2, w: 0.5, h: 0.4});
  // Overflow past the page edge is clamped, not rejected.
  assert.deepEqual(sanitiseFigureBox({x: 0.8, y: 0.8, w: 0.5, h: 0.5}), {x: 0.8, y: 0.8, w: 0.19999999999999996, h: 0.19999999999999996});
  // A full-page map is a REAL figure (unlike the scanned-quiz sanitiser).
  assert.ok(sanitiseFigureBox({x: 0, y: 0, w: 1, h: 1}));
  // Degenerate slivers and junk are rejected.
  assert.equal(sanitiseFigureBox({x: 0.1, y: 0.1, w: 0.001, h: 0.5}), null);
  assert.equal(sanitiseFigureBox({x: 'a', y: 0, w: 0.5, h: 0.5}), null);
  assert.equal(sanitiseFigureBox(null), null);
});

test('normalisePassageRef carries sourcePage + figureBox; a page-only map survives', () => {
  const p = normalisePassageRef({ref: 'P1', kind: 'map', sourcePage: 3, figureBox: {x: 0.1, y: 0.1, w: 0.8, h: 0.5}});
  assert.equal(p.sourcePage, 3);
  assert.deepEqual(p.figureBox, {x: 0.1, y: 0.1, w: 0.8, h: 0.5});
  // No ref/title/text/table but a printed page: still a usable map descriptor.
  const pageOnly = normalisePassageRef({kind: 'map', sourcePage: 4});
  assert.ok(pageOnly, 'page-located figure must not be discarded');
  assert.equal(pageOnly.ref, 'page:4');
  assert.equal(pageOnly.kind, 'map');
});

test('collectPassages KEEPS a text-less map that carries a printed location', () => {
  // The vanishing-map regression: a pure visual map (no OCR-able text, one
  // grouped question captured) was dropped as a "mislabelled standalone",
  // erasing the map block entirely.
  const qs = [
    {prompt: 'Which town is marked X?', order: 0, passage: {ref: 'M1', kind: 'map', text: '', sourcePage: 2, figureBox: {x: 0.1, y: 0.1, w: 0.8, h: 0.6}}},
  ];
  const {passages, questions} = collectPassages(qs);
  assert.equal(passages.length, 1, 'map block with a location must be kept');
  assert.equal(passages[0].passageKind, 'map');
  assert.equal(passages[0].sourcePage, 2);
  assert.deepEqual(passages[0].figureBox, {x: 0.1, y: 0.1, w: 0.8, h: 0.6});
  assert.equal(questions[0].passageId, 'p001');
});

test('collectPassages: page + box travel as an ATOMIC pair — re-reads never mix', () => {
  // A box only means anything on the page it was reported with. Mixing one
  // read's page with another's box crops a random region (confirmed finding).
  const qs = [
    {prompt: 'Q1', order: 0, passage: {ref: 'M1', kind: 'map', text: 'Study the map.', sourcePage: 2, figureBox: {x: 0.2, y: 0.2, w: 0.3, h: 0.3}}},
    {prompt: 'Q2', order: 1, passage: {ref: 'M1', kind: 'map', text: 'Study the map.', sourcePage: 5, figureBox: {x: 0.1, y: 0.1, w: 0.8, h: 0.6}}},
  ];
  const {passages} = collectPassages(qs);
  assert.equal(passages.length, 1);
  assert.equal(passages[0].sourcePage, 2, 'first complete pair wins');
  assert.deepEqual(passages[0].figureBox, {x: 0.2, y: 0.2, w: 0.3, h: 0.3},
    "page 2's own box — never page 5's box on page 2");
});

test('collectPassages: a complete page+box pair beats a page-only report; larger box wins on the SAME page', () => {
  const qs = [
    {prompt: 'Q1', order: 0, passage: {ref: 'M1', kind: 'map', text: 'Map.', sourcePage: 2}},
    {prompt: 'Q2', order: 1, passage: {ref: 'M1', kind: 'map', text: 'Map.', sourcePage: 3, figureBox: {x: 0.1, y: 0.1, w: 0.4, h: 0.3}}},
    {prompt: 'Q3', order: 2, passage: {ref: 'M1', kind: 'map', text: 'Map.', sourcePage: 3, figureBox: {x: 0.05, y: 0.05, w: 0.9, h: 0.6}}},
  ];
  const {passages} = collectPassages(qs);
  assert.equal(passages[0].sourcePage, 3, 'complete pair replaces page-only');
  assert.deepEqual(passages[0].figureBox, {x: 0.05, y: 0.05, w: 0.9, h: 0.6}, 'largest same-page box wins');
});

test('collectPassages: figure location NEVER attaches to a comprehension passage', () => {
  // A comprehension passage is its text; attaching the raw page scan under a
  // story because the model reported its start page was a confirmed
  // mis-feature. Location only travels on map passages.
  const qs = [
    {prompt: 'Q1', order: 0, passage: {ref: 'P1', kind: 'comprehension', text: 'A long story about a farmer...', sourcePage: 2, figureBox: {x: 0, y: 0, w: 0.9, h: 0.9}}},
    {prompt: 'Q2', order: 1, passage: {ref: 'P1', kind: 'comprehension', text: ''}},
  ];
  const {passages} = collectPassages(qs);
  assert.equal(passages.length, 1);
  assert.equal('sourcePage' in passages[0], false);
  assert.equal('figureBox' in passages[0], false);
});

test('findSourceNumberGaps is SECTION-SCOPED: a restart paper cannot mask a missing question', () => {
  // Section A is complete 1..5; Section B (restarted numbering) is missing 3.
  // The old global union {1..5} looked complete — the gap was invisible to
  // recovery AND to the gate's missing-numbers blocker.
  const qs = [
    ...[1, 2, 3, 4, 5].map(n => ({sourceNumber: n, sectionLabel: 'SECTION A'})),
    ...[1, 2, 4, 5].map(n => ({sourceNumber: n, sectionLabel: 'SECTION B'})),
  ];
  assert.deepEqual(findSourceNumberGaps(qs), [3]);
  // A section with too few numbers of its own is not trusted (no phantom gaps
  // from one stray mislabelled question).
  const sparse = [
    ...[1, 2, 3, 4, 5].map(n => ({sourceNumber: n, sectionLabel: 'SECTION A'})),
    {sourceNumber: 9, sectionLabel: 'SECTIN A (typo)'},
  ];
  assert.deepEqual(findSourceNumberGaps(sparse), []);
});

test('collectPassages still drops a text-less LONE block with no location (misfire guard)', () => {
  const qs = [
    {prompt: 'Q1', order: 0, passage: {ref: 'X1', kind: 'comprehension', text: ''}},
  ];
  const {passages, questions} = collectPassages(qs);
  assert.equal(passages.length, 0);
  assert.equal(questions[0].passageId, null);
});

test('buildImportReport carries figures + engineVersion for the studio', () => {
  const report = buildImportReport({
    questionsImported: 2,
    questions: [{type: 'mcq', options: ['a', 'b'], answerKnown: true}],
    figures: [{passageId: 'p001', title: 'Map of Zambia', sourcePage: 2, box: {x: 0, y: 0, w: 1, h: 0.5}}],
    engineVersion: '2026.07.02-faithful1',
  });
  assert.equal(report.figures.length, 1);
  assert.equal(report.figures[0].passageId, 'p001');
  assert.equal(report.engineVersion, '2026.07.02-faithful1');
  assert.ok(report.corrections.some(c => /figure|map/i.test(c)));
  // Absent inputs degrade to safe defaults.
  const bare = buildImportReport({questions: []});
  assert.deepEqual(bare.figures, []);
  assert.equal(bare.engineVersion, '');
});

// ── Question-own figures (crop-from-page pipeline) ──────────────────────────
test('normaliseImportedQuestion carries hasFigure + figureBox', () => {
  const n = normaliseImportedQuestion({
    prompt: 'Which activity is being performed in the picture shown below?',
    options: ['Field event', 'Track event', 'Relay', 'Gymnastics'],
    type: 'mcq', sourceNumber: 6, sourcePageNumber: 3,
    hasFigure: true, figureBox: {x: 0.1, y: 0.4, w: 0.5, h: 0.3},
  }, 0);
  assert.equal(n.hasFigure, true);
  assert.deepEqual(n.figureBox, {x: 0.1, y: 0.4, w: 0.5, h: 0.3});
  assert.equal(n.sourcePageNumber, 3);
});

test('normaliseImportedQuestion: a degenerate figureBox drops but hasFigure survives', () => {
  const n = normaliseImportedQuestion({
    prompt: 'Name the object shown.', type: 'short_answer',
    sourceNumber: 2, sourcePageNumber: 1,
    hasFigure: true, figureBox: {x: 0.1, y: 0.1, w: 0.001, h: 0.5},
  }, 0);
  assert.equal(n.hasFigure, true);
  assert.equal(n.figureBox, undefined);
});

test('extractFigureDescription strips an inline "[Picture shows …]" into the description', () => {
  const {prompt, figureDescription} = extractFigureDescription(
    'Which activity is being performed in the picture shown below? [Picture shows a person performing a running/sprinting action]',
  );
  assert.equal(prompt, 'Which activity is being performed in the picture shown below?');
  assert.ok(/running\/sprinting/.test(figureDescription));
});

test('extractFigureDescription leaves terse cross-references and [UNCLEAR] alone', () => {
  const a = extractFigureDescription('Study the diagram (figure 2) and answer.');
  assert.equal(a.prompt, 'Study the diagram (figure 2) and answer.');
  assert.equal(a.figureDescription, '');
  const b = extractFigureDescription('The result was [UNCLEAR] metres.');
  assert.equal(b.prompt, 'The result was [UNCLEAR] metres.');
  assert.equal(b.figureDescription, '');
});

test('extractFigureDescription never erases a description-only prompt', () => {
  const {prompt, figureDescription} = extractFigureDescription('[Picture shows a maize plant with roots]');
  assert.equal(prompt, '[Picture shows a maize plant with roots]');
  assert.ok(/maize plant/.test(figureDescription));
});

test('normaliseImportedQuestion moves a prose picture-description out of the stem', () => {
  const n = normaliseImportedQuestion({
    prompt: 'Which activity is shown? [Picture shows a person sprinting on a track]',
    options: ['Field event', 'Track event', 'Relay', 'Gymnastics'],
    type: 'mcq', sourceNumber: 6, sourcePageNumber: 3,
  }, 0);
  assert.equal(n.prompt, 'Which activity is shown?');
  assert.ok(/sprinting/.test(n.figureDescription));
  assert.equal(n.hasFigure, true, 'a stripped description is itself a figure signal');
});

// ── Report ──────────────────────────────────────────────────────────────────
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed of ${pass + failures.length}`);
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`));
  process.exit(1);
}
console.log(`pastPaperImport helpers: all ${pass} tests passed`);
