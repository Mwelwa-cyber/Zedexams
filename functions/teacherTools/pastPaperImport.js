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
const mammoth = require("mammoth");
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
const MAX_DOCX_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_TEXT_CHARS = 150000;
const MAX_QUESTIONS = 40;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME = "application/msword";

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
  // Returns one of:
  //   {kind: 'pdf', path, size}
  //   {kind: 'docx', path, size, mime}  — Word documents
  //   {kind: 'images', items}            — scanned page images
  //
  // Mark-scheme assets are intentionally skipped — feeding the answer
  // key into the importer would let the model "extract" questions
  // from the mark scheme itself, polluting the output.
  if (paper.pdfPath) {
    return {kind: "pdf", path: paper.pdfPath, size: paper.pdfSize || null};
  }
  const rawAssets = Array.isArray(paper.assets) ? paper.assets : [];
  const assets = rawAssets.filter((a) => a.role !== "mark-scheme");
  const pdf = assets.find((a) => a.contentType === "application/pdf");
  if (pdf) return {kind: "pdf", path: pdf.path, size: pdf.size || null};
  const doc = assets.find(
    (a) => a.contentType === DOCX_MIME || a.contentType === DOC_MIME,
  );
  if (doc) {
    return {
      kind: "docx",
      path: doc.path,
      size: doc.size || null,
      mime: doc.contentType,
    };
  }
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
  let extraNote = "";

  if (source.kind === "pdf") {
    const buf = await downloadAsset(source.path);
    if (buf.length > MAX_PDF_BYTES) {
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
  } else if (source.kind === "docx") {
    // Anthropic doesn't accept .docx natively. mammoth extracts the
    // textual content (paragraphs, tables, ordered lists) into plain
    // text that the model can parse. Embedded images are intentionally
    // dropped — the admin will attach pictures inside the Quiz Editor.
    const buf = await downloadAsset(source.path);
    if (buf.length > MAX_DOCX_BYTES) {
      throw new HttpsError("failed-precondition",
        `Document is ${Math.round(buf.length / 1024 / 1024)}MB; the AI ` +
        "importer accepts up to 25MB Word files.");
    }
    if (source.mime === DOC_MIME) {
      // mammoth officially supports .docx only. Some .doc files import
      // anyway; we attempt and fall back to a clear error.
      extraNote = "Legacy .doc files may import partially. " +
        "Re-save as .docx for the best results.";
    }
    let text = "";
    try {
      const result = await mammoth.extractRawText({buffer: buf});
      text = String(result && result.value || "").trim();
    } catch (err) {
      throw new HttpsError("failed-precondition",
        "Could not read this Word document. Re-save as .docx and retry. " +
        String(err && err.message || err).slice(0, 200));
    }
    if (!text || text.length < 80) {
      throw new HttpsError("failed-precondition",
        "The document had no extractable text. Save as .docx (not .doc) " +
        "or paste the questions in manually.");
    }
    const truncated = text.length > MAX_DOCX_TEXT_CHARS;
    const slice = truncated ? text.slice(0, MAX_DOCX_TEXT_CHARS) : text;
    if (truncated) {
      extraNote = (extraNote ? extraNote + " " : "") +
        "Document was longer than 150,000 characters and got truncated; " +
        "re-run on the remaining pages if needed.";
    }
    blocks.push({
      type: "text",
      text: "The full text of the uploaded Word document follows. " +
        "Embedded images are NOT included — the admin will add pictures " +
        "manually in the Quiz Editor.\n\n----\n" + slice + "\n----",
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
  return {blocks, droppedForSize, extraNote};
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

/**
 * Erase the existing question set on a quiz before writing fresh AI
 * output. Past-paper quizzes are AI-curated end-to-end; the admin
 * re-runs the importer when they want a clean slate.
 */
async function clearQuizQuestions(quizId) {
  const ref = admin.firestore().collection(`quizzes/${quizId}/questions`);
  const snap = await ref.get();
  if (snap.empty) return 0;
  // Firestore caps writeBatch at 500 ops; chunk to stay safe.
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = admin.firestore().batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return docs.length;
}

/**
 * Write the AI-extracted questions into the linked quiz's questions
 * subcollection. We use deterministic ids `q001`, `q002`, ... so a
 * second run rewrites cleanly without leaving stale docs.
 */
async function writeQuestionsToQuiz(quizId, questions) {
  if (!questions.length) return 0;
  for (let i = 0; i < questions.length; i += 400) {
    const chunk = questions.slice(i, i + 400);
    const batch = admin.firestore().batch();
    chunk.forEach((q, offset) => {
      const id = `q${String(i + offset + 1).padStart(3, "0")}`;
      const ref = admin.firestore()
        .doc(`quizzes/${quizId}/questions/${id}`);
      batch.set(ref, {
        type: "mcq",
        text: q.prompt,
        textJSON: null,
        options: q.options,
        correctAnswer: Number.isInteger(q.correctAnswer) ? q.correctAnswer : 0,
        explanation: q.explanation || "",
        explanationJSON: null,
        marks: 1,
        order: i + offset,
        requiresReview: true,
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
        importSource: "past_paper_ai",
      }, {merge: false});
    });
    await batch.commit();
  }
  return questions.length;
}

async function runPastPaperImport({uid, paperId, quizId, apiKey}) {
  const paper = await loadPaperOrThrow(paperId);
  const source = pickSources(paper);
  if (!source) {
    throw new HttpsError("failed-precondition",
      "This paper has no uploaded files. Add a PDF, Word document, " +
      "or scanned images first.");
  }

  const {blocks, droppedForSize, extraNote} =
    await buildMessageBlocks(source);
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

  // If a target quizId was supplied, persist the questions directly so
  // the admin can open the Quiz Editor and find them ready for review.
  let cleared = 0;
  let written = 0;
  if (quizId && questions.length) {
    cleared = await clearQuizQuestions(quizId);
    written = await writeQuestionsToQuiz(quizId, questions);
    // Keep the parent quiz doc in sync with the new count.
    try {
      await admin.firestore().doc(`quizzes/${quizId}`).set({
        questionCount: written,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    } catch (err) {
      console.warn("[pastPaperImport] quiz count sync failed",
        err && err.message);
    }
  }

  // Log to aiGenerations for cost tracking + audit trail.
  try {
    await admin.firestore().collection("aiGenerations").add({
      kind: "past_paper_import",
      paperId,
      quizId: quizId || null,
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
      questionsWritten: written,
      questionsCleared: cleared,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("[pastPaperImport] usage log failed", err && err.message);
  }

  const warnings = [];
  if (droppedForSize > 0) {
    warnings.push(`${droppedForSize} page${droppedForSize === 1 ? "" : "s"} ` +
      "skipped because they were over 5MB each.");
  }
  if (extraNote) warnings.push(extraNote);
  if (questions.length === 0) {
    warnings.push("The AI could not extract any clean MCQs from this paper.");
  }

  return {
    questions,
    questionsWritten: written,
    questionsCleared: cleared,
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
      const quizId = request.data && request.data.quizId ?
        String(request.data.quizId) : null;
      return runPastPaperImport({uid, paperId, quizId, apiKey});
    },
  );
}

module.exports = {createImportPastPaperQuestions, runPastPaperImport};
