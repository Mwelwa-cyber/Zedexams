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

// Dependencies are required lazily, not at module load. The CI "Tests" job
// runs `npm run test:all` after a ROOT-only `npm ci` (no functions/node_modules),
// so importing firebase-functions / the model clients at the top would make
// this file unloadable there — and the pure helpers below are exactly what
// that job unit-tests. HttpsError falls back to a plain coded Error when
// firebase-functions isn't installed (test env); production always has it.
function httpsError(code, message) {
  try {
    const {HttpsError} = require("firebase-functions/v2/https");
    return new HttpsError(code, message);
  } catch {
    return Object.assign(new Error(message), {code});
  }
}

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
  "You are digitising a standard Zambian ECZ examination paper for the",
  "ZedExams quiz editor. The user sends the paper as a sequence of scanned",
  "page images. Capture EVERYTHING on the paper — nothing should be left out —",
  "and return it as structured JSON 'sections' via the tool, in the exact",
  "order it appears.",
  "",
  "A section is either a 'passage' (shared content + its questions) or a",
  "'standalone' question. Group correctly:",
  "- COMPREHENSION (English stories, letters, poems, adverts, notices, dialogues,",
  "  reports): emit ONE passage with kind='comprehension', the full text in",
  "  passageText, and every question about it inside questions[]. Never fold a",
  "  story into the previous question's text.",
  "- SHARED MAP / DIAGRAM / FIGURE / TABLE that several questions refer to",
  "  (e.g. a Social Studies map of Zambia, a science apparatus, a graph or a",
  "  data table read by Q5-Q8): emit ONE passage with kind='map', set",
  "  hasImage=true, put the caption in title and any printed lead-in text in",
  "  passageText, and place the dependent questions inside questions[].",
  "- Everything else (single MCQs, sentence-completion, pattern/box puzzles,",
  "  individual maths items): emit a 'standalone' section.",
  "",
  "Question rules:",
  "- sourceQuestionNumber: the printed number (integer); 0 if unreadable.",
  "- prompt: the stem exactly as written; repair obvious OCR/spacing artefacts.",
  "- options: one string per printed choice (usually 4: A, B, C, D), in order,",
  "  WITHOUT the 'A.'/'B.' labels. Preserve wording exactly.",
  "- correctAnswer: ALWAYS null — ECZ question papers print no answer key, so",
  "  never guess. The teacher sets answers afterwards.",
  "- explanation: ''.",
  "- hasDiagram: true when THIS question has its own figure/shape/picture/graph",
  "  printed with it (e.g. a single geometry shape, a Venn diagram, a number",
  "  line). Use the map/diagram passage instead when a figure is shared.",
  "- PICTORIAL OPTIONS: if the answer choices THEMSELVES are pictures/shapes/",
  "  graphs rather than text (e.g. four nets, four diagrams, four bar charts),",
  "  set optionsAreImages=true, keep each options[] entry as its printed label",
  "  (often '') and give optionImageBoxes: one tight bounding box per option,",
  "  in the same order, as {x,y,w,h} fractions (0-1) of the page on the item's",
  "  sourcePageIndex. Use this ONLY for genuinely pictorial options — never for",
  "  text options (leave optionsAreImages false and omit the boxes).",
  "- sourcePageIndex: 0-based index of the page (within this batch) the item is on.",
  "",
  "Preserve STRUCTURE with ZedExams import markup so the editor renders real",
  "nodes — never flatten to prose or '[see diagram]':",
  "- Fractions: \\frac{3}{4} (mixed numbers: 1\\frac{1}{3}).",
  "- Other inline maths (roots, powers, indices, symbols): wrap in $...$,",
  "  e.g. $\\sqrt{49}$, $5^3$, $5\\times10^3$, $313_5$.",
  "- Vertical / column arithmetic: ONE token on its own line —",
  "  [[vmath op=- lines=3623,1894 answer=]] (op is + - * /, lines are the",
  "  operands top-to-bottom, answer empty when the paper does not give it).",
  "- Any table OR a 'complete the pattern' box puzzle (Special Paper): a",
  "  GitHub-style Markdown table — header row, then a |---|---| separator, then",
  "  one row per line. Show an empty answer box as the ▭ character. Example:",
  "  | Word | Pattern |",
  "  | --- | --- |",
  "  | INTEND | TEND |",
  "  | CARTOON | ▭ |",
  "  Apply this markup inside prompt, options and passageText.",
  "",
  "COMPLETENESS IS CRITICAL. Transcribe EVERY numbered question printed on",
  "these pages — do not skip, merge, abbreviate, or summarise items in a long",
  "run. A page typically holds about 6 questions, and a Section A / Part 1 can",
  "list 20 short numbered items in a row; return ALL of them, each as its own",
  "entry, even when consecutive items look similar. Before you finish, scan the",
  "printed numbers and make sure every number you can see has a matching entry",
  "(no gaps in the sequence on these pages).",
  "",
  "Skip ONLY the cover/instructions page and any worked 'Example'. Skip",
  "free-response items (essays, 'explain why'). Do not invent questions.",
].join("\n");

const SCANNED_TOOL_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {type: "string", enum: ["passage", "standalone"]},
          // passage fields
          passageKind: {type: "string", enum: ["comprehension", "map"]},
          title: {type: "string"},
          instructions: {type: "string"},
          passageText: {type: "string"},
          hasImage: {type: "boolean"},
          sourcePageIndex: {type: "integer"},
          questions: {type: "array", items: {$ref: "#/$defs/question"}},
          // standalone field
          question: {$ref: "#/$defs/question"},
        },
        required: ["kind"],
      },
    },
  },
  required: ["sections"],
  $defs: {
    question: {
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
        optionsAreImages: {
          type: "boolean",
          description:
            "True only when the answer options are pictures/shapes/graphs " +
            "rather than text.",
        },
        optionImageBoxes: {
          type: "array",
          description:
            "When optionsAreImages: one bounding box per option (same order " +
            "as options), as fractions 0-1 of the page, tightly around that " +
            "option's picture. Use null for any text option.",
          items: {
            type: ["object", "null"],
            properties: {
              x: {type: "number"},
              y: {type: "number"},
              w: {type: "number"},
              h: {type: "number"},
            },
          },
        },
        sectionTitle: {type: "string"},
        instruction: {type: "string"},
        sourcePageIndex: {type: "integer"},
      },
      required: ["prompt", "options"],
    },
  },
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
    throw httpsError("invalid-argument", "No pages were supplied for import.");
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
    throw httpsError(
      "failed-precondition",
      "Every page image was unreadable or over 5MB. Re-render at a lower resolution and retry.",
    );
  }
  return {pages, dropped};
}

function pageNumberFor(rawIndex, pageNumbers) {
  const pageIdx = Number.parseInt(rawIndex, 10);
  if (Number.isFinite(pageIdx) && pageNumbers[pageIdx] != null) {
    return pageNumbers[pageIdx];
  }
  return pageNumbers[0] ?? null;
}

/**
 * Normalise one question, applying the scanned-import answer policy: answer
 * always blank, flagged for review. Returns null for an unusable item.
 */
function clampUnit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.min(1, Math.max(0, n));
}

// Validate one normalised bounding box {x,y,w,h} (fractions of the page).
// Returns null when it is missing, degenerate, or covers (nearly) the whole
// page — i.e. not a usable per-option crop. Overflow past the right/bottom
// edge is clamped rather than dropped.
function sanitiseBox(box) {
  if (!box || typeof box !== "object") return null;
  let x = clampUnit(box.x);
  let y = clampUnit(box.y);
  let w = clampUnit(box.w);
  let h = clampUnit(box.h);
  if ([x, y, w, h].some((n) => !Number.isFinite(n))) return null;
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  // Too small to be a real picture, or basically the whole page.
  if (w < 0.03 || h < 0.03) return null;
  if (w > 0.98 && h > 0.98) return null;
  return {x, y, w, h};
}

// Build the per-option box array (length === optionCount). Each entry is a
// sanitised box or null (text option). Exported for tests.
function sanitiseOptionBoxes(rawBoxes, optionCount) {
  const list = Array.isArray(rawBoxes) ? rawBoxes : [];
  const out = [];
  for (let i = 0; i < optionCount; i += 1) {
    out.push(sanitiseBox(list[i]));
  }
  return out;
}

/**
 * Normalise one question, applying the scanned-import answer policy: answer
 * always blank, flagged for review. Returns null for an unusable item.
 *
 * Pictorial-option questions (four shapes/graphs instead of text) are kept
 * with `optionsAreImages` + per-option `optionImageBoxes` so the client can
 * crop each option's picture out of the page; their option strings may be
 * blank labels.
 */
function normaliseScannedQuestion(raw, pageNumbers = []) {
  const prompt = clampString(raw?.prompt || raw?.text, 4000).trim();
  if (!prompt) return null;

  const rawOptions = (Array.isArray(raw?.options) ? raw.options : [])
    .map((o) => clampString(o, 1000).trim());

  // Decide whether the options are pictures we can crop.
  let optionsAreImages = false;
  let optionImageBoxes = null;
  let options;
  if (raw?.optionsAreImages) {
    const count = Math.min(
      6,
      Math.max(rawOptions.length, Array.isArray(raw?.optionImageBoxes) ? raw.optionImageBoxes.length : 0),
    );
    const boxes = sanitiseOptionBoxes(raw?.optionImageBoxes, count);
    if (boxes.filter(Boolean).length >= 2) {
      optionsAreImages = true;
      optionImageBoxes = boxes;
      // Keep any printed labels, allow blanks — the picture carries the option.
      options = Array.from({length: count}, (_, i) => rawOptions[i] || "");
    }
  }
  if (!optionsAreImages) {
    options = rawOptions.filter(Boolean).slice(0, 6);
    if (options.length < 2) return null;
  } else if (options.length < 2) {
    return null;
  }

  const num = Number.parseInt(raw?.sourceQuestionNumber, 10);
  return {
    sourceQuestionNumber: Number.isFinite(num) && num > 0 ? num : null,
    text: prompt,
    options,
    correctAnswer: "", // never imported from a question paper
    explanation: "",
    type: "mcq",
    hasDiagram: Boolean(raw?.hasDiagram),
    optionsAreImages,
    optionImageBoxes,
    sectionTitle: clampString(raw?.sectionTitle, 160).trim(),
    sharedInstruction: clampString(raw?.instruction, 1200).trim(),
    sourcePage: pageNumberFor(raw?.sourcePageIndex, pageNumbers),
    requiresReview: true,
  };
}

/**
 * Normalise the model's sections into the editor-facing shape. Passages keep
 * their text + child questions; map/diagram passages keep a hasImage flag so
 * the client attaches the source page image. Standalone questions are wrapped
 * in a one-question section. Empty sections are dropped.
 */
function normaliseScannedSections(rawSections, pageNumbers = []) {
  const list = Array.isArray(rawSections) ? rawSections : [];
  const out = [];

  for (const raw of list) {
    const kind = clampString(raw?.kind, 20).toLowerCase();

    if (kind === "passage") {
      const questions = (Array.isArray(raw?.questions) ? raw.questions : [])
        .map((q) => normaliseScannedQuestion(q, pageNumbers))
        .filter(Boolean);
      if (!questions.length) continue;
      const passageKind = clampString(raw?.passageKind, 20).toLowerCase() === "map" ?
        "map" : "comprehension";
      out.push({
        kind: "passage",
        passageKind,
        title: clampString(raw?.title, 200).trim(),
        instructions: clampString(raw?.instructions, 2000).trim(),
        passageText: clampString(raw?.passageText, 12000).trim(),
        hasImage: Boolean(raw?.hasImage) || passageKind === "map",
        sourcePage: pageNumberFor(raw?.sourcePageIndex, pageNumbers),
        questions,
      });
    } else {
      const question = normaliseScannedQuestion(raw?.question || raw, pageNumbers);
      if (!question) continue;
      out.push({kind: "standalone", question});
    }
  }
  return out;
}

function countSectionQuestions(sections = []) {
  return sections.reduce((total, section) => {
    if (section?.kind === "passage") {
      return total + (Array.isArray(section.questions) ? section.questions.length : 0);
    }
    return total + 1;
  }, 0);
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
    "Digitise EVERYTHING on the pages above into 'sections' using the tool —",
    "passages/stories and maps with their questions grouped, standalone MCQs,",
    "pattern/box puzzles as tables, and all maths in the markup described.",
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
  // Lazy-require the real model clients only when not injected (tests inject
  // both, so they never load firebase-functions-dependent code).
  const callClaude = deps.callClaude ||
    require("./teacherTools/anthropicClient").callClaude;
  const callGemini = deps.callGemini ||
    require("./geminiClient").callGemini;

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
  // maxTokens: English papers include long comprehension passageText (800+
  // words) which balloons the tool-call JSON well past 8 000 output tokens.
  // 16 000 comfortably fits the largest ECZ English batch; Sonnet supports up
  // to 64 K output tokens so this is nowhere near the model ceiling.
  const result = await callClaude(anthropicKey, {
    systemPrompt: CLAUDE_SYSTEM_PROMPT,
    messages: buildClaudeMessages(pages, hints, geminiDraft),
    model: VISION_MODEL,
    maxTokens: 16000,
    temperature: 0.1,
    mode: "tool",
    toolName: "return_sections",
    toolDescription:
      "Return every passage, map/diagram group and question on the pages.",
    toolInputSchema: SCANNED_TOOL_SCHEMA,
  });

  // Surface truncation immediately — a max_tokens stop in tool mode means
  // the tail sections were silently dropped. The tool input is still a valid
  // (but incomplete) JSON object so callClaude does not throw; we must check
  // stopReason ourselves.
  if (result?.stopReason === "max_tokens") {
    warnings.push(
      "The AI hit its output-token limit on this batch — some questions at " +
      "the end of these pages may be missing. Try importing fewer pages at " +
      "once (reduce the batch if that option is available) or re-import the " +
      "affected pages separately.",
    );
    console.warn("[scannedQuizImport] max_tokens stop — batch may be truncated", {
      model: result?.model,
      usage: result?.usage,
    });
  }

  const sections = normaliseScannedSections(
    result?.parsed?.sections,
    pageNumbers,
  );
  const extractedCount = countSectionQuestions(sections);

  const countWarning = reconcileCounts(extractedCount, geminiCount);
  if (countWarning) warnings.push(countWarning);

  return {
    sections,
    warnings,
    pageNumbers,
    detectedCount: geminiCount,
    extractedCount,
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
  normaliseScannedQuestion,
  normaliseScannedSections,
  countSectionQuestions,
  sanitiseOptionBoxes,
  reconcileCounts,
  parseGeminiCount,
  buildClaudeMessages,
  buildGeminiImages,
  CLAUDE_SYSTEM_PROMPT,
  SCANNED_TOOL_SCHEMA,
  MAX_PAGES_PER_CALL,
  VISION_MODEL,
};
