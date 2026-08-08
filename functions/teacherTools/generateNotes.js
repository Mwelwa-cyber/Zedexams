/**
 * generateNotes — HTTPS callable Cloud Function.
 *
 * Produces notes for a Zambian lesson in one of TWO AUDIENCES, and the audience
 * changes the document rather than its tone:
 *
 *   - `learner` (the default) — study notes written TO the class, the product
 *     the studio exists for. Retrieve-then-write against the syllabus, checked
 *     for teacher-directed voice and for grade ceiling afterwards. The pipeline
 *     is `generateLearnerNotes.js`; this file owns the reservation, the usage
 *     meter and the document.
 *   - `teaching` — the delivery notes this studio produced before 2026-08:
 *     hooks, worked examples with delivery guidance, misconceptions, discussion
 *     prompts. Unchanged, and reached by every saved document that predates the
 *     `audience` field, because absence of the field means exactly this.
 *
 * Both audiences work from a saved lesson plan (`{ lessonPlanId }`, ownership
 * enforced, topic and goal inherited) or standalone
 * (`{ grade, subject, topic, … }`).
 *
 * Persists the result to `aiGenerations` with `tool: 'notes'` and (when
 * applicable) `inputs.lessonPlanId` linking back to the source plan.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {assertGeneratorRateLimit} = require("./generatorRateLimit");

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
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {requireAndReserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");
const {
  isLessonPlanTool,
  lessonPlanBody,
  deriveInputsFromLessonPlan,
} = require("./notesPlanSource");
const {generateLearnerNotesDocument} = require("./generateLearnerNotes");

const NOTES_MODEL = process.env.NOTES_MODEL || "claude-sonnet-4-6";
// Stamped on the document the moment it is created, before the learner
// pipeline reports which model it actually used — a "generating" row with no
// model is a row nobody can attribute a cost to.
const LEARNER_MODEL_LABEL = NOTES_MODEL;
const LEARNER_PROMPT_VERSION = "learner-notes.v1";
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
  // The 2013 senior RE split: two separately examined ECZ syllabi.
  "religious_education_2044", "religious_education_2046",
  // 2013-framework subjects exposed by curriculum-data-2013.json
  // (Agricultural Science / Art & Design / Home Management, Grades 10-12).
  "agricultural_science", "art_and_design", "home_management",
  // CBC 2023 Forms 1-4 subjects the Syllabus Studio exposes as their own
  // canonical keys (Art & Design is shared with the 2013 line above).
  "commerce_and_principles_of_accounts", "design_and_technology_studies",
  "music_and_creative_arts",
  // ── The 2026-07 subject split ──────────────────────────────────────────
  // Canonical keys carved out of shared ones, each its own examinable subject
  // with its own numbering (see src/utils/subjectSplitClassifier.js). The
  // pre-split spellings above are kept so a saved pick still passes.
  "commerce", "principles_of_accounts",
  "food_and_nutrition", "fashion_and_fabrics", "mathematics_ii",
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
    // ── Audience and presentation (2026-08) ────────────────────────────────
    //
    // Carried as raw strings and normalised against the shared vocabulary in
    // the async path — `functions/shared/notes/notesOptionsCore.js` is ESM and
    // this file is CommonJS, and a second copy of the defaults here is exactly
    // the fork the shared package exists to prevent. The one thing decided
    // synchronously is which PIPELINE runs, and that is a two-way branch.
    audience: String(raw.audience || "").toLowerCase() === "teaching" ?
      "teaching" : "learner",
    format: str(raw.format, 20).toLowerCase(),
    detail: str(raw.detail, 20).toLowerCase(),
    length: str(raw.length, 20).toLowerCase(),
    englishLevel: str(raw.englishLevel, 20).toLowerCase(),
    paperSize: str(raw.paperSize, 20).toLowerCase(),
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

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (§7 — a duplicate/retried request must return the existing result,
 * never call the provider again). Reads the persisted aiGenerations doc rather
 * than re-deriving anything. Mirrors generateWorksheet's resume path.
 */
async function buildResumedNotesResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const genData = genSnap && genSnap.exists ? genSnap.data() : null;
  return {
    generationId: genId,
    notes: genData ? genData.output : null,
    usage: null,
    warning: genData && genData.status === "flagged" ?
      "Some fields were incomplete — please review." : null,
    kbGrounded: Boolean(genData && genData.kbVersion),
    resumed: true,
  };
}

/**
 * The learner-notes path (§3).
 *
 * Everything the two audiences share stays in `runNotes` — the reservation, the
 * ownership check on a source plan, the usage meter, the refund on failure and
 * the shape of the `aiGenerations` document. What differs is the pipeline, and
 * the difference is entirely inside `generateLearnerNotesDocument`.
 *
 * One thing to notice about the order: the document is created BEFORE the model
 * call and updated after, exactly as the teaching path does it, so a generation
 * that dies mid-flight leaves a `failed` row rather than nothing at all. The
 * doc id is the idempotency key, so a retry of the same request re-set()s this
 * document instead of creating a sibling.
 */
async function runLearnerNotes({uid, inputs, apiKey, idempotencyKey, sourcePlan}) {
  const usage = await assertAndIncrement(uid, "notes");
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);

  await genRef.set({
    ownerUid: uid,
    tool: "notes",
    inputs,
    output: null,
    outputText: "",
    modelUsed: LEARNER_MODEL_LABEL,
    promptVersion: LEARNER_PROMPT_VERSION,
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
    audience: "learner",
    ...(inputs.lessonPlanId ? {lessonPlanId: inputs.lessonPlanId} : {}),
  });

  let result;
  try {
    result = await generateLearnerNotesDocument({
      apiKey,
      uid,
      inputs: {...inputs, lessonPlan: sourcePlan && sourcePlan.output},
      rawOptions: {
        audience: "learner",
        format: inputs.format,
        detail: inputs.detail,
        length: inputs.length,
        englishLevel: inputs.englishLevel,
        paperSize: inputs.paperSize,
      },
    });
  } catch (err) {
    await genRef.update({
      status: "failed",
      errorMessage: String(err && err.message || err).slice(0, 500),
    });
    // Nothing usable came back — do not charge for a transient failure.
    try {
      await refundGeneration(uid, usage, "notes");
    } catch (refundErr) {
      console.error("[generateNotes] refund failed after learner generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[generateNotes] failAiOperation failed after learner generation error",
          {uid, generationId: genRef.id}, opErr);
    }
    throw err;
  }

  const {notes, validation, options, grounding, checks} = result;
  const tokensIn = Number(result.usageInfo.inputTokens || 0);
  const tokensOut = Number(result.usageInfo.outputTokens || 0);
  const costUsdCents = Math.round(
      ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );

  // The warning strip is assembled ONCE, here, from the three things that can
  // be wrong with a finished document: an incomplete shape, a voice the checks
  // could not repair, and a syllabus we could not read or could not satisfy.
  // A teacher gets one sentence per real problem, not three empty reassurances.
  const warning = [
    validation.ok ? "" : "Some parts were incomplete — please review.",
    checks.voiceClean ? "" :
      `${checks.voiceMessage} could not be rewritten — check the wording before printing.`,
    checks.scopeChecked ? "" : "",
    checks.scopeClean ? "" : `Scope check: ${checks.scopeMessage}.`,
    grounding.grounded ? "" : grounding.message,
  ].filter(Boolean).join(" ");

  await genRef.update({
    status: validation.ok ? "complete" : "flagged",
    errorMessage: validation.ok ? null : `Schema errors: ${validation.errors.join("; ")}`,
    output: notes,
    outputText: String(result.raw || "").slice(0, 20000),
    coveredContent: notes.coveredContent || [],
    audience: "learner",
    noteFormat: options.format,
    noteDetail: options.detail,
    noteLength: options.length,
    englishLevel: options.englishLevel,
    paperSize: options.paperSize,
    // Provenance, kept beside the document rather than only shown once: a chip
    // claiming a grounding nobody can check later is not provenance.
    grounded: grounding.grounded,
    groundingOutcomeCount: grounding.count,
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed: result.modelUsed,
    promptVersion: result.promptVersion,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
  } catch (opErr) {
    console.error("[generateNotes] completeAiOperation failed (learner)",
        {uid, generationId: genRef.id}, opErr);
  }

  return {
    generationId: genRef.id,
    notes,
    usage,
    warning: warning || null,
    kbGrounded: grounding.grounded,
    grounding,
    checks,
  };
}

async function runNotes({uid, rawInputs, apiKey, idempotencyKey}) {
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

  // Idempotency reservation (§6/§7/§8), UNCONDITIONAL. A request without a
  // valid key is refused here — before the usage meter, before the provider,
  // before any result document exists. It sits AFTER the lesson-plan derivation
  // so the fingerprint is the FINAL inputs (a from-plan request and the same
  // request with the plan's fields spelled out reconcile to one key). The
  // lesson-plan load above is a cheap read with no spend, so re-doing it on a
  // resumed duplicate costs nothing but a Firestore get.
  const reservation = await requireAndReserveAiOperation({
    idempotencyKey,
    userId: uid,
    operationType: "generate_notes",
    inputFingerprint: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedNotesResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }
  // "created" or "retrying" — exactly one provider call happens below.
  // "failed" and "cancelled" already threw inside the helper.

  if (inputs.audience === "learner") {
    return runLearnerNotes({uid, inputs, apiKey, idempotencyKey, sourcePlan});
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

  // Deterministic doc id (= the idempotency key), always. A retry of the SAME
  // logical request re-set()s this exact doc instead of creating a sibling, and
  // the resumed-completed path reads it straight back by id. The auto-id branch
  // that used to sit here is deleted rather than bypassed: a reservation that
  // settles onto an auto-id document cannot be resumed.
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
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
    // No usable notes were returned — roll the counter back so the teacher is
    // not charged for a transient failure. Best-effort: must not mask the
    // original error. (Matches generateWorksheet.js.)
    try {
      await refundGeneration(uid, usage, "notes");
    } catch (refundErr) {
      console.error("[generateNotes] refund failed after generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[generateNotes] failAiOperation failed after generation error",
          {uid, generationId: genRef.id}, opErr);
    }
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
    // A "flagged" note is still a real result the teacher already got and was
    // billed for — a completion for idempotency purposes, not a failure.
    try {
      await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
    } catch (opErr) {
      console.error("[generateNotes] completeAiOperation failed (flagged)",
          {uid, generationId: genRef.id}, opErr);
    }
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
  try {
    await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
  } catch (opErr) {
    console.error("[generateNotes] completeAiOperation failed",
        {uid, generationId: genRef.id}, opErr);
  }

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
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      await assertGeneratorRateLimit(request, "notes");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const idempotencyKey = request.data && request.data.idempotencyKey;
      return runNotes({uid, rawInputs: request.data, apiKey, idempotencyKey});
    },
  );
}

module.exports = {createGenerateNotes, runNotes};
