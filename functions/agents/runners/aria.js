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

// Maps the agentJobs `input.tool` value to {run, draftKey}. The draft key
// tells Aria which field on the runner's return value carries the
// teacher-facing artifact (every runner uses a different key today; we
// accept that and just look them up).
//
// The underlying teacher-tool runners are required lazily (inside each
// `run`) rather than at module load: those modules pull in the
// firebase-functions framework, which is a `functions/`-only dependency.
// Requiring them eagerly would make this module unimportable from the
// plain-node test suite (which installs root deps only). Deferring the
// require keeps `require('./aria')` import-light while production behaviour
// is unchanged — the real generator is loaded the first time a job runs.
const RUNNERS = {
  lesson_plan:    {run: (a) => require("../../teacherTools/generateLessonPlan").runLessonPlan(a),   draftKey: "lessonPlan"},
  worksheet:      {run: (a) => require("../../teacherTools/generateWorksheet").runWorksheet(a),     draftKey: "worksheet"},
  flashcards:     {run: (a) => require("../../teacherTools/generateFlashcards").runFlashcards(a),   draftKey: "flashcards"},
  rubric:         {run: (a) => require("../../teacherTools/generateRubric").runRubric(a),           draftKey: "rubric"},
  scheme_of_work: {run: (a) => require("../../teacherTools/generateSchemeOfWork").runSchemeOfWork(a), draftKey: "schemeOfWork"},
  notes:          {run: (a) => require("../../teacherTools/generateNotes").runNotes(a),             draftKey: "notes"},
};

// Lazy default for the API-key resolver — same reasoning as RUNNERS:
// aiService requires firebase-functions, so we only pull it in at call
// time (and never in tests, which inject their own getApiKey).
function defaultGetApiKey(secret) {
  return require("../../aiService").getAnthropicApiKey(secret);
}

const {agentJobIdempotencyKey} = require("../../aiOperationsCore");

const SUPPORTED_TOOLS = new Set(Object.keys(RUNNERS));

/**
 * @param {object} args
 * @param {string} args.jobId - The agentJobs DOCUMENT ID, passed separately by
 *   the dispatcher, which owns the authoritative path. It is deliberately not
 *   read from `job.id`: that is mutable document data, and the idempotency key
 *   derived from it must be as durable as the document itself.
 * @param {object} args.job - The agentJobs document data.
 * @param {object} args.anthropicApiKeySecret - Firebase secret param.
 * @param {object} [args.runners] - Tool→runner map. Defaults to RUNNERS;
 *   injected by the unit test so the routing/draft-mapping logic runs
 *   without calling the real teacher-tool generators.
 * @param {Function} [args.getApiKey] - Resolves the Anthropic key from the
 *   secret. Injected by the unit test.
 * @returns {Promise<object>} { generationId, draft, modelUsed }
 */
async function runAria({
  jobId,
  job,
  anthropicApiKeySecret,
  runners = RUNNERS,
  getApiKey = defaultGetApiKey,
}) {
  const input = job.input || {};
  const tool = String(input.tool || "").toLowerCase();
  const runner = runners[tool];
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

  const apiKey = getApiKey(anthropicApiKeySecret);

  // One agentJobs document is one logical Aria generation, so the key is
  // derived from the job rather than minted per attempt. Without this the
  // generators that now REQUIRE a key would refuse every Aria run — and a
  // freshly minted key would be worse than none, because each retry would
  // reserve a new operation and pay for a second provider call.
  const idempotencyKey = agentJobIdempotencyKey(jobId, "aria");
  const result = await runner.run({uid, rawInputs: input, apiKey, idempotencyKey});

  return {
    generationId: result.generationId,
    draft: result[runner.draftKey] || null,
    warning: result.warning || null,
    kbGrounded: Boolean(result.kbGrounded),
    ranAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

module.exports = {runAria, SUPPORTED_TOOLS};
