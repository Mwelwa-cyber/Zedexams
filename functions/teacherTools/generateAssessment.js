/**
 * generateAssessment — HTTPS callable Cloud Function.
 *
 * A formal graded test grounded on the verified curriculum module for the
 * selected grade + sub-topic + term. Persists to `aiGenerations` with
 * `tool: 'assessment'`. (Distinct from the quiz editor / Assessment Studio,
 * which manage the quizzes collection — this produces a saved, exportable
 * assessment document like worksheet/full-lesson.)
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

const {resolveCbcContext, classifySubjectForGrade} = require("./cbcKnowledge");
const {
  ASSESSMENT_TYPES,
  resolveAssessmentFormatContext,
  normalizeQuestionTypes,
} = require("./assessmentFormats");
const {validateAssessment} = require("./assessmentSchema");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV10");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {reserveAiOperation, completeAiOperation, failAiOperation} = require("../aiOperations");
const {FREE_PREVIEW_LIMITS} = require("./teacherPlans");
const {clampAssessmentPreview} = require("./freePreview");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");
const {sourceAssessmentFromBank} = require("./masterBankSourcing");
const {buildAvoidNote, mergeSourcedIntoSections} = require("./masterBankSourcingCore");
const {checkAssessmentQuality, interleaveSections} =
  require("./assessmentQualityCheck");
const {
  bandForGrade, buildBandDirective, allowedQuestionTypes, toSchemaTypes,
  bandPermitsActivity,
  ALL_QUESTION_TYPES: BAND_QUESTION_TYPES,
} = require("./assessmentBands");
const {buildProvenance} = require("../aiValidation/operationRegistry");
const {validateCurriculumContext} = require("../aiValidation/curriculumGuard");
const {deriveAcceptanceState} = require("../aiValidation/validationResult");

// The assessment types the Master Bank can supply (the rest — structured,
// calculation, essay, matching — stay AI-only).
const BANK_ASSESSMENT_TYPES = ["multiple_choice", "true_false", "short_answer"];
// Cap on how much of a paper (by marks) may be filled from the bank; the AI
// always authors the rest.
const BANK_MARKS_SHARE = 0.5;

const ASSESSMENT_MODEL =
  process.env.ASSESSMENT_MODEL || "claude-sonnet-4-6";
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);

const ASSESSMENT_TOOL_SCHEMA = {
  type: "object",
  description: "A formal graded Zambian CBC assessment.",
  additionalProperties: true,
  properties: {
    header: {type: "object", additionalProperties: true},
  },
};

const {ALLOWED_GRADES, ALLOWED_SUBJECTS} =
  require("./assessmentAllowlists");
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);

function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();
  const assessmentType = str(raw.assessmentType, 30).toLowerCase();

  const term = Math.round(num(raw.term, 0));
  const lessonNumber = Math.round(num(raw.lessonNumber, 0));
  const totalLessons = Math.round(num(raw.totalLessons, 0));
  const learningEnvironment = str(raw.learningEnvironment, 40)
      .toLowerCase().replace(/[^a-z_]/g, "_");

  return {
    grade,
    subject,
    topic: str(raw.topic, 240),
    subtopic: str(raw.subtopic, 300),
    term: term >= 1 && term <= 3 ? term : null,
    lessonNumber: lessonNumber >= 1 ? lessonNumber : null,
    totalLessons: totalLessons >= 1 ? totalLessons : null,
    learningEnvironment: LE_VALUES.has(learningEnvironment) ?
      learningEnvironment : "",
    totalMarks: Math.min(100, Math.max(5,
        Math.round(num(raw.totalMarks, 20)))),
    durationMinutes: Math.min(180, Math.max(10,
        Math.round(num(raw.durationMinutes, 40)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    questionTypes: normalizeQuestionTypes(raw.questionTypes),
    // The teacher's selection in the BAND's vocabulary — the early-years and
    // upper-band task names, which normalizeQuestionTypes drops because it only
    // knows the eight schema types. Kept so the band ceiling is applied to what
    // was actually asked for, then converted to schema types for the prompt.
    // The vocabulary itself is the band's (assessmentBands.js); this only
    // filters against it. Nothing outside it survives.
    requestedBandTypes: (Array.isArray(raw.questionTypes) ? raw.questionTypes : [])
        .map((v) => String(v || "").trim().toLowerCase())
        .filter((v) => BAND_QUESTION_TYPES.includes(v)),
    instructions: str(raw.instructions, 500),
    // Omitted → the safe default (topic_test), same as before. An explicit
    // but unrecognised value is kept as-is here (NOT silently coerced) so
    // validateInputs below can reject it with a clear error instead of the
    // request silently generating (and saving) a different assessment type
    // than the one the teacher actually picked.
    assessmentType: assessmentType || "topic_test",
    // Curriculum framework the teacher chose: new CBC (default) or the
    // old 2013 syllabus. resolveCbcContext grounds on the matching
    // syllabi data file.
    framework: String(raw.framework) === "2013" ? "2013" : "2023",
    // Smart sourcing is on by default; a client can opt out ("fresh
    // questions only") by sending useQuestionBank: false.
    useQuestionBank: raw.useQuestionBank !== false,
  };
}

// Human-readable grade label. Mirrors the client level ladder
// (src/config/educationLevels.js): G1–G7 → "Grade N", G8–G12 → the forms
// "Form 1"…"Form 5", and the two ECE age bands → Nursery and Reception. A Form
// is never relabelled a Grade.
//
// "Baby Class" and "Middle Class" are NOT levels; their codes are legacy
// spellings that resolve to Nursery so an old record still opens. A bare "ECE"
// predates the age bands, covers both years, and resolves to the youngest.
function gradeLabelFor(code) {
  const g = String(code || "").toUpperCase();
  if (g === "ECE_N" || g === "ECE_B" || g === "ECE" || g === "ECE_M") {
    return "Nursery";
  }
  if (g === "ECE_R") return "Reception";
  const m = g.match(/^G(\d{1,2})$/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 8 && n <= 12) return `Form ${n - 7}`;
    return `Grade ${n}`;
  }
  const f = g.match(/^F(\d)$/);
  if (f) return `Form ${f[1]}`;
  return String(code || "");
}

function subjectLabelFor(key) {
  const known = {
    integrated_science: "Integrated Science",
    social_studies: "Social Studies",
    expressive_arts: "Expressive Arts",
    technology_studies: "Technology Studies",
    home_economics: "Home Economics",
    zambian_language: "Zambian Language",
    creative_and_technology_studies: "Creative & Technology Studies",
    religious_education: "Religious Education",
    civic_education: "Civic Education",
    physical_education: "Physical Education",
    environmental_science: "Environmental Science",
  };
  const k = String(key || "").trim();
  return known[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  // Defensive: reject an assessment type the server doesn't recognise
  // instead of silently falling back to a different one. A client sending a
  // garbage/stale value should see a clear error, not a paper quietly
  // generated (and saved) as the wrong type. An OMITTED type is fine — that
  // already defaulted to "topic_test" in sanitizeInputs (or, for a caller
  // that hits validateInputs directly without sanitizing first, is simply
  // not this check's concern).
  if (inputs.assessmentType && !ASSESSMENT_TYPES.includes(inputs.assessmentType)) {
    errs.push(
        `"${inputs.assessmentType}" is not a supported assessment type.`,
    );
  }
  // Reject a definitively invalid curriculum/level/subject combination so bad
  // paper metadata can never be saved. Fail-OPEN: classifySubjectForGrade
  // returns 'unknown' for any grade without an authoritative subject list (and
  // for the 2013 framework), so this only blocks pairs we KNOW are wrong —
  // e.g. Integrated Science requested for a grade whose CBC syllabus omits it.
  if (
    inputs.grade && inputs.subject && inputs.framework === "2023" &&
    classifySubjectForGrade(inputs.grade, inputs.subject) === "not_in_grade"
  ) {
    errs.push(
        `${subjectLabelFor(inputs.subject)} is not available for ` +
        `${gradeLabelFor(inputs.grade)} under the selected curriculum. ` +
        "Please choose a valid curriculum, level and subject combination.",
    );
  }
  return errs;
}

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (§7 — a duplicate/retried request must return the existing
 * result, never call the provider again). Reads the persisted aiGenerations
 * doc rather than re-deriving anything, so a resumed response is exactly
 * what the original caller would have seen.
 */
async function buildResumedAssessmentResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const genData = genSnap && genSnap.exists ? genSnap.data() : null;
  return {
    generationId: genId,
    assessment: genData ? genData.output : null,
    usage: null,
    warning: genData && genData.status === "flagged" ?
      "Some fields were incomplete — please review." : null,
    kbGrounded: Boolean(genData && genData.kbVersion),
    sourcing: genData ? genData.sourcing : null,
    quality: genData ? genData.quality : null,
    preview: null,
    resumed: true,
  };
}

async function runAssessment({uid, rawInputs, apiKey, idempotencyKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  // Idempotency reservation (§6/§7/§8) — MUST happen before the CBC-context
  // resolution / usage meter / Anthropic call below, so a duplicate request
  // (double-click, rapid tap, retried timeout, a second tab) can never reach
  // the provider or the usage meter a second time for the same logical
  // generation. `inputs` doubles as the canonical fingerprint payload — any
  // field a teacher could change between two calls is already in there.
  const reservation = await reserveAiOperation({
    uid,
    idempotencyKey,
    operationType: "generate_assessment",
    fingerprintInput: inputs,
  });
  if (reservation.status === "completed") {
    return buildResumedAssessmentResponse(reservation.operation);
  }
  if (reservation.status === "processing") {
    // Another call (this tab's retry, another tab, or a network resend) is
    // already running the provider call for this exact request — do not
    // start a second one. The client-side lock (useAiOperationLock) is what
    // prevents this from firing FROM the same tab in the first place; this
    // is the server-side backstop for everything else (§12/§13).
    return {status: "processing", operationId: idempotencyKey};
  }
  if (reservation.status === "failed") {
    throw new HttpsError(
        "failed-precondition",
        reservation.operation.errorMessage ||
          "This request already failed and cannot be retried automatically.",
        {code: reservation.operation.errorCode, retryable: false, operationId: idempotencyKey},
    );
  }
  if (reservation.status === "cancelled") {
    throw new HttpsError("cancelled", "This request was cancelled.");
  }
  // reservation.status is "created" or "retrying" — exactly one provider
  // call happens below.

  const [
    {contextBlock, kbMatch, kbWarning, kbVersion},
    {formatBlock, formatProfileId, formatSource},
    usage,
  ] = await Promise.all([
    resolveCbcContext({
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
    }),
    resolveAssessmentFormatContext({
      grade: inputs.grade,
      subject: inputs.subject,
      assessmentType: inputs.assessmentType,
      allowedTypes: inputs.questionTypes,
    }),
    assertAndIncrement(uid, "assessment"),
  ]);

  // Free preview (§12–13): a free short test aims at a small marks budget so
  // the model authors ~FREE_PREVIEW_LIMITS.maxShortTestQuestions questions
  // (the hard question cap is enforced on the OUTPUT below — the marks clamp
  // alone is a soft lever). Everything downstream (bank marksBudget,
  // gapMarks, maxTokens, the prompt) reads inputs.totalMarks, so clamping
  // here propagates everywhere.
  const freePreview = usage.plan === "free";
  if (freePreview) {
    inputs.totalMarks = Math.min(inputs.totalMarks, FREE_PREVIEW_LIMITS.shortTestMarksCap);
    inputs.durationMinutes = Math.min(inputs.durationMinutes, 30);
  }

  // Deterministic doc id (= the idempotency key) rather than a random push
  // id: makes the result write idempotent by construction — a retry of the
  // SAME logical request (reservation.status === "retrying") re-`set()`s
  // this exact doc instead of creating a sibling, and the resumed-completed
  // path above can read it straight back by id (§10).
  const genRef = admin.firestore().collection("aiGenerations").doc(idempotencyKey);
  await genRef.set({
    ownerUid: uid,
    tool: "assessment",
    inputs,
    output: null,
    outputText: "",
    modelUsed: ASSESSMENT_MODEL,
    promptVersion: PROMPT_VERSION,
    kbVersion,
    formatProfileId,
    formatSource,
    // Version provenance (§35) — the prompt/schema/validator/catalogue
    // quadruple that produced this doc, so a later regression can be traced to
    // the exact combination. Read from the shared operation registry rather
    // than hard-coded here.
    provenance: buildProvenance("generate_assessment", {
      model: ASSESSMENT_MODEL,
      promptVersion: PROMPT_VERSION,
      curriculumVersion: kbVersion || null,
      framework: inputs.framework === "2013" ? "obc" : "cbc",
    }),
    // Acceptance-state lifecycle (§31): server-managed, never client-writable.
    acceptanceStatus: "validating",
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

  // The band governing this level — reading requirement, permitted question
  // types, structural rules, cognitive spread. Resolved BEFORE sourcing so the
  // band's ceiling applies to bank questions as well as authored ones: a Baby
  // Class paper must not be handed an essay from the Master Bank either.
  //
  // The client already filters its chips to the band, but a client is not a
  // guard — the ceiling is enforced here, where it cannot be bypassed.
  const band = await bandForGrade(inputs.grade);
  // Intersect what was asked for with what the band permits, in the band's own
  // vocabulary, then convert to the schema types the generator can emit.
  const requested = inputs.requestedBandTypes.length > 0 ?
    inputs.requestedBandTypes : inputs.questionTypes;
  const bandTypes = allowedQuestionTypes(band, requested);
  // The ceiling only ever NARROWS. When the intersection is empty — a stale
  // client asking Baby Class for an essay — fall back to the BAND's own list,
  // never to the client's: falling back to the request would hand back exactly
  // the types the band just refused.
  const permitted = bandTypes.length > 0 ?
    bandTypes : (band ? band.questionTypes : requested);
  const effectiveTypes = toSchemaTypes(permitted);

  // Smart Paper Generation — fill up to ~half the marks from the Master Bank,
  // then ask the AI to author only the remainder. Best-effort: an empty/
  // unmatched bank sources nothing and the flow is identical to before.
  let sourced = {questions: [], fromBank: 0, marks: 0, scanned: 0};
  if (inputs.useQuestionBank) {
    const allowedTypes = effectiveTypes && effectiveTypes.length ?
      effectiveTypes : BANK_ASSESSMENT_TYPES;
    sourced = await sourceAssessmentFromBank({
      grade: inputs.grade,
      subject: inputs.subject,
      topic: inputs.topic,
      marksBudget: Math.round(inputs.totalMarks * BANK_MARKS_SHARE),
      allowedTypes,
    });
  }
  // A bank question whose activity the band forbids is REJECTED, not adapted.
  // sourceAssessmentFromBank is filtered by type, but the bank is shared across
  // grades and a stored question can carry an activity that is wrong for this
  // level — reusing it would put an essay on a Nursery paper by the back door.
  if (band && sourced.questions.length > 0) {
    const keptQuestions = sourced.questions.filter((q) => bandPermitsActivity(
        band, q.activityType || q.type,
    ));
    const rejected = sourced.questions.length - keptQuestions.length;
    if (rejected > 0) {
      const keptMarks = keptQuestions
          .reduce((sum, q) => sum + (Number(q.marks) || 0), 0);
      console.warn(
          `generateAssessment: rejected ${rejected} Master Bank question(s) ` +
        `whose activity is not permitted for band ${band.id}.`,
      );
      sourced = {
        ...sourced,
        questions: keptQuestions,
        fromBank: keptQuestions.length,
        marks: keptMarks,
      };
    }
  }

  // Marks the AI still needs to author. >= ~half by construction, so the model
  // is always called and always produces a coherent paper.
  const gapMarks = Math.max(1, inputs.totalMarks - sourced.marks);

  // The band's rules are rendered into the prompt from the resolved document
  // rather than written into the prompt file, so correcting a band in Firestore
  // changes what the model is told with no deploy and no prompt version bump. A
  // level with no band (an unrecognised grade token) contributes nothing and
  // the paper generates exactly as it did before.
  const bandDirective = buildBandDirective(band, gradeLabelFor(inputs.grade));

  const userPrompt = buildUserPrompt({
    ...inputs, totalMarks: gapMarks, questionTypes: effectiveTypes,
  }) +
    (bandDirective ? `\n\n${bandDirective}` : "") +
    buildAvoidNote(sourced.questions);

  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = ASSESSMENT_MODEL;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "assessment"},
      systemPrompt: SYSTEM_PROMPT,
      cbcContextBlock: contextBlock,
      formatContextBlock: formatBlock,
      messages: [{role: "user", content: userPrompt}],
      // Output budget scales with the marks the AI actually authors (the gap
      // after sourcing); ~130 tokens covers a question with options, answer and
      // marking guide; capped at 16k. Output tokens are billed as used.
      maxTokens: Math.min(16000, 3000 + gapMarks * 130),
      temperature: 0.4,
      model: ASSESSMENT_MODEL,
      // Streamed internally (tool deltas accumulate to the same parsed
      // object as mode:"tool"). Anthropic drops idle non-streaming
      // connections on long generations — large max_tokens without
      // streaming is exactly the case their docs warn about, and big
      // papers were dying with "AI is temporarily unavailable".
      mode: "stream",
      onToken: () => {},
      toolName: "emit_assessment",
      toolDescription:
        "Emit the complete assessment as a single structured object. Do " +
        "not include any prose or commentary outside this tool call.",
      toolInputSchema: ASSESSMENT_TOOL_SCHEMA,
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
    // The AI call failed with a hard throw — no usable assessment was returned.
    // Refund the credit or roll back the counter so the teacher is not charged
    // for a transient failure. Best-effort: must not mask the original error,
    // but a failed refund leaves the teacher's quota silently decremented, so
    // it must at least be traceable in the logs.
    try {
      await refundGeneration(uid, usage, "assessment");
    } catch (refundErr) {
      // Include the usage object: if the refund failed because it was
      // malformed, the log has to show what refundGeneration actually saw.
      console.error("[generateAssessment] refund failed after generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    try {
      await failAiOperation({idempotencyKey, err, usageCharged: 0});
    } catch (opErr) {
      // Best-effort — the original provider/refund error is what the
      // caller needs to see; a failed operation-record write just means
      // the durable audit trail is incomplete, not that anything was
      // double-charged (the meter refund above already ran).
      console.error("[generateAssessment] failAiOperation failed after generation error",
          {uid, generationId: genRef.id}, opErr);
    }
    throw err;
  }

  // Merge the Master Bank questions into the model's sections (by type), then
  // validate the combined paper — validateAssessment renumbers globally and
  // recomputes the marks totals, so the merged paper stays consistent.
  const mergedParsed = (parsed && typeof parsed === "object") ? {...parsed} : {};
  mergedParsed.sections = mergeSourcedIntoSections(mergedParsed.sections, sourced.questions);

  // Assessment Quality Checker (deterministic, no LLM). If the model grouped a
  // topic into a worksheet-style block AND the questions carry topic tags,
  // re-order them so topics rotate through the paper — BEFORE validation, so
  // validateAssessment renumbers the mixed sequence cleanly. Advisory only:
  // the remaining findings surface as non-blocking warnings, never a block.
  const requestedTopics = String(inputs.topic || "")
      .split(/[;\n]+/).map((t) => t.trim()).filter(Boolean);
  const preCheck = checkAssessmentQuality(mergedParsed,
      {grade: inputs.grade, topics: requestedTopics});
  let didReorder = false;
  if (preCheck.clustered && preCheck.topicsTagged) {
    mergedParsed.sections = interleaveSections(mergedParsed.sections);
    didReorder = true;
  }

  const validation = validateAssessment(mergedParsed);
  let assessment = validation.value;

  // Curriculum-context guard (§7–9): defence-in-depth against the model
  // echoing a DIFFERENT grade/subject/framework than the teacher selected, or
  // leaking framework-incompatible fields (CBC ↔ 2013/OBC). Input validation
  // (validateInputs → classifySubjectForGrade) already blocks a wrong request;
  // this catches a wrong RESPONSE. Fail-open on omitted coordinates, fail-closed
  // on contradiction. Advisory here — folded into the acceptance state below.
  const curriculumGuard = validateCurriculumContext({
    response: assessment,
    selected: {
      framework: inputs.framework,
      grade: inputs.grade,
      subject: inputs.subject,
    },
  });
  // Hard free-preview guarantee: never return more than the preview's
  // question cap, whatever the model produced (fail-closed on the revenue
  // boundary). Header marks are restamped from the kept questions.
  let previewTruncated = false;
  if (freePreview) {
    const clamped = clampAssessmentPreview(
        assessment, FREE_PREVIEW_LIMITS.maxShortTestQuestions);
    assessment = clamped.assessment;
    previewTruncated = clamped.truncated;
  }
  // Final report on the validated paper (post-reorder), persisted + returned so
  // the studio can surface the quality summary to the teacher.
  const quality = checkAssessmentQuality(assessment,
      {grade: inputs.grade, topics: requestedTopics});
  quality.reordered = didReorder;
  const totalQuestions = assessment.sections
      .reduce((sum, s) => sum + (s.questions ? s.questions.length : 0), 0);
  const sourcing = {
    fromBank: sourced.fromBank,
    generated: Math.max(0, totalQuestions - sourced.fromBank),
    marks: sourced.marks,
    scanned: sourced.scanned,
    aiCalled: true,
  };

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  const costUsdCents = Math.round(
      ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );

  // Combine the schema-validator verdict and the curriculum guard into one
  // acceptance state (§31). Schema failures are repairable errors; a curriculum
  // mismatch is a non-repairable critical (→ "rejected"). The state is recorded
  // for observability and to mark a paper that needs a human look; it never
  // relaxes the existing flagged/complete Firestore status the studio reads.
  const acceptanceIssues = [
    ...curriculumGuard.issues,
    ...(validation.ok ? [] : [{
      path: "(root)", code: "SCHEMA_INVALID",
      message: (validation.errors || []).join("; "),
      severity: "error", repairable: true,
    }]),
  ];
  const acceptanceStatus = deriveAcceptanceState({
    issues: acceptanceIssues, allowRepairReview: true,
  });
  const guardCritical = curriculumGuard.issues.some((i) => i.severity === "critical");
  // A wrong-curriculum RESPONSE must never be saved as a clean "complete" paper,
  // even if it happens to pass the shape validator — flag it for review.
  const forceFlag = guardCritical;

  if (!validation.ok || forceFlag) {
    const flagReasons = [
      validation.ok ? "" : `Schema errors: ${validation.errors.join("; ")}`,
      guardCritical ?
        `Curriculum mismatch: ${curriculumGuard.issues.map((i) => i.message).join("; ")}` : "",
    ].filter(Boolean).join(" | ");
    await genRef.update({
      status: "flagged",
      errorMessage: flagReasons,
      acceptanceStatus,
      curriculumIssues: curriculumGuard.issues,
      output: assessment,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn,
      tokensOut,
      costUsdCents,
      modelUsed,
      sourcing,
      quality,
    });
    // A "flagged" paper is still a real result the teacher already got and
    // was already billed for — this is a completion for idempotency
    // purposes, not a failure (no retry, no refund).
    try {
      await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
    } catch (opErr) {
      console.error("[generateAssessment] completeAiOperation failed (flagged)",
          {uid, generationId: genRef.id}, opErr);
    }
    return {
      generationId: genRef.id,
      assessment,
      usage,
      warning: [
        "Some fields were incomplete — please review.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch),
      sourcing,
      quality,
    };
  }

  await genRef.update({
    status: "complete",
    acceptanceStatus,
    curriculumIssues: curriculumGuard.issues,
    output: assessment,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    sourcing,
    quality,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  try {
    await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
  } catch (opErr) {
    // Best-effort — the teacher already has their paper; a failed
    // operation-record write only means a retry with this SAME key would
    // (harmlessly) re-run the reservation transaction and see "processing"
    // stuck, not that anything gets double-billed.
    console.error("[generateAssessment] completeAiOperation failed",
        {uid, generationId: genRef.id}, opErr);
  }

  return {
    generationId: genRef.id,
    assessment,
    usage,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch),
    sourcing,
    quality,
    // Free preview markers — the studio uses these to show the honest
    // "your short test is ready, upgrade for the full paper" prompt.
    preview: freePreview ? {
      maxQuestions: FREE_PREVIEW_LIMITS.maxShortTestQuestions,
      truncated: previewTruncated,
    } : null,
  };
}

function createGenerateAssessment(anthropicApiKeySecret) {
  return onCall(
      {secrets: [anthropicApiKeySecret], timeoutSeconds: 240,
        memory: "512MiB"},
      async (request) => {
        const uid = await assertVerifiedAuth(request, "Please sign in.");
        await assertGeneratorRateLimit(request, "assessment");
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
              "permission-denied",
              "Teacher tools are available to approved teachers only.",
          );
        }
        const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
        const idempotencyKey = request.data && request.data.idempotencyKey;
        return runAssessment({uid, rawInputs: request.data, apiKey, idempotencyKey});
      },
  );
}

module.exports = {
  createGenerateAssessment, runAssessment, sanitizeInputs,
  normalizeQuestionTypes,
  validateInputs, gradeLabelFor, subjectLabelFor,
  ALLOWED_SUBJECTS, ALLOWED_GRADES,
};
