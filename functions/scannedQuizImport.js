/**
 * scannedQuizImport — dual-model OCR pipeline for the Quiz Editor's
 * "import a scanned past paper" flow.
 *
 * Scanned ECZ papers (the ones teachers upload most) have NO text layer:
 * every page is a photographed sheet. PDF.js text extraction returns
 * nothing, so the old text-based importer turned a 12-page / 60-question
 * paper into ~12 "review this diagram" blobs. This module fixes that by
 * reading the rendered page images with vision models.
 *
 * Two models, by design (see PR discussion):
 *   - Claude vision is the PRIMARY OCR + structuring reasoner. It reads the
 *     page images and emits clean, structured MCQs via a tool schema.
 *   - Gemini 2.5 Flash is the cheap ASSIST: it does a fast recall pass over
 *     the same pages and reports how many questions it saw. That count is
 *     cross-checked against Claude's output so Claude can never silently
 *     under-extract a batch without the teacher being warned.
 *
 * Answer handling: these question papers ship without a mark scheme (answers
 * were on a separate sheet), so we NEVER guess. correctAnswer is always left
 * blank and every imported question is flagged requiresReview — the teacher
 * sets the answers in the editor before publishing.
 *
 * The pure helpers (validation, normalisation, reconciliation, prompt
 * builders) are exported and unit-tested in scannedQuizImport.test.js; the
 * model calls are injected so the tests run without network access.
 */

const {HttpsError} = require("firebase-functions/v2/https");
const {callClaude: defaultCallClaude} = require("./teacherTools/anthropicClient");
const {callGemini: defaultCallGemini} = require("./geminiClient");

// The vision OCR model is configurable so the project owner can dial cost vs
// quality without a code change. Defaults to the project-wide Anthropic model
// (Sonnet) when no override is set.
const VISION_MODEL =
  process.env.SCANNED_IMPORT_MODEL ||
  process.env.ANTHROPIC_VISION_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "claude-sonnet-4-5";

// Caps. A batch is a handful of pages so each model call stays inside the
// output-token budget and the function timeout. The client paginates a long
// paper into several batches and merges the results.
const MAX_PAGES_PER_CALL = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // per page, decoded
const MAX_QUESTIONS_PER_CALL = 60;
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const CLAUDE_SYSTEM_PROMPT = [
  "You are digitising a Zambian ECZ examination paper for the ZedExams quiz",
  "editor. The user sends you the paper as a sequence of scanned page images.",
  "Read EVERY question on the pages and return them as structured JSON via the",
  "tool, in the exact order they appear.",
  "",
  "Rules:",
  "- One entry per question. Use the printed question number as",
  "  sourceQuestionNumber (an integer). If a number is unreadable, set it to 0.",
  "- prompt: the question stem, exactly as written. Preserve inline maths,",
  "  units and labels. Repair obvious OCR/spacing artefacts in the scan.",
  "- options: one string per choice the paper offers (usually 4: A, B, C, D),",
  "  in order, WITHOUT the 'A.'/'B.' letter labels. Preserve wording exactly.",
  "- correctAnswer: ALWAYS null. These question papers do not print an answer",
  "  key, so never guess — the teacher fills answers in afterwards.",
  "- explanation: leave empty ('').",
  "- hasDiagram: true when the question depends on a figure, picture, table,",
  "  graph, shape or diagram printed on the page; false for plain text.",
  "- sectionTitle: the nearest section/part heading above the question",
  "  (e.g. 'Section A', 'Part 1') or ''. instruction: any shared instruction",
  "  that applies to the question (e.g. 'Choose the word that best completes",
  "  the sentence') or ''.",
  "- Skip the cover/instructions page and worked examples. Skip non-MCQ items",
  "  (essays, 'explain why'). Do not invent questions.",
  "",
  "Accuracy over coverage, but do not drop readable questions: a 6-page batch",
  "of an ECZ paper typically holds 25-35 questions.",
].join("\n");

const SCANNED_TOOL_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceQuestionNumber: {type: "integer"},
          prompt: {type: "string"},
          options: {
            type: "array",
            items: {type: "string"},
            minItems: 2,
            maxItems: 6,
          },
          correctAnswer: {type: ["integer", "null"]},
          explanation: {type: "string"},
          hasDiagram: {type: "boolean"},
          sectionTitle: {type: "string"},
          instruction: {type: "string"},
          sourcePageIndex: {
            type: "integer",
            description:
              "0-based index of the page (within this batch) the question " +
              "appears on, so its diagram can be attached.",
          },
        },
        required: ["prompt", "options"],
      },
    },
  },
  required: ["questions"],
};

const GEMINI_SYSTEM_PROMPT = [
  "You are a fast page scanner for an exam-digitising pipeline. The user sends",
  "scanned exam pages. Report ONLY the printed question numbers you can see, as",
  "JSON. Include every numbered question stem; ignore the cover page, examples,",
  "options and diagrams. Do not transcribe text. Return only the JSON object.",
].join(" ");

// ─── Pure helpers ────────────────────────────────────────────────────────────

function clampString(value, max) {
  return String(value == null ? "" : value)
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, max);
}


/**
 * Validate and bound an incoming batch of page images. Throws on a batch that
 * is empty or entirely oversized; silently drops individual oversized pages
 * (reported via the returned `dropped` count) so one huge scan doesn't sink
 * the whole import.
 *
 * Each page in: { pageNumber, dataUrl } where dataUrl is
 * "data:image/jpeg;base64,...." Returns decoded { pageNumber, mediaType, data }.
 */
function validatePages(rawPages) {
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    throw new HttpsError("invalid-argument", "No pages were supplied for import.");
  }
  const pages = [];
  let dropped = 0;
  for (const page of rawPages.slice(0, MAX_PAGES_PER_CALL)) {
    const dataUrl = String(page?.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) {
      dropped += 1;
      continue;
    }
    const mediaType = match[1].toLowerCase();
    if (!ALLOWED_IMAGE_MIME.has(mediaType)) {
      dropped += 1;
      continue;
    }
    const data = match[2].replace(/\s+/g, "");
    // base64 decodes to ~3/4 of its length in bytes.
    if ((data.length * 3) / 4 > MAX_IMAGE_BYTES) {
      dropped += 1;
      continue;
    }
    const pageNumber = Number.parseInt(page?.pageNumber, 10);
    pages.push({
      pageNumber: Number.isFinite(pageNumber) ? pageNumber : pages.length + 1,
      mediaType,
      data,
    });
  }
  if (!pages.length) {
    throw new HttpsError(
      "failed-precondition",
      "Every page image was unreadable or over 5MB. Re-render at a lower resolution and retry.",
    );
  }
  return {pages, dropped};
}

/**
 * Force the scanned-import answer policy: blank answer, flagged for review.
 * Drops entries without a usable stem + at least two options. Re-bases the
 * model's per-batch sourcePageIndex onto the real page numbers so a question's
 * diagram can be attached to the right page client-side.
 */
function normaliseScannedQuestions(rawQuestions, pageNumbers = []) {
  const list = Array.isArray(rawQuestions) ? rawQuestions : [];
  const out = [];
  for (const raw of list.slice(0, MAX_QUESTIONS_PER_CALL)) {
    const prompt = clampString(raw?.prompt || raw?.text, 4000).trim();
    const options = (Array.isArray(raw?.options) ? raw.options : [])
      .map((o) => clampString(o, 1000).trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!prompt || options.length < 2) continue;

    const num = Number.parseInt(raw?.sourceQuestionNumber, 10);
    const pageIdx = Number.parseInt(raw?.sourcePageIndex, 10);
    const sourcePage = Number.isFinite(pageIdx) && pageNumbers[pageIdx] != null ?
      pageNumbers[pageIdx] :
      (pageNumbers[0] ?? null);

    out.push({
      sourceQuestionNumber: Number.isFinite(num) && num > 0 ? num : null,
      text: prompt,
      options,
      // Answer policy: never imported from a question paper. Always blank.
      correctAnswer: "",
      explanation: "",
      type: "mcq",
      hasDiagram: Boolean(raw?.hasDiagram),
      sectionTitle: clampString(raw?.sectionTitle, 160).trim(),
      sharedInstruction: clampString(raw?.instruction, 1200).trim(),
      sourcePage,
      requiresReview: true,
    });
  }
  return out;
}

/**
 * Compare the primary (Claude) extraction count against the assist (Gemini)
 * recall count for one batch. Returns a warning string when Claude returned
 * meaningfully fewer questions than Gemini saw — the classic "dropped
 * questions" failure — or null when the counts agree closely.
 */
function reconcileCounts(claudeCount, geminiCount) {
  if (!Number.isFinite(geminiCount) || geminiCount <= 0) return null;
  // Allow a small slack: Gemini over-counts headers/examples sometimes.
  if (claudeCount >= geminiCount - 1) return null;
  return (
    `A page scan saw about ${geminiCount} questions but ${claudeCount} were ` +
    "extracted — some questions on these pages may be missing. Please check " +
    "against the original."
  );
}

function parseGeminiCount(text) {
  try {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return 0;
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed.questionNumbers)) return parsed.questionNumbers.length;
    if (Number.isFinite(parsed.count)) return Number(parsed.count);
    return 0;
  } catch {
    return 0;
  }
}

function buildClaudeMessages(pages, hints, geminiDraft) {
  const content = [];
  pages.forEach((page, idx) => {
    content.push({type: "text", text: `--- Page ${idx + 1} (paper page ${page.pageNumber}) ---`});
    content.push({
      type: "image",
      source: {type: "base64", media_type: page.mediaType, data: page.data},
    });
  });
  const tail = [
    "Extract every multiple-choice question from the pages above using the tool.",
    hints?.subject ? `Subject: ${hints.subject}` : "",
    hints?.grade ? `Grade: ${hints.grade}` : "",
    geminiDraft ?
      `A fast scan reported these question numbers (use only to check you did ` +
      `not miss any; verify against the images): ${geminiDraft}` : "",
    "Remember: correctAnswer is always null — do not guess answers.",
  ].filter(Boolean).join("\n");
  content.push({type: "text", text: tail});
  return [{role: "user", content}];
}

function buildGeminiImages(pages) {
  return pages.map((page) => ({mimeType: page.mediaType, data: page.data}));
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function runScannedQuizImport(
  {pages: rawPages, fileName, subjectHint, gradeHint, anthropicKey, geminiKey, uid},
  deps = {},
) {
  const callClaude = deps.callClaude || defaultCallClaude;
  const callGemini = deps.callGemini || defaultCallGemini;

  const {pages, dropped} = validatePages(rawPages);
  const pageNumbers = pages.map((p) => p.pageNumber);
  const hints = {subject: clampString(subjectHint, 80), grade: clampString(gradeHint, 20)};
  const warnings = [];
  if (dropped > 0) {
    warnings.push(`${dropped} page${dropped === 1 ? "" : "s"} were skipped (unreadable or too large).`);
  }

  // Assist pass (Gemini) — cheap recall. Best-effort: a failure here only
  // costs us the count cross-check, never the import itself.
  let geminiCount = 0;
  let geminiDraft = "";
  if (geminiKey) {
    try {
      const text = await callGemini(geminiKey, {
        systemPrompt: GEMINI_SYSTEM_PROMPT,
        userPrompt:
          "List the printed question numbers across these pages as " +
          '{"questionNumbers":[...]}. JSON only.',
        images: buildGeminiImages(pages),
        responseJson: true,
        maxTokens: 1200,
        temperature: 0,
      });
      geminiCount = parseGeminiCount(text);
      geminiDraft = clampString(text, 600);
    } catch (err) {
      console.warn("[scannedQuizImport] Gemini assist failed", {
        message: err?.message?.slice(0, 200),
      });
    }
  }

  // Primary pass (Claude vision) — authoritative structured extraction.
  const result = await callClaude(anthropicKey, {
    systemPrompt: CLAUDE_SYSTEM_PROMPT,
    messages: buildClaudeMessages(pages, hints, geminiDraft),
    model: VISION_MODEL,
    maxTokens: 8000,
    temperature: 0.1,
    mode: "tool",
    toolName: "return_questions",
    toolDescription: "Return every multiple-choice question found on the pages.",
    toolInputSchema: SCANNED_TOOL_SCHEMA,
  });

  const questions = normaliseScannedQuestions(
    result?.parsed?.questions,
    pageNumbers,
  );

  const countWarning = reconcileCounts(questions.length, geminiCount);
  if (countWarning) warnings.push(countWarning);

  return {
    questions,
    warnings,
    pageNumbers,
    detectedCount: geminiCount,
    extractedCount: questions.length,
    model: result?.model || VISION_MODEL,
    usage: result?.usage || null,
    fileName: clampString(fileName, 180),
    uid: uid || null,
  };
}

module.exports = {
  runScannedQuizImport,
  // Exported for tests:
  validatePages,
  normaliseScannedQuestions,
  reconcileCounts,
  parseGeminiCount,
  buildClaudeMessages,
  buildGeminiImages,
  CLAUDE_SYSTEM_PROMPT,
  SCANNED_TOOL_SCHEMA,
  MAX_PAGES_PER_CALL,
  VISION_MODEL,
};
