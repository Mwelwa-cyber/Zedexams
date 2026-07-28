/**
 * Unit tests for Aria — the Content Author runner.
 *
 * Aria is a thin router over the teacher-tool generators. The two refusal
 * gates (unsupported tool, missing/system uid) run with no dependencies.
 * The happy path injects a fake runner map + key getter so the
 * tool→draftKey routing is exercised without calling Anthropic.
 *
 *   node functions/agents/runners/aria.test.js
 */

const assert = require("node:assert");
const {isValidIdempotencyKey} = require("../../aiOperationsCore");
const {runAria, SUPPORTED_TOOLS} = require("./aria");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

async function run() {
  // ── the supported-tool set is the contract the dispatcher relies on ─
  await test("SUPPORTED_TOOLS lists the six content generators Aria drives", () => {
    assert.deepStrictEqual(
      [...SUPPORTED_TOOLS].sort(),
      ["flashcards", "lesson_plan", "notes", "rubric", "scheme_of_work", "worksheet"],
    );
  });

  // ── refusal gates ──────────────────────────────────────────────────
  await test("refuses a tool it does not drive", async () => {
    await assert.rejects(
      () => runAria({jobId: "job_test", job: {createdBy: "u1", input: {tool: "assessment"}}}),
      /does not drive the "assessment" generator/,
    );
  });

  await test("refuses a missing tool", async () => {
    await assert.rejects(
      () => runAria({jobId: "job_test", job: {createdBy: "u1", input: {}}}),
      /does not drive the "<missing>" generator/,
    );
  });

  await test("refuses when createdBy is absent", async () => {
    await assert.rejects(
      () => runAria({jobId: "job_test", job: {input: {tool: "worksheet"}}}),
      /needs a real teacher uid/,
    );
  });

  await test("refuses the synthetic 'system' uid", async () => {
    await assert.rejects(
      () => runAria({jobId: "job_test", job: {createdBy: "system", input: {tool: "worksheet"}}}),
      /needs a real teacher uid/,
    );
  });

  // ── happy path: routes to the right runner and maps the draft key ──
  await test("routes to the matching runner and pulls the draft via its draftKey", async () => {
    const calls = [];
    const fakeRunners = {
      worksheet: {
        draftKey: "worksheet",
        async run(args) {
          calls.push(args);
          return {
            generationId: "gen-9",
            worksheet: {title: "Fractions practice"},
            warning: null,
            kbGrounded: true,
          };
        },
      },
    };

    const out = await runAria({
      jobId: "job_test",
      job: {createdBy: "teacher-7", input: {tool: "WORKSHEET", grade: "6"}},
      anthropicApiKeySecret: {value: () => "secret"},
      runners: fakeRunners,
      getApiKey: () => "resolved-key",
    });

    // The runner received the resolved key + raw inputs + uid.
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].uid, "teacher-7");
    assert.strictEqual(calls[0].apiKey, "resolved-key");
    assert.strictEqual(calls[0].rawInputs.grade, "6");

    // Aria mapped the draftKey field onto `draft`.
    assert.strictEqual(out.generationId, "gen-9");
    assert.deepStrictEqual(out.draft, {title: "Fractions practice"});
    assert.strictEqual(out.kbGrounded, true);
    assert.strictEqual(out.warning, null);
    assert.ok(out.ranAt, "stamps a ranAt timestamp");
  });

  await test("draft is null when the runner returns nothing under its draftKey", async () => {
    const fakeRunners = {
      notes: {draftKey: "notes", async run() {
        return {generationId: "gen-x"};
      }},
    };
    const out = await runAria({
      jobId: "job_test",
      job: {createdBy: "t1", input: {tool: "notes"}},
      anthropicApiKeySecret: {},
      runners: fakeRunners,
      getApiKey: () => "k",
    });
    assert.strictEqual(out.draft, null);
    assert.strictEqual(out.kbGrounded, false);
  });

  // ── The idempotency key Aria hands its generators ──────────────────────
  //
  // Regression test for a real production break. Slice 2 made five generators
  // refuse a request with no idempotency key; Aria called them with none, so
  // her worksheet, flashcards, rubric and scheme_of_work jobs failed outright
  // and nothing in the suite noticed — every existing test injected a fake
  // runner that did not care.
  {
    const seen = [];
    const runners = {
      worksheet: {run: async (a) => { seen.push(a); return {generationId: "g1", worksheet: {}}; },
        draftKey: "worksheet"},
    };
    const job = {createdBy: "u1", input: {tool: "worksheet", grade: "G5"}};

    await runAria({jobId: "job_A", job, anthropicApiKeySecret: "s", runners, getApiKey: () => "k"});
    await test("passes an idempotency key to the generator", () => assert.ok(isValidIdempotencyKey(seen[0].idempotencyKey)));

    await runAria({jobId: "job_A", job, anthropicApiKeySecret: "s", runners, getApiKey: () => "k"});
    await test("the SAME job yields the SAME key, so a retry resumes rather than re-pays", () => assert.ok(seen[1].idempotencyKey === seen[0].idempotencyKey));

    await runAria({jobId: "job_B", job, anthropicApiKeySecret: "s", runners, getApiKey: () => "k"});
    await test("a DIFFERENT job yields a different key", () => assert.ok(seen[2].idempotencyKey !== seen[0].idempotencyKey));

    // The key must not move when the job's data does. Changed inputs on the
    // same job are meant to be REJECTED by fingerprint mismatch, which only
    // happens if the key stays put.
    await runAria({
      jobId: "job_A", job: {...job, input: {...job.input, grade: "G6"}},
      anthropicApiKeySecret: "s", runners, getApiKey: () => "k",
    });
    await test("the key is derived from the job id alone, not from its mutable input", () => assert.ok(seen[3].idempotencyKey === seen[0].idempotencyKey));
  }

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
