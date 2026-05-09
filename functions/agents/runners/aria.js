/**
 * Aria — Content Author runner.
 *
 * Thin router over the existing teacher-tool runners. Each underlying
 * runX wraps the same pipeline shape (sanitize inputs → CBC resolve →
 * usage metering → reserve aiGenerations → callClaude → validate →
 * finalise). The aiGenerations doc is created with
 * `visibility: 'private'` by every runner; Pubo flips it to `public`
 * after admin approval.
 */

const admin = require("firebase-admin");
const {runLessonPlan} = require("../../teacherTools/generateLessonPlan");
const {runWorksheet} = require("../../teacherTools/generateWorksheet");
const {runFlashcards} = require("../../teacherTools/generateFlashcards");
const {runRubric} = require("../../teacherTools/generateRubric");
const {runSchemeOfWork} = require("../../teacherTools/generateSchemeOfWork");
const {runNotes} = require("../../teacherTools/generateNotes");
const {getAnthropicApiKey} = require("../../aiService");

// Maps the agentJobs `input.tool` value to {runner, draftKey}. The draft
// key tells Aria which field on the runner's return value carries the
// teacher-facing artifact (every runner uses a different key today; we
// accept that and just look them up).
const RUNNERS = {
  lesson_plan:    {run: runLessonPlan,    draftKey: "lessonPlan"},
  worksheet:      {run: runWorksheet,     draftKey: "worksheet"},
  flashcards:     {run: runFlashcards,    draftKey: "flashcards"},
  rubric:         {run: runRubric,        draftKey: "rubric"},
  scheme_of_work: {run: runSchemeOfWork,  draftKey: "schemeOfWork"},
  notes:          {run: runNotes,         draftKey: "notes"},
};

const SUPPORTED_TOOLS = new Set(Object.keys(RUNNERS));

/**
 * @param {object} args
 * @param {object} args.job - The agentJobs document data (with id).
 * @param {object} args.anthropicApiKeySecret - Firebase secret param.
 * @returns {Promise<object>} { generationId, draft, modelUsed }
 */
async function runAria({job, anthropicApiKeySecret}) {
  const input = job.input || {};
  const tool = String(input.tool || "").toLowerCase();
  const runner = RUNNERS[tool];
  if (!runner) {
    throw new Error(
      `Aria does not drive the "${tool || "<missing>"}" generator. ` +
      `Supported: ${[...SUPPORTED_TOOLS].join(", ")}.`,
    );
  }

  const uid = job.createdBy;
  if (!uid || uid === "system") {
    throw new Error(
      "Aria needs a real teacher uid in agentJobs.createdBy (so usage " +
      "metering and aiGenerations ownership work).",
    );
  }

  const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
  const result = await runner.run({uid, rawInputs: input, apiKey});

  return {
    generationId: result.generationId,
    draft: result[runner.draftKey] || null,
    warning: result.warning || null,
    kbGrounded: Boolean(result.kbGrounded),
    ranAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

module.exports = {runAria, SUPPORTED_TOOLS};
