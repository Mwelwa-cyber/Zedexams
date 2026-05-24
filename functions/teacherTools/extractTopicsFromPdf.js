/**
 * extractTopicsFromPdf — admin-only PDF syllabus → CBC KB extractor.
 *
 * The existing parseSyllabusUpload Storage trigger only handles XLSX
 * workbooks. The CDC publishes most national syllabi as PDFs, so admins
 * had no way to feed a PDF document into the knowledge base without
 * manually retyping it.
 *
 * This callable closes that gap:
 *   1. Admin uploads the PDF to Storage at syllabus-uploads-pdf/{version}/
 *   2. Admin calls this with { storagePath, grade, subject, version }
 *   3. We download the PDF, extract text with pdf-parse, send a capped
 *      slice to Claude with a strict JSON tool schema asking for topics
 *      that match the cbcKnowledgeBase/{version}/draftTopics/* shape.
 *   4. We write each extracted topic as a draftTopic. The existing
 *      CurriculumReplaceStudio approve flow handles promotion to
 *      live topics.
 *   5. We write an uploadStatus doc so the admin UI can show progress
 *      next to the XLSX uploads.
 *
 * Cost controls: PDF text is truncated to PDF_TEXT_LIMIT chars before
 * the LLM call. Per-call cost is metered against the calling admin via
 * assertDailyLimit so a runaway upload can't burn unbounded spend.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const pdfParse = require("pdf-parse");

const {
  callAnthropic,
  getAnthropicApiKey,
  getUserRole,
  assertDailyLimit,
  isStaffRole,
} = require("../aiService");

const APPCHECK_ENFORCE_CALLABLE = process.env.APPCHECK_ENFORCE === "1";
const PDF_TEXT_LIMIT = 50_000;
const MAX_TOPICS = 40;

const EXTRACTION_TOOL = {
  name: "submit_extracted_topics",
  description:
    "Submit the CBC topics extracted from the syllabus PDF. " +
    "Return one entry per distinct topic in the document. " +
    "Subtopics, specific competencies, and learning activities should " +
    "match the verbatim CDC wording where possible.",
  input_schema: {
    type: "object",
    properties: {
      topics: {
        type: "array",
        minItems: 0,
        maxItems: MAX_TOPICS,
        items: {
          type: "object",
          required: ["topic"],
          properties: {
            topic: {type: "string"},
            term: {type: "integer", minimum: 1, maximum: 3},
            subtopics: {
              type: "array",
              items: {type: "string"},
            },
            specificOutcomes: {
              type: "array",
              items: {type: "string"},
            },
            keyCompetencies: {
              type: "array",
              items: {type: "string"},
            },
            values: {
              type: "array",
              items: {type: "string"},
            },
            suggestedMaterials: {
              type: "array",
              items: {type: "string"},
            },
          },
        },
      },
      warnings: {
        type: "array",
        items: {type: "string"},
      },
    },
    required: ["topics"],
  },
};

const SYSTEM_PROMPT =
  "You are a Zambian CBC syllabus structurer. The user will paste raw " +
  "text from an official Curriculum Development Centre (CDC) syllabus " +
  "PDF, along with the grade and subject. Extract every distinct topic " +
  "into structured records. Be faithful to the source — never invent " +
  "topics, outcomes, or competencies that are not in the text. If a " +
  "section is malformed or you skipped it, list a short warning string " +
  "explaining why. Return only the tool call, no prose.";

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function buildTopicId(grade, subject, topic) {
  const g = slug(grade);
  const s = slug(subject);
  const t = slug(topic);
  if (!g || !s || !t) return null;
  return `${g}-${s}-${t}`;
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .slice(0, 30);
}

function sanitiseGrade(value) {
  const v = String(value || "").trim().toUpperCase();
  if (/^G\d{1,2}$/.test(v) || v === "ECE" || /^F\d{1,2}$/.test(v)) return v;
  return null;
}

function sanitiseSubject(value) {
  const v = String(value || "").toLowerCase().trim()
    .replace(/[^a-z0-9_\s]/g, "")
    .replace(/\s+/g, "_");
  return v && v.length <= 64 ? v : null;
}

function sanitiseVersion(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(v)) return null;
  return v;
}

function sanitiseStoragePath(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (!v.startsWith("syllabus-uploads-pdf/")) return null;
  if (!v.toLowerCase().endsWith(".pdf")) return null;
  if (v.length > 400) return null;
  return v;
}

function createExtractTopicsFromPdf(anthropicApiKeySecret) {
  return onCall({
    secrets: [anthropicApiKeySecret],
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "1GiB",
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  }, async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    const uid = request.auth.uid;
    const role = await getUserRole(uid);
    if (role !== "admin") {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    const storagePath = sanitiseStoragePath(request.data?.storagePath);
    const grade = sanitiseGrade(request.data?.grade);
    const subject = sanitiseSubject(request.data?.subject);
    const version = sanitiseVersion(request.data?.version);
    if (!storagePath) {
      throw new HttpsError("invalid-argument",
        "storagePath must be under syllabus-uploads-pdf/ and end with .pdf");
    }
    if (!grade) {
      throw new HttpsError("invalid-argument",
        "grade is required (e.g. G6, G10, F1, ECE).");
    }
    if (!subject) {
      throw new HttpsError("invalid-argument",
        "subject is required (e.g. mathematics, integrated_science).");
    }
    if (!version) {
      throw new HttpsError("invalid-argument",
        "version is required (3-80 chars, lowercase letters/digits/hyphens).");
    }

    // Daily-cap enforcement against the calling admin. Re-uses the same
    // budget bucket as agent jobs / explain / chat, so a runaway upload
    // can't bypass the limit by routing through a separate action key.
    await assertDailyLimit(uid, role, "extractTopicsFromPdf");
    void isStaffRole;

    const filename = storagePath.split("/").pop() || "syllabus.pdf";
    const statusRef = admin.firestore()
      .collection("cbcKnowledgeBase")
      .doc(version)
      .collection("uploadStatus")
      .doc(slug(filename));

    await statusRef.set({
      filename,
      status: "parsing",
      kind: "pdf",
      grade,
      subject,
      sourceStoragePath: storagePath,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    let pdfText = "";
    try {
      const [buf] = await admin.storage().bucket()
        .file(storagePath)
        .download();
      const parsed = await pdfParse(buf);
      pdfText = String(parsed?.text || "").trim();
    } catch (err) {
      const message = String(err && err.message || err).slice(0, 500);
      await statusRef.set({
        status: "error",
        error: `PDF parse failed: ${message}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      throw new HttpsError("invalid-argument",
        `Could not read PDF: ${message}`);
    }

    if (!pdfText || pdfText.length < 80) {
      await statusRef.set({
        status: "error",
        error: "PDF contained no extractable text (image-only scan?).",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      throw new HttpsError("failed-precondition",
        "PDF has no extractable text. Try an OCR'd copy.");
    }

    const truncated = pdfText.length > PDF_TEXT_LIMIT;
    const slice = truncated ? pdfText.slice(0, PDF_TEXT_LIMIT) : pdfText;

    const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
    let raw;
    try {
      raw = await callAnthropic(apiKey, {
        systemPrompt: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content:
            `Grade: ${grade}\nSubject: ${subject}\n` +
            `Source file: ${filename}\n\n` +
            "===== SYLLABUS TEXT =====\n" +
            slice +
            (truncated ?
              "\n\n[…truncated — extract only what is visible above…]" :
              ""),
        }],
        maxTokens: 4000,
        temperature: 0.1,
        tools: [EXTRACTION_TOOL],
        toolChoice: {type: "tool", name: EXTRACTION_TOOL.name},
        track: {uid, tool: "extractTopicsFromPdf"},
      });
    } catch (err) {
      const message = String(err && err.message || err).slice(0, 500);
      await statusRef.set({
        status: "error",
        error: `Claude extraction failed: ${message}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      throw err instanceof HttpsError ? err :
        new HttpsError("internal", message);
    }

    let extracted;
    try {
      extracted = JSON.parse(raw);
    } catch {
      await statusRef.set({
        status: "error",
        error: "Claude returned malformed JSON.",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      throw new HttpsError("internal",
        "AI returned malformed output. Please try again.");
    }

    const topics = Array.isArray(extracted?.topics) ?
      extracted.topics.slice(0, MAX_TOPICS) : [];
    const warnings = Array.isArray(extracted?.warnings) ?
      extracted.warnings.slice(0, 20).map(String) : [];
    if (truncated) {
      warnings.push(
        `Source PDF was truncated at ${PDF_TEXT_LIMIT} characters — ` +
        "remainder was not analysed. Re-upload split into smaller files " +
        "if you need full coverage.",
      );
    }

    const db = admin.firestore();
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const writtenIds = [];
    const skipped = [];

    for (const t of topics) {
      const topicName = typeof t?.topic === "string" ? t.topic.trim() : "";
      if (!topicName) {
        skipped.push("(missing topic name)");
        continue;
      }
      const id = buildTopicId(grade, subject, topicName);
      if (!id) {
        skipped.push(topicName);
        continue;
      }
      const ref = db.collection("cbcKnowledgeBase")
        .doc(version)
        .collection("draftTopics")
        .doc(id);
      batch.set(ref, {
        id,
        grade,
        subject,
        topic: topicName.slice(0, 200),
        term: Number.isInteger(t?.term) ?
          Math.max(1, Math.min(3, t.term)) : 1,
        subtopics: cleanStringArray(t?.subtopics).map((name) => ({
          name,
          specificCompetence: "",
          learningActivities: [],
          expectedStandard: "",
        })),
        specificOutcomes: cleanStringArray(t?.specificOutcomes),
        keyCompetencies: cleanStringArray(t?.keyCompetencies),
        values: cleanStringArray(t?.values),
        suggestedMaterials: cleanStringArray(t?.suggestedMaterials),
        sourceWorkbook: filename,
        sourceStoragePath: storagePath,
        sourceKind: "pdf",
        reviewStatus: "needs_check",
        updatedAt: now,
        importedAt: now,
        importedBy: uid,
      }, {merge: true});
      writtenIds.push(id);
    }

    batch.set(statusRef, {
      status: "parsed",
      topicCount: writtenIds.length,
      skippedCount: skipped.length,
      warnings,
      parsedAt: now,
      updatedAt: now,
    }, {merge: true});

    await batch.commit();

    return {
      ok: true,
      version,
      topicCount: writtenIds.length,
      skippedCount: skipped.length,
      warnings,
      truncated,
      topicIds: writtenIds,
    };
  });
}

module.exports = {createExtractTopicsFromPdf};
