/**
 * Pure helpers for the aiLessonCount callable (lessonCount.js).
 *
 * Dependency-free on purpose — the repo-root test suite runs
 * `node functions/teacherTools/lessonCount.test.js` without installing
 * functions/node_modules (same *Core.js split as metaWhatsAppCore.js), so
 * nothing here may require firebase-functions or firebase-admin.
 */

const MIN_LESSONS = 1;
const MAX_LESSONS = 10;

function str(v, max) {
  return typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function sanitizeLessonCountInputs(raw = {}) {
  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 60);
  const topic = str(raw.topic, 200);
  const subtopic = str(raw.subtopic, 200);
  const expectedStandard = str(raw.expectedStandard, 600);

  const rawActivities = Array.isArray(raw.learningActivities) ?
    raw.learningActivities : [];
  const learningActivities = rawActivities
    .map((a) => str(a, 240))
    .filter((a) => a.length > 0)
    .slice(0, 12);

  // Counts already shown to this teacher for this sub-topic — the model is
  // asked to propose a different pacing. Bounded so a hammered button can't
  // grow the prompt without limit.
  const rawAvoid = Array.isArray(raw.avoidCounts) ? raw.avoidCounts : [];
  const avoidCounts = [...new Set(
    rawAvoid
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= MIN_LESSONS && n <= MAX_LESSONS),
  )].slice(0, 6);

  return {grade, subject, topic, subtopic, expectedStandard, learningActivities, avoidCounts};
}

function validateLessonCountInputs(inputs) {
  const errs = [];
  if (!inputs.topic) errs.push("Topic is required.");
  if (!inputs.subtopic) errs.push("Sub-topic is required.");
  return errs;
}

const SYSTEM_PROMPT = [
  "You are an expert Zambian CBC (Competency-Based Curriculum) lesson planner",
  "advising a teacher who is about to plan a lesson series.",
  "",
  "Your job: decide how many lessons (periods) one syllabus sub-topic should",
  "be taught over, and sketch each lesson's title and teaching focus.",
  "",
  "Rules:",
  `- The lesson count MUST be an integer between ${MIN_LESSONS} and ${MAX_LESSONS}.`,
  "- Base the pacing on the sub-topic's real teaching load: concept",
  "  introduction, guided practice, application, and consolidation/assessment",
  "  — not simply one lesson per listed activity.",
  "- A typical Zambian primary/secondary period is 30–40 minutes with mixed-",
  "  ability classes and large class sizes; pace realistically for that.",
  "- The breakdown MUST contain exactly `count` lessons, in teaching order.",
  "- Each lesson title is short (≤ 12 words) and specific to what that lesson",
  "  covers — never a bare repeat of the sub-topic name for every lesson.",
  "- Each lesson focus is one sentence describing what learners do/achieve.",
  "- The reason is 1–2 sentences a teacher can read at a glance, explaining",
  "  why this many lessons fits this sub-topic.",
  "- If the teacher has already seen certain counts, propose a genuinely",
  "  different but still defensible pacing (e.g. split concepts further, or",
  "  consolidate), and explain the trade-off in the reason.",
].join("\n");

function buildLessonCountPrompt(inputs) {
  const lines = [];
  if (inputs.grade) lines.push(`Grade: ${inputs.grade}`);
  if (inputs.subject) lines.push(`Subject: ${inputs.subject}`);
  lines.push(`Topic: ${inputs.topic}`);
  lines.push(`Sub-topic: ${inputs.subtopic}`);
  if (inputs.expectedStandard) {
    lines.push(`Expected standard: ${inputs.expectedStandard}`);
  }
  if (inputs.learningActivities.length > 0) {
    lines.push("");
    lines.push("Learning activities the syllabus lists for this sub-topic:");
    inputs.learningActivities.forEach((a) => lines.push(`- ${a}`));
  }
  if (inputs.avoidCounts.length > 0) {
    lines.push("");
    lines.push(
      `The teacher has already seen suggestions of ${inputs.avoidCounts.join(", ")} ` +
      "lesson(s) for this sub-topic. Propose a DIFFERENT lesson count with a " +
      "different pacing rationale, unless no other count is defensible.",
    );
  }
  lines.push("");
  lines.push(
    "Recommend how many lessons to teach this sub-topic over and outline " +
    "each lesson.",
  );
  return lines.join("\n");
}

// Permissive on purpose — coerceLessonCountResult does the strict clamping
// and shape repair, mirroring the other micro tools.
const LESSON_COUNT_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    count: {type: "integer", minimum: MIN_LESSONS, maximum: MAX_LESSONS},
    reason: {type: "string", maxLength: 500},
    breakdown: {
      type: "array",
      maxItems: MAX_LESSONS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {type: "string", maxLength: 160},
          focus: {type: "string", maxLength: 300},
        },
        required: ["title", "focus"],
      },
    },
  },
  required: ["count", "reason", "breakdown"],
};

/**
 * Clamp + repair the model output into the exact shape the studio's Lesson
 * Series builder consumes. Always returns `count` breakdown items numbered
 * 1..count with a non-empty title, so the client can seed the editable
 * lesson cards without any further checks.
 */
function coerceLessonCountResult(parsed, inputs) {
  // `parsed?.count ?? NaN` (not `Number(parsed && parsed.count)`) — a null
  // parsed would coerce to 0 and clamp to 1 instead of the 2-lesson default.
  const rawCount = Number(parsed && parsed.count != null ? parsed.count : NaN);
  const count = Number.isFinite(rawCount) ?
    Math.min(MAX_LESSONS, Math.max(MIN_LESSONS, Math.round(rawCount))) : 2;

  const reason = str(parsed && parsed.reason, 500) ||
    "A suggested pacing for this sub-topic. Adjust the count to fit your class.";

  const rawBreakdown = Array.isArray(parsed && parsed.breakdown) ?
    parsed.breakdown : [];
  const breakdown = Array.from({length: count}, (_, i) => {
    const item = rawBreakdown[i] || {};
    const title = str(item.title, 160) ||
      `Lesson ${i + 1}: ${inputs.subtopic || inputs.topic}`;
    return {
      lessonNumber: i + 1,
      title,
      focus: str(item.focus, 300),
      status: "pending",
    };
  });

  return {count, reason, breakdown};
}

module.exports = {
  sanitizeLessonCountInputs,
  validateLessonCountInputs,
  buildLessonCountPrompt,
  coerceLessonCountResult,
  SYSTEM_PROMPT,
  LESSON_COUNT_TOOL_SCHEMA,
  MIN_LESSONS,
  MAX_LESSONS,
};
