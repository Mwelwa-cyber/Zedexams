/**
 * pastPaperImport — HTTPS callable that runs Claude over an uploaded past
 * paper (PDF, Word doc, or scanned page images) and writes the extracted
 * questions into the linked quiz, ready for an admin to review in the Past
 * Paper Studio.
 *
 * Inputs come from the paper doc itself rather than the call so the admin
 * can't bypass storage rules by handing us arbitrary file paths — we only
 * ever read `pastPapers/{paperId}.assets[]` (or the legacy `pdfPath`).
 *
 * ── Design (2026-06 redesign) ────────────────────────────────────────────
 * The previous version made ONE Claude call capped at 40 questions / 8000
 * output tokens / 12 page images, and only kept multiple-choice questions.
 * On any real ECZ paper that silently truncated: papers stopped at ~40
 * questions, pages past the 12th were dropped, and every non-MCQ (true/false,
 * fill-in, short answer, essay) was thrown away. There is no such cap now:
 *
 *   • Pages are batched (a few per call) so each call's OUTPUT stays well
 *     inside the token budget — the real reason long papers truncated.
 *   • Each segment runs a loop-until-dry coverage loop: we keep asking the
 *     model for "questions you have NOT yet returned" until a round adds
 *     nothing new, so a single call being cut off can never lose questions.
 *   • Every supported question type is captured (mcq, tf, short_answer,
 *     fill_blanks, essay, numeric), not just MCQ.
 *   • A deterministic verification pass dedupes, checks numbering + answers,
 *     and produces the report the studio shows the admin.
 *
 * Output: { questions, questionsWritten, questionsCleared, report, warning? }.
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
const {
  canWriteQuiz,
  planPageBatches,
  selectNewQuestions,
  summariseSeenStems,
  normaliseImportedQuestion,
  mergeAndRenumber,
  buildImportReport,
  dedupeExtractedQuestions,
} = require("./pastPaperImportHelpers");

const IMPORT_MODEL = process.env.PAST_PAPER_IMPORT_MODEL || "claude-sonnet-4-6";

// Input-size guards (these bound the SOURCE we accept, never the number of
// questions we extract). PDFs/images that exceed these can't physically be
// sent to the model; the studio surfaces a clear "split / re-upload" error.
const MAX_PDF_BYTES = 32 * 1024 * 1024; // Anthropic's document byte limit.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Per page image, decoded.
const MAX_DOCX_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_CHARS_PER_SEGMENT = 120000; // Chunk size, NOT a total cap.
// Page cap for the sample-format analyzers that call buildMessageBlocks (they
// only characterise a paper's house style from a few pages). NOT used by the
// import path, which processes every page via planSegments.
const SAMPLE_MAX_IMAGES = 12;

// Extraction controls. Pages-per-batch keeps each call's OUTPUT small enough to
// never truncate; the coverage loop + round cap are a generous backstop, not a
// question cap — a normal paper converges in 1–2 rounds per segment.
const IMAGE_PAGES_PER_BATCH = 4;
const MAX_ROUNDS_PER_SEGMENT = 8;
const EXTRACTION_MAX_TOKENS = 16000;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME = "application/msword";

// Permissive tool schema — the prompt describes the shape in detail and the
// pure normaliser does the strict per-type coercion. The win is forcing a
// structured response rather than prose. Note there is deliberately NO maxItems
// on `questions`: the model returns as many as it finds.
const QUESTIONS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceNumber: {
            type: ["string", "integer", "null"],
            description:
              "The question number printed on the paper (e.g. 12). Used to " +
              "detect skipped questions. Null if the paper shows none.",
          },
          type: {
            type: "string",
            description:
              "One of: mcq, tf, short_answer, fill_blanks, essay, numeric. " +
              "Use the closest type for matching/structured/diagram questions " +
              "(usually short_answer) — never drop a question.",
          },
          prompt: {type: "string"},
          options: {
            type: "array",
            items: {type: "string"},
            description: "Choices for mcq/tf only. Empty for other types.",
          },
          correctAnswer: {
            type: ["integer", "string", "null"],
            description:
              "For mcq/tf: 0-based index into options. For short_answer/" +
              "fill_blanks/numeric: the answer text. Null/empty when the paper " +
              "does not print a key — never guess.",
          },
          explanation: {type: "string"},
        },
        required: ["prompt"],
      },
    },
  },
  required: ["questions"],
};

const SYSTEM_PROMPT = `You are digitising a Zambian ECZ examination paper. The user sends the paper as a PDF, a Word document's text, or scanned page images. Read it with very high accuracy and return EVERY question as structured JSON via the tool.

COMPLETENESS IS THE TOP PRIORITY. Capture every question on every page, in the order they appear. Do not stop early, do not summarise, do not skip a question because it has a diagram or is hard to read — transcribe what you can. A paper may have 20, 50, or 100+ questions; return all of them.

For each question:
- type: choose the closest of mcq, tf (true/false), short_answer, fill_blanks, essay, numeric. For matching, ordering, structured (a/b/c parts), table, or diagram-label questions that don't fit those, use short_answer and put the full question (including its parts) in the prompt. NEVER discard a question.
- prompt: the full question text. Preserve maths, fractions, powers/superscripts, subscripts, units, chemical formulae, currency, percentages, scientific notation, and labels exactly. Keep multi-part questions (a), (b), (c) together in one prompt with their parts.
- options: for mcq list every choice (usually A–D) with exact wording; for tf use ["True","False"]; leave empty otherwise.
- correctAnswer: only if the paper actually marks it (answer key, asterisk, shading) — the 0-based option index for mcq/tf, or the answer text for short_answer/fill_blanks/numeric. If the answer is NOT printed, return null. NEVER guess an answer.
- sourceNumber: the question number printed on the paper, so skipped numbers can be detected.
- explanation: one short sentence on the concept tested, or empty if unsure.

Transcribe faithfully. It is far better to return a complete paper with a few questions flagged for review than a tidy subset.`;

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
  //   {kind: 'images', items}            — ALL scanned page images (no cap)
  //
  // Mark-scheme assets are intentionally skipped — feeding the answer key into
  // the importer would let the model "extract" questions from the mark scheme.
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
  const images = assets.filter(
    (a) => a.contentType && a.contentType.startsWith("image/"),
  );
  if (images.length) return {kind: "images", items: images};
  return null;
}

async function downloadAsset(path) {
  const [buf] = await admin.storage().bucket().file(path).download();
  return buf;
}

/**
 * Build the Anthropic content blocks for a WHOLE source in one shot. Used by
 * the sample-format analyzers (extractAssessmentFormat / examPaperLibrary),
 * which only need a representative sample of pages — so images stay capped at
 * `maxImages` (default 12, the historical bound that used to live in
 * pickSources). The past-paper IMPORT path does NOT use this for images; it
 * uses planSegments(), which batches every page with no cap.
 */
async function buildMessageBlocks(source, maxImages = SAMPLE_MAX_IMAGES) {
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
    blocks.push(pdfBlock(buf));
  } else if (source.kind === "docx") {
    const {text, note} = await extractDocxText(source);
    extraNote = note;
    blocks.push(docxBlock(text));
  } else {
    for (const item of source.items.slice(0, maxImages)) {
      const buf = await downloadAsset(item.path);
      if (buf.length > MAX_IMAGE_BYTES) {
        droppedForSize += 1;
        continue;
      }
      blocks.push(imageBlock(item.contentType, buf));
    }
    if (!blocks.length) {
      throw new HttpsError("failed-precondition",
        "Every page asset was over 5MB. Compress the scans and retry.");
    }
  }
  return {blocks, droppedForSize, extraNote};
}

function pdfBlock(buf) {
  return {
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: buf.toString("base64"),
    },
  };
}

function imageBlock(mediaType, buf) {
  return {
    type: "image",
    source: {type: "base64", media_type: mediaType, data: buf.toString("base64")},
  };
}

function docxBlock(text) {
  return {
    type: "text",
    text: "The full text of the uploaded Word document follows. Embedded " +
      "images are NOT included — the admin will add pictures manually in the " +
      "Quiz Editor.\n\n----\n" + text + "\n----",
  };
}

async function extractDocxText(source) {
  // Anthropic doesn't accept .docx natively. mammoth extracts the textual
  // content (paragraphs, tables, ordered lists). Embedded images are dropped —
  // the admin attaches pictures in the Quiz Editor.
  const buf = await downloadAsset(source.path);
  if (buf.length > MAX_DOCX_BYTES) {
    throw new HttpsError("failed-precondition",
      `Document is ${Math.round(buf.length / 1024 / 1024)}MB; the AI ` +
      "importer accepts up to 25MB Word files.");
  }
  let note = "";
  if (source.mime === DOC_MIME) {
    note = "Legacy .doc files may import partially. Re-save as .docx for the " +
      "best results.";
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
      "The document had no extractable text. Save as .docx (not .doc) or " +
      "paste the questions in manually.");
  }
  return {text, note};
}

/**
 * Slice a long string into overlapping-free chunks of at most `size`
 * characters, preferring to break on a blank line / newline near the boundary
 * so a question isn't cut in half. Pure-ish (no I/O); kept here as it's tied to
 * the DOCX path constants.
 */
function chunkText(text, size) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      const slice = text.slice(i, end);
      const br = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
      if (br > size * 0.5) end = i + br;
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

/**
 * Turn a source into the list of extraction SEGMENTS, each with the content
 * blocks for a manageable slice of the paper plus a label + page span. Images
 * are batched by page; a PDF is a single segment (the model paginates it); a
 * DOCX is chunked by character budget. Returns {segments, droppedForSize,
 * extraNote, pageCount}.
 */
async function planSegments(source) {
  if (source.kind === "pdf") {
    const buf = await downloadAsset(source.path);
    if (buf.length > MAX_PDF_BYTES) {
      throw new HttpsError("failed-precondition",
        `PDF is ${Math.round(buf.length / 1024 / 1024)}MB; the AI importer ` +
        "accepts up to 32MB. Split the paper or re-upload as images.");
    }
    return {
      segments: [{label: "the PDF", pageCount: 1, blocks: [pdfBlock(buf)]}],
      droppedForSize: 0,
      extraNote: "",
    };
  }

  if (source.kind === "docx") {
    const {text, note} = await extractDocxText(source);
    const chunks = chunkText(text, MAX_DOCX_CHARS_PER_SEGMENT);
    const segments = chunks.map((chunk, i) => ({
      label: chunks.length > 1 ?
        `document part ${i + 1} of ${chunks.length}` : "the document",
      pageCount: 1,
      blocks: [docxBlock(chunk)],
    }));
    return {segments, droppedForSize: 0, extraNote: note};
  }

  // images — download every page once, drop oversize, batch the rest.
  const prepared = [];
  let droppedForSize = 0;
  for (const item of source.items) {
    const buf = await downloadAsset(item.path);
    if (buf.length > MAX_IMAGE_BYTES) {
      droppedForSize += 1;
      continue;
    }
    prepared.push(imageBlock(item.contentType, buf));
  }
  if (!prepared.length) {
    throw new HttpsError("failed-precondition",
      "Every page asset was over 5MB. Compress the scans and retry.");
  }
  const batches = planPageBatches(prepared, IMAGE_PAGES_PER_BATCH);
  const segments = batches.map((b) => ({
    label: b.startPage === b.endPage ?
      `page ${b.startPage}` : `pages ${b.startPage}–${b.endPage}`,
    pageCount: b.pages.length,
    blocks: b.pages,
  }));
  return {segments, droppedForSize, extraNote: ""};
}

function buildContextLines(paper) {
  return [
    "Paper: " + (paper.title || "(untitled)"),
    paper.examBoard ? `Board: ${paper.examBoard}` : null,
    paper.grade ? `Grade: ${paper.grade}` : null,
    paper.subject ? `Subject: ${paper.subject}` : null,
    paper.year ? `Year: ${paper.year}` : null,
    paper.paperNumber ? `Paper number: ${paper.paperNumber}` : null,
  ].filter(Boolean).join("\n");
}

function buildExtractionPrompt({paper, segment, seenStems, round}) {
  const context = buildContextLines(paper);
  if (round === 0) {
    return [
      `Extract EVERY question from ${segment.label} of this past paper, in the ` +
      "order they appear. Use the tool schema exactly.",
      "",
      context,
    ].join("\n");
  }
  // Continuation round: ask only for what was missed / cut off.
  const already = seenStems.length ?
    seenStems.join("\n") : "(none yet)";
  return [
    `You have already extracted these questions from ${segment.label}:`,
    already,
    "",
    "Return ONLY questions from this paper that you have NOT already returned " +
    "above — any you missed or that were cut off. Do not repeat any question " +
    "listed above. If every question has now been captured, return an empty " +
    "questions array.",
    "",
    context,
  ].join("\n");
}

/**
 * Run the loop-until-dry coverage loop over a single segment. Repeatedly asks
 * the model for questions it hasn't yet returned, accepting only genuinely new
 * ones, until a round adds nothing (or the round cap is hit). This is what
 * makes a single truncated call unable to lose questions.
 */
async function extractSegment({apiKey, paper, segment, seenKeys, accum}) {
  const segmentQuestions = [];
  let rounds = 0;
  let truncationHit = false;
  const usage = {inputTokens: 0, outputTokens: 0};

  for (let round = 0; round < MAX_ROUNDS_PER_SEGMENT; round++) {
    rounds += 1;
    const seenStems = summariseSeenStems(segmentQuestions);
    const promptText = buildExtractionPrompt({paper, segment, seenStems, round});
    const messages = [{
      role: "user",
      content: [...segment.blocks, {type: "text", text: promptText}],
    }];

    let result;
    try {
      result = await callClaude(apiKey, {
        systemPrompt: SYSTEM_PROMPT,
        messages,
        model: IMPORT_MODEL,
        maxTokens: EXTRACTION_MAX_TOKENS,
        temperature: 0,
        mode: "tool",
        toolName: "return_questions",
        toolDescription: "Return the extracted exam questions.",
        toolInputSchema: QUESTIONS_TOOL_SCHEMA,
      });
    } catch (err) {
      // A single round failing (e.g. a transient shape error after retries)
      // shouldn't abandon the whole paper — keep what we have from this segment.
      console.warn("[pastPaperImport] segment round failed",
        segment.label, round, err && err.message);
      break;
    }

    usage.inputTokens += Number(result?.usage?.inputTokens || 0);
    usage.outputTokens += Number(result?.usage?.outputTokens || 0);

    const rawQuestions = Array.isArray(result?.parsed?.questions) ?
      result.parsed.questions : [];
    const normalised = rawQuestions
      .map((q, i) => normaliseImportedQuestion(q, accum.length + i))
      .filter(Boolean);
    const {fresh} = selectNewQuestions(seenKeys, normalised);
    fresh.forEach((q) => {
      segmentQuestions.push(q);
      accum.push(q);
    });

    const truncated = result?.stopReason === "max_tokens";
    if (truncated) truncationHit = true;

    // Stop conditions:
    //  • nothing new AND not truncated → the segment is exhausted.
    //  • nothing new AND truncated → can't make progress; stop to avoid a
    //    pointless loop (logged via truncationHit so the report flags it).
    if (fresh.length === 0) break;
  }

  return {rounds, truncationHit, usage};
}

/**
 * Erase the existing question set on a quiz before writing fresh AI output.
 * Past-paper quizzes are AI-curated end-to-end; the admin re-runs the importer
 * when they want a clean slate.
 */
async function clearQuizQuestions(quizId) {
  const ref = admin.firestore().collection(`quizzes/${quizId}/questions`);
  const snap = await ref.get();
  if (snap.empty) return 0;
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
 * Build the Firestore question doc for one normalised question, with the
 * per-type fields the editor's schema expects (no options on free-text/numeric
 * types; a finite number for numeric; an index for mcq/tf).
 */
function toQuestionDoc(q, order) {
  const base = {
    type: q.type,
    text: q.prompt,
    textJSON: null,
    explanation: q.explanation || "",
    explanationJSON: null,
    marks: 1,
    order,
    requiresReview: true,
    importedAt: admin.firestore.FieldValue.serverTimestamp(),
    importSource: "past_paper_ai",
  };
  if (q.sourceNumber != null) base.sourcePage = String(q.sourceNumber);

  if (q.type === "mcq" || q.type === "tf") {
    return {
      ...base,
      options: Array.isArray(q.options) ? q.options : [],
      correctAnswer: Number.isInteger(q.correctAnswer) ? q.correctAnswer : 0,
    };
  }
  if (q.type === "numeric") {
    const n = Number(q.correctAnswer);
    return {
      ...base,
      options: [],
      correctAnswer: Number.isFinite(n) ? n : 0,
      tolerance: 0,
    };
  }
  // short_answer / fill_blanks / essay — free-text answer, no options.
  return {
    ...base,
    options: [],
    correctAnswer: typeof q.correctAnswer === "string" ? q.correctAnswer : "",
  };
}

/**
 * Write the extracted questions into the linked quiz's questions subcollection.
 * Deterministic ids q001, q002, … so a re-run rewrites cleanly. Chunked at 400
 * to stay under Firestore's 500-op writeBatch limit — supports any count.
 */
async function writeQuestionsToQuiz(quizId, questions) {
  if (!questions.length) return 0;
  for (let i = 0; i < questions.length; i += 400) {
    const chunk = questions.slice(i, i + 400);
    const batch = admin.firestore().batch();
    chunk.forEach((q, offset) => {
      const id = `q${String(i + offset + 1).padStart(3, "0")}`;
      const ref = admin.firestore().doc(`quizzes/${quizId}/questions/${id}`);
      batch.set(ref, toQuestionDoc(q, i + offset), {merge: false});
    });
    await batch.commit();
  }
  return questions.length;
}

/**
 * Reject early when the caller asks to write into a quiz they don't own. Runs
 * BEFORE the Claude call so an unauthorised quizId neither wipes the target
 * quiz nor burns an AI generation.
 */
async function assertQuizWritable(quizId, uid, isAdmin) {
  const snap = await admin.firestore().doc(`quizzes/${quizId}`).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Target quiz not found.");
  }
  if (!canWriteQuiz(snap.data(), uid, isAdmin)) {
    throw new HttpsError("permission-denied",
      "You can only import questions into your own quiz.");
  }
}

async function runPastPaperImport({uid, paperId, quizId, apiKey, isAdmin = false}) {
  // Authorise the destructive target up front — never clear/overwrite a quiz
  // the caller doesn't own, and don't spend an AI call to find out.
  if (quizId) await assertQuizWritable(quizId, uid, isAdmin);
  const paper = await loadPaperOrThrow(paperId);
  const source = pickSources(paper);
  if (!source) {
    throw new HttpsError("failed-precondition",
      "This paper has no uploaded files. Add a PDF, Word document, " +
      "or scanned images first.");
  }

  const {segments, droppedForSize, extraNote} = await planSegments(source);

  // Extract every segment, accumulating across the whole paper. `seenKeys`
  // dedupes across segments AND rounds; `accum` is the running question list.
  const accum = [];
  const seenKeys = new Set();
  let pagesProcessed = 0;
  let extractionRounds = 0;
  let truncationHit = false;
  const usage = {inputTokens: 0, outputTokens: 0};

  for (const segment of segments) {
    const segResult = await extractSegment({
      apiKey, paper, segment, seenKeys, accum,
    });
    extractionRounds += segResult.rounds;
    if (segResult.truncationHit) truncationHit = true;
    usage.inputTokens += segResult.usage.inputTokens;
    usage.outputTokens += segResult.usage.outputTokens;
    pagesProcessed += segment.pageCount;
  }

  const questionsFound = accum.length;
  const {questions, duplicatesRemoved} = mergeAndRenumber(accum);

  // Persist + keep the parent quiz count in sync.
  let cleared = 0;
  let written = 0;
  if (quizId && questions.length) {
    cleared = await clearQuizQuestions(quizId);
    written = await writeQuestionsToQuiz(quizId, questions);
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

  const report = buildImportReport({
    pagesProcessed,
    segments: segments.length,
    questionsFound,
    questionsImported: written || questions.length,
    duplicatesRemoved,
    extractionRounds,
    truncationHit,
    droppedForSize,
    questions,
    extraNotes: [extraNote],
  });

  // Log to aiGenerations for cost tracking + audit trail.
  try {
    await admin.firestore().collection("aiGenerations").add({
      kind: "past_paper_import",
      paperId,
      quizId: quizId || null,
      uid,
      modelUsed: IMPORT_MODEL,
      sourceKind: source.kind,
      sourcePageCount: pagesProcessed,
      segments: segments.length,
      extractionRounds,
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      questionsReturned: questions.length,
      questionsWritten: written,
      questionsCleared: cleared,
      confidence: report.confidence,
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
  if (truncationHit) {
    warnings.push("A very long section reached the extraction round limit — " +
      "re-run the import to be sure every question was captured.");
  }
  if (questions.length === 0) {
    warnings.push("The AI could not extract any questions from this paper.");
  }

  return {
    questions,
    questionsWritten: written,
    questionsCleared: cleared,
    report,
    usage,
    warning: warnings.length ? warnings.join(" ") : null,
  };
}

function createImportPastPaperQuestions(anthropicApiKeySecret) {
  return onCall(
    {
      secrets: [anthropicApiKeySecret],
      // Long papers run several model calls in sequence; give the function room
      // rather than truncating. Cloud Functions v2 allows up to 3600s.
      timeoutSeconds: 540,
      // PDF + image content blocks live in memory before going to Anthropic.
      memory: "2GiB",
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
      return runPastPaperImport({
        uid, paperId, quizId, apiKey, isAdmin: role === "admin",
      });
    },
  );
}

module.exports = {
  createImportPastPaperQuestions, runPastPaperImport,
  // Source loaders reused by extractAssessmentFormat (same download, size-cap
  // and DOCX→text handling for sample assessment papers).
  loadPaperOrThrow, pickSources, buildMessageBlocks,
  // Re-exported from pastPaperImportHelpers for callers that already import it
  // from here; the test imports the helper module directly.
  dedupeExtractedQuestions,
};
