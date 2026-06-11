/**
 * Node test for the pure parts of the format-profile extraction flow.
 * Run: node functions/teacherTools/assessmentFormatExtractHelpers.test.js
 */

const assert = require("node:assert");
const {
  SAMPLE_PATH_PREFIX,
  sanitiseSamplePath,
  kindFromPath,
  sourceForSamplePath,
  FORMAT_PROFILE_TOOL_SCHEMA,
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
  buildDraftFromExtraction,
} = require("./assessmentFormatExtractHelpers");
const {buildFormatId} = require("./assessmentFormats");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentFormatExtractHelpers");

// ── Storage path sanitiser ────────────────────────────────────────────────
{
  const good = `${SAMPLE_PATH_PREFIX}uid123/1718000000-mock.pdf`;
  assert.strictEqual(sanitiseSamplePath(good), good);
  assert.strictEqual(
    sanitiseSamplePath(`${SAMPLE_PATH_PREFIX}uid123/test.docx`),
    `${SAMPLE_PATH_PREFIX}uid123/test.docx`);
  ok("accepts .pdf and .docx under the sample prefix", true);

  const bad = [
    "curriculum-uploads/uid/x.pdf",          // wrong prefix
    `${SAMPLE_PATH_PREFIX}uid/../secret.pdf`, // traversal
    `${SAMPLE_PATH_PREFIX}uid/x.xlsx`,        // unsupported extension
    `${SAMPLE_PATH_PREFIX}uid/x.doc`,         // legacy .doc rejected
    `${SAMPLE_PATH_PREFIX}uid/x`,             // no extension
    "", null, undefined,
  ];
  for (const p of bad) {
    assert.strictEqual(sanitiseSamplePath(p), null,
      `should reject ${JSON.stringify(p)}`);
  }
  ok("rejects wrong prefix, traversal, and unsupported extensions", true);
}

// ── Kind detection + source descriptors ──────────────────────────────────
{
  assert.strictEqual(kindFromPath("a/b.pdf"), "pdf");
  assert.strictEqual(kindFromPath("a/b.docx"), "docx");
  assert.strictEqual(kindFromPath("a/b.txt"), null);
  ok("kindFromPath maps extensions", true);

  const pdf = sourceForSamplePath(`${SAMPLE_PATH_PREFIX}u/p.pdf`);
  assert.strictEqual(pdf.kind, "pdf");
  const docx = sourceForSamplePath(`${SAMPLE_PATH_PREFIX}u/p.docx`);
  assert.strictEqual(docx.kind, "docx");
  assert.ok(docx.mime.includes("wordprocessingml"),
    "docx source carries the mime buildMessageBlocks branches on");
  ok("sourceForSamplePath builds pastPaperImport-compatible sources", true);
}

// ── Prompts carry the copyright guardrails ────────────────────────────────
{
  ok("system prompt forbids transcription",
    EXTRACT_SYSTEM_PROMPT.includes("NEVER transcribe") &&
    EXTRACT_SYSTEM_PROMPT.includes("FRESH PARAPHRASES"));
  const up = buildExtractUserPrompt({
    assessmentType: "mock_exam",
    gradeBand: "upper_primary",
    subject: "_generic",
  });
  ok("user prompt names the admin's classification",
    up.includes("mock_exam") && up.includes("upper_primary") &&
    up.includes("generic"));
  ok("tool schema requires the format fields",
    FORMAT_PROFILE_TOOL_SCHEMA.required.includes("paperStructure") &&
    FORMAT_PROFILE_TOOL_SCHEMA.required.includes("numberingStyle"));
}

// ── Draft building ────────────────────────────────────────────────────────
function goodExtraction() {
  return {
    label: "Grade 7 Mock — extracted format",
    paperStructure: [
      {
        name: "SECTION A", heading: "SECTION A: MULTIPLE CHOICE",
        instructions: "Answer ALL questions.",
        questionTypes: ["multiple_choice"], questionCountHint: "20",
        marksShare: 70, marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B", heading: "SECTION B: WRITTEN QUESTIONS",
        instructions: "Show your working.",
        questionTypes: ["short_answer", "calculation"],
        questionCountHint: "5", marksShare: 30,
        marksPerQuestionHint: "2-4 marks each",
      },
    ],
    coverInstructions: ["Answer ALL questions.", "Write neatly."],
    numberingStyle: "Continuous numbering, marks in brackets.",
    phrasingNotes: ["Short stems."],
    marksConventions: ["1 mark per item in Section A."],
    diagramConventions: [],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "The capital of Zambia is …  A Kitwe  B Livingstone  C Lusaka  D Ndola", note: "fresh paraphrase"},
      {type: "calculation", marks: 2, prompt: "Work out 125 + 348.", note: "fresh paraphrase"},
    ],
  };
}

{
  const meta = {
    assessmentType: "mock_exam",
    gradeBand: "upper_primary",
    subject: "mathematics",
    sourceKind: "docx",
    sourceNote: "G7 Mock 2024",
  };
  const built = buildDraftFromExtraction({extracted: goodExtraction(), ...meta});
  assert.ok(!built.error, `unexpected error: ${built.error}`);
  ok("clean extraction yields no validation errors",
    built.validationErrors.length === 0);
  ok("draft id derives from the ADMIN classification",
    built.draft.id === buildFormatId(meta));
  ok("draft stays a draft with docx origin",
    built.draft.status === "draft" && built.draft.origin === "docx_extract");

  // The model can't override the admin's classification.
  const sneaky = {
    ...goodExtraction(),
    assessmentType: "exercise", gradeBand: "lower_primary", subject: "english",
  };
  const built2 = buildDraftFromExtraction({extracted: sneaky, ...meta});
  assert.strictEqual(built2.draft.assessmentType, "mock_exam");
  assert.strictEqual(built2.draft.gradeBand, "upper_primary");
  assert.strictEqual(built2.draft.subject, "mathematics");
  ok("admin classification overrides anything the model returned", true);

  // Broken extraction still produces a fixable draft, with errors listed.
  const broken = {...goodExtraction(), paperStructure: [], exemplarQuestions: []};
  const built3 = buildDraftFromExtraction({extracted: broken, ...meta});
  assert.ok(!built3.error);
  ok("broken extraction surfaces validation errors instead of throwing",
    built3.validationErrors.length > 0 &&
    built3.draft.validationErrors.length > 0);

  // Bad admin metadata is a hard error.
  const badMeta = buildDraftFromExtraction({
    extracted: goodExtraction(),
    assessmentType: "quiz", gradeBand: "upper_primary", subject: "x",
    sourceKind: "pdf", sourceNote: "",
  });
  ok("invalid assessmentType is rejected outright", Boolean(badMeta.error));
}

console.log(`assessmentFormatExtractHelpers: ${passed} checks passed`);
