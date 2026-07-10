/**
 * Exam Paper Library callables — admin-only.
 *
 *   analyzeExamPaper            — runs Claude over ONE uploaded real paper
 *                                 (PDF gives the model the page images via
 *                                 the document API; DOCX is read as text)
 *                                 and stores a structured per-paper analysis
 *                                 in cbcKnowledgeBase/{version}/
 *                                 examPaperSamples/{autoId}. Each paper keeps
 *                                 its own doc, so a whole corpus accumulates.
 *
 *   synthesizeAssessmentFormat  — merges every analysed sample for a
 *                                 (type, band, subject) into ONE consolidated
 *                                 format-profile draft in
 *                                 assessmentFormatDrafts/{autoId}, which the
 *                                 admin reviews and approves into
 *                                 assessmentFormats/ from the CBC KB page —
 *                                 the same human gate manual profiles pass.
 *
 * Reuses the past-paper / format-sample source machinery so downloads, size
 * caps and DOCX→text extraction behave identically to the rest of the app.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getAnthropicApiKey, getUserRole} = require("../aiService");
const {callClaude} = require("./anthropicClient");
const {getActiveKbVersion} = require("./cbcKnowledge");
const {
  ASSESSMENT_TYPES,
  GRADE_BANDS,
  validateFormatProfile,
} = require("./assessmentFormats");
const {
  loadPaperOrThrow, pickSources, buildMessageBlocks,
} = require("./pastPaperImport");
const {
  sanitiseSamplePath, sourceForSamplePath,
} = require("./assessmentFormatExtractHelpers");
const {
  normalizeSampleMeta,
  normalizeSubjectKey,
  ANALYSIS_TOOL_SCHEMA,
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  normalizeAnalysis,
  SYNTHESIS_TOOL_SCHEMA,
  SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserPrompt,
  buildSynthesisDraft,
} = require("./examPaperLibraryHelpers");

const ANALYZE_MODEL =
  process.env.ASSESSMENT_FORMAT_EXTRACT_MODEL || "claude-sonnet-4-6";
// Bound synthesis token cost: the most recent N analysed samples are plenty
// to characterise a paper kind; older ones rarely change the house style.
const MAX_SYNTHESIS_SAMPLES = 12;

async function resolveSource({paperId, storagePath}) {
  if (paperId) {
    const paper = await loadPaperOrThrow(paperId);
    const source = pickSources(paper);
    if (!source) {
      throw new HttpsError("failed-precondition",
        "This past paper has no uploaded files. Add a PDF, Word " +
        "document, or scanned images first.");
    }
    const noteBits = [paper.title, paper.grade, paper.subject, paper.year]
      .filter(Boolean).join(" · ");
    return {source, sourceNote: noteBits || `past paper ${paperId}`};
  }
  const path = sanitiseSamplePath(storagePath);
  if (!path) {
    throw new HttpsError("invalid-argument",
      "Provide a paperId or an assessment-format-samples/… path to a " +
      ".pdf or .docx file.");
  }
  const source = sourceForSamplePath(path);
  return {source, sourceNote: path.split("/").pop() || "uploaded sample"};
}

// ── analyzeExamPaper ─────────────────────────────────────────────────────

async function runAnalyzeExamPaper({uid, data, apiKey}) {
  const paperId = data && data.paperId ? String(data.paperId) : "";
  const storagePath = data && data.storagePath ? String(data.storagePath) : "";

  const {meta, error} = normalizeSampleMeta(data || {});
  if (error) throw new HttpsError("invalid-argument", error);

  const {source, sourceNote} = await resolveSource({paperId, storagePath});
  const {blocks, droppedForSize, extraNote} = await buildMessageBlocks(source);

  const result = await callClaude(apiKey, {
    track: {uid, tool: "examPaperAnalyze"},
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        ...blocks,
        {type: "text", text: buildAnalysisUserPrompt(meta)},
      ],
    }],
    model: ANALYZE_MODEL,
    maxTokens: 6000,
    temperature: 0.2,
    mode: "tool",
    toolName: "emit_paper_analysis",
    toolDescription:
      "Emit the structured analysis of this assessment paper as a single " +
      "object.",
    toolInputSchema: ANALYSIS_TOOL_SCHEMA,
  });

  const {analysis, warnings: analysisWarnings} =
    normalizeAnalysis(result.parsed);

  const kbVersion = await getActiveKbVersion();
  const sampleRef = admin.firestore()
    .collection("cbcKnowledgeBase").doc(kbVersion)
    .collection("examPaperSamples").doc();
  await sampleRef.set({
    id: sampleRef.id,
    ...meta,
    analysis,
    status: "analyzed",
    sourceKind: source.kind,
    sourcePaperId: paperId || null,
    sourceStoragePath: storagePath || null,
    sourceNote: String(sourceNote || "").slice(0, 300),
    analysisWarnings,
    uploadedBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    await admin.firestore().collection("aiGenerations").add({
      kind: "exam_paper_analysis",
      sampleId: sampleRef.id,
      grade: meta.grade,
      subject: meta.subject,
      assessmentType: meta.assessmentType,
      uid,
      modelUsed: result.model || ANALYZE_MODEL,
      sourceKind: source.kind,
      tokensIn: Number(result.usage && result.usage.inputTokens || 0),
      tokensOut: Number(result.usage && result.usage.outputTokens || 0),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("[analyzeExamPaper] usage log failed", err && err.message);
  }

  const warnings = [...analysisWarnings];
  if (droppedForSize > 0) {
    warnings.push(`${droppedForSize} page(s) skipped (over 5MB each).`);
  }
  if (extraNote) warnings.push(extraNote);

  return {
    sampleId: sampleRef.id,
    grade: meta.grade,
    gradeBand: meta.gradeBand,
    subject: meta.subject,
    assessmentType: meta.assessmentType,
    analysis,
    usage: result.usage || null,
    warning: warnings.length ? warnings.join(" ") : null,
  };
}

// ── synthesizeAssessmentFormat ───────────────────────────────────────────

async function runSynthesizeAssessmentFormat({uid, data, apiKey}) {
  const assessmentType = String(data && data.assessmentType || "")
    .toLowerCase().trim();
  const gradeBand = String(data && data.gradeBand || "").toLowerCase().trim();
  const subject = normalizeSubjectKey(data && data.subject);
  if (!ASSESSMENT_TYPES.includes(assessmentType)) {
    throw new HttpsError("invalid-argument", "Pick a valid assessment type.");
  }
  if (!GRADE_BANDS.includes(gradeBand)) {
    throw new HttpsError("invalid-argument", "Pick a valid grade band.");
  }

  const kbVersion = await getActiveKbVersion();
  // examPaperSamples is an admin-curated collection of modest size; reading
  // it whole and filtering in memory avoids a composite index, same as the
  // topics/formats reads elsewhere in this codebase.
  const snap = await admin.firestore()
    .collection("cbcKnowledgeBase").doc(kbVersion)
    .collection("examPaperSamples").get();
  const matches = snap.docs
    .map((d) => ({id: d.id, ...(d.data() || {})}))
    .filter((s) => s.assessmentType === assessmentType &&
      s.gradeBand === gradeBand && s.subject === subject)
    .sort((a, b) => {
      const at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return bt - at;
    });

  if (matches.length === 0) {
    throw new HttpsError("failed-precondition",
      "No analysed papers for this assessment type, band and subject yet. " +
      "Upload and analyse at least one paper first.");
  }
  const samples = matches.slice(0, MAX_SYNTHESIS_SAMPLES);

  const result = await callClaude(apiKey, {
    track: {uid, tool: "examPaperFormat"},
    systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: buildSynthesisUserPrompt(samples,
          {assessmentType, gradeBand, subject}),
      }],
    }],
    model: ANALYZE_MODEL,
    maxTokens: 6000,
    temperature: 0.2,
    mode: "tool",
    toolName: "emit_format_profile",
    toolDescription:
      "Emit the consolidated assessment format profile as a single object.",
    toolInputSchema: SYNTHESIS_TOOL_SCHEMA,
  });

  const built = buildSynthesisDraft({
    extracted: result.parsed,
    assessmentType,
    gradeBand,
    subject,
    sampleCount: samples.length,
  });
  if (built.error) throw new HttpsError("invalid-argument", built.error);

  const check = validateFormatProfile(built.candidate);

  const draftRef = admin.firestore()
    .collection("cbcKnowledgeBase").doc(kbVersion)
    .collection("assessmentFormatDrafts").doc();
  await draftRef.set({
    ...check.value,
    status: "draft",
    validationErrors: check.errors,
    draftId: draftRef.id,
    origin: "library_synthesis",
    synthesizedFromCount: samples.length,
    synthesizedFromIds: samples.map((s) => s.id),
    extractedBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    await admin.firestore().collection("aiGenerations").add({
      kind: "assessment_format_synthesis",
      draftId: draftRef.id,
      assessmentType,
      gradeBand,
      subject,
      sampleCount: samples.length,
      uid,
      modelUsed: result.model || ANALYZE_MODEL,
      tokensIn: Number(result.usage && result.usage.inputTokens || 0),
      tokensOut: Number(result.usage && result.usage.outputTokens || 0),
      validationErrorCount: check.errors.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("[synthesizeAssessmentFormat] usage log failed",
      err && err.message);
  }

  const warnings = [];
  if (matches.length > samples.length) {
    warnings.push(`Used the ${samples.length} most recent of ` +
      `${matches.length} matching papers.`);
  }
  if (check.errors.length > 0) {
    warnings.push("The draft needs fixes before it can be approved: " +
      check.errors.join("; "));
  }

  return {
    draftId: draftRef.id,
    draft: {...check.value, draftId: draftRef.id, status: "draft"},
    validationErrors: check.errors,
    sampleCount: samples.length,
    matchedCount: matches.length,
    warning: warnings.length ? warnings.join(" ") : null,
  };
}

// ── Wiring ───────────────────────────────────────────────────────────────

function assertAdmin(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  return uid;
}

function createAnalyzeExamPaper(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 300, memory: "1GiB"},
    async (request) => {
      const uid = assertAdmin(request);
      if ((await getUserRole(uid)) !== "admin") {
        throw new HttpsError("permission-denied", "Admin only.");
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      return runAnalyzeExamPaper({uid, data: request.data, apiKey});
    },
  );
}

function createSynthesizeAssessmentFormat(anthropicApiKeySecret) {
  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 300, memory: "512MiB"},
    async (request) => {
      const uid = assertAdmin(request);
      if ((await getUserRole(uid)) !== "admin") {
        throw new HttpsError("permission-denied", "Admin only.");
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      return runSynthesizeAssessmentFormat({uid, data: request.data, apiKey});
    },
  );
}

module.exports = {
  createAnalyzeExamPaper,
  createSynthesizeAssessmentFormat,
  runAnalyzeExamPaper,
  runSynthesizeAssessmentFormat,
};
