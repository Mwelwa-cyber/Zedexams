/**
 * generateSbaTask — HTTPS callable Cloud Function.
 *
 * Generates ONE ECZ-compliant School Based Assessment task (Grades 5–7) with
 * its marking scheme, grounded on the verified syllabus context. Persists to
 * `aiGenerations` with `tool: 'sba_task'`. The marking artefact follows the
 * task's marking style (answer key / oral observation / method marks /
 * experiment / project / competence / criteria rubric).
 *
 *   const fn = httpsCallable(functions, 'generateSbaTask');
 *   await fn({ grade: 'G5', subject: 'english', taskType: 'reading_comprehension',
 *             term: 'Term 1', topic: 'The environment', bloomLevel: 'Comprehension',
 *             language: 'english' });
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
const {validateSbaTask} = require("./sbaTaskSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} = require("./sbaTaskPrompt");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {requireAndReserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");
const {
  SUBJECT_LABELS,
  GRADE_LABELS,
  CTS_COMPONENT_LABELS,
  BLOOM_LEVELS,
  isSbaSubject,
  isSbaGrade,
  resolveSbaTaskMeta,
  ctsComponentToKbSubject,
} = require("./sbaTaxonomy");

const SBA_MODEL = process.env.SBA_MODEL || "claude-sonnet-4-6";

const SBA_TOOL_SCHEMA = {
  type: "object",
  description: "A single ECZ-compliant School Based Assessment task with its marking scheme.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
  },
};

const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

// Strip stray NUL bytes from inputs without putting a literal NUL in source.
const NUL = String.fromCharCode(0);

function sanitizeInputs(raw = {}) {
  const s = (v, max) => (typeof v === "string" ?
    v.split(NUL).join("").trim().slice(0, max) : "");

  const grade = s(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = s(raw.subject, 48).toLowerCase().replace(/[^a-z_]/g, "_");
  const taskType = s(raw.taskType, 48).toLowerCase().replace(/[^a-z_]/g, "_");
  const component = s(raw.component, 48).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = s(raw.language || "english", 20).toLowerCase();
  const bloomLevel = s(raw.bloomLevel, 20);

  return {
    grade,
    subject,
    taskType,
    component: Object.prototype.hasOwnProperty.call(CTS_COMPONENT_LABELS, component) ?
      component : "",
    term: s(raw.term, 20),
    topic: s(raw.topic, 160),
    outcome: s(raw.outcome, 200),
    bloomLevel: BLOOM_LEVELS.has(bloomLevel) ? bloomLevel : "",
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    instructions: s(raw.instructions, 500),
    // SBA is the Grade 5–7 School Based Assessment instrument, which sits on
    // the 2013 outcome-based (OBC) curriculum — NOT the 2023 CBC. Always
    // ground on the 2013 framework.
    framework: "2013",
  };
}

function validateInputs(inputs) {
  const errs = [];
  if (!isSbaGrade(inputs.grade)) {
    errs.push("SBA tasks are for Grades 5, 6 and 7 only.");
  }
  if (!isSbaSubject(inputs.subject)) {
    errs.push("Please select a supported SBA subject.");
  }
  const meta = isSbaSubject(inputs.subject) ?
    resolveSbaTaskMeta(inputs.subject, inputs.taskType) : null;
  if (!meta) {
    errs.push("Please select a valid task type for this subject.");
  } else if (meta.needsComponent && !inputs.component) {
    errs.push("Please choose a CTS component (Expressive Arts, Home Economics or Technology Studies).");
  }
  return {errs, meta};
}

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (§7 — a duplicate/retried request must return the existing result,
 * never call the provider again). Reads the persisted aiGenerations doc rather
 * than re-deriving anything. Mirrors generateWorksheet's resume path.
 */
async function buildResumedSbaResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const genData = genSnap && genSnap.exists ? genSnap.data() : null;
  return {
    generationId: genId,
    task: genData ? genData.output : null,
    usage: null,
    warning: genData && genData.status === "flagged" ?
      "Some fields were incomplete — please review." : null,
    kbGrounded: Boolean(genData && genData.kbVersion),
    resumed: true,
  };
}

async function runSbaTask({uid, rawInputs, apiKey, idempotencyKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const {errs, meta} = validateInputs(inputs);
  if (errs.length > 0) {
    throw new HttpsError("invalid-argument", errs.join(" "));
  }

  // Idempotency reservation (§6/§7/§8), UNCONDITIONAL. A request without a
  // valid key is refused here — before the usage meter, before the provider,
  // before any result document exists. `inputs` is the canonical fingerprint
  // (every teacher-changeable field is already in there), so replaying one key
  // with different inputs is rejected rather than quietly answered with the
  // first result.
  const reservation = await requireAndReserveAiOperation({
    idempotencyKey,
    userId: uid,
    operationType: "generate_sba_task",
    inputFingerprint: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedSbaResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    return {status: "processing", operationId: idempotencyKey};
  }
  // "created" or "retrying" — exactly one provider call happens below.
  // "failed" and "cancelled" already threw inside the helper.

  const totalMarks = meta.defaultMarks;
  const subjectLabel = SUBJECT_LABELS[inputs.subject];
  const gradeLabel = GRADE_LABELS[inputs.grade];
  const componentLabel = inputs.component ?
    CTS_COMPONENT_LABELS[inputs.component] : "";

  // Ground on the 2013 OBC syllabus for the topic so tasks aren't invented
  // from thin air. CTS has no syllabus of its own; its components (Expressive
  // Arts / Home Economics / Design & Technology) are the KB subjects, so
  // ground on the chosen component — matching the topic/outcome the studio's
  // 2013 picker drew from it.
  const groundingSubject = inputs.subject === "creative_and_technology_studies" &&
    inputs.component ? ctsComponentToKbSubject(inputs.component) : inputs.subject;
  const [{contextBlock, kbMatch, kbWarning, kbVersion}, usage] = await Promise.all([
    resolveCbcContext({
      grade: inputs.grade,
      subject: groundingSubject,
      topic: inputs.topic || meta.label,
      subtopic: inputs.outcome,
      framework: inputs.framework,
      ownerUid: uid,
    }),
    assertAndIncrement(uid, "sba_task"),
  ]);

  // Deterministic doc id (= the idempotency key), always. A retry of the SAME
  // logical request re-set()s this exact doc instead of creating a sibling, and
  // the resumed-completed path reads it straight back by id. The auto-id branch
  // that used to sit here is deleted rather than bypassed: a reservation that
  // settles onto an auto-id document cannot be resumed.
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
  await genRef.set({
    ownerUid: uid,
    tool: "sba_task",
    inputs,
    output: null,
    outputText: "",
    modelUsed: SBA_MODEL,
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
  });

  const userPrompt = buildUserPrompt({
    gradeLabel,
    subjectLabel,
    taskTypeLabel: meta.label,
    marking: meta.marking,
    component: componentLabel,
    skill: meta.skill,
    term: inputs.term,
    topic: inputs.topic,
    outcome: inputs.outcome,
    bloomLevel: inputs.bloomLevel,
    totalMarks,
    language: inputs.language,
    instructions: inputs.instructions,
  });

  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = SBA_MODEL;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "sbaTask"},
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 4000,
      temperature: 0.4,
      model: SBA_MODEL,
      mode: "tool",
      toolName: "emit_sba_task",
      toolDescription:
        "Emit the complete SBA task as a single structured object. Do not " +
        "include any prose or commentary outside this tool call.",
      toolInputSchema: SBA_TOOL_SCHEMA,
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
    // No usable task was returned — roll the counter back so the teacher is not
    // charged for a transient failure. Best-effort: must not mask the original
    // error. (Matches generateWorksheet.js.)
    try {
      await refundGeneration(uid, usage, "sba_task");
    } catch (refundErr) {
      console.error("[generateSbaTask] refund failed after generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      console.error("[generateSbaTask] failAiOperation failed after generation error",
          {uid, generationId: genRef.id}, opErr);
    }
    throw err;
  }

  const validation = validateSbaTask(parsed);
  const task = validation.value;

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
      output: task,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents,
      modelUsed,
    });
    // A "flagged" task is still a real result the teacher already got and was
    // billed for — a completion for idempotency purposes, not a failure.
    try {
      await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
    } catch (opErr) {
      console.error("[generateSbaTask] completeAiOperation failed (flagged)",
          {uid, generationId: genRef.id}, opErr);
    }
    return {
      generationId: genRef.id,
      task,
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
    output: task,
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
    console.error("[generateSbaTask] completeAiOperation failed",
        {uid, generationId: genRef.id}, opErr);
  }

  return {
    generationId: genRef.id,
    task,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
  };
}

function createGenerateSbaTask(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 120, memory: "512MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      await assertGeneratorRateLimit(request, "sba_task");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const idempotencyKey = request.data && request.data.idempotencyKey;
      return runSbaTask({uid, rawInputs: request.data, apiKey, idempotencyKey});
    },
  );
}

module.exports = {createGenerateSbaTask, runSbaTask, sanitizeInputs};
