/**
 * planAssessment — HTTPS callable. Show the teacher the paper before it is written.
 *
 * §3.1: "Show the blueprint to the teacher as a readable summary in the
 * pre-generation confirmation step, and let them adjust it before generating."
 *
 * This calls no model and charges no credit — it is Firestore reads and
 * arithmetic, and it returns the SAME blueprint object `generateAssessment`
 * would build for the same request, because both go through
 * assessmentPlanning.planPaper. The teacher can adjust it (today: the difficulty
 * spread) and send it back with the generate call, where
 * `acceptClientBlueprint` re-checks it before it constrains anything.
 *
 * It also surfaces the §3.5 refusal EARLY. A grade+subject the verified
 * curriculum has nothing for used to be discovered after the teacher had filled
 * in the whole form and waited for a generation to fail; now they are told at the
 * plan step, before any spend.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {assertGeneratorRateLimit} = require("./generatorRateLimit");
const {getUserRole, isStaffRole} = require("../aiService");
const {sanitizeInputs, validateInputs} = require("./generateAssessment");
const {planPaper} = require("./assessmentPlanning");
const {gradeLabelFor, curriculumRefusalMessage} = require("./assessmentLabels");
const {FREE_PREVIEW_LIMITS} = require("./teacherPlans");
const {getUserTeacherPlan} = require("./usageMeter");

/**
 * Plan a paper for the given request.
 *
 * @param {object} args
 * @param {string} args.uid
 * @param {object} args.rawInputs the same payload generateAssessment takes
 * @param {string} [args.plan]    the teacher's subscription plan, for the free
 *   preview clamp — so the plan shown matches the paper that will be generated
 * @returns {Promise<object>} {blueprint, warnings, band, effectiveTypes, preview}
 */
async function runPlanAssessment({uid, rawInputs, plan = ""}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  // A free teacher's paper is clamped to the short-test marks cap by the
  // generator. Plan against the SAME number, or the plan would promise a
  // 40-mark paper and the generator would deliver a 10-mark one.
  const freePreview = plan === "free";
  if (freePreview) {
    inputs.totalMarks = Math.min(
        inputs.totalMarks, FREE_PREVIEW_LIMITS.shortTestMarksCap);
    inputs.durationMinutes = Math.min(inputs.durationMinutes, 30);
  }

  const planned = await planPaper({
    inputs,
    gradeLabel: gradeLabelFor(inputs.grade),
  });

  if (planned.refusal) {
    throw new HttpsError(
        "failed-precondition", curriculumRefusalMessage(inputs),
        {reason: planned.refusal.code},
    );
  }
  if (!planned.blueprint) {
    // The plan came out internally unsound. Say so plainly rather than showing a
    // confident summary of a plan we do not trust; the teacher can still
    // generate (the generator falls back to unconstrained), so this is a
    // warning, not a dead end.
    return {
      blueprint: null,
      problems: planned.problems,
      canGenerate: true,
      effectiveTypes: planned.effectiveTypes,
      bandId: planned.band ? planned.band.id : "",
      bandLabel: planned.band ? planned.band.label : "",
      topicsOnFile: planned.coverage.count || 0,
      preview: freePreview ? {
        maxQuestions: FREE_PREVIEW_LIMITS.maxShortTestQuestions,
        marksCap: FREE_PREVIEW_LIMITS.shortTestMarksCap,
      } : null,
    };
  }

  return {
    blueprint: planned.blueprint,
    problems: [],
    canGenerate: true,
    effectiveTypes: planned.effectiveTypes,
    bandId: planned.band ? planned.band.id : "",
    bandLabel: planned.band ? planned.band.label : "",
    // How many topics the verified syllabus has for this grade + subject, so the
    // teacher can see the plan is grounded on real curriculum rather than
    // trusting that it is.
    topicsOnFile: planned.coverage.count || 0,
    preview: freePreview ? {
      maxQuestions: FREE_PREVIEW_LIMITS.maxShortTestQuestions,
      marksCap: FREE_PREVIEW_LIMITS.shortTestMarksCap,
    } : null,
  };
}

function createPlanAssessment() {
  return onCall({timeoutSeconds: 60, memory: "256MiB"}, async (request) => {
    const uid = await assertVerifiedAuth(request, "Please sign in.");
    // Rate-limited like a generator even though it costs no tokens: it reads
    // several Firestore documents, and a client loop must not be able to turn
    // the plan step into a read amplifier.
    await assertGeneratorRateLimit(request, "assessment_plan");
    const role = await getUserRole(uid);
    if (!isStaffRole(role)) {
      throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
      );
    }
    // Read-only: the plan step never touches the usage counter (it costs no
    // tokens), it only needs to know whether to plan against the free-preview
    // clamp so the plan matches the paper the teacher will actually get.
    const plan = await getUserTeacherPlan(uid);
    return runPlanAssessment({uid, rawInputs: request.data, plan});
  });
}

module.exports = {createPlanAssessment, runPlanAssessment};
