/**
 * extractAssessmentFormat — admin-only HTTPS callable.
 *
 * Phase 2 of the Zambian assessment-format pipeline: runs Claude over a
 * sample Zambian assessment paper and distils a FORMAT PROFILE draft
 * (structure, instruction wording, numbering, marks conventions,
 * paraphrased exemplars — never transcribed content; see the system
 * prompt in assessmentFormatExtractHelpers.js).
 *
 * Sources, one of:
 *   { paperId }     — an existing pastPapers/{paperId} doc (PDF / DOCX /
 *                     scanned images), loaded through the same
 *                     pickSources/buildMessageBlocks path as the
 *                     past-paper question importer.
 *   { storagePath } — a file the admin uploaded directly to
 *                     assessment-format-samples/{uid}/… (.pdf or .docx;
 *                     storage.rules gate the write).
 *
 * The draft lands in cbcKnowledgeBase/{activeVersion}/
 * assessmentFormatDrafts/{autoId} with status:'draft' — the resolver
 * ignores drafts, so nothing reaches teachers until an admin reviews and
 * approves it into assessmentFormats/ from the CBC KB page.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getAnthropicApiKey, getUserRole} = require("../aiService");
const {callClaude} = require("./anthropicClient");
const {getActiveKbVersion} = require("./cbcKnowledge");
const {
  loadPaperOrThrow, pickSources, buildMessageBlocks,
} = require("./pastPaperImport");
const {
  sanitiseSamplePath,
  sourceForSamplePath,
  FORMAT_PROFILE_TOOL_SCHEMA,
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
  buildDraftFromExtraction,
  isLikelyContentImage,
  buildStagedPictureDoc,
  extOf,
  MAX_IMAGES_PER_PAPER,
} = require("./assessmentFormatExtractHelpers");

const EXTRACT_MODEL =
  process.env.ASSESSMENT_FORMAT_EXTRACT_MODEL || "claude-sonnet-4-6";

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

/**
 * Pull embedded images out of a DOCX sample and stage them in the
 * picture bank (status:'staged') for the admin to tag or discard. Best
 * effort — a failure here never fails the format extraction itself.
 * Returns the number of images staged.
 */
async function stageDocxImages({
  source, draftId, subject, gradeBand, sourceNote, uid,
}) {
  if (!source || source.kind !== "docx") return 0;
  try {
    // adm-zip reads the DOCX container directly; mammoth (used for the
    // text path) doesn't expose raw media entries.
    const AdmZip = require("adm-zip");
    const [buf] = await admin.storage().bucket()
      .file(source.path).download();
    const zip = new AdmZip(buf);
    const media = zip.getEntries()
      .filter((e) => e.entryName.startsWith("word/media/") && !e.isDirectory)
      .map((e) => ({name: e.entryName, byteLength: e.header.size, entry: e}))
      .filter(isLikelyContentImage)
      .slice(0, MAX_IMAGES_PER_PAPER);
    if (media.length === 0) return 0;

    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    let staged = 0;
    for (let i = 0; i < media.length; i++) {
      const m = media[i];
      const ext = extOf(m.name);
      const docRef = db.collection("pictureBank").doc();
      const storagePath =
        `picture-bank/staged/${draftId}/${docRef.id}.${ext}`;
      const doc = buildStagedPictureDoc({
        index: i, ext, storagePath, subject, gradeBand, draftId,
        sourceNote, uid,
      });
      await bucket.file(storagePath).save(m.entry.getData(), {
        contentType: doc.contentType,
        resumable: false,
      });
      await docRef.set({
        ...doc,
        id: docRef.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      staged += 1;
    }
    return staged;
  } catch (err) {
    console.warn("[extractAssessmentFormat] image staging failed",
      err && err.message);
    return 0;
  }
}

async function runExtractAssessmentFormat({uid, data, apiKey}) {
  const paperId = data && data.paperId ? String(data.paperId) : "";
  const storagePath = data && data.storagePath ?
    String(data.storagePath) : "";
  const assessmentType = String(data && data.assessmentType || "")
    .toLowerCase();
  const gradeBand = String(data && data.gradeBand || "").toLowerCase();
  const subject = String(data && data.subject || "_generic").toLowerCase();

  const {source, sourceNote} = await resolveSource({paperId, storagePath});
  const {blocks, droppedForSize, extraNote} =
    await buildMessageBlocks(source);

  const result = await callClaude(apiKey, {
    systemPrompt: EXTRACT_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        ...blocks,
        {
          type: "text",
          text: buildExtractUserPrompt({assessmentType, gradeBand, subject}),
        },
      ],
    }],
    model: EXTRACT_MODEL,
    maxTokens: 6000,
    temperature: 0.2,
    mode: "tool",
    toolName: "emit_format_profile",
    toolDescription:
      "Emit the distilled assessment format profile as a single " +
      "structured object.",
    toolInputSchema: FORMAT_PROFILE_TOOL_SCHEMA,
  });

  const built = buildDraftFromExtraction({
    extracted: result.parsed,
    assessmentType,
    gradeBand,
    subject,
    sourceKind: source.kind,
    sourceNote,
  });
  if (built.error) {
    throw new HttpsError("invalid-argument", built.error);
  }

  const kbVersion = await getActiveKbVersion();
  const draftRef = admin.firestore()
    .collection("cbcKnowledgeBase").doc(kbVersion)
    .collection("assessmentFormatDrafts").doc();
  await draftRef.set({
    ...built.draft,
    draftId: draftRef.id,
    extractedBy: uid,
    sourcePaperId: paperId || null,
    sourceStoragePath: storagePath || null,
    sourceKind: source.kind,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Stage any embedded teaching figures into the picture bank for admin
  // tagging. DOCX only — PDFs would need rasterising, which is a separate
  // project. Best effort; never blocks the format draft.
  const imagesStaged = await stageDocxImages({
    source,
    draftId: draftRef.id,
    subject,
    gradeBand,
    sourceNote,
    uid,
  });

  // Cost tracking + audit trail, same shape as the past-paper importer.
  try {
    await admin.firestore().collection("aiGenerations").add({
      kind: "assessment_format_extract",
      draftId: draftRef.id,
      paperId: paperId || null,
      storagePath: storagePath || null,
      uid,
      modelUsed: result.model || EXTRACT_MODEL,
      sourceKind: source.kind,
      tokensIn: Number(result.usage && result.usage.inputTokens || 0),
      tokensOut: Number(result.usage && result.usage.outputTokens || 0),
      validationErrorCount: built.validationErrors.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("[extractAssessmentFormat] usage log failed",
      err && err.message);
  }

  const warnings = [];
  if (droppedForSize > 0) {
    warnings.push(`${droppedForSize} page(s) skipped (over 5MB each).`);
  }
  if (extraNote) warnings.push(extraNote);
  if (built.validationErrors.length > 0) {
    warnings.push("The draft needs fixes before it can be approved: " +
      built.validationErrors.join("; "));
  }
  if (imagesStaged > 0) {
    warnings.push(`${imagesStaged} embedded image(s) staged in the ` +
      "picture bank for tagging.");
  }

  return {
    draftId: draftRef.id,
    draft: built.draft,
    validationErrors: built.validationErrors,
    imagesStaged,
    usage: result.usage || null,
    warning: warnings.length ? warnings.join(" ") : null,
  };
}

function createExtractAssessmentFormat(anthropicApiKeySecret) {
  return onCall(
    {
      secrets: [anthropicApiKeySecret],
      timeoutSeconds: 300,
      // PDF content blocks are held in memory before going to Anthropic
      // (a 30MB PDF base64-encodes to ~40MB) — same budget as the
      // past-paper importer.
      memory: "1GiB",
    },
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
      const role = await getUserRole(uid);
      if (role !== "admin") {
        throw new HttpsError("permission-denied", "Admin only.");
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      return runExtractAssessmentFormat({uid, data: request.data, apiKey});
    },
  );
}

module.exports = {createExtractAssessmentFormat, runExtractAssessmentFormat};
