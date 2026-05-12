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

const {resolveCbcContext, KB_VERSION} = require("./cbcKnowledge");
const {validateNotes} = require("./notesSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./notesPrompt");
const {assertAndIncrement} = require("./usageMeter");

const NOTES_MODEL = process.env.NOTES_MODEL || "claude-sonnet-4-5";

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
  "ECE", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
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
]);
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();

  return {
    grade,
    subject,
    topic: str(raw.topic, 160),
    subtopic: str(raw.subtopic, 200),
    durationMinutes: Math.min(240, Math.max(5, Math.round(num(raw.durationMinutes, 40)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    teacherName: str(raw.teacherName, 80),
    school: str(raw.school, 120),
    instructions: str(raw.instructions, 500),
    lessonPlanId: str(raw.lessonPlanId, 80),
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
  if (data.tool !== "lesson_plan" || !data.output) {
    throw new HttpsError(
      "invalid-argument",
      "That generation isn't a lesson plan we can build notes from.",
    );
  }
  return data;
}

function deriveInputsFromLessonPlan(plan, base) {
  if (!plan || !plan.output) return base;
  const planInputs = plan.inputs || {};
  const planHeader = plan.output.header || {};
  return {
    ...base,
    grade: base.grade || planInputs.grade || planHeader.class || "",
    subject: base.subject || planInputs.subject || planHeader.subject || "",
    topic: base.topic || planInputs.topic || planHeader.topic || "",
    subtopic: base.subtopic || planInputs.subtopic || planHeader.subtopic || "",
    durationMinutes: base.durationMinutes ||
      planInputs.durationMinutes || planHeader.durationMinutes || 40,
    language: base.language || planInputs.language ||
      planHeader.mediumOfInstruction || "english",
    teacherName: base.teacherName ||
      planInputs.teacherName || planHeader.teacherName || "",
    school: base.school || planInputs.school || planHeader.school || "",
  };
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

  const {contextBlock, kbMatch, kbWarning} = await resolveCbcContext({
    grade: inputs.grade,
    subject: inputs.subject,
    topic: inputs.topic,
    subtopic: inputs.subtopic,
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
    kbVersion: KB_VERSION,
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
      systemPrompt: SYSTEM_PROMPT,
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
