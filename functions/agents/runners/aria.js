/**
 * Aria — Content Author runner.
 *
 * Wraps the existing teacher-tool runners (currently lesson_plan, worksheet)
 * so an admin or scheduled job can enqueue a brief in `agentJobs` and have
 * the existing pipeline produce a private `aiGenerations` doc. The
 * `aiGenerations` doc is created with `visibility: 'private'` by the
 * underlying runner; Pubo flips it to `public` after admin approval.
 *
 * For other tools (flashcards/rubric/scheme/notes) Aria currently throws —
 * those generators only export an HTTPS callable factory, not a `run*`
 * helper, so they need a small refactor before the dispatcher can drive
 * them. Tracked in docs/AGENTS.md.
 */

const admin = require("firebase-admin");
const {runLessonPlan} = require("../../teacherTools/generateLessonPlan");
const {runWorksheet} = require("../../teacherTools/generateWorksheet");
const {getAnthropicApiKey} = require("../../aiService");

const SUPPORTED_TOOLS = new Set(["lesson_plan", "worksheet"]);

/**
 * @param {object} args
 * @param {object} args.job - The agentJobs document data (with id).
 * @param {object} args.anthropicApiKeySecret - Firebase secret param.
 * @returns {Promise<object>} { generationId, draft, modelUsed }
 */
async function runAria({job, anthropicApiKeySecret}) {
  const input = job.input || {};
  const tool = String(input.tool || "").toLowerCase();
  if (!SUPPORTED_TOOLS.has(tool)) {
    throw new Error(
      `Aria does not yet drive the "${tool || "<missing>"}" generator. ` +
      `Phase 2 supports: ${[...SUPPORTED_TOOLS].join(", ")}.`,
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

  let result;
  if (tool === "lesson_plan") {
    result = await runLessonPlan({uid, rawInputs: input, apiKey});
  } else {
    result = await runWorksheet({uid, rawInputs: input, apiKey});
  }

  // Both runners return { generationId, lessonPlan|worksheet, usage, ... }.
  const draft = result.lessonPlan || result.worksheet || null;
  return {
    generationId: result.generationId,
    draft,
    warning: result.warning || null,
    kbGrounded: Boolean(result.kbGrounded),
    ranAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

module.exports = {runAria, SUPPORTED_TOOLS};
