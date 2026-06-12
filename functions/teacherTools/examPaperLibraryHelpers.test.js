/**
 * Node test for the pure parts of the Exam Paper Library flow.
 * Run: node functions/teacherTools/examPaperLibraryHelpers.test.js
 */

const assert = require("node:assert");
const {
  normalizeSampleMeta,
  normalizeSubjectKey,
  normalizeYear,
  ANALYSIS_TOOL_SCHEMA,
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  normalizeAnalysis,
  SYNTHESIS_TOOL_SCHEMA,
  SYNTHESIS_SYSTEM_PROMPT,
  summarizeSampleForSynthesis,
  buildSynthesisUserPrompt,
  buildSynthesisDraft,
} = require("./examPaperLibraryHelpers");
const {
  validateFormatProfile, buildFormatId, renderFormatContextBlock,
} = require("./assessmentFormats");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("examPaperLibraryHelpers");

// ── Metadata normalisation ────────────────────────────────────────────────
{
  const r = normalizeSampleMeta({
    grade: "g1", subject: "Mathematics", assessmentType: "end_of_term",
    title: "  EOT 2  ", year: "2024", region: "Lusaka",
  });
  assert.ok(!r.error, "valid meta has no error");
  assert.strictEqual(r.meta.grade, "G1");
  assert.strictEqual(r.meta.gradeBand, "lower_primary");
  assert.strictEqual(r.meta.subject, "mathematics");
  assert.strictEqual(r.meta.year, 2024);
  assert.strictEqual(r.meta.title, "EOT 2");
  ok("normalizeSampleMeta keeps precise grade + derives band", true);

  // ECE maps to lower_primary; Baby/Middle/Reception all upload as ECE.
  assert.strictEqual(
    normalizeSampleMeta({grade: "ECE", subject: "_generic", assessmentType: "topic_test"}).meta.gradeBand,
    "lower_primary");
  ok("ECE (Baby/Middle Class) resolves to lower_primary", true);

  assert.ok(normalizeSampleMeta({grade: "G5", subject: "x", assessmentType: "nope"}).error,
    "bad type rejected");
  assert.ok(normalizeSampleMeta({grade: "G99", subject: "x", assessmentType: "exercise"}).error,
    "bad grade rejected");
  ok("invalid type or grade is rejected", true);

  assert.strictEqual(normalizeSubjectKey("Integrated Science"), "integrated_science");
  assert.strictEqual(normalizeSubjectKey(""), "_generic");
  assert.strictEqual(normalizeYear("2024"), 2024);
  assert.strictEqual(normalizeYear("nope"), null);
  assert.strictEqual(normalizeYear(1850), null);
  ok("subject + year helpers normalise as expected", true);
}

// ── Prompts + schema sanity ───────────────────────────────────────────────
{
  assert.ok(ANALYSIS_TOOL_SCHEMA.required.includes("paperStructure"));
  assert.ok(ANALYSIS_TOOL_SCHEMA.properties.pictureUsage);
  assert.ok(ANALYSIS_TOOL_SCHEMA.properties.answerSpaceConventions);
  assert.ok(/COPYRIGHT/.test(ANALYSIS_SYSTEM_PROMPT));
  assert.ok(/never|NEVER/.test(ANALYSIS_SYSTEM_PROMPT));
  ok("analysis schema covers pictures + answer spaces; prompt forbids copying", true);

  const up = buildAnalysisUserPrompt({
    grade: "G3", gradeBand: "lower_primary", subject: "mathematics",
    assessmentType: "mid_term", title: "T", year: 2023, region: "Copperbelt",
  });
  assert.ok(up.includes("G3") && up.includes("mid_term") && up.includes("2023"));
  ok("analysis user prompt carries the classification", true);

  assert.ok(SYNTHESIS_TOOL_SCHEMA.properties.gradeNotes);
  assert.ok(/sum to exactly 100/.test(SYNTHESIS_SYSTEM_PROMPT));
  ok("synthesis schema has gradeNotes; prompt enforces marks=100", true);
}

// ── Analysis normalisation ────────────────────────────────────────────────
{
  const {analysis, warnings} = normalizeAnalysis({
    summary: "A picture-led lower-primary maths paper.",
    paperStructure: [
      {name: "A", heading: "SECTION A", questionTypes: ["multiple_choice"], marksShare: 60},
      {name: "B", heading: "SECTION B", questionTypes: ["short_answer"], marksShare: 40},
      {bogus: true}, // dropped (no name/heading)
    ],
    pictureUsage: ["Each item shows a picture of objects to count.", "  "],
    answerSpaceConventions: ["Boxes under each item for the numeral."],
    commandWords: ["Count", "Match", "Draw"],
    gradeLevelNotes: "Heavier picture reliance than Grade 4.",
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "How many balls are shown?"},
      {prompt: ""}, // dropped (no prompt)
    ],
    observedTotalMarks: "40",
  });
  assert.strictEqual(analysis.paperStructure.length, 2);
  assert.strictEqual(analysis.pictureUsage.length, 1);
  assert.strictEqual(analysis.exemplarQuestions.length, 1);
  assert.strictEqual(analysis.observedTotalMarks, 40);
  assert.strictEqual(warnings.length, 0);
  ok("normalizeAnalysis tidies structure, drops junk, coerces numbers", true);

  const thin = normalizeAnalysis({summary: ""});
  assert.ok(thin.warnings.length >= 1, "thin analysis warns");
  ok("a paper with no detectable structure surfaces a warning", true);
}

// ── Synthesis draft → validates + renders ─────────────────────────────────
{
  const samples = [
    {
      id: "s1", grade: "G1", year: 2024, title: "EOT",
      analysis: {
        summary: "Picture-led counting paper.",
        paperStructure: [{heading: "SECTION A", marksShare: 100, questionTypes: ["multiple_choice"]}],
        numberingStyle: "Numbered 1-10.",
        pictureUsage: ["Objects to count beside each item."],
        answerSpaceConventions: ["A box for the numeral."],
        commandWords: ["Count"],
      },
    },
    {
      id: "s2", grade: "G3", year: 2023,
      analysis: {
        summary: "Short-sentence answers.",
        paperStructure: [{heading: "SECTION A", marksShare: 100, questionTypes: ["short_answer"]}],
        numberingStyle: "Numbered continuously.",
      },
    },
  ];
  const prompt = buildSynthesisUserPrompt(samples,
    {assessmentType: "end_of_term", gradeBand: "lower_primary", subject: "mathematics"});
  assert.ok(prompt.includes("2 analysed sample"));
  assert.ok(prompt.includes("Sample 1") && prompt.includes("Sample 2"));
  assert.ok(prompt.includes("Pictures:"));
  ok("synthesis prompt summarises every sample with its signals", true);

  // The model's emitted profile, carrying the new optional fields.
  const built = buildSynthesisDraft({
    extracted: {
      label: "Grade 1-3 End of Term (Maths)",
      paperStructure: [
        {name: "SECTION A", heading: "SECTION A", instructions: "Answer ALL.", questionTypes: ["multiple_choice"], marksShare: 50, questionCountHint: "10"},
        {name: "SECTION B", heading: "SECTION B", instructions: "Answer ALL.", questionTypes: ["short_answer"], marksShare: 50, questionCountHint: "5"},
      ],
      coverInstructions: ["Write your name.", "Answer ALL questions."],
      numberingStyle: "Sections A-B; questions numbered continuously; marks in [].",
      pictureUsage: ["Counting items shown beside lower-grade questions."],
      answerSpaceConventions: ["Ruled boxes under each item."],
      gradeNotes: {G1: "Picture-led, single-numeral answers.", G3: "Short sentences.", BAD: "dropped"},
      exemplarQuestions: [
        {type: "multiple_choice", marks: 1, prompt: "How many oranges are in the basket?"},
        {type: "short_answer", marks: 2, prompt: "Write the number ten in words."},
      ],
    },
    assessmentType: "end_of_term", gradeBand: "lower_primary",
    subject: "mathematics", sampleCount: 2,
  });
  assert.ok(!built.error);
  assert.strictEqual(built.candidate.id,
    buildFormatId({assessmentType: "end_of_term", gradeBand: "lower_primary", subject: "mathematics"}));
  assert.strictEqual(built.candidate.origin, "library_synthesis");

  const check = validateFormatProfile(built.candidate);
  assert.ok(check.ok, `synthesised profile validates: ${check.errors.join("; ")}`);
  assert.strictEqual(check.value.pictureUsage.length, 1);
  assert.strictEqual(check.value.answerSpaceConventions.length, 1);
  // Invalid grade key BAD is dropped; G1/G3 survive.
  assert.deepStrictEqual(Object.keys(check.value.gradeNotes).sort(), ["G1", "G3"]);
  ok("buildSynthesisDraft → validateFormatProfile keeps the new fields", true);

  // The rendered block surfaces the per-grade note for the grade asked.
  const blockG1 = renderFormatContextBlock(check.value, {grade: "G1"});
  assert.ok(blockG1.includes("Grade-specific guidance for G1"));
  assert.ok(blockG1.includes("Pictures, drawings and diagrams"));
  assert.ok(blockG1.includes("Answer spaces and layout"));
  const blockG3 = renderFormatContextBlock(check.value, {grade: "G3"});
  assert.ok(blockG3.includes("Grade-specific guidance for G3"));
  assert.ok(!blockG3.includes("Grade-specific guidance for G1"));
  // No grade → no per-grade line, but still renders.
  const blockNone = renderFormatContextBlock(check.value);
  assert.ok(!blockNone.includes("Grade-specific guidance"));
  assert.ok(blockNone.length < 6000, "rendered block stays under budget");
  ok("renderFormatContextBlock surfaces the right per-grade note", true);
}

// ── Bad synthesis grouping rejected ───────────────────────────────────────
{
  assert.ok(buildSynthesisDraft({extracted: {}, assessmentType: "nope", gradeBand: "lower_primary", subject: "x", sampleCount: 1}).error);
  assert.ok(buildSynthesisDraft({extracted: {}, assessmentType: "exercise", gradeBand: "nope", subject: "x", sampleCount: 1}).error);
  ok("synthesis rejects an invalid type or band outright", true);
}

console.log(`examPaperLibraryHelpers: ${passed} checks passed`);
