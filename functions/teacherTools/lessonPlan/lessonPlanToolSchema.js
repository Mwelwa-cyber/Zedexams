/**
 * The forced-tool output shape for a lesson plan.
 *
 * Permissive on purpose: its job is to guarantee a well-formed OBJECT (a plain
 * `mode:"json"` call could return prose or a truncated fence, which surfaced to
 * teachers as a generic "Something went wrong"), not to police the plan's
 * contents. `additionalProperties: true` keeps it compatible with both the CBC
 * and Previous-curriculum shapes the system prompts describe, so only the two
 * fields common to BOTH are required.
 *
 * Lifted out of studioLessonPlan.js when that file became an adapter — the
 * canonical operation owns the contract it generates against.
 */

const LESSON_PLAN_TOOL_SCHEMA = {
  type: "object",
  description: "A complete Zambian lesson plan as a single JSON object, in " +
    "the structure described by the system and user prompts.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
    generalCompetences: {type: "array", items: {type: "string"}},
    specificCompetence: {type: "string"},
    specificOutcome: {type: "string"},
    lessonGoal: {type: "string"},
    rationale: {type: "string"},
    priorKnowledge: {type: "string"},
    references: {type: "array", items: {type: "string"}},
    learningEnvironment: {type: "object", additionalProperties: true},
    materials: {type: "array", items: {type: "string"}},
    expectedStandard: {type: "string"},
    stages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        // The stage keys MUST match the studio system prompt's documented
        // contract (teacher / pupils / assessment / duration) — the same keys
        // renderPlanHtml reads. The prompt (studioSystemPrompt.js) explicitly
        // instructs the model to use these and FORBIDS the
        // teacherActivities/learnerActivities/assessmentCriteria family. A tool
        // schema that named the forbidden family contradicted the prompt, and
        // under forced tool_choice that contradiction made the model emit a
        // degenerate, near-empty tool call — every plan rendered as an empty
        // table skeleton. Keeping schema + prompt in lock-step is what makes
        // the model actually fill the plan. (normalizePlanShape on the client
        // still tolerates the array family if a future model drifts.)
        properties: {
          name: {type: "string"},
          duration: {type: "string"},
          teacher: {type: "string"},
          pupils: {type: "string"},
          assessment: {type: "string"},
        },
      },
    },
  },
  required: ["lessonGoal", "stages"],
};

module.exports = {LESSON_PLAN_TOOL_SCHEMA};
