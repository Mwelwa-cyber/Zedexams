/**
 * Unit tests for Cala — the CBC Alignment Officer runner.
 *
 * Cala is deterministic (no model call): it checks an Aria draft against
 * the KB entry's outcome statements and reports citations, gaps, and
 * dotted-code drift. The KB lookup is injected so none of this touches
 * Firestore; the end-to-end seed-KB path (with firebase-admin stubbed) is
 * covered separately by scripts/test-cala-matcher.mjs.
 *
 *   node functions/agents/runners/cala.test.js
 */

const assert = require("node:assert");
const {runCala, _internals} = require("./cala");
const {
  collectDraftText,
  extractKbOutcomes,
  draftCoversOutcome,
  buildOutcomeId,
  normalise,
  stem,
} = _internals;

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

// Build a job with an Aria draft.
function job(draft, input = {grade: "6", subject: "Maths", topic: "Fractions"}) {
  return {input, output: {aria: {draft}}};
}

// An injected KB resolver returning a fixed context and recording the call.
function kbReturning(ctx, sink) {
  return async (query) => {
    if (sink) sink.push(query);
    return {kbMatch: null, kbWarning: null, kbVersion: "kb-test", ...ctx};
  };
}

const OUTCOME_A = "Add and subtract fractions with the same denominator";
const OUTCOME_B = "Order fractions on a number line from smallest to largest";

function kbEntry(overrides = {}) {
  return {
    id: "g6-maths-fractions",
    grade: "6",
    subject: "Maths",
    topic: "Fractions",
    specificOutcomes: [OUTCOME_A, OUTCOME_B],
    ...overrides,
  };
}

async function run() {
  // ── refusal gate: the two missing-draft cases have distinct messages ─
  await test("throws 'Aria must run first' when there is no aria output at all", async () => {
    await assert.rejects(
        () => runCala({job: {input: {}, output: {}}, resolveContext: kbReturning({})}),
        /Aria must run first/,
    );
  });

  await test("throws 'empty draft' when Aria ran but handed off nothing", async () => {
    await assert.rejects(
        () => runCala({job: {input: {}, output: {aria: {draft: ""}}}, resolveContext: kbReturning({})}),
        /empty draft/,
    );
  });

  // ── input shaping: the KB lookup receives the job's curriculum keys ──
  await test("passes grade/subject/topic/subtopic/term through to the KB lookup", async () => {
    const sink = [];
    const input = {grade: "4", subject: "Science", topic: "Plants", subtopic: "Roots", term: 2};
    await runCala({job: job("some draft", input), resolveContext: kbReturning({}, sink)});
    assert.deepStrictEqual(sink[0], {
      grade: "4", subject: "Science", topic: "Plants", subtopic: "Roots", term: 2,
    });
  });

  // ── aligned path: quoted outcomes become citations ───────────────────
  await test("a draft quoting every outcome is aligned with one citation per outcome", async () => {
    const draft = {
      title: "Fractions worksheet",
      sections: [
        `Pupils will ${OUTCOME_A.toLowerCase()}.`,
        `Then they ${OUTCOME_B.toLowerCase()}.`,
      ],
    };
    const out = await runCala({job: job(draft), resolveContext: kbReturning({kbMatch: kbEntry()})});
    assert.strictEqual(out.aligned, true);
    assert.deepStrictEqual(out.gaps, []);
    assert.deepStrictEqual(out.drift, []);
    assert.strictEqual(out.citations.length, 2);
    assert.deepStrictEqual(out.citations[0], {outcome: "g6-maths-fractions:o1", text: OUTCOME_A});
    assert.deepStrictEqual(out.citations[1], {outcome: "g6-maths-fractions:o2", text: OUTCOME_B});
    assert.strictEqual(out.kbVersion, "kb-test");
    assert.strictEqual(out.kbWarning, null);
  });

  // ── paraphrase tolerance: token-overlap fallback still cites ─────────
  await test("a reworded outcome is still cited via the token-overlap fallback", async () => {
    const draft = "Learners practise adding and subtracting fraction pairs " +
      "that share the same denominator in this activity.";
    const out = await runCala({
      job: job(draft),
      resolveContext: kbReturning({kbMatch: kbEntry({specificOutcomes: [OUTCOME_A]})}),
    });
    assert.strictEqual(out.aligned, true);
    assert.strictEqual(out.citations.length, 1);
  });

  // ── gap path: an uncovered outcome blocks alignment ──────────────────
  await test("an outcome the draft never touches becomes a gap and aligned=false", async () => {
    const out = await runCala({
      job: job("A page about the water cycle."),
      resolveContext: kbReturning({kbMatch: kbEntry()}),
    });
    assert.strictEqual(out.aligned, false);
    assert.deepStrictEqual(out.citations, []);
    assert.strictEqual(out.gaps.length, 2);
    assert.strictEqual(out.gaps[0].outcome, "g6-maths-fractions:o1");
    assert.match(out.gaps[0].note, /not covered/i);
  });

  // ── no KB entry: the gap names the topic, nothing else is attempted ──
  await test("a missing KB topic yields one explanatory gap and no citations or drift", async () => {
    const out = await runCala({
      job: job("Anything at all, even citing M.6.2.1."),
      resolveContext: kbReturning({kbMatch: null}),
    });
    assert.strictEqual(out.aligned, false);
    assert.strictEqual(out.gaps.length, 1);
    assert.match(out.gaps[0].note, /not found/i);
    assert.strictEqual(out.gaps[0].topic, "Fractions");
    assert.deepStrictEqual(out.citations, []);
    assert.deepStrictEqual(out.drift, []);
  });

  // ── KB entry with no outcomes: explicit gap, not a silent pass ───────
  await test("a KB entry with zero outcomes yields the 'no outcomes defined' gap", async () => {
    const out = await runCala({
      job: job("draft text"),
      resolveContext: kbReturning({kbMatch: kbEntry({specificOutcomes: []})}),
    });
    assert.strictEqual(out.aligned, false);
    assert.strictEqual(out.gaps.length, 1);
    assert.match(out.gaps[0].note, /no outcomes/i);
    assert.strictEqual(out.gaps[0].kbEntryId, "g6-maths-fractions");
  });

  // ── drift: dotted codes absent from the KB entry are flagged ─────────
  await test("a dotted code missing from the KB entry lands in drift", async () => {
    const draft = `${OUTCOME_A}. See outcome M.6.2.1 and also ENG.5.1.3.`;
    const out = await runCala({
      job: job(draft),
      resolveContext: kbReturning({
        kbMatch: kbEntry({specificOutcomes: [OUTCOME_A], code: "M.6.2.1"}),
      }),
    });
    assert.strictEqual(out.drift.length, 1);
    assert.strictEqual(out.drift[0].outcome, "ENG.5.1.3");
    assert.match(out.drift[0].note, /not present/i);
    // Drift does not by itself break alignment — only gaps do.
    assert.strictEqual(out.aligned, true);
  });

  await test("a dotted code present anywhere in the KB entry is not drift", async () => {
    const out = await runCala({
      job: job(`${OUTCOME_A}. Reference: M.6.2.1.`),
      resolveContext: kbReturning({
        kbMatch: kbEntry({specificOutcomes: [OUTCOME_A], code: "M.6.2.1"}),
      }),
    });
    assert.deepStrictEqual(out.drift, []);
  });

  // ── kbWarning passthrough ────────────────────────────────────────────
  await test("a KB warning is passed through verbatim", async () => {
    const out = await runCala({
      job: job(OUTCOME_A),
      resolveContext: kbReturning({kbMatch: kbEntry(), kbWarning: "stale seed"}),
    });
    assert.strictEqual(out.kbWarning, "stale seed");
  });

  // ── _internals: collectDraftText walks any draft shape ───────────────
  await test("collectDraftText flattens nested objects and arrays and skips nulls", () => {
    const text = collectDraftText({
      title: "T",
      sections: [{heading: "H", items: ["one", null, "two"]}, "tail"],
      count: 3,
    });
    for (const piece of ["T", "H", "one", "two", "tail"]) {
      assert.ok(text.includes(piece), `missing ${piece}`);
    }
    assert.strictEqual(collectDraftText("plain"), "plain");
    assert.strictEqual(collectDraftText(null), "");
  });

  // ── _internals: extractKbOutcomes accepts both KB shapes ─────────────
  await test("extractKbOutcomes reads outcomes, specificOutcomes, and {text} objects", () => {
    assert.deepStrictEqual(extractKbOutcomes({outcomes: ["a", {text: "b"}, "", null]}), ["a", "b"]);
    assert.deepStrictEqual(extractKbOutcomes({specificOutcomes: ["c"]}), ["c"]);
    // `outcomes` wins when both are present.
    assert.deepStrictEqual(extractKbOutcomes({outcomes: ["a"], specificOutcomes: ["c"]}), ["a"]);
    assert.deepStrictEqual(extractKbOutcomes(null), []);
    assert.deepStrictEqual(extractKbOutcomes({}), []);
  });

  // ── _internals: buildOutcomeId falls back to a synthesised slug ──────
  await test("buildOutcomeId uses the entry id, then a grade-subject-topic slug, then 'kb'", () => {
    assert.strictEqual(buildOutcomeId({id: "x"}, 0), "x:o1");
    assert.strictEqual(buildOutcomeId({moduleId: "m"}, 1), "m:o2");
    assert.strictEqual(
        buildOutcomeId({grade: "6", subject: "Maths", topic: "Fractions"}, 0),
        "6-maths-fractions:o1",
    );
    assert.strictEqual(buildOutcomeId({}, 0), "kb:o1");
  });

  // ── _internals: normalise + stem fold both sides the same way ────────
  await test("normalise lowercases, strips punctuation, and collapses whitespace", () => {
    assert.strictEqual(normalise("  Counts, forwards\nand   backwards! "), "counts forwards and backwards");
    assert.strictEqual(normalise(null), "");
  });

  await test("stem folds inflections and -ise/-ize to a shared stem", () => {
    assert.strictEqual(stem("foods"), stem("food"));
    assert.strictEqual(stem("classifies"), stem("classify"));
    assert.strictEqual(stem("organize"), stem("organise"));
    assert.strictEqual(stem("counting"), stem("count"));
    // Short tokens pass through untouched.
    assert.strictEqual(stem("to"), "to");
  });

  // ── _internals: draftCoversOutcome thresholds ────────────────────────
  await test("draftCoversOutcome refuses the token fallback for very short outcomes", () => {
    // "Add up" has fewer than 3 content tokens: only an exact substring counts.
    const tokens = new Set("pupils add up numbers".split(" ").map(stem));
    assert.strictEqual(draftCoversOutcome("pupils add up numbers", tokens, "Add up"), true);
    assert.strictEqual(draftCoversOutcome("pupils sum values", new Set(["pupil", "sum", "valu"]), "Add up"), false);
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
