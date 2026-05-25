/**
 * pastPaperImport — HTTPS callable that runs Claude over an uploaded
 * past paper (PDF or scanned page images) and returns draft MCQs
 * ready for an admin to review in the Past Paper Studio.
 *
 * Inputs come from the paper doc itself rather than the call so the
 * admin can't bypass storage rules by handing us arbitrary file
 * paths — we only ever read `pastPapers/{paperId}.assets[]` (or the
 * legacy `pdfPath`).
 *
 * Caps:
 *   - PDF: first 32 MB of the file (Anthropic's document limit).
 *   - Images: first 12 pages, 5 MB each before base64. The studio
 *     can run the import a second time and merge if a paper is
 *     longer; v1 keeps the prompt budget bounded.
 *
 * Output: { questions: [...], usage: {...}, warning?: '...' } where
 * each question follows the studio's working shape (prompt, options,
 * correctAnswer (index or null), explanation).
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {
  getAnthropicApiKey,
  getUserRole,
  isStaffRole,
} = require("../aiService");
const {callClaude} = require("./anthropicClient");

const IMPORT_MODEL = process.env.PAST_PAPER_IMPORT_MODEL || "claude-sonnet-4-5";

const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 12;
const MAX_QUESTIONS = 40;

const QUESTIONS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          prompt: {type: "string"},
          options: {
            type: "array",
            items: {type: "string"},
            minItems: 2,
            maxItems: 6,
          },
          correctAnswer: {
            type: ["integer", "null"],
            description:
              "Zero-based index into options. null when the source " +
              "paper does not mark the answer.",
          },
          explanation: {type: "string"},
        },
        required: ["prompt", "options"],
      },
    },
  },
  required: ["questions"],
};

const SYSTEM_PROMPT = `You are digitising a Zambian ECZ past paper. The user will send you the paper as a PDF or as a series of scanned page images. Your job is to read every multiple-choice question on the paper and return it as structured JSON.

Rules:
- Return ONE option per choice the paper offers (typically 4: A, B, C, D). Preserve the wording exactly.
- If the paper marks the correct answer (mark scheme box, answer key page, asterisk, or shading), return the 0-based index into the options array. If the answer is not visible, return null — never guess.
- Keep the question prompt as a single line where possible. Preserve any inline maths, units, or labels.
- Skip diagrams that can't be conveyed in text. If a question is unreadable, skip it rather than invent content.
- Skip questions that are not multiple-choice (essay, fill-in-the-blank, "explain why"). The studio handles those manually.
- Write a short one-sentence explanation for each question pointing at the concept being tested. If you don't know the answer, leave explanation empty.

Quality over coverage: it is much better to return 8 accurate questions than 30 noisy ones.`;

async function loadPaperOrThrow(paperId) {
  if (!paperId || typeof paperId !== "string") {
    throw new HttpsError("invalid-argument", "paperId is required.");
  }
  const snap = await admin.firestore().doc(`pastPapers/${paperId}`).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Past paper not found.");
  }
  return {id: snap.id, ...snap.data()};
}

function pickSources(paper) {
  // Returns either {kind: 'pdf', path, size} or {kind: 'images', items}
  // where items is [{path, contentType, size}, ...] capped by MAX_IMAGES.
  if (paper.pdfPath) {
    return {kind: "pdf", path: paper.pdfPath, size: paper.pdfSize || null};
  }
  const assets = Array.isArray(paper.assets) ? paper.assets : [];
  const pdf = assets.find((a) => a.contentType === "application/pdf");
  if (pdf) return {kind: "pdf", path: pdf.path, size: pdf.size || null};
  const images = assets
    .filter((a) => a.contentType && a.contentType.startsWith("image/"))
    .slice(0, MAX_IMAGES);
  if (images.length) return {kind: "images", items: images};
  return null;
}

async function downloadAsset(path) {
  const [buf] = await admin.storage().bucket().file(path).download();
  return buf;
}

async function buildMessageBlocks(source) {
  const blocks = [];
  let droppedForSize = 0;
  if (source.kind === "pdf") {
    const buf = await downloadAsset(source.path);
    if (buf.length > MAX_PDF_BYTES) {
      // Anthropic enforces the cap upstream; truncating an arbitrary PDF
      // would corrupt it. Better to refuse with a clear message.
      throw new HttpsError("failed-precondition",
        `PDF is ${Math.round(buf.length / 1024 / 1024)}MB; the AI importer ` +
        "accepts up to 32MB. Split the paper or re-upload as images.");
    }
    blocks.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: buf.toString("base64"),
      },
    });
  } else {
    for (const item of source.items) {
      const buf = await downloadAsset(item.path);
      if (buf.length > MAX_IMAGE_BYTES) {
        droppedForSize += 1;
        continue;
      }
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: item.contentType,
          data: buf.toString("base64"),
        },
      });
    }
    if (!blocks.length) {
      throw new HttpsError("failed-precondition",
        "Every page asset was over 5MB. Compress the scans and retry.");
    }
  }
  return {blocks, droppedForSize};
}

function buildUserPromptText(paper) {
  const parts = [
    "Paper: " + (paper.title || "(untitled)"),
    paper.examBoard ? `Board: ${paper.examBoard}` : null,
    paper.grade ? `Grade: ${paper.grade}` : null,
    paper.subject ? `Subject: ${paper.subject}` : null,
    paper.year ? `Year: ${paper.year}` : null,
    paper.paperNumber ? `Paper number: ${paper.paperNumber}` : null,
  ].filter(Boolean);
  return [
    "Extract every multiple-choice question from this past paper.",
    "",
    parts.join("\n"),
    "",
    "Return up to " + MAX_QUESTIONS + " questions in the order they " +
      "appear on the paper. Use the tool schema exactly.",
  ].join("\n");
}

function normaliseQuestion(raw, idx) {
  const prompt = String(raw && raw.prompt || "").trim();
  const optionsRaw = Array.isArray(raw && raw.options) ? raw.options : [];
  const options = optionsRaw
    .map((o) => String(o == null ? "" : o).trim())
    .filter(Boolean)
    .slice(0, 6);
  let correctAnswer = raw && raw.correctAnswer;
  if (correctAnswer === undefined || correctAnswer === null) {
    correctAnswer = null;
  } else {
    const n = Number(correctAnswer);
    correctAnswer = Number.isInteger(n) && n >= 0 && n < options.length ?
      n : null;
  }
  return {
    prompt,
    options,
    correctAnswer,
    explanation: String(raw && raw.explanation || "").trim(),
    order: idx,
    requiresReview: true,
  };
}

async function runPastPaperImport({uid, paperId, apiKey}) {
  const paper = await loadPaperOrThrow(paperId);
  const source = pickSources(paper);
  if (!source) {
    throw new HttpsError("failed-precondition",
      "This paper has no uploaded files. Add a PDF or scanned images first.");
  }

  const {blocks, droppedForSize} = await buildMessageBlocks(source);
  const messages = [{
    role: "user",
    content: [
      ...blocks,
      {type: "text", text: buildUserPromptText(paper)},
    ],
  }];

  const result = await callClaude(apiKey, {
    systemPrompt: SYSTEM_PROMPT,
    messages,
    model: IMPORT_MODEL,
    maxTokens: 8000,
    temperature: 0.1,
    mode: "tool",
    toolName: "return_questions",
    toolDescription: "Return the extracted multiple-choice questions.",
    toolInputSchema: QUESTIONS_TOOL_SCHEMA,
  });

  const rawQuestions = Array.isArray(result && result.parsed &&
    result.parsed.questions) ? result.parsed.questions : [];
  const questions = rawQuestions
    .slice(0, MAX_QUESTIONS)
    .map((q, i) => normaliseQuestion(q, i))
    .filter((q) => q.prompt && q.options.length >= 2);

  // Log to aiGenerations for cost tracking + audit trail.
  try {
    await admin.firestore().collection("aiGenerations").add({
      kind: "past_paper_import",
      paperId,
      uid,
      modelUsed: result && result.model || IMPORT_MODEL,
      sourceKind: source.kind,
      sourcePageCount: source.kind === "images" ?
        source.items.length : 1,
      tokensIn: Number(result && result.usage &&
        result.usage.inputTokens || 0),
      tokensOut: Number(result && result.usage &&
        result.usage.outputTokens || 0),
      questionsReturned: questions.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Telemetry only — don't block the response on a logging failure.
    console.warn("[pastPaperImport] usage log failed", err && err.message);
  }

  const warnings = [];
  if (droppedForSize > 0) {
    warnings.push(`${droppedForSize} page${droppedForSize === 1 ? "" : "s"} ` +
      "skipped because they were over 5MB each.");
  }
  if (questions.length === 0) {
    warnings.push("The AI could not extract any clean MCQs from this paper.");
  }

  return {
    questions,
    usage: result && result.usage || null,
    warning: warnings.length ? warnings.join(" ") : null,
  };
}

function createImportPastPaperQuestions(anthropicApiKeySecret) {
  return onCall(
    {
      secrets: [anthropicApiKeySecret],
      timeoutSeconds: 240,
      // PDF + image content blocks live in memory before going to
      // Anthropic. A 30MB PDF base64-encoded is ~40MB; budget 1GB.
      memory: "1GiB",
    },
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "Please sign in.");
      }
      const role = await getUserRole(uid);
      // Only admins can import — past papers are admin-curated content.
      if (role !== "admin" && !isStaffRole(role)) {
        throw new HttpsError("permission-denied",
          "Admin access is required to import past-paper questions.");
      }
      const apiKey = getAnthropicApiKey(anthropicApiKeySecret);
      const paperId = String(request.data && request.data.paperId || "");
      return runPastPaperImport({uid, paperId, apiKey});
    },
  );
}

module.exports = {createImportPastPaperQuestions, runPastPaperImport};
