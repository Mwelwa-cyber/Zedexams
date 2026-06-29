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
  planPageBatches,
  selectNewQuestions,
  summariseSeenStems,
  normaliseImportedQuestion,
  parseSourceNumber,
  findSourceNumberGaps,
  mergeAndRenumber,
  validateImport,
  computeConfidence,
  countByType,
  buildImportReport,
  canonicalPassageKind,
  normalisePassageRef,
  collectPassages,
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

// ── Report ──────────────────────────────────────────────────────────────────
if (failures.length) {
  console.log(`\n✗ ${failures.length} failed of ${pass + failures.length}`);
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`));
  process.exit(1);
}
console.log(`pastPaperImport helpers: all ${pass} tests passed`);
