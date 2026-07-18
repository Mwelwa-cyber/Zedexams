'use strict';

/**
 * End-to-end PURE-PIPELINE tests for the past-paper exact-count invariant:
 *
 *   expectedQuestionNumbers === importedQuestionNumbers
 *
 * These compose the same stages runPastPaperImport() runs (classify content
 * role → normalise → merge/dedupe → declared-range reconcile → collect
 * passages → validation gate) without touching firebase-admin/Anthropic, so
 * they exercise the REAL production logic end-to-end and stay runnable under
 * plain `node` in CI (root-only deps).
 *
 * Run: node functions/teacherTools/pastPaperImportExactCount.test.js
 */

const assert = require('node:assert/strict');
const {
  classifyContentRole,
  normaliseImportedQuestion,
  mergeAndRenumber,
  collectPassages,
} = require('./pastPaperImportHelpers');
const { reconcilePastPaper } = require('./pastPaperImportReconcile');
const { gateImport } = require('../documentEngine/validationEngineCore');

let pass = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    failures.push({ name, message: err.message });
  }
}

// Mirrors the pipeline stage runPastPaperImport runs on each batch of raw
// Claude output before it enters `accum`.
function classifyAndNormalise(rawQuestions) {
  const out = [];
  const rejections = { example: 0, instruction: 0, heading: 0 };
  rawQuestions.forEach((raw, i) => {
    const role = classifyContentRole(raw);
    if (role !== 'question') {
      rejections[role] = (rejections[role] || 0) + 1;
      return;
    }
    const n = normaliseImportedQuestion(raw, i);
    if (n) out.push(n);
  });
  return { questions: out, rejections };
}

// Full pipeline: raw candidates + parts + declaredCount → the exact same
// {questions, gate} shape the server writes from.
function runPipeline(rawQuestions, parts, declaredCount) {
  const { questions: candidates, rejections } = classifyAndNormalise(rawQuestions);
  const merged = mergeAndRenumber(candidates);
  const reconciled = reconcilePastPaper(merged.questions, parts, declaredCount);
  const { questions } = collectPassages(reconciled.questions);
  const gate = gateImport({ questions, expectedNumbers: reconciled.expectedNumbers });
  return { questions, gate, reconciled, rejections };
}

const mcq = (n, over = {}) => ({
  type: 'mcq',
  prompt: `Question ${n}?`,
  options: ['A', 'B', 'C', 'D'],
  sourceNumber: n,
  confidence: 0.9,
  ...over,
});

console.log('pastPaperImportExactCount (end-to-end pure pipeline)');

// ── MANDATORY TEST 1/2: a declared 1–60 paper with 63 candidates saves
// exactly 60, and Q61–Q63 are rejected. ──────────────────────────────────────
test('a declared 1-60 paper with 63 raw candidates yields exactly 60 questions, Q61-63 rejected', () => {
  const raw = [];
  for (let n = 1; n <= 60; n++) raw.push(mcq(n));
  raw.push(mcq(61), mcq(62), mcq(63)); // phantom over-count
  const { questions, gate, reconciled } = runPipeline(raw, [], 60);

  assert.equal(questions.length, 60);
  assert.deepEqual(questions.map((q) => q.sourceNumber), Array.from({ length: 60 }, (_, i) => i + 1));
  assert.equal(gate.ok, true);
  assert.equal(gate.manifest.exact, true);
  assert.deepEqual(reconciled.droppedNumbers.outOfRange, [61, 62, 63]);
});

// ── MANDATORY TEST 3/4: duplicate Q23 candidates collapse to one; the more
// complete read wins. ────────────────────────────────────────────────────────
test('duplicate Q23 candidates collapse to the single more-complete read', () => {
  const raw = [];
  for (let n = 1; n <= 60; n++) {
    if (n === 23) {
      // A thin, low-confidence read arrives first…
      raw.push(mcq(23, { options: ['A', 'B'], confidence: 0.3 }));
      // …then a fuller, higher-confidence re-read of the SAME printed number.
      raw.push(mcq(23, { options: ['A', 'B', 'C', 'D'], confidence: 0.97 }));
    } else {
      raw.push(mcq(n));
    }
  }
  const { questions, gate } = runPipeline(raw, [], 60);
  assert.equal(questions.length, 60, 'the duplicate collapses to one — still exactly 60');
  const q23 = questions.find((q) => q.sourceNumber === 23);
  assert.equal(q23.options.length, 4, 'the fuller/higher-confidence read of Q23 wins');
  assert.equal(gate.ok, true);
});

// ── MANDATORY TEST 5: a worked Example is rejected. ──────────────────────────
test('a worked Example never becomes a question, even mixed into a full 60-question paper', () => {
  const raw = [];
  raw.push({
    // No sourceNumber — a worked Example is never printed with its own number.
    prompt: 'Example: Choose the correctly spelled word.',
    options: ['tributaly', 'tributary'],
  });
  for (let n = 1; n <= 60; n++) raw.push(mcq(n));
  const { questions, gate, rejections } = runPipeline(raw, [], 60);
  assert.equal(questions.length, 60, 'the Example does not occupy a slot or inflate the count');
  assert.equal(rejections.example, 1);
  assert.ok(!questions.some((q) => /^Example[:.]/i.test(q.prompt)));
  assert.equal(gate.ok, true);
});

// ── MANDATORY TEST 6: a legitimate empty-stem spelling item survives and
// receives the Part instruction. ─────────────────────────────────────────────
test('a legitimate stem-less spelling item survives normalisation and is filled by its Part instruction', () => {
  const parts = [{
    label: 'Part 3', sectionLabel: 'SECTION A', firstNumber: 1, lastNumber: 5,
    instruction: 'Choose the correctly spelled word.',
  }];
  const raw = [
    mcq(1), mcq(2), mcq(3), mcq(4),
    { sourceNumber: 5, prompt: '', options: ['tributaly', 'tributary', 'tributery', 'tributory'] },
  ];
  const { questions, gate } = runPipeline(raw, parts, 5);
  assert.equal(questions.length, 5);
  const stemless = questions.find((q) => q.sourceNumber === 5);
  assert.equal(stemless.prompt, 'Choose the correctly spelled word.');
  assert.equal(stemless.options.length, 4);
  assert.equal(gate.ok, true);
});

// ── MANDATORY TEST 7/8: a missing Q24 blocks the write; gap recovery cannot
// substitute Q23/Q25 for it (tested at the filter layer — see pastPaperImport
// .test.js's "gap-recovery invention guard" + "REGRESSION" cases for the
// substitution-specific proofs; this test proves the GATE side: an honestly
// missing Q24 blocks even though the count would otherwise look complete). ──
test('a genuinely missing Q24 BLOCKS the write (honest gap, never silently filled)', () => {
  const raw = [];
  for (let n = 1; n <= 60; n++) {
    if (n === 24) continue; // Q24 could not be verified anywhere on the paper
    raw.push(mcq(n));
  }
  const { questions, gate } = runPipeline(raw, [], 60);
  assert.equal(questions.length, 59);
  assert.equal(gate.ok, false, 'the destructive write must be blocked');
  assert.ok(gate.blockers.some((b) => /Missing questions: 24/.test(b)));
});

// ── MANDATORY TEST 14: continuous-number papers cannot accept duplicate bare
// numbers even if reconcile's own dedupe were somehow bypassed — the gate is
// a second, independent line of defence. ────────────────────────────────────
test('the gate independently blocks a duplicate bare number even without reconcile running', () => {
  // Simulate reconcile being skipped (e.g. restart-numbering false positive)
  // by handing the gate a manifest directly with a true duplicate present.
  const expected = [1, 2, 3, 4, 5];
  const questions = [1, 2, 2, 3, 4, 5].map((n) => mcq(n));
  const gate = gateImport({ questions, expectedNumbers: expected });
  assert.equal(gate.ok, false);
  assert.ok(gate.blockers.some((b) => /Duplicate question number/.test(b)));
});

// ── MANDATORY TEST 13: Section A Q1 and Section B Q1 stay separate on a
// restart-numbering paper — the strict global gate must NOT apply here. ─────
test('restart-numbering paper: Section A/B Q1..Q3 both survive, no false extras/duplicates blocker', () => {
  const parts = [
    { firstNumber: 1, lastNumber: 3, sectionLabel: 'SECTION A' },
    { firstNumber: 1, lastNumber: 3, sectionLabel: 'SECTION B' },
  ];
  const raw = [
    mcq(1, { sectionLabel: 'SECTION A', prompt: 'A1?' }),
    mcq(2, { sectionLabel: 'SECTION A', prompt: 'A2?' }),
    mcq(3, { sectionLabel: 'SECTION A', prompt: 'A3?' }),
    mcq(1, { sectionLabel: 'SECTION B', prompt: 'B1?' }),
    mcq(2, { sectionLabel: 'SECTION B', prompt: 'B2?' }),
    mcq(3, { sectionLabel: 'SECTION B', prompt: 'B3?' }),
  ];
  const { questions, gate, reconciled } = runPipeline(raw, parts, undefined);
  assert.equal(questions.length, 6, 'all six survive — no cross-section collision');
  assert.equal(reconciled.skippedRestartNumbering, true);
  assert.equal(gate.manifest, null, 'no strict global manifest on a restart-numbering paper');
  assert.equal(gate.ok, true);
});

// ── MANDATORY TEST 9 (existing-quiz safety) — verified at the call-site
// level: runPastPaperImport only clears/writes `if (quizId && questions.length
// && gate.ok)`. Documented here as a pipeline-shape assertion: a blocked gate
// always carries ok:false, which is the ONLY signal the write path checks. ──
test('a blocked gate is unambiguous — ok is false exactly when a required check fails', () => {
  const { gate: blockedGate } = runPipeline(
    (() => { const r = []; for (let n = 1; n <= 60; n++) if (n !== 24) r.push(mcq(n)); return r; })(),
    [], 60,
  );
  assert.equal(blockedGate.ok, false);
  const { gate: cleanGate } = runPipeline(
    (() => { const r = []; for (let n = 1; n <= 60; n++) r.push(mcq(n)); return r; })(),
    [], 60,
  );
  assert.equal(cleanGate.ok, true);
});

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed of ${pass + failures.length}`);
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`));
  process.exit(1);
}
console.log(`pastPaperImportExactCount: all ${pass} tests passed`);
