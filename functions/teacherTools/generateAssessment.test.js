/**
 * Node test for the generateAssessment orchestration (runAssessment in
 * functions/teacherTools/generateAssessment.js). The schema, prompt and
 * quality-check sub-pieces have their own tests; this covers the wiring
 * between them, which was previously untested end-to-end:
 *
 *   1. callClaude throws → the aiGenerations doc flips to 'failed', the
 *      teacher's quota is refunded, and the original error is rethrown —
 *      including when the refund itself fails (best-effort must never mask
 *      the real error).
 *   2. Invalid model output → status 'flagged', a review warning is returned,
 *      and NO refund happens (the teacher still got a paper).
 *   3. Valid output → status 'complete' with the validated paper.
 *   4. Master-Bank-sourced questions are merged into the returned sections
 *      and reported in the sourcing summary.
 *
 * Plain `node` script (repo convention). firebase-admin, firebase-functions,
 * the Anthropic client and the Firestore-backed helpers are stubbed via
 * Module._load before the module under test loads (same pattern as
 * usageMeter.test.js); assessmentSchema / assessmentQualityCheck /
 * masterBankSourcingCore / assessmentPromptV9 load for real.
 *
 * Constraint of that pattern: the stubs must be installed BEFORE the first
 * require of generateAssessment.js (Node caches the module with whatever its
 * dependencies resolved to at that moment), and the test must never
 * re-require it after restoring Module._load.
 *
 * Run: node functions/teacherTools/generateAssessment.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── In-memory aiGenerations store ────────────────────────────────────────
const SERVER_TS = Symbol("serverTimestamp");
let genDocs = {}; // id -> merged doc data
let genSeq = 0;

const firestoreFn = () => ({
  collection: (name) => {
    assert.strictEqual(name, "aiGenerations", "only aiGenerations is written");
    return {
      doc: () => {
        const id = `gen_${++genSeq}`;
        return {
          id,
          set: async (data) => {
            genDocs[id] = {...data};
          },
          update: async (data) => {
            genDocs[id] = {...(genDocs[id] || {}), ...data};
          },
        };
      },
    };
  },
});
firestoreFn.FieldValue = {
  serverTimestamp: () => SERVER_TS,
  increment: (n) => ({__inc: n}),
};

// ── Controllable stubs ───────────────────────────────────────────────────
class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const calls = {claude: [], refund: [], meter: [], sourced: []};
let claudeImpl = async () => {
  throw new Error("claudeImpl not set");
};
let refundImpl = async () => {};
let sourcedImpl = async () => ({questions: [], fromBank: 0, marks: 0, scanned: 0});
// Max plan so the general-behaviour tests run unclamped; the free-preview
// clamps get their own dedicated block at the end of the suite (flip
// USAGE.plan to "free" there and restore it after).
const USAGE = {plan: "max", used: 1, period: "202607"};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return {firestore: firestoreFn};
  if (request === "firebase-functions/v2/https") {
    return {HttpsError, onCall: (opts, handler) => handler};
  }
  if (request === "../aiService") {
    return {
      getAnthropicApiKey: () => "test-key",
      getUserRole: async () => "teacher",
      isStaffRole: () => true,
    };
  }
  if (request === "./anthropicClient") {
    return {
      callClaude: (apiKey, opts) => {
        calls.claude.push({apiKey, opts});
        return claudeImpl(apiKey, opts);
      },
    };
  }
  if (request === "./cbcKnowledge") {
    return {
      resolveCbcContext: async () => ({
        contextBlock: "CBC CONTEXT",
        kbMatch: true,
        kbWarning: null,
        kbVersion: "kb-test",
      }),
      getActiveKbVersion: async () => "kb-test",
    };
  }
  if (request === "./usageMeter") {
    return {
      assertAndIncrement: async (uid, tool) => {
        calls.meter.push({uid, tool});
        return {...USAGE};
      },
      refundGeneration: async (uid, usage, tool) => {
        calls.refund.push({uid, usage, tool});
        return refundImpl(uid, usage, tool);
      },
    };
  }
  if (request === "./masterBankSourcing") {
    return {
      sourceAssessmentFromBank: async (params) => {
        calls.sourced.push(params);
        return sourcedImpl(params);
      },
    };
  }
  if (request === "./assessmentFormats") {
    // Real module (ASSESSMENT_TYPES, normalizeQuestionTypes, type labels are
    // load-bearing), with only the Firestore-backed format resolver stubbed.
    const real = origLoad.call(this, request, ...rest);
    return {
      ...real,
      resolveAssessmentFormatContext: async () => ({
        formatBlock: "",
        formatProfileId: null,
        formatSource: "none",
      }),
    };
  }
  return origLoad.call(this, request, ...rest);
};

const {runAssessment} = require("./generateAssessment");

// ── Fixtures ─────────────────────────────────────────────────────────────
const INPUTS = {
  grade: "G7",
  subject: "mathematics",
  topic: "Fractions",
  totalMarks: 20,
  durationMinutes: 40,
  assessmentType: "topic_test",
};

function validPaper() {
  return {
    header: {
      title: "Fractions Topic Test",
      grade: "G7",
      subject: "Mathematics",
      topic: "Fractions",
      durationMinutes: 40,
      totalMarks: 4,
      instructions: "Answer ALL questions.",
    },
    sections: [{
      title: "Multiple choice",
      instructions: "Circle the correct answer.",
      questions: [
        {
          type: "multiple_choice",
          prompt: "What is 1/2 + 1/4?",
          options: ["3/4", "1/2", "2/6", "1/8"],
          marks: 2,
          answer: "3/4",
          markingGuide: "2 marks for 3/4.",
        },
        {
          type: "short_answer",
          prompt: "Write 0.5 as a fraction in its simplest form.",
          marks: 2,
          answer: "1/2",
          markingGuide: "2 marks for 1/2.",
        },
      ],
    }],
    markingScheme: {notes: "Standard marking."},
  };
}

function reset() {
  genDocs = {};
  genSeq = 0;
  calls.claude.length = 0;
  calls.refund.length = 0;
  calls.meter.length = 0;
  calls.sourced.length = 0;
  refundImpl = async () => {};
  sourcedImpl = async () => ({questions: [], fromBank: 0, marks: 0, scanned: 0});
}

async function caught(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
}

(async () => {
  console.log("runAssessment — input validation");
  reset();
  const eBad = await caught(runAssessment({
    uid: "t1", rawInputs: {...INPUTS, grade: "G99"}, apiKey: "k",
  }));
  ok("invalid grade throws invalid-argument", eBad instanceof HttpsError && eBad.code === "invalid-argument");
  ok("invalid input never reaches the usage meter", calls.meter.length === 0);
  ok("invalid input writes no aiGenerations doc", Object.keys(genDocs).length === 0);

  console.log("\nrunAssessment — AI failure → failed + refund + rethrow");
  reset();
  claudeImpl = async () => {
    throw new Error("anthropic exploded");
  };
  const eFail = await caught(runAssessment({uid: "t1", rawInputs: INPUTS, apiKey: "k"}));
  ok("the original error is rethrown", eFail && eFail.message === "anthropic exploded");
  ok("the generation doc flips to failed", genDocs.gen_1 && genDocs.gen_1.status === "failed");
  ok("the failure message is persisted", String(genDocs.gen_1.errorMessage).includes("anthropic exploded"));
  ok("the quota is refunded once", calls.refund.length === 1);
  ok("refund carries uid + usage + tool", calls.refund[0].uid === "t1" &&
    calls.refund[0].tool === "assessment" && calls.refund[0].usage.period === USAGE.period);

  // The refund is best-effort: a refund failure must be swallowed (and logged)
  // so the ORIGINAL generation error is what the caller sees.
  reset();
  claudeImpl = async () => {
    throw new Error("anthropic exploded");
  };
  refundImpl = async () => {
    throw new Error("refund also exploded");
  };
  const origErr = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(" "));
  const eBoth = await caught(runAssessment({uid: "t1", rawInputs: INPUTS, apiKey: "k"}));
  console.error = origErr;
  ok("a failing refund does not mask the generation error",
      eBoth && eBoth.message === "anthropic exploded");
  ok("the failed refund is logged for tracing",
      logged.some((line) => line.includes("refund failed")));

  console.log("\nrunAssessment — invalid output → flagged, NO refund");
  reset();
  claudeImpl = async () => ({
    parsed: {header: {}, sections: []}, // no title/grade/subject/topic, no questions
    text: "{}",
    usage: {inputTokens: 10, outputTokens: 20},
    model: "claude-test",
  });
  const flagged = await runAssessment({uid: "t2", rawInputs: INPUTS, apiKey: "k"});
  ok("invalid output resolves (no throw)", Boolean(flagged && flagged.generationId));
  ok("the generation doc is flagged", genDocs.gen_1.status === "flagged");
  ok("schema errors are persisted", String(genDocs.gen_1.errorMessage).startsWith("Schema errors:"));
  ok("a review warning is returned to the studio",
      String(flagged.warning).includes("incomplete"));
  ok("NO refund on flagged (the teacher still got a paper)", calls.refund.length === 0);

  console.log("\nrunAssessment — valid output → complete");
  reset();
  claudeImpl = async () => ({
    parsed: validPaper(),
    text: JSON.stringify(validPaper()),
    usage: {inputTokens: 100, outputTokens: 500},
    model: "claude-test",
  });
  const done = await runAssessment({uid: "t3", rawInputs: INPUTS, apiKey: "k"});
  ok("returns the validated assessment", done.assessment &&
    done.assessment.header.title === "Fractions Topic Test");
  ok("the generation doc completes", genDocs.gen_1.status === "complete");
  ok("token usage + cost are persisted", genDocs.gen_1.tokensIn === 100 &&
    genDocs.gen_1.tokensOut === 500 && genDocs.gen_1.costUsdCents > 0);
  ok("sourcing summary reports a pure-AI paper", done.sourcing.fromBank === 0 &&
    done.sourcing.generated === 2 && done.sourcing.aiCalled === true);
  ok("no refund on success", calls.refund.length === 0);
  ok("marks are recomputed from the questions", done.assessment.header.totalMarks === 4);

  console.log("\nrunAssessment — Master Bank questions are merged + reported");
  reset();
  sourcedImpl = async () => ({
    questions: [
      {type: "multiple_choice", prompt: "Bank Q1", options: ["a", "b", "c", "d"],
        answer: "a", markingGuide: "1 mark", marks: 2},
      {type: "multiple_choice", prompt: "Bank Q2", options: ["e", "f", "g", "h"],
        answer: "e", markingGuide: "1 mark", marks: 2},
    ],
    fromBank: 2,
    marks: 4,
    scanned: 40,
  });
  claudeImpl = async () => ({
    parsed: validPaper(),
    text: "",
    usage: {inputTokens: 100, outputTokens: 500},
    model: "claude-test",
  });
  const mixed = await runAssessment({uid: "t4", rawInputs: INPUTS, apiKey: "k"});
  const prompts = mixed.assessment.sections
      .flatMap((s) => s.questions).map((q) => q.prompt);
  ok("bank questions land in the paper", prompts.includes("Bank Q1") && prompts.includes("Bank Q2"));
  ok("AI questions are still present", prompts.includes("What is 1/2 + 1/4?"));
  ok("sourcing summary counts the bank share", mixed.sourcing.fromBank === 2 &&
    mixed.sourcing.marks === 4 && mixed.sourcing.scanned === 40);
  ok("generated count excludes the bank questions",
      mixed.sourcing.generated === prompts.length - 2);
  ok("the bank share shrinks the AI marks budget",
      calls.sourced[0].marksBudget === 10); // 50% of the 20 requested marks
  ok("questions are renumbered globally across the merge",
      mixed.assessment.sections.flatMap((s) => s.questions)
          .every((q, i) => q.number === i + 1));

  // Opting out of smart sourcing must skip the bank entirely.
  reset();
  claudeImpl = async () => ({
    parsed: validPaper(), text: "",
    usage: {inputTokens: 1, outputTokens: 1}, model: "claude-test",
  });
  await runAssessment({uid: "t5", rawInputs: {...INPUTS, useQuestionBank: false}, apiKey: "k"});
  ok("useQuestionBank:false never queries the bank", calls.sourced.length === 0);

  // ── Free preview (§12–13): marks clamp + hard 5-question cap ─────────
  console.log("\nrunAssessment — free-preview clamps");
  reset();
  USAGE.plan = "free";
  const bigQ = (n) => ({
    type: "short_answer", prompt: `Preview Q${n}`, marks: 2,
    answer: `A${n}`, markingGuide: "2 marks.",
  });
  claudeImpl = async () => ({
    // Model overshoots the preview: 8 questions across two sections.
    parsed: {
      header: {...validPaper().header, totalMarks: 16},
      sections: [
        {title: "A", instructions: "Answer.",
          questions: [bigQ(1), bigQ(2), bigQ(3), bigQ(4), bigQ(5), bigQ(6)]},
        {title: "B", instructions: "Answer.", questions: [bigQ(7), bigQ(8)]},
      ],
    },
    text: "",
    usage: {inputTokens: 100, outputTokens: 500},
    model: "claude-test",
  });
  const freeRun = await runAssessment(
      {uid: "t6", rawInputs: {...INPUTS, useQuestionBank: false}, apiKey: "k"});
  const freeQs = freeRun.assessment.sections.flatMap((s) => s.questions);
  ok("free preview never returns more than 5 questions", freeQs.length === 5);
  ok("free preview drops emptied sections",
      freeRun.assessment.sections.length === 1);
  ok("free preview restamps header marks from kept questions",
      freeRun.assessment.header.totalMarks === 10);
  ok("free preview marker is returned to the studio",
      freeRun.preview && freeRun.preview.maxQuestions === 5 &&
      freeRun.preview.truncated === true);
  ok("paid runs carry no preview marker", mixed.preview === null);
  USAGE.plan = "max";

  Module._load = origLoad;
  console.log(`\n${passed} passed`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
