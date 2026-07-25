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
// Controls the stubbed classifySubjectForGrade (combination validation).
let classifyResult = "unknown";

const firestoreFn = () => ({
  collection: (name) => {
    // assessmentBands is READ (never written) to resolve the band governing the
    // paper's level. An empty collection is the realistic pre-seed state, and
    // exercises the fallback to the published defaults.
    if (name === "assessmentBands") {
      return {get: async () => ({forEach: () => {}})};
    }
    assert.strictEqual(name, "aiGenerations", "only aiGenerations is written");
    return {
      doc: (suppliedId) => {
        const id = suppliedId || `gen_${++genSeq}`;
        return {
          id,
          set: async (data) => {
            genDocs[id] = {...data};
          },
          update: async (data) => {
            genDocs[id] = {...(genDocs[id] || {}), ...data};
          },
          get: async () => ({
            exists: id in genDocs,
            data: () => genDocs[id],
          }),
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

const calls = {claude: [], refund: [], meter: [], sourced: [], reserve: [], complete: [], fail: []};
let claudeImpl = async () => {
  throw new Error("claudeImpl not set");
};
let refundImpl = async () => {};
let sourcedImpl = async () => ({questions: [], fromBank: 0, marks: 0, scanned: 0});

// ── Fake aiOperations service (in-memory, keyed by idempotencyKey) ─────────
// A deliberately simplified stand-in for functions/aiOperations.js — real
// reservation-transaction semantics (concurrency, fingerprint mismatch,
// retry backoff) are covered by aiOperations.test.js. This fake only needs
// to prove that generateAssessment.js WIRES the service correctly: reserve
// before the provider call, resume a completed key without re-calling
// Claude, refuse a terminally-failed key, and settle on success/flagged.
let opStore = new Map();
const reserveImpl = async ({uid, idempotencyKey, operationType, fingerprintInput}) => {
  calls.reserve.push({uid, idempotencyKey, operationType, fingerprintInput});
  const existing = opStore.get(idempotencyKey);
  if (!existing) {
    const record = {userId: uid, status: "processing", resultDocumentId: null, errorMessage: null, errorCode: null};
    opStore.set(idempotencyKey, record);
    return {status: "created", operation: record};
  }
  if (existing.status === "completed") return {status: "completed", operation: existing};
  if (existing.status === "failed") return {status: "failed", operation: existing};
  return {status: "processing", operation: existing};
};
const completeImpl = async ({idempotencyKey, resultDocumentId, usageCharged}) => {
  calls.complete.push({idempotencyKey, resultDocumentId, usageCharged});
  const rec = opStore.get(idempotencyKey);
  if (rec) {
    rec.status = "completed";
    rec.resultDocumentId = resultDocumentId;
  }
};
const failImpl = async ({idempotencyKey, err, usageCharged}) => {
  calls.fail.push({idempotencyKey, err, usageCharged});
  const rec = opStore.get(idempotencyKey);
  if (rec) {
    rec.status = "failed";
    rec.errorMessage = String((err && err.message) || err);
    rec.errorCode = "PROVIDER_ERROR";
  }
};
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
      // Controllable per assertion via `classifyResult`; defaults to the
      // fail-open "unknown" so the existing valid-input runs are untouched.
      classifySubjectForGrade: () => classifyResult,
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
  if (request === "../aiOperations") {
    return {
      reserveAiOperation: (args) => reserveImpl(args),
      completeAiOperation: (args) => completeImpl(args),
      failAiOperation: (args) => failImpl(args),
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

// Every test call site shares one fixed, valid idempotency key — reset()
// clears the fake operation store between tests, and each test's own
// aiGenerations doc id is deterministically THIS key (generateAssessment.js
// now uses `.doc(idempotencyKey)` — see the "deterministic result ids"
// comment in generateAssessment.js).
const IDK = "11111111-1111-4111-8111-111111111111";

function reset() {
  genDocs = {};
  genSeq = 0;
  calls.claude.length = 0;
  calls.refund.length = 0;
  calls.meter.length = 0;
  calls.sourced.length = 0;
  calls.reserve.length = 0;
  calls.complete.length = 0;
  calls.fail.length = 0;
  opStore = new Map();
  refundImpl = async () => {};
  sourcedImpl = async () => ({questions: [], fromBank: 0, marks: 0, scanned: 0});
  classifyResult = "unknown";
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
    uid: "t1", rawInputs: {...INPUTS, grade: "G99"}, apiKey: "k", idempotencyKey: IDK,
  }));
  ok("invalid grade throws invalid-argument", eBad instanceof HttpsError && eBad.code === "invalid-argument");
  ok("invalid input never reaches the usage meter", calls.meter.length === 0);
  ok("invalid input never reaches the idempotency reservation", calls.reserve.length === 0);
  ok("invalid input writes no aiGenerations doc", Object.keys(genDocs).length === 0);

  // Defensive validation (the fix for the "Examination silently generates as
  // Mock Examination" bug): an unrecognised assessmentType must be REJECTED,
  // never silently coerced to a different type.
  reset();
  const eBadType = await caught(runAssessment({
    uid: "t1", rawInputs: {...INPUTS, assessmentType: "not_a_real_type"}, apiKey: "k", idempotencyKey: IDK,
  }));
  ok("unsupported assessmentType throws invalid-argument",
    eBadType instanceof HttpsError && eBadType.code === "invalid-argument");
  ok("the rejection names the bad value", String(eBadType.message).includes("not_a_real_type"));
  ok("an unsupported assessmentType never reaches the usage meter", calls.meter.length === 0);

  // Regression: every examination-category type must reach the saved
  // aiGenerations doc UNCHANGED — none of them collapse to 'mock_exam'.
  for (const type of ["mock_exam", "examination", "final_exam"]) {
    reset();
    claudeImpl = async () => validPaper();
    await runAssessment({uid: "t1", rawInputs: {...INPUTS, assessmentType: type}, apiKey: "k", idempotencyKey: IDK});
    ok(`assessmentType "${type}" is persisted unchanged`,
      genDocs[IDK] && genDocs[IDK].inputs.assessmentType === type);
  }

  console.log("\nrunAssessment — AI failure → failed + refund + rethrow");
  reset();
  claudeImpl = async () => {
    throw new Error("anthropic exploded");
  };
  const eFail = await caught(runAssessment({uid: "t1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK}));
  ok("the original error is rethrown", eFail && eFail.message === "anthropic exploded");
  ok("the generation doc flips to failed", genDocs[IDK] && genDocs[IDK].status === "failed");
  ok("the failure message is persisted", String(genDocs[IDK].errorMessage).includes("anthropic exploded"));
  ok("the quota is refunded once", calls.refund.length === 1);
  ok("refund carries uid + usage + tool", calls.refund[0].uid === "t1" &&
    calls.refund[0].tool === "assessment" && calls.refund[0].usage.period === USAGE.period);
  ok("the operation record is marked failed", calls.fail.length === 1 && calls.fail[0].idempotencyKey === IDK);

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
  const eBoth = await caught(runAssessment({uid: "t1", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK}));
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
  const flagged = await runAssessment({uid: "t2", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
  ok("invalid output resolves (no throw)", Boolean(flagged && flagged.generationId));
  ok("the generation doc is flagged", genDocs[IDK].status === "flagged");
  ok("schema errors are persisted", String(genDocs[IDK].errorMessage).startsWith("Schema errors:"));
  ok("a review warning is returned to the studio",
      String(flagged.warning).includes("incomplete"));
  ok("NO refund on flagged (the teacher still got a paper)", calls.refund.length === 0);
  ok("a flagged paper still completes the operation record (billed once, not retried)",
      calls.complete.length === 1 && calls.complete[0].idempotencyKey === IDK);

  console.log("\nrunAssessment — valid output → complete");
  reset();
  claudeImpl = async () => ({
    parsed: validPaper(),
    text: JSON.stringify(validPaper()),
    usage: {inputTokens: 100, outputTokens: 500},
    model: "claude-test",
  });
  const done = await runAssessment({uid: "t3", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
  ok("returns the validated assessment", done.assessment &&
    done.assessment.header.title === "Fractions Topic Test");
  ok("the generation doc completes", genDocs[IDK].status === "complete");
  ok("token usage + cost are persisted", genDocs[IDK].tokensIn === 100 &&
    genDocs[IDK].tokensOut === 500 && genDocs[IDK].costUsdCents > 0);
  ok("sourcing summary reports a pure-AI paper", done.sourcing.fromBank === 0 &&
    done.sourcing.generated === 2 && done.sourcing.aiCalled === true);
  ok("no refund on success", calls.refund.length === 0);
  ok("marks are recomputed from the questions", done.assessment.header.totalMarks === 4);
  ok("the operation is reserved exactly once", calls.reserve.length === 1);
  ok("the operation completes with the aiGenerations doc id + one usage charge",
      calls.complete.length === 1 && calls.complete[0].resultDocumentId === IDK &&
      calls.complete[0].usageCharged === 1);
  // Validation framework wiring (Prompt 14 §31/§35): a clean paper records a
  // "validated" acceptance status and a version-provenance quadruple.
  ok("a clean paper is marked acceptanceStatus 'validated'",
      genDocs[IDK].acceptanceStatus === "validated");
  ok("provenance stamps the prompt/schema/validator quadruple",
      genDocs[IDK].provenance && genDocs[IDK].provenance.promptVersion &&
      genDocs[IDK].provenance.schemaVersion && genDocs[IDK].provenance.validatorVersion);
  ok("no curriculum issues on a matching paper",
      Array.isArray(genDocs[IDK].curriculumIssues) && genDocs[IDK].curriculumIssues.length === 0);

  // Curriculum guard (§7–9): a valid-SHAPE paper that echoes the WRONG grade is
  // flagged for review, never saved as a clean "complete" — defence in depth
  // against a response that contradicts the teacher's selected context.
  console.log("\nrunAssessment — wrong-curriculum response → flagged by the guard");
  reset();
  claudeImpl = async () => {
    const wrong = validPaper();
    wrong.header.grade = "G3"; // teacher asked for G7
    return {parsed: wrong, text: "{}", usage: {inputTokens: 10, outputTokens: 20}, model: "claude-test"};
  };
  const guarded = await runAssessment({uid: "t9", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
  ok("wrong-grade response resolves (no throw)", Boolean(guarded && guarded.generationId));
  ok("wrong-grade response is flagged, not completed", genDocs[IDK].status === "flagged");
  ok("the flag names the curriculum mismatch",
      String(genDocs[IDK].errorMessage).includes("Curriculum mismatch"));
  ok("acceptanceStatus is 'rejected' for a curriculum mismatch (non-repairable)",
      genDocs[IDK].acceptanceStatus === "rejected");
  ok("the curriculum issue is recorded with a GRADE_MISMATCH code",
      genDocs[IDK].curriculumIssues.some((i) => i.code === "GRADE_MISMATCH"));
  ok("a guard-flagged paper still bills once, never refunds", calls.refund.length === 0 && calls.complete.length === 1);

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
  const mixed = await runAssessment({uid: "t4", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
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
  await runAssessment({uid: "t5", rawInputs: {...INPUTS, useQuestionBank: false}, apiKey: "k", idempotencyKey: IDK});
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
      {uid: "t6", rawInputs: {...INPUTS, useQuestionBank: false}, apiKey: "k", idempotencyKey: IDK});
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

  // ── Idempotency wiring (request-locking / duplicate-billing initiative) ──
  console.log("\nrunAssessment — idempotency: resume, block-duplicate, refuse-retry");

  // A second call with the SAME idempotencyKey after the first has already
  // completed must resume the existing result WITHOUT calling Claude again
  // or charging usage again.
  reset();
  claudeImpl = async () => ({
    parsed: validPaper(), text: "", usage: {inputTokens: 10, outputTokens: 10}, model: "claude-test",
  });
  const first = await runAssessment({uid: "t7", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
  ok("first call reaches the provider", calls.claude.length === 1);
  ok("first call charges usage once", calls.meter.length === 1);
  const resumed = await runAssessment({uid: "t7", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK});
  ok("a duplicate call with a completed key does NOT call the provider again", calls.claude.length === 1);
  ok("a duplicate call with a completed key does NOT charge usage again", calls.meter.length === 1);
  ok("a duplicate call does NOT write a second aiGenerations doc",
      Object.keys(genDocs).length === 1);
  ok("the resumed response is marked resumed", resumed.resumed === true);
  ok("the resumed response returns the SAME assessment", resumed.assessment &&
      resumed.assessment.header.title === first.assessment.header.title);
  ok("the resumed response carries the same generationId", resumed.generationId === first.generationId);

  // Two calls with the same key fired without waiting for the first to
  // settle: the second must see "processing" and must not call the provider
  // a second time (real cross-request/cross-tab concurrency is covered by
  // aiOperations.test.js's transaction test — this proves generateAssessment
  // ACTS on that "processing" status correctly rather than plowing ahead).
  reset();
  claudeImpl = async () => ({
    parsed: validPaper(), text: "", usage: {inputTokens: 10, outputTokens: 10}, model: "claude-test",
  });
  const [raceA, raceB] = await Promise.all([
    runAssessment({uid: "t8", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK}),
    runAssessment({uid: "t8", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK}),
  ]);
  ok("only one of the two racing calls reaches the provider", calls.claude.length === 1);
  ok("only one of the two racing calls charges usage", calls.meter.length === 1);
  const raceOutcomes = [raceA, raceB].map((r) => (r.status === "processing" ? "processing" : "assessment"));
  ok("one racer gets the assessment, the other gets a processing status",
      raceOutcomes.sort().join(",") === "assessment,processing");

  // A key that already failed terminally must not be retried automatically.
  reset();
  claudeImpl = async () => {
    throw new Error("anthropic exploded");
  };
  await caught(runAssessment({uid: "t9", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK}));
  ok("the first attempt reached the provider", calls.claude.length === 1);
  const eRetry = await caught(runAssessment({uid: "t9", rawInputs: INPUTS, apiKey: "k", idempotencyKey: IDK}));
  ok("a duplicate call after a terminal failure is rejected, not retried",
      eRetry instanceof HttpsError && eRetry.code === "failed-precondition");
  ok("the provider is NOT called again for an already-failed key", calls.claude.length === 1);

  // ── Combination validation: curriculum + level + subject ─────────────
  console.log("\nvalidateInputs — curriculum/level/subject combination");
  reset();
  const {validateInputs, gradeLabelFor, subjectLabelFor} =
    require("./generateAssessment");
  // Fail-open: an unverified pair (classify → 'unknown') passes through so
  // valid teaching combos without a digitised syllabus are never blocked.
  classifyResult = "unknown";
  ok("unknown combination is allowed (fail-open)",
      validateInputs({grade: "G5", subject: "integrated_science", topic: "x",
        framework: "2023"}).length === 0);
  // A definitively-invalid CBC pair is rejected with the exact guidance.
  classifyResult = "not_in_grade";
  const comboErrs = validateInputs({grade: "G10", subject: "integrated_science",
    topic: "x", framework: "2023"});
  ok("invalid CBC combination is rejected", comboErrs.some((e) =>
    e.includes("is not available for") &&
    e.includes("valid curriculum, level and subject combination")));
  ok("rejection names the subject + level (Form, not Grade)",
      comboErrs.some((e) =>
        e.startsWith("Integrated Science is not available for Form 3")));
  // The 2013 framework has no authoritative CBC map — never blocked on combo.
  ok("previous-curriculum combos are not blocked by the CBC check",
      validateInputs({grade: "G10", subject: "integrated_science", topic: "x",
        framework: "2013"}).length === 0);
  // Label helpers: a Form is never relabelled a Grade.
  ok("gradeLabelFor keeps forms as forms",
      gradeLabelFor("G8") === "Form 1" && gradeLabelFor("G4") === "Grade 4");
  // The two ECE age bands are Nursery and Reception (the ladder in
  // src/config/educationLevels.js). Retired spellings still label as Nursery so
  // an old record reads sensibly rather than showing a raw code.
  ok("gradeLabelFor maps ECE bands",
      gradeLabelFor("ECE_N") === "Nursery" &&
      gradeLabelFor("ECE_R") === "Reception" &&
      gradeLabelFor("ECE_B") === "Nursery" &&
      gradeLabelFor("ECE") === "Nursery");
  ok("subjectLabelFor humanises keys",
      subjectLabelFor("integrated_science") === "Integrated Science");
  classifyResult = "unknown";

  // ── Assessment bands (Phase 2) ─────────────────────────────────────────
  // The band governing the paper's level must reach the model, and must be a
  // CEILING the client cannot lift: the picker already filters its chips, but
  // a stale or hostile client asking Baby Class for an essay must not get one.
  reset();
  claudeImpl = async () => validPaper();
  await runAssessment({
    uid: "t1",
    rawInputs: {...INPUTS, grade: "ECE_N", subject: "numeracy", questionTypes: ["essay", "counting"]},
    apiKey: "k",
    idempotencyKey: IDK,
  });
  const ecePrompt = calls.claude[0].opts.messages[0].content;
  ok("the band's rules reach the prompt",
      ecePrompt.includes("BAND RULES") && ecePrompt.includes("Nursery"));
  ok("Early Childhood is told the learner cannot be assumed to read",
      ecePrompt.includes("CANNOT be assumed to read"));
  ok("a type the band forbids is dropped before the model sees it",
      !/ALLOWED QUESTION TYPES[^\n]*essay/.test(ecePrompt));
  // "counting" is a TASK; structurally it is a short-answer question. The
  // directive names the task, the schema line names the structure — the model
  // needs both to write a counting item rather than a sentence to read.
  ok("a task the band permits is named in its own words",
      /PERMITTED TASKS[^\n]*counting/.test(ecePrompt));
  ok("the task is structured as something the schema can validate",
      /ALLOWED QUESTION TYPES[^\n]*short answer/.test(ecePrompt));
  ok("no early-years task leaks out as a raw schema type",
      !/"type"\s*:\s*"counting"/.test(ecePrompt));

  // A senior paper gets its own band, not the early-years one.
  reset();
  claudeImpl = async () => validPaper();
  await runAssessment({
    uid: "t1",
    rawInputs: {...INPUTS, grade: "G11", subject: "mathematics", questionTypes: ["essay"]},
    apiKey: "k",
    idempotencyKey: IDK,
  });
  const seniorPrompt = calls.claude[0].opts.messages[0].content;
  ok("Forms 3-5 get the examination register",
      seniorPrompt.includes("BAND RULES") && seniorPrompt.includes("Form 4"));
  ok("essay survives where the band permits it",
      /ALLOWED QUESTION TYPES[^\n]*essay/.test(seniorPrompt));
  ok("the early-years reading rule is NOT applied to a senior paper",
      !seniorPrompt.includes("CANNOT be assumed to read"));

  // A Master Bank question whose activity the band forbids must be REJECTED,
  // not adapted. The bank is shared across grades, so a stored essay could
  // otherwise reach a Nursery paper by the back door.
  {
    const {bandPermitsActivity, ASSESSMENT_BAND_SEED} = require("./assessmentBands");
    const ece = ASSESSMENT_BAND_SEED.early_childhood;
    ok("a bank essay is refused for Early Childhood",
        bandPermitsActivity(ece, "essay") === false);
    ok("a bank question tagged with its activity is refused when forbidden",
        bandPermitsActivity(ece, "extended_response") === false);
    ok("a bank question the band permits is kept",
        bandPermitsActivity(ece, "picture_matching") === true);
    // A stored question carrying only its render type is permitted when some
    // allowed activity is carried by that structure — that is what a plain
    // multiple-choice question is.
    ok("a plain multiple_choice question is permitted via its structure",
        bandPermitsActivity(ece, "multiple_choice") === true);
    ok("no band means no opinion", bandPermitsActivity(null, "essay") === true);
  }

  // The activity identity must survive onto the SAVED paper: a mapped activity
  // must not become indistinguishable from the structure that carries it.
  reset();
  claudeImpl = async () => {
    const paper = validPaper();
    // "Circle the correct picture" really IS a multiple-choice question — the
    // structure is faithful, but which activity the teacher asked for is not
    // recoverable from the structure alone.
    paper.sections[0].questions[0].activityType = "circling";
    return {parsed: paper};
  };
  await runAssessment({
    uid: "t1",
    rawInputs: {...INPUTS, grade: "ECE_N", subject: "numeracy"},
    apiKey: "k",
    idempotencyKey: IDK,
  });
  {
    const q = genDocs[IDK].output.sections[0].questions[0];
    ok("the saved question keeps its activity identity", q.activityType === "circling");
    ok("…while still being multiple_choice for the renderers",
        q.type === "multiple_choice");
  }

  // The schema itself is what guarantees this, including for the activities with
  // no faithful layout yet.
  {
    const {validateAssessment} = require("./assessmentSchema");
    const paper = validPaper();
    paper.sections[0].questions[0].activityType = "tracing";
    paper.sections[0].questions[1].activityType = "not_a_real_activity";
    const res = validateAssessment(paper);
    const qs = res.value.sections[0].questions;
    ok("a limited-support activity is preserved verbatim",
        qs[0].activityType === "tracing");
    ok("an unrecognised activity falls back to the render type, never dropping the question",
        qs[1].activityType === "short_answer");
  }

  Module._load = origLoad;
  console.log(`\n${passed} passed`);
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
