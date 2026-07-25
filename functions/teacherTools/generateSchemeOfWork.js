/**
 * generateSchemeOfWork — HTTPS callable Cloud Function.
 *
 * Usage from client:
 *   const fn = httpsCallable(functions, 'generateSchemeOfWork');
 *   const result = await fn({
 *     grade: 'G5', subject: 'mathematics', term: 2, numberOfWeeks: 12,
 *     school: '...', teacherName: '...', language: 'english', instructions: ''
 *   });
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
const {callClaude, DEFAULT_MODEL} = require("./anthropicClient");

const {
  resolveCbcContext,
  resolveTermModuleOutline,
  classifySubjectForGrade,
  getOfficialSubjectsForGrade,
} = require("./cbcKnowledge");
const {validateSchemeOfWork} = require("./schemeOfWorkSchema");
const {buildSchemeQualityChecks} = require("./schemeQualityCheck");
const {PROMPT_VERSION, pickSystemPrompt, buildUserPrompt} =
  require("./schemeOfWorkPrompt");
const {assertAndIncrement, refundGeneration} = require("./usageMeter");
const {reserveAiOperation, completeAiOperation, failAiOperation} =
  require("../aiOperations");
const {isValidIdempotencyKey} = require("../aiOperationsCore");
const {FREE_PREVIEW_LIMITS} = require("./teacherPlans");
const {clampSchemePreview} = require("./freePreview");
const {resolveSchemeOutline} = require("./schemeCurriculumOutline");
const {sliceOutlineToTerm} = require("./schemeTermDivision");
const {
  sanitizeTimetableInput,
  summarizeTimetableForSubject,
} = require("./schemeTimetable");
const {buildSchemeAdvisories} = require("./schemeAdvisories");

/** "integrated_science" → "Integrated Science" for human-facing messages. */
function humanizeSubject(slug) {
  return String(slug || "").split("_").filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Permissive top-level shape — validateSchemeOfWork() does the strict
// checking. Tool mode forces an object response and removes "AI returned
// non-JSON output" parse failures.
const SCHEME_TOOL_SCHEMA = {
  type: "object",
  description: "A Zambian CBC scheme of work spanning the requested term.",
  additionalProperties: true,
};

const ALLOWED_GRADES = new Set([
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
  "F1", "F2", "F3", "F4",
]);
// Mirrors the frontend TEACHER_SUBJECTS list in src/utils/teacherTools.js.
const ALLOWED_SUBJECTS = new Set([
  "mathematics", "numeracy", "english", "literacy",
  "cinyanja", "zambian_language",
  "integrated_science", "environmental_science",
  "biology", "chemistry", "physics",
  "social_studies", "history", "geography", "civic_education",
  "religious_education",
  "technology_studies", "creative_and_technology_studies",
  "home_economics", "expressive_arts", "physical_education",
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
    term: Math.min(3, Math.max(1, Math.round(num(raw.term, 1)))),
    numberOfWeeks: Math.min(15, Math.max(6, Math.round(num(raw.numberOfWeeks, 12)))),
    // Academic year from the studio's calendar selector; clamped to the MoE
    // calendar range. Falls back to the current UTC year.
    year: Math.min(2035, Math.max(2024,
      Math.round(num(raw.year, new Date().getUTCFullYear())))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    teacherName: str(raw.teacherName, 80),
    school: str(raw.school, 120),
    instructions: str(raw.instructions, 500),
    // Optional: a trimmed copy of one of the teacher's saved Class Timetables
    // so the scheme can pace around the real week. null when not attached.
    timetable: sanitizeTimetableInput(raw.timetable),
    // Periods/time-per-week the studio derived from the 2023 Curriculum
    // Framework (or the teacher typed by hand) when no timetable is attached.
    // An attached timetable still wins over these in runSchemeOfWork.
    periodsPerWeek: str(raw.periodsPerWeek, 60),
    timePerWeek: str(raw.timePerWeek, 40),
    // Optional calendar week plan (School Calendar) — reserved exam/revision
    // weeks + dates the model paces around. Empty when the studio didn't send one.
    weekPlan: sanitizeWeekPlan(raw.weekPlan),
    // Optional teacher-approved topic backbone for THIS term (the reviewed &
    // edited plan from the studio's preview step). When present it drives the
    // sequencing directly; empty when the teacher generated without previewing.
    topicSelection: sanitizeTopicSelection(raw.topicSelection),
    // Teaching (delivery) weeks available per term — lets the server slice the
    // outline the same way the client preview did. Defaults applied downstream.
    weeksByTerm: sanitizeWeeksByTerm(raw.weeksByTerm),
    // Explicit curriculum chosen by the teacher — drives CBC vs Previous
    // prompt/terminology + framework-aware KB grounding. A whole-term scheme
    // has no single topic, but still branches on curriculum/framework.
    framework: String(raw.framework) === "2013" ? "2013" : "2023",
    curriculum: String(raw.curriculum || "").toLowerCase() === "previous" ?
      "previous" : "cbc",
  };
}

/** Trim a client-sent week plan to the few fields the prompt trusts. */
function sanitizeWeekPlan(raw) {
  if (!Array.isArray(raw)) return [];
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const roles = new Set(["teaching", "revision", "exam"]);
  return raw.slice(0, 20).map((w, i) => {
    const role = String(w && w.role || "teaching").toLowerCase();
    return {
      week: Number.isFinite(Number(w && w.week)) ? Math.round(Number(w.week)) : i + 1,
      role: roles.has(role) ? role : "teaching",
      beginning: str(w && w.beginning, 24),
      ending: str(w && w.ending, 24),
      holidays: Array.isArray(w && w.holidays) ?
        w.holidays.filter((h) => typeof h === "string").slice(0, 5).map((h) => str(h, 40)) : [],
    };
  });
}

/**
 * Trim a client-sent teacher-approved topic selection to the fields the prompt
 * trusts. Caps the list length and each topic's sub-topics so a hostile client
 * can't balloon the prompt.
 */
function sanitizeTopicSelection(raw) {
  if (!Array.isArray(raw)) return [];
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  return raw.slice(0, 40).map((t) => ({
    topic: str(t && t.topic, 160),
    subtopics: Array.isArray(t && t.subtopics) ?
      t.subtopics.filter((s) => typeof s === "string")
          .slice(0, 12).map((s) => str(s, 160)) : [],
    weeks: Math.min(6, Math.max(1,
        Number.isFinite(Number(t && t.weeks)) ? Math.round(Number(t.weeks)) : 1)),
    isRevision: Boolean(t && t.isRevision),
  })).filter((t) => t.topic);
}

/** Trim the per-term teaching-week counts to a sane {1,2,3} map or null. */
function sanitizeWeeksByTerm(raw) {
  if (!raw || typeof raw !== "object") return null;
  const val = (t) => {
    const n = Number(raw[t]);
    return Number.isFinite(n) && n > 0 ? Math.min(20, Math.round(n)) : undefined;
  };
  const out = {};
  for (const t of [1, 2, 3]) {
    const v = val(t);
    if (v !== undefined) out[t] = v;
  }
  return Object.keys(out).length ? out : null;
}

function validateInputs(inputs) {
  const errs = [];
  if (!inputs.grade || !ALLOWED_GRADES.has(inputs.grade)) {
    errs.push("Please select a grade from ECE–G12.");
  }
  if (!inputs.subject || !ALLOWED_SUBJECTS.has(inputs.subject)) {
    errs.push("Please select a supported subject.");
  }
  return errs;
}

/**
 * Reconstruct the client-facing response for an idempotency key that already
 * completed (a duplicate/retried request must return the existing result, never
 * call the provider again). Reads the persisted aiGenerations doc rather than
 * re-deriving anything. Mirrors generateHomework's resume path.
 */
async function buildResumedSchemeResponse(operation) {
  const genId = operation.resultDocumentId;
  const genSnap = genId ?
    await admin.firestore().collection("aiGenerations").doc(genId).get() : null;
  const genData = genSnap && genSnap.exists ? genSnap.data() : null;
  return {
    generationId: genId,
    schemeOfWork: genData ? genData.output : null,
    usage: null,
    advisories: genData && genData.advisories ? genData.advisories : [],
    curriculumSource: genData ? genData.curriculumSource : null,
    qualityChecks: genData && genData.qualityChecks ? genData.qualityChecks : null,
    warning: genData && genData.status === "flagged" ?
      "Some fields were incomplete — please review." : null,
    kbGrounded: Boolean(genData && genData.kbVersion),
    preview: null,
    resumed: true,
  };
}

async function runSchemeOfWork({uid, rawInputs, apiKey, idempotencyKey}) {
  const inputs = sanitizeInputs(rawInputs || {});
  const inputErrors = validateInputs(inputs);
  if (inputErrors.length > 0) {
    throw new HttpsError("invalid-argument", inputErrors.join(" "));
  }

  // Idempotency reservation. Only engaged when the client sends a valid key —
  // without one the flow is byte-for-byte the old behaviour (random doc id, no
  // reservation), so this is a safe, no-frontend-breakage rollout: a
  // double-click / rapid tap / retried timeout from a key-sending client can
  // never reach the provider or the usage meter twice; a legacy caller is
  // unaffected. `inputs` is the canonical fingerprint.
  const idemActive = isValidIdempotencyKey(idempotencyKey);
  if (idemActive) {
    const reservation = await reserveAiOperation({
      uid,
      idempotencyKey,
      operationType: "generate_scheme_of_work",
      fingerprintInput: inputs,
    });
    if (reservation.status === "completed") {
      return buildResumedSchemeResponse(reservation.operation);
    }
    if (reservation.status === "processing") {
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
    // "created" or "retrying" — exactly one provider call happens below.
  }

  // CBC context — scheme-of-work uses the broad grade+subject context,
  // not a specific topic, so we pass the term as the topic anchor. The
  // curriculum OUTLINE (Syllabi Studio → seed → admin overlay, with uploaded
  // modules folded in) is the authoritative topic list; the context block is
  // the supplemental grounding (and the uploaded-module fallback path).
  const [{contextBlock, kbMatch, kbWarning, kbVersion}, outline, termOutline] =
    await Promise.all([
      resolveCbcContext({
        grade: inputs.grade,
        subject: inputs.subject,
        topic: `Term ${inputs.term} overview`,
        subtopic: "",
        framework: inputs.framework,
      }),
      resolveSchemeOutline({
        grade: inputs.grade,
        subject: inputs.subject,
        term: inputs.term,
        framework: inputs.framework,
        weeksByTerm: inputs.weeksByTerm,
      }),
      // Uploaded curriculum modules arranged at term level — the backup
      // source. The per-sub-topic module lookup can't fire for a whole-term
      // scheme, so this term-level lookup is how a scheme reaches modules.
      // The uploaded-module KB is 2023-CBC only, so a Previous (2013) scheme
      // skips it — grounding a 2013 scheme on CBC modules would mix
      // curricula, which the v2 prompts forbid.
      inputs.framework === "2013" ? Promise.resolve(null) :
        resolveTermModuleOutline({
          grade: inputs.grade,
          subject: inputs.subject,
          term: inputs.term,
        }),
    ]);

  // Source precedence (per spec): Syllabi Studio is the MAIN source; an
  // uploaded module is the BACKUP, used only where the Syllabi outline is
  // missing. That keeps the prompt from carrying two competing "authoritative"
  // topic lists for the common case where Syllabi data already covers it.
  const moduleGrounded = Boolean(termOutline) && outline.topicCount === 0;

  // Where the scheme's topics ultimately come from, for the provenance badge.
  const curriculumSource = outline.topicCount > 0 ?
    "syllabi_studio" :
    ((moduleGrounded || kbMatch) ? "uploaded_module" : "ai_inferred");

  // Timetable awareness — pace the term around the teacher's real week.
  // Precedence for the period allocation: an attached Class Timetable wins,
  // then the framework/manual value the studio derived, else blank.
  const timetableSummary = inputs.timetable ?
    summarizeTimetableForSubject(inputs.timetable, inputs.subject) : null;
  const periodsPerWeek = timetableSummary && timetableSummary.found &&
    timetableSummary.periods > 0 ?
    `${timetableSummary.periods} period${timetableSummary.periods === 1 ? "" : "s"} per week` :
    (inputs.periodsPerWeek || "");
  const teachingDays = timetableSummary ? timetableSummary.days : [];

  // Curriculum advisories — flag mismatches between curriculum, timetable and
  // the chosen week/term shape. Deterministic; surfaced to the teacher.
  const subjectLabel = humanizeSubject(inputs.subject);
  const advisories = buildSchemeAdvisories({
    grade: inputs.grade,
    subject: inputs.subject,
    subjectLabel,
    term: inputs.term,
    numberOfWeeks: inputs.numberOfWeeks,
    classification: classifySubjectForGrade(inputs.grade, inputs.subject),
    officialSubjects: getOfficialSubjectsForGrade(inputs.grade),
    outline,
    timetableSummary,
  });

  // Grounding order: Syllabi Studio outline (primary) → supplemental CBC
  // context → uploaded term-module outline (backup, only when no Syllabi
  // outline). Everything the model needs so it sequences real topics.
  const fullContextBlock = [
    outline.block,
    contextBlock,
    moduleGrounded ? termOutline.outlineBlock : "",
  ].filter(Boolean).join("\n\n");

  const usage = await assertAndIncrement(uid, "scheme_of_work");

  // Free preview (§12–13): a free scheme covers only the first
  // FREE_PREVIEW_LIMITS.schemePreviewWeeks weeks of the term. Clamping the
  // inputs steers the prompt (buildUserPrompt reads numberOfWeeks/weekPlan
  // below); the hard guarantee is the output truncation after validation.
  const freePreview = usage.plan === "free";
  if (freePreview) {
    const previewWeeks = FREE_PREVIEW_LIMITS.schemePreviewWeeks;
    inputs.numberOfWeeks = Math.min(inputs.numberOfWeeks, previewWeeks);
    if (Array.isArray(inputs.weekPlan)) {
      inputs.weekPlan = inputs.weekPlan.slice(0, previewWeeks);
    }
  }

  // Deterministic doc id (= the idempotency key) when idempotency is active, so
  // a retry of the SAME logical request re-set()s this exact doc instead of
  // creating a sibling, and the resumed-completed path reads it straight back
  // by id. Random id otherwise (legacy behaviour).
  const genRef = idemActive ?
    admin.firestore().collection("aiGenerations").doc(idempotencyKey) :
    admin.firestore().collection("aiGenerations").doc();
  await genRef.set({
    ownerUid: uid,
    tool: "scheme_of_work",
    inputs,
    output: null,
    outputText: "",
    advisories,
    curriculumSource,
    modelUsed: "claude-sonnet-4-6",
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
    ...inputs,
    periodsPerWeek,
    teachingDays,
    weekPlan: inputs.weekPlan,
    hasOutline: outline.topicCount > 0,
    hasModuleOutline: moduleGrounded,
  });
  let parsed = null;
  let raw = "";
  let usageInfo = {inputTokens: 0, outputTokens: 0};
  let modelUsed = DEFAULT_MODEL;
  try {
    const response = await callClaude(apiKey, {
      track: {uid, tool: "schemeOfWork"},
      systemPrompt: pickSystemPrompt(inputs),
      cbcContextBlock: fullContextBlock,
      messages: [{role: "user", content: userPrompt}],
      maxTokens: 8000,   // schemes are long
      temperature: 0.3,
      mode: "tool",
      toolName: "emit_scheme_of_work",
      toolDescription:
        "Emit the complete scheme of work as a single structured object. " +
        "Do not include any prose or commentary outside this tool call.",
      toolInputSchema: SCHEME_TOOL_SCHEMA,
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
    // Hard throw from the AI call — no usable scheme was returned. Refund the
    // credit / roll back the counter so the teacher is not charged for a
    // transient failure. Best-effort: must not mask the original error.
    try {
      await refundGeneration(uid, usage, "scheme_of_work");
    } catch (refundErr) {
      console.error("[generateSchemeOfWork] refund failed after generation error",
          {uid, generationId: genRef.id, usage}, refundErr);
    }
    if (idemActive) {
      try {
        await failAiOperation({idempotencyKey, err, usageCharged: 0});
      } catch (opErr) {
        console.error("[generateSchemeOfWork] failAiOperation failed after generation error",
            {uid, generationId: genRef.id}, opErr);
      }
    }
    throw err;
  }

  const validation = validateSchemeOfWork(parsed);
  let scheme = validation.value;
  // Hard free-preview guarantee: never return more than the preview weeks,
  // whatever the model produced (fail-closed on the revenue boundary).
  let previewTruncated = false;
  if (freePreview) {
    const clamped = clampSchemePreview(
      scheme, FREE_PREVIEW_LIMITS.schemePreviewWeeks);
    scheme = clamped.scheme;
    previewTruncated = clamped.truncated;
  }
  // The form already knows these — never trust the model with them (it
  // has invented "UNKNOWN" for a blank school and last year's date).
  scheme.header.school = inputs.school;
  scheme.header.teacherName = inputs.teacherName;
  const eceHeaderLabels = {
    ECE: "ECE",
    ECE_N: "ECE Nursery (3-4)",
    ECE_R: "ECE Reception (4-5)",
  };
  scheme.header.grade = eceHeaderLabels[inputs.grade] ||
    inputs.grade.replace(/^G/i, "");
  scheme.header.term = inputs.term;
  scheme.header.numberOfWeeks = inputs.numberOfWeeks;
  scheme.header.year = String(inputs.year || new Date().getUTCFullYear());
  // Curriculum drives the printed column set (CBC 9-col vs OBC 7-col). Stamp
  // it from the teacher's explicit choice, never the model's guess.
  scheme.header.curriculum = inputs.curriculum === "previous" ? "obc" : "cbc";
  // Timetable is the source of truth for the period allocation + days when one
  // is attached — never let the model override the teacher's real schedule.
  if (periodsPerWeek) scheme.header.periodsPerWeek = periodsPerWeek;
  if (teachingDays && teachingDays.length) {
    scheme.header.teachingDays = teachingDays;
  }
  // Provenance the view + exporters surface ("From Syllabi Studio", etc.).
  scheme.curriculumSource = curriculumSource;
  // Deterministic quality checklist (header/week numbering/filled cells/
  // class tests/revision + exam placement/filler) — informational, surfaced
  // as the studio's "Quality checks" panel so the teacher knows what to review.
  const qualityChecks = buildSchemeQualityChecks(scheme);
  if (!validation.ok) {
    await genRef.update({
      status: "flagged",
      errorMessage: `Schema errors: ${validation.errors.join("; ")}`,
      output: scheme,
      outputText: String(raw || "").slice(0, 20000),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      tokensIn: Number(usageInfo.inputTokens || 0),
      tokensOut: Number(usageInfo.outputTokens || 0),
      modelUsed,
      qualityChecks,
    });
    // A "flagged" scheme is still a real result the teacher already got and was
    // billed for — a completion for idempotency purposes, not a failure.
    if (idemActive) {
      try {
        await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
      } catch (opErr) {
        console.error("[generateSchemeOfWork] completeAiOperation failed (flagged)",
            {uid, generationId: genRef.id}, opErr);
      }
    }
    return {
      generationId: genRef.id,
      schemeOfWork: scheme,
      usage,
      advisories,
      curriculumSource,
      qualityChecks,
      warning: [
        "Some fields were incomplete — please review.",
        kbWarning,
      ].filter(Boolean).join(" "),
      kbGrounded: Boolean(kbMatch) || moduleGrounded,
      preview: freePreview ? {
        weeks: FREE_PREVIEW_LIMITS.schemePreviewWeeks,
        truncated: previewTruncated,
      } : null,
    };
  }

  const tokensIn = Number(usageInfo.inputTokens || 0);
  const tokensOut = Number(usageInfo.outputTokens || 0);
  const costUsdCents = Math.round(
    ((tokensIn / 1e6) * 300) + ((tokensOut / 1e6) * 1500),
  );
  await genRef.update({
    status: "complete",
    output: scheme,
    outputText: String(raw || "").slice(0, 20000),
    tokensIn,
    tokensOut,
    costUsdCents,
    modelUsed,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    qualityChecks,
  });
  if (idemActive) {
    try {
      await completeAiOperation({idempotencyKey, resultDocumentId: genRef.id, usageCharged: 1});
    } catch (opErr) {
      console.error("[generateSchemeOfWork] completeAiOperation failed",
          {uid, generationId: genRef.id}, opErr);
    }
  }

  return {
    generationId: genRef.id,
    schemeOfWork: scheme,
    usage,
    advisories,
    curriculumSource,
    qualityChecks,
    warning: kbWarning || null,
    kbGrounded: Boolean(kbMatch) || moduleGrounded,
    // Free preview markers — the studio uses these to show the honest
    // "your first weeks are ready, upgrade for the full term" prompt.
    preview: freePreview ? {
      weeks: FREE_PREVIEW_LIMITS.schemePreviewWeeks,
      truncated: previewTruncated,
    } : null,
  };
}

function createGenerateSchemeOfWork(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 180, memory: "512MiB"},
    async (request) => {
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      await assertGeneratorRateLimit(request, "scheme_of_work");
      const role = await getUserRole(uid);
      if (!isStaffRole(role)) {
        throw new HttpsError(
          "permission-denied",
          "Teacher tools are available to approved teachers only.",
        );
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const idempotencyKey = request.data && request.data.idempotencyKey;
      return runSchemeOfWork({uid, rawInputs: request.data, apiKey, idempotencyKey});
    },
  );
}

module.exports = {createGenerateSchemeOfWork, runSchemeOfWork};
