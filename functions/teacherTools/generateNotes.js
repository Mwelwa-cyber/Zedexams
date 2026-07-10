/**
 * generateNotes — HTTPS callable Cloud Function.
 *
 * Produces TEACHER delivery notes for a Zambian CBC lesson. Two modes:
 *
 *   1. From a saved lesson plan (preferred):
 *        await fn({ lessonPlanId: 'aiGenerations/abc123' });
 *      The function loads the lesson plan, enforces ownership, and grounds
 *      the notes on its topic, SMART goal, and competencies.
 *
 *   2. Standalone (free-form):
 *        await fn({ grade, subject, topic, subtopic, durationMinutes, language, instructions });
 *
 * Persists the result to `aiGenerations` with `tool: 'notes'` and (when
 * applicable) `inputs.lessonPlanId` linking back to the source plan.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const {resolveCbcContext} = require("./cbcKnowledge");
const {validateNotes} = require("./notesSchema");
const {PROMPT_VERSION, pickSystemPrompt, buildUserPrompt} =
  require("./notesPrompt");
const {assertAndIncrement} = require("./usageMeter");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");
const {
  isLessonPlanTool,
  lessonPlanBody,
  deriveInputsFromLessonPlan,
} = require("./notesPlanSource");

const NOTES_MODEL = process.env.NOTES_MODEL || "claude-sonnet-4-6";
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

// Permissive top-level shape — validateNotes() does the strict checking.
// The schema's job here is to anchor Claude to an object response and force
// tool use, which eliminates "AI returned non-JSON output" parse failures.
const NOTES_TOOL_SCHEMA = {
  type: "object",
  description: "Teacher delivery notes for a Zambian CBC lesson.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
  },
};

const ALLOWED_GRADES = new Set([
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
  "F1", "F2", "F3", "F4",
]);
const ALLOWED_SUBJECTS = new Set([
  "mathematics", "english", "integrated_science", "social_studies",
  "literacy", "numeracy", "cinyanja", "zambian_language",
  "creative_and_technology_studies",
  "physical_education", "religious_education", "civic_education",
  "biology", "chemistry", "physics", "geography", "history",
  "environmental_science", "technology_studies", "home_economics",
  "expressive_arts",
  // Senior/vocational subjects the syllabi expose (Forms 1-4) — accepted so the
  // standardized curriculum selector never dead-ends on a real syllabus subject.
  "fashion_fabrics", "food_nutrition", "hospitality_management",
  "travel_tourism", "literature_in_english",
  // 2013-framework subjects exposed by curriculum-data-2013.json
  // (Agricultural Science / Art & Design / Home Management, Grades 10-12).
  "agricultural_science", "art_and_design", "home_management",
]);
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

// Turn an ISO date (YYYY-MM-DD) from the date picker into the "19 June 2026"
// form Zambian teachers write on printed handouts. Anything that isn't a clean
// ISO date is passed through untouched (or dropped if empty), mirroring the
// lesson-plan studio's formatLessonDate.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function formatLessonDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s.slice(0, 40);
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return s.slice(0, 40);
  return `${d} ${MONTH_NAMES[mo - 1]} ${y}`;
}

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();

  // Optional curriculum-module selectors (Phase 1 model). Absent → null/""
  // so behaviour is unchanged when not supplied.
  const term = Math.round(num(raw.term, 0));
  const lessonNumber = Math.round(num(raw.lessonNumber, 0));
  const totalLessons = Math.round(num(raw.totalLessons, 0));
  const learningEnvironment = str(raw.learningEnvironment, 40)
    .toLowerCase().replace(/[^a-z_]/g, "_");

  return {
    grade,
    subject,
    topic: str(raw.topic, 160),
    subtopic: str(raw.subtopic, 200),
    date: formatLessonDate(raw.date),
    term: term >= 1 && term <= 3 ? term : null,
    lessonNumber: lessonNumber >= 1 ? lessonNumber : null,
    totalLessons: totalLessons >= 1 ? totalLessons : null,
    learningEnvironment: LE_VALUES.has(learningEnvironment) ?
      learningEnvironment : "",
    durationMinutes: Math.min(240, Math.max(5, Math.round(num(raw.durationMinutes, 40)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    teacherName: str(raw.teacherName, 80),
    school: str(raw.school, 120),
    instructions: str(raw.instructions, 500),
    lessonPlanId: str(raw.lessonPlanId, 80),
    // Explicit curriculum chosen by the teacher — drives CBC vs Previous
    // prompt/terminology + framework-aware KB grounding.
    framework: String(raw.framework) === "2013" ? "2013" : "2023",
    curriculum: String(raw.curriculum || "").toLowerCase() === "previous" ?
      "previous" : "cbc",
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.grade || !ALLOWED_GRADES.has(inputs.grade)) {
    errs.push("Please select a valid grade.");
  }
  if (!inputs.subject || !ALLOWED_SUBJECTS.has(inputs.subject)) {
    errs.push("Please select a supported subject.");
  }
  if (!inputs.topic) {
    errs.push("Please provide a topic.");
  }
  return errs;
}

async function loadLessonPlan(uid, lessonPlanId) {
  if (!lessonPlanId) return null;
  const snap = await admin.firestore()
    .collection("aiGenerations").doc(lessonPlanId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "That lesson plan no longer exists.");
  }
  const data = snap.data();
  if (data.ownerUid !== uid) {
    throw new HttpsError(
      "permission-denied",
      "You can only build notes from your own lesson plans.",
    );
  }
  if (!isLessonPlanTool(data.tool)) {
    throw new HttpsError(
      "invalid-argument",
      "That generation isn't a lesson plan we can build notes from.",
    );
  }
  const body = lessonPlanBody(data);
  if (!body) {
    // It IS a lesson plan, but it has no usable body yet — almost always
    // because it's still generating or the generation failed. Give an
    // actionable message instead of the misleading "isn't a lesson plan".
    if (data.status === "generating") {
      throw new HttpsError(
        "failed-precondition",
        "That lesson plan is still being written. Give it a moment to " +
        "finish, then try again.",
      );
    }
    throw new HttpsError(
      "failed-precondition",
      "That lesson plan didn't finish generating, so there's nothing to " +
      "build notes from. Pick a finished plan, or switch to Standalone mode.",
    );
  }
  // Hand back a normalised shape so the rest of the pipeline can rely on
  // `.output` regardless of which writer produced the doc (the legacy
  // studio stored the body under `data`).
  return {...data, output: body};
}

async function runNotes({uid, rawInputs, apiKey}) {
  let inputs = sanitizeInputs(rawInputs || {});

  // If a lesson plan is referenced, load it and use it to fill in any
  // missing fields. This makes the from-plan flow as little as
  // `{ lessonPlanId }`.
  let sourcePlan = null;
  if (inputs.lessonPlanId) {
    sourcePlan = await loadLessonPlan(uid, inputs.lessonPlanId);
    inputs = deriveInputsFromLessonPlan(sourcePlan, inputs);
    // Re-sanitise grade/subject after pulling from the plan.
    inputs.grade = String(inputs.grade || "").toUpperCase().replace(/\s+/g, "");
    inputs.subject = String(inputs.subject || "").toLowerCase().replace(/[^a-z_]/g, "_");
  }

  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  const {contextBlock, kbMatch, kbWarning, kbVersion} = await resolveCbcContext({
    grade: inputs.grade,
    subject: inputs.subject,
    topic: inputs.topic,
    subtopic: inputs.subtopic,
    term: inputs.term,
    lessonNumber: inputs.lessonNumber,
    totalLessons: inputs.totalLessons,
    learningEnvironment: inputs.learningEnvironment,
    framework: inputs.framework,
    ownerUid: uid,
  });

  const usage = await assertAndIncrement(uid, "notes");

  const genRef = admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "notes",
    inputs,
    output: null,
    outputText: "",
    modelUsed: NOTES_MODEL,
    promptVersion: PROMPT_VERSION,
    kbVersion,
    tokensIn: 0,
    tokensOut: 0,
    costUsdCents: 0,
    status: "generating",
    errorMessage: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: null,
    teacherEdited: false,
    exportedFormats: [],
    visibility: "private",
    ...(inputs.lessonPlanId ? {lessonPlanId: inputs.lessonPlanId} : {}),
  });

  const userPrompt = buildUserPrompt({
    ...inputs,
    lessonPlan: sourcePlan && sourcePlan.output,
  });

  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = NOTES_MODEL;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "notes"},
      systemPrompt: pickSystemPrompt(inputs),
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 6000,
      temperature: 0.4,
      model: NOTES_MODEL,
      mode: "tool",
      toolName: "emit_lesson_notes",
      toolDescription:
        "Emit the complete teacher delivery notes as a single structured " +
        "object. Do not include any prose or commentary outside this tool call.",
      toolInputSchema: NOTES_TOOL_SCHEMA,
    });
    parsed = response.parsed;
    raw = response.text || "";
    usageInfo = response.usage || usageInfo;
    modelUsed = response.model || modelUsed;
  } catch (err) {
    await genRef.update({
      status: "failed",
      errorMessage: String(err && err.message || err).slice(0, 500),
    });
    throw err;
  }

  // Make sure the lessonPlanId is reflected inside header.lessonPlanId so
  // the viewer can show "Built from lesson plan ↗" without an extra read.
  if (inputs.lessonPlanId && parsed && parsed.header) {
    parsed.header.lessonPlanId = inputs.lessonPlanId;
  }

  // The lesson date is teacher-supplied, not model-invented — stamp the
  // formatted value straight onto the header so the viewer and the .docx
  // header render it like a lesson plan.
  if (inputs.date && parsed && parsed.header) {
    parsed.header.date = inputs.date;
  }

  const validation = validateNotes(parsed);
  const notes = validation.value;

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  // Sonnet pricing: ~$3/M input, $15/M output.
  const costUsdCents = Math.round(
    ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );

  if (!validation.ok) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: notes,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents,
      modelUsed,
    });
    return {
      generationId: genRef.id,
      notes,
      usage,
      warning: [
        "Some fields were incomplete — please review.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
    };
  }

  await genRef.update({
    status: "complete",
    output: notes,
    coveredContent: notes.coveredContent || [],
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    generationId: genRef.id,
    notes,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function createGenerateNotes(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 120, memory: "512MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      return runNotes({uid, rawInputs: request.data, apiKey});
    },
  );
}

module.exports = {createGenerateNotes, runNotes};
