/**
 * scannedQuizImportV2 — extended Claude extraction schema for the Quiz Editor's
 * "import a scanned past paper" flow.
 *
 * Extends scannedQuizImport.js (V1) to support 20+ question types beyond MCQ:
 * fill-in-the-blanks, matching, tables, label-diagrams, true/false, sequences,
 * calculations, structured questions, word problems, essays, and more.
 *
 * The V1 file is left untouched — V2 is a copy-and-extend that swaps in the
 * richer system prompt, expanded tool schema, and a new normaliser that maps
 * each vision-detected type to the correct editor type.
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
// Targeted re-ask rounds when Claude's first pass missed printed numbers
// Gemini saw. Bounded to cap cost/latency.
const MAX_REASK_ROUNDS = 2;
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// ─── V2: vision type → editor type mapping ───────────────────────────────────

const VISION_TYPE_TO_EDITOR = {
  mcq: 'mcq',
  true_false: 'tf',
  fill_blanks: 'fill_blanks',
  short_answer: 'short_answer',
  matching: 'matching',
  table_fill: 'short_answer',   // uses tableData field
  label_diagram: 'diagram',
  sequence: 'sequence',
  calculation: 'numeric',
  structured: 'short_answer',   // uses subParts[]
  diagram_question: 'diagram',
  word_problem: 'short_answer',
  essay: 'essay',
};

// ─── System prompts ──────────────────────────────────────────────────────────

const CLAUDE_SYSTEM_PROMPT_V2 = [
  "You are digitising a standard Zambian ECZ examination paper for the",
  "ZedExams quiz editor. The user sends the paper as a sequence of scanned",
  "page images. Capture EVERYTHING on the paper — nothing should be left out —",
  "and return it as structured JSON 'sections' via the tool, in the exact",
  "order it appears.",
  "",
  "THESE IMAGES ARE PAGES OF THE SAME ASSESSMENT. Read them in page order and",
  "extract the full paper into one continuous editable paper. Keep the original",
  "numbering, sections, instructions, marks, answer options, diagrams and layout",
  "meaning. Do NOT restart numbering on each page unless the original paper does",
  "so. If a question (or its options, passage or diagram) continues from the",
  "bottom of one page onto the next, combine the parts into a single question —",
  "never emit the same printed number twice or split one item into two.",
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
  "- DIAGRAMS — NEVER LEAVE THEM OUT. Many Zambian questions depend on a figure",
  "  (\"study the diagram below and answer the questions\", a labelled science",
  "  drawing, a map, a graph, a number line, a table, a shape). When a question",
  "  has a figure printed with it, set hasDiagram=true AND return a 'diagrams'",
  "  array — one entry per distinct figure, in reading order, each with:",
  "    box: a TIGHT {x,y,w,h} bounding box (fractions 0-1 of the page on the",
  "      item's sourcePageIndex) around JUST that figure, excluding the question",
  "      text and options. Same coordinate system as optionImageBoxes.",
  "    caption: the printed caption/figure label if any (e.g. 'Fig. 2'), else ''.",
  "    kind: what the figure IS — one of: map, labelled_science, body_part,",
  "      plant, animal, tool, food_chart, circuit, photo, number_line, shape,",
  "      venn, bar_chart, line_graph, pie_chart, table, measurement, drawing,",
  "      other.",
  "    complexity: 'complex' for rich/realistic figures that MUST stay as an",
  "      image (maps, labelled science diagrams, body parts, plants, animals,",
  "      tools, food charts, circuit diagrams, realistic pictures); 'simple' for",
  "      figures that could be redrawn accurately (number lines, simple shapes,",
  "      Venn diagrams, bar/line graphs, tables, basic measurement drawings);",
  "      'unsure' when you cannot tell.",
  "    confidence: 0-1, how sure you are this is one distinct figure for this",
  "      question.",
  "  Attach each figure to the question it belongs to — NEVER move a figure to a",
  "  different question or to the end of the paper, and never replace it with",
  "  '[see diagram]'. A figure shared by several questions goes on the map",
  "  passage (set its diagrams array too) instead of repeating on each question.",
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
  "",
  "Question type rules (new in V2):",
  "- Set questionType to the specific type; do NOT default everything to 'mcq'.",
  "- true_false: exactly 2 choices (True/False). Put the declarative statement in",
  "  tfStatement; prompt holds any preamble.",
  "- fill_blanks: use _____ for each gap in statements[].text. Put printed word bank in wordBank[].",
  "- matching: Column A → matchingLeft[], Column B → matchingRight[] (include extras).",
  "  Do not include labels like \"1.\" or \"A.\" — only the text.",
  "- table_fill: emit tableHeaders[] and tableRows[][], using ▭ for blank cells students fill.",
  "- structured: list (a)(b)(c) sub-parts in subParts[] with label, text, marks, answerLines.",
  "- label_diagram: set hasDiagram=true, list label slots in labelSlots[] with slotId.",
  "- marks: always set to the printed mark value (0 if not visible).",
  "- answerLines: count of ruled answer lines printed below the question (0 for MCQ).",
  "- confidence: 0.9+ for clear text; 0.5 for partially readable; 0.3 for poor scan.",
  "- sectionHeader: the section title printed above this question group (e.g. \"SECTION B\").",
].join("\n");

// ─── Tool schemas ─────────────────────────────────────────────────────────────

const SCANNED_TOOL_SCHEMA_V2 = {
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
          // A shared map/figure several questions read — same shape as a
          // question's diagrams (see $defs/diagram).
          diagrams: {type: "array", items: {$ref: "#/$defs/diagram"}},
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
    diagram: {
      type: "object",
      description:
        "A figure printed with the item: picture, graph, map, table, number " +
        "line, shape, labelled drawing or science diagram. Always attach it to " +
        "the item it belongs to; never drop or move it.",
      properties: {
        box: {
          type: "object",
          description:
            "Tight bounding box around just this figure, as fractions 0-1 of " +
            "the page on the item's sourcePageIndex.",
          properties: {
            x: {type: "number"},
            y: {type: "number"},
            w: {type: "number"},
            h: {type: "number"},
          },
        },
        caption: {type: "string"},
        kind: {
          type: "string",
          enum: [
            "map", "labelled_science", "body_part", "plant", "animal", "tool",
            "food_chart", "circuit", "photo", "number_line", "shape", "venn",
            "bar_chart", "line_graph", "pie_chart", "table", "measurement",
            "drawing", "other",
          ],
        },
        complexity: {type: "string", enum: ["complex", "simple", "unsure"]},
        confidence: {type: "number"},
      },
    },
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
        diagrams: {
          type: "array",
          description:
            "Every figure printed with THIS question (see $defs/diagram). " +
            "Empty when the question is text-only. Never leave a figure out.",
          items: {$ref: "#/$defs/diagram"},
        },
        sectionTitle: {type: "string"},
        instruction: {type: "string"},
        sourcePageIndex: {type: "integer"},
        // ── V2 additions ──────────────────────────────────────────────────────
        questionType: {
          type: "string",
          enum: [
            "mcq", "true_false", "fill_blanks", "short_answer", "matching",
            "table_fill", "label_diagram", "sequence", "calculation",
            "structured", "diagram_question", "word_problem", "essay",
          ],
          description: "The specific question type detected.",
        },
        confidence: {
          type: "number",
          description: "0.0–1.0 confidence that this question was read correctly. Below 0.6 = needs review.",
        },
        marks: {
          type: "integer",
          description: "Printed marks for this question. 0 if not visible.",
        },
        answerLines: {
          type: "integer",
          description: "Number of ruled answer lines printed. 0 for MCQ/no lines.",
        },
        sectionHeader: {
          type: "string",
          description: "Section heading printed above this question group.",
        },
        tfStatement: {
          type: "string",
          description: "For true_false: the declarative sentence that is True or False.",
        },
        statements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: {type: "string"},
              blanks: {type: "integer"},
            },
          },
          description: "For fill_blanks: sentences with _____ placeholders.",
        },
        wordBank: {
          type: "array",
          items: {type: "string"},
          description: "For fill_blanks: printed word bank options.",
        },
        matchingLeft: {
          type: "array",
          items: {type: "string"},
          description: "For matching: Column A items.",
        },
        matchingRight: {
          type: "array",
          items: {type: "string"},
          description: "For matching: Column B options.",
        },
        tableHeaders: {
          type: "array",
          items: {type: "string"},
          description: "For table_fill: column headers.",
        },
        tableRows: {
          type: "array",
          items: {type: "array", items: {type: "string"}},
          description: "For table_fill: rows, using ▭ for blank cells.",
        },
        subParts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: {type: "string"},
              text: {type: "string"},
              marks: {type: "integer"},
              answerLines: {type: "integer"},
            },
          },
          description: "For structured: sub-parts (a)(b)(c).",
        },
        labelSlots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slotId: {type: "string"},
              answer: {type: "string"},
            },
          },
          description: "For label_diagram: blank label slots.",
        },
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

// ─── Pure helpers (copied verbatim from V1) ───────────────────────────────────

function clampString(value, max) {
  return String(value == null ? "" : value)
    .replace(/ /g, " ")
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

// ─── Diagram detection + classification ─────────────────────────────────────

const MAX_DIAGRAMS_PER_QUESTION = 6;
const DIAGRAM_REVIEW_CONFIDENCE = 0.45;
const COMPLEX_DIAGRAM_KINDS = new Set([
  "map", "labelled_science", "body_part", "plant", "animal", "tool",
  "food_chart", "circuit", "photo",
]);
const SIMPLE_DIAGRAM_KINDS = new Set([
  "number_line", "shape", "venn", "bar_chart", "line_graph", "pie_chart",
  "table", "measurement",
]);

function classifyDiagram({kind, complexity, confidence} = {}) {
  const k = String(kind || "").toLowerCase();
  const cx = String(complexity || "").toLowerCase();
  const conf = Number(confidence);
  const c = Number.isFinite(conf) ? conf : 1;

  if (c < DIAGRAM_REVIEW_CONFIDENCE || cx === "unsure" || k === "other" || k === "") {
    return "review";
  }
  if (COMPLEX_DIAGRAM_KINDS.has(k)) return "preserve";
  if (SIMPLE_DIAGRAM_KINDS.has(k)) return "recreate";
  if (cx === "complex") return "preserve";
  if (cx === "simple") return "recreate";
  return "clean";
}

function sanitiseDiagram(raw) {
  if (!raw || typeof raw !== "object") return null;
  const box = sanitiseBox(raw.box);
  if (!box) return null;
  const kind = clampString(raw.kind, 40).toLowerCase();
  const complexity = ["complex", "simple", "unsure"]
    .includes(String(raw.complexity || "").toLowerCase()) ?
    String(raw.complexity).toLowerCase() : "unsure";
  let confidence = Number(raw.confidence);
  confidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5;
  const caption = clampString(raw.caption, 240).trim();
  return {
    box,
    caption,
    kind: kind || "other",
    complexity,
    confidence,
    classification: classifyDiagram({kind, complexity, confidence}),
  };
}

function sanitiseDiagrams(rawList, max = MAX_DIAGRAMS_PER_QUESTION) {
  const list = Array.isArray(rawList) ? rawList : [];
  const out = [];
  for (const raw of list) {
    const diagram = sanitiseDiagram(raw);
    if (diagram) out.push(diagram);
    if (out.length >= max) break;
  }
  return out;
}

// ─── V2 normaliser ────────────────────────────────────────────────────────────

/**
 * Normalise one Claude V2 question object into the editor-facing shape.
 *
 * Unlike the V1 normaliser (which hardcodes type='mcq' and requiresReview=true
 * for everything), V2 maps each vision-detected questionType to the correct
 * editor type and derives requiresReview from the model's own confidence score.
 *
 * @param {object} raw  - Raw question object from the Claude tool output
 * @param {object} opts
 * @param {number} opts.sourcePageIndex - 0-based page index (default 0)
 * @returns {object} Normalised question for the editor
 */
function normaliseScannedQuestionV2(raw, { sourcePageIndex = 0 } = {}) {
  const editorType = VISION_TYPE_TO_EDITOR[raw.questionType] ?? 'mcq';
  const lowConfidence = typeof raw.confidence === 'number' && raw.confidence < 0.6;
  const importWarnings = [];
  if (lowConfidence) {
    importWarnings.push(`Low confidence (${(raw.confidence * 100).toFixed(0)}%) — check this question`);
  }

  const base = {
    type: editorType,
    text: raw.prompt ?? '',
    options: raw.options ?? [],
    correctAnswer: '',
    marks: raw.marks ?? 1,
    answerLines: raw.answerLines ?? 0,
    hasDiagram: raw.hasDiagram ?? false,
    diagrams: raw.diagrams ?? [],
    requiresReview: lowConfidence,
    importWarnings,
    sourcePage: sourcePageIndex,
    optionsAreImages: raw.optionsAreImages ?? false,
    optionImageBoxes: raw.optionImageBoxes ?? [],
  };

  if (editorType === 'fill_blanks') {
    base.statements = raw.statements ?? [];
    base.wordBank = raw.wordBank ?? [];
  } else if (editorType === 'tf') {
    base.options = ['True', 'False'];
    if (raw.tfStatement) base.text = raw.tfStatement;
  } else if (editorType === 'matching') {
    base.matchingLeft = raw.matchingLeft ?? [];
    base.matchingRight = raw.matchingRight ?? [];
  } else if (editorType === 'short_answer' && raw.questionType === 'table_fill') {
    base.tableData = {
      headers: raw.tableHeaders ?? [],
      rows: raw.tableRows ?? [],
    };
  } else if (editorType === 'short_answer' && raw.questionType === 'structured') {
    base.subParts = (raw.subParts ?? []).map(sp => ({
      text: sp.text ?? '',
      answer: '',
      marks: sp.marks ?? 1,
      answerFormat: 'lines',
      answerLines: sp.answerLines ?? 2,
    }));
  } else if (editorType === 'diagram' && raw.questionType === 'label_diagram') {
    base.diagramMode = 'identify';
    base.diagramLabels = (raw.labelSlots ?? []).map((slot, i) => ({
      id: `slot-${i}`,
      x: 0.1 + i * 0.15,
      y: 0.5,
      text: slot.answer ?? '',
    }));
  }

  return base;
}

// ─── Section normaliser (V1 compatible, used internally by runScannedQuizImportV2) ─

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
      const diagrams = sanitiseDiagrams(raw?.diagrams);
      out.push({
        kind: "passage",
        passageKind,
        title: clampString(raw?.title, 200).trim(),
        instructions: clampString(raw?.instructions, 2000).trim(),
        passageText: clampString(raw?.passageText, 12000).trim(),
        hasImage: Boolean(raw?.hasImage) || passageKind === "map" || diagrams.length > 0,
        diagrams,
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

/**
 * V1-compatible question normaliser used by normaliseScannedSections above.
 * Kept here so the V2 orchestrator (runScannedQuizImportV2) can reuse the
 * section normaliser without importing V1. Returns null for unusable items.
 */
function normaliseScannedQuestion(raw, pageNumbers = []) {
  const prompt = clampString(raw?.prompt || raw?.text, 4000).trim();
  if (!prompt) return null;

  const rawOptions = (Array.isArray(raw?.options) ? raw.options : [])
    .map((o) => clampString(o, 1000).trim());

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
  const diagrams = sanitiseDiagrams(raw?.diagrams);
  return {
    sourceQuestionNumber: Number.isFinite(num) && num > 0 ? num : null,
    text: prompt,
    options,
    correctAnswer: "",
    explanation: "",
    type: "mcq",
    hasDiagram: Boolean(raw?.hasDiagram) || diagrams.length > 0,
    diagrams,
    optionsAreImages,
    optionImageBoxes,
    sectionTitle: clampString(raw?.sectionTitle, 160).trim(),
    sharedInstruction: clampString(raw?.instruction, 1200).trim(),
    sourcePage: pageNumberFor(raw?.sourcePageIndex, pageNumbers),
    requiresReview: true,
  };
}

function countSectionQuestions(sections = []) {
  return sections.reduce((total, section) => {
    if (section?.kind === "passage") {
      return total + (Array.isArray(section.questions) ? section.questions.length : 0);
    }
    return total + 1;
  }, 0);
}

function reconcileCounts(claudeCount, geminiCount) {
  if (!Number.isFinite(geminiCount) || geminiCount <= 0) return null;
  if (claudeCount >= geminiCount - 1) return null;
  return (
    `A page scan saw about ${geminiCount} questions but ${claudeCount} were ` +
    "extracted — some questions on these pages may be missing. Please check " +
    "against the original."
  );
}

function parseGeminiNumbers(text) {
  try {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    const arr = Array.isArray(parsed.questionNumbers) ? parsed.questionNumbers : [];
    const nums = arr
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isInteger(n) && n > 0 && n <= 500);
    return [...new Set(nums)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function parseGeminiCount(text) {
  const nums = parseGeminiNumbers(text);
  if (nums.length) return nums.length;
  try {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return 0;
    const parsed = JSON.parse(match[0]);
    return Number.isFinite(parsed.count) ? Number(parsed.count) : 0;
  } catch {
    return 0;
  }
}

function flattenSectionQuestions(sections = []) {
  const out = [];
  sections.forEach((section) => {
    if (section?.kind === "passage") {
      (section.questions || []).forEach((q) => out.push(q));
    } else if (section?.question) {
      out.push(section.question);
    }
  });
  return out;
}

function extractedNumberSet(sections = []) {
  const set = new Set();
  flattenSectionQuestions(sections).forEach((q) => {
    if (Number.isInteger(q?.sourceQuestionNumber) && q.sourceQuestionNumber > 0) {
      set.add(q.sourceQuestionNumber);
    }
  });
  return set;
}

function computeMissingNumbers(expected = [], extractedSet = new Set()) {
  return expected
    .filter((n) => !extractedSet.has(n))
    .slice(0, 40);
}

function expectedBatchNumbers(geminiNumbers = [], extractedSet = new Set()) {
  const expected = new Set(geminiNumbers);
  const nums = [...extractedSet].filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length >= 2) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (hi - lo <= 80) {
      for (let n = lo; n <= hi; n += 1) expected.add(n);
    }
  }
  return [...expected].sort((a, b) => a - b);
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
    "For every question that has a figure (diagram, picture, graph, map, table,",
    "number line, shape, labelled drawing), set hasDiagram=true and return its",
    "diagrams[] with a bounding box, kind, complexity and confidence. Do NOT",
    "drop figures and do NOT move a figure to another question.",
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

function buildReaskMessages(pages, hints, missingNumbers) {
  const content = [];
  pages.forEach((page, idx) => {
    content.push({type: "text", text: `--- Page ${idx + 1} (paper page ${page.pageNumber}) ---`});
    content.push({
      type: "image",
      source: {type: "base64", media_type: page.mediaType, data: page.data},
    });
  });
  const tail = [
    "You already read these pages, but these printed question numbers were " +
    `MISSED: ${missingNumbers.join(", ")}.`,
    "Transcribe ONLY those questions, exactly as printed, each as a 'standalone'",
    "section using the tool and the same rules (options without A/B/C/D labels,",
    "correctAnswer always null, maths/table markup preserved).",
    "Set each one's sourceQuestionNumber to its printed number.",
    "If a listed number is actually a worked Example or not a real",
    "multiple-choice question, simply omit it — do not invent anything.",
    hints?.subject ? `Subject: ${hints.subject}` : "",
    hints?.grade ? `Grade: ${hints.grade}` : "",
  ].filter(Boolean).join("\n");
  content.push({type: "text", text: tail});
  return [{role: "user", content}];
}

// ─── V2 Orchestrator ──────────────────────────────────────────────────────────

async function runScannedQuizImportV2(
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
  let geminiNumbers = [];
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
      geminiNumbers = parseGeminiNumbers(text);
      geminiCount = geminiNumbers.length || parseGeminiCount(text);
      geminiDraft = clampString(text, 600);
    } catch (err) {
      console.warn("[scannedQuizImportV2] Gemini assist failed", {
        message: err?.message?.slice(0, 200),
      });
    }
  }

  // Primary pass (Claude vision) — authoritative structured extraction.
  // maxTokens: V2 supports richer question types (structured, table_fill,
  // label_diagram) which produce larger tool-call JSON. 24000 comfortably fits
  // the largest ECZ batch including fill-blanks and matching sections; Sonnet
  // supports up to 64K output tokens so this is nowhere near the model ceiling.
  const result = await callClaude(anthropicKey, {
    systemPrompt: CLAUDE_SYSTEM_PROMPT_V2,
    messages: buildClaudeMessages(pages, hints, geminiDraft),
    model: VISION_MODEL,
    maxTokens: 24000,
    temperature: 0.1,
    mode: "tool",
    toolName: "return_sections",
    toolDescription:
      "Return every passage, map/diagram group and question on the pages.",
    toolInputSchema: SCANNED_TOOL_SCHEMA_V2,
  });

  // Surface truncation immediately — a max_tokens stop in tool mode means
  // the tail sections were silently dropped.
  if (result?.stopReason === "max_tokens") {
    warnings.push(
      "The AI hit its output-token limit on this batch — some questions at " +
      "the end of these pages may be missing. Try importing fewer pages at " +
      "once (reduce the batch if that option is available) or re-import the " +
      "affected pages separately.",
    );
    console.warn("[scannedQuizImportV2] max_tokens stop — batch may be truncated", {
      model: result?.model,
      usage: result?.usage,
    });
  }

  const sections = normaliseScannedSections(
    result?.parsed?.sections,
    pageNumbers,
  );

  // Number-driven completeness: hold Claude's first pass against the printed
  // numbers Gemini saw, and re-ask specifically for any it missed.
  let recovered = 0;
  {
    const extracted = extractedNumberSet(sections);
    const expected = expectedBatchNumbers(geminiNumbers, extracted);
    let missing = computeMissingNumbers(expected, extracted);
    let round = 0;
    while (missing.length && round < MAX_REASK_ROUNDS) {
      round += 1;
      let reask;
      try {
        reask = await callClaude(anthropicKey, {
          systemPrompt: CLAUDE_SYSTEM_PROMPT_V2,
          messages: buildReaskMessages(pages, hints, missing),
          model: VISION_MODEL,
          maxTokens: 8000,
          temperature: 0.1,
          mode: "tool",
          toolName: "return_sections",
          toolDescription: "Return only the requested missing questions.",
          toolInputSchema: SCANNED_TOOL_SCHEMA_V2,
        });
      } catch (err) {
        console.warn("[scannedQuizImportV2] re-ask round failed", {
          message: err?.message?.slice(0, 200),
        });
        break;
      }
      const reaskSections = normaliseScannedSections(reask?.parsed?.sections, pageNumbers);
      const wanted = new Set(missing);
      let added = 0;
      flattenSectionQuestions(reaskSections).forEach((q) => {
        const n = q?.sourceQuestionNumber;
        if (Number.isInteger(n) && wanted.has(n) && !extracted.has(n)) {
          sections.push({kind: "standalone", question: q});
          extracted.add(n);
          added += 1;
        }
      });
      recovered += added;
      if (!added) break;
      missing = computeMissingNumbers(expected, extracted);
    }
    if (recovered > 0) {
      console.warn("[scannedQuizImportV2] recovered missing questions via re-ask", {
        recovered,
        rounds: round,
      });
    }
  }

  const extractedCount = countSectionQuestions(sections);

  const countWarning = reconcileCounts(extractedCount, geminiCount);
  if (countWarning) warnings.push(countWarning);

  return {
    sections,
    warnings,
    pageNumbers,
    detectedCount: geminiCount,
    extractedCount,
    recovered,
    model: result?.model || VISION_MODEL,
    usage: result?.usage || null,
    fileName: clampString(fileName, 180),
    uid: uid || null,
  };
}

module.exports = {
  normaliseScannedQuestionV2,
  runScannedQuizImportV2,
  // Exported for tests / introspection:
  CLAUDE_SYSTEM_PROMPT_V2,
  SCANNED_TOOL_SCHEMA_V2,
  VISION_TYPE_TO_EDITOR,
};
