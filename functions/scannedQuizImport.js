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

// Question typing (mcq / true_false / fill_blank / matching / short_answer) +
// marks parsing. Pure + dependency-free so requiring it at the top is safe even
// in the root-only CI test env (no firebase deps pulled in).
const {
  normaliseQuestionType,
  classifyQuestionType,
  extractMarks,
} = require("./teacherTools/testPaperImport/questionTyping");

// The vision OCR model is configurable so the project owner can dial cost vs
// quality without a code change. Defaults to the project-wide Anthropic model
// (Sonnet) when no override is set.
const VISION_MODEL =
  process.env.SCANNED_IMPORT_MODEL ||
  process.env.ANTHROPIC_VISION_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "claude-sonnet-4-5";

// Engine version stamp. Returned on every import result and surfaced in the
// editor so a STALE DEPLOY is observable: if the version the live importer
// reports doesn't match this string, the Cloud Function did not actually ship
// the latest code (the silent firebase-tools "exit 0 but stale" failure that
// repeatedly made importer fixes look broken in production while passing every
// test). Bump this whenever the server extraction logic changes.
const SCANNED_IMPORT_ENGINE_VERSION = "2026.07.09-zeroyield";

// Caps. A batch is a handful of pages so each model call stays inside the
// output-token budget and the function timeout. The client paginates a long
// paper into several batches and merges the results.
const MAX_PAGES_PER_CALL = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // per page, decoded
const MAX_QUESTIONS_PER_CALL = 60;
// Targeted re-ask rounds when Claude's first pass missed printed numbers
// Gemini saw. Bounded to cap cost/latency — but high enough that a long,
// dense batch that keeps surfacing more missing numbers each round isn't
// abandoned with questions still un-recovered (the "stops short on big
// papers" complaint). Each round only re-asks for the still-missing numbers,
// so a clean batch still costs zero extra rounds.
const MAX_REASK_ROUNDS = 3;
// Wall-clock budget for the whole import call. The function's own deadline is
// 300s (functions/index.js); if the primary pass + re-ask rounds ride into
// that, Cloud Functions kills the request and the CLIENT LOSES EVERYTHING the
// call had already extracted — the "one group of pages could not be read"
// failure that keeps the same dense pages missing on every re-import. So the
// re-ask loop checks elapsed time and stops early, returning the partial (but
// real) result with a warning instead; the client's own recovery pass then
// re-reads the affected pages in smaller batches. `deps.now` is injectable so
// tests can simulate a slow batch without waiting.
const REASK_TIME_BUDGET_MS = 210 * 1000;
// Cap on how many missing printed numbers we re-ask for in one batch. Guards
// against a hallucinated Gemini number list triggering an unbounded re-ask,
// but set well above any real batch's question count so a genuinely long run
// is fully recovered rather than truncated at the old 40.
const MAX_REASK_NUMBERS = 120;
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
  "- NEVER invent, complete or guess content. If any word, option, number or",
  "  symbol is unreadable, output the literal token [UNCLEAR] in its place",
  "  instead of guessing. It is always better to mark [UNCLEAR] than to fabricate",
  "  text. Do not add options, questions or answers that are not printed.",
  "- sourceQuestionNumber: the printed number (integer); 0 if unreadable.",
  "- prompt: the stem exactly as written; repair obvious OCR/spacing artefacts,",
  "  but mark anything you genuinely cannot read as [UNCLEAR] rather than guess.",
  "- questionType: classify EACH question — 'mcq' (printed answer choices),",
  "  'true_false' (a statement with True/False), 'fill_blank' (a sentence with a",
  "  blank line / underline / box to complete), 'matching' (two columns to join),",
  "  'diagram_label' (label or name the parts of a printed figure, e.g. \"label",
  "  the parts of the plant\" / \"name the parts marked A, B, C\"), or",
  "  'short_answer' (the learner writes on blank lines). Capture ALL of these",
  "  types, not only multiple choice. Use 'short_answer' for any other",
  "  written-response item that is not a long essay/composition.",
  "- marks: the marks printed for the question (e.g. a trailing [3] or",
  "  (2 marks)); omit when none are printed.",
  "- options: one string per printed choice (usually 4: A, B, C, D), in order,",
  "  WITHOUT the 'A.'/'B.' labels. Preserve wording exactly. Leave options EMPTY",
  "  ([]) for fill_blank, matching and short_answer questions.",
  "- matchingLeft / matchingRight: for a 'matching' question, return the two",
  "  printed columns as separate string arrays in printed order (left = items",
  "  matched FROM, right = options matched TO). Do NOT guess the pairing.",
  "- wordBank: if a box/list of candidate answers is printed with the question",
  "  (common for fill-in-the-blank), return those words as an array; else omit.",
  "- diagramLabels: for a 'diagram_label' question, list the parts the learner",
  "  must name in reading order (the printed markers like A, B, C, or the named",
  "  parts if shown). Such a question always has its figure — set hasDiagram.",
  "- answerLines: for a written-answer question, count the blank ruled lines",
  "  printed under it for the learner's answer (0 or omit when there are none).",
  "- sectionTitle: the heading of the section this question sits under, copied",
  "  verbatim if printed (e.g. 'Section A', 'Section B: Comprehension'); omit",
  "  when the paper shows no section heading.",
  "- correctAnswer: ALWAYS null — ECZ question papers print no answer key, so",
  "  never guess. The teacher sets answers afterwards.",
  "- explanation: ''.",
  "- confidence: 0-1, how sure you are you read THIS question correctly (wording,",
  "  options, marks). Use > 0.95 only for crisp, unambiguous PRINTED text; use",
  "  < 0.8 for anything handwritten, smudged, cut off at a page edge, or",
  "  ambiguous, so the teacher is asked to check it. Be honest — a low score is a",
  "  helpful flag, not a failure.",
  "- source: 'printed' or 'handwritten' — how the item appeared on the paper.",
  "  HANDWRITING RULE: when a question is handwritten, TRANSCRIBE it to clean,",
  "  correctly-typed text (fix only obvious spelling/spacing so it reads",
  "  professionally); NEVER keep it as an image and NEVER describe the",
  "  handwriting in prose. Set source='handwritten' so the teacher double-checks.",
  "  Do NOT reword, rephrase, expand or 'improve' the question's meaning — only",
  "  the teacher may do that later with an explicit Improve/Rewrite action.",
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
  "Skip ONLY the cover/instructions page and any worked 'Example'. Capture",
  "short written-answer questions (questionType='short_answer'); skip only LONG",
  "essay/composition prompts (write a letter/story of several paragraphs). Do",
  "not invent questions.",
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
        questionType: {
          type: "string",
          enum: ["mcq", "true_false", "fill_blank", "matching", "short_answer", "diagram_label"],
          description:
            "What KIND of question this is: 'mcq' (choose one of several " +
            "printed options), 'true_false', 'fill_blank' (a sentence with a " +
            "blank/underline to complete), 'matching' (join two columns), " +
            "'diagram_label' (label/name the parts of a printed figure), or " +
            "'short_answer' (the learner writes an answer on blank lines). " +
            "Use 'short_answer' for any other written-response item.",
        },
        marks: {
          type: "integer",
          description:
            "Marks printed for this question (e.g. from a trailing [3] or " +
            "(2 marks)). Omit when no marks are printed.",
        },
        options: {
          type: "array",
          items: {type: "string"},
          minItems: 0,
          maxItems: 6,
          description:
            "The printed answer choices for an MCQ/true-false (no A./B. " +
            "labels). Leave empty [] for fill_blank / matching / short_answer.",
        },
        matchingLeft: {
          type: "array",
          items: {type: "string"},
          description:
            "For questionType='matching': the LEFT column items (the prompts " +
            "the learner matches FROM), in printed order. Omit otherwise.",
        },
        matchingRight: {
          type: "array",
          items: {type: "string"},
          description:
            "For questionType='matching': the RIGHT column items (the options " +
            "matched TO), in printed order. Omit otherwise.",
        },
        wordBank: {
          type: "array",
          items: {type: "string"},
          description:
            "Any printed word bank / box of candidate answers shown with the " +
            "question (common on fill-in-the-blank items). Omit when none.",
        },
        diagramLabels: {
          type: "array",
          items: {type: "string"},
          description:
            "For questionType='diagram_label': the parts/labels the learner " +
            "must name, in reading order (e.g. the printed markers 'A','B','C' " +
            "or the named parts if shown). Omit otherwise.",
        },
        answerLines: {
          type: "integer",
          description:
            "For a written-answer question (short_answer / fill_blank / " +
            "diagram_label), the number of blank ruled answer lines printed " +
            "under it. Omit when there is no blank answer space.",
        },
        correctAnswer: {type: ["integer", "null"]},
        explanation: {type: "string"},
        confidence: {
          type: "number",
          description:
            "How confident you are (0-1) that you read THIS question's wording, " +
            "options and marks correctly. Use < 0.8 for handwritten, smudged, " +
            "cut-off or ambiguous items so the teacher is asked to check them; " +
            "use > 0.95 only for crisp, unambiguous printed text.",
        },
        source: {
          type: "string",
          enum: ["printed", "handwritten"],
          description:
            "Whether this question was PRINTED (typeset) or HANDWRITTEN on the " +
            "original paper. Handwriting must still be transcribed to clean " +
            "typed text — this flag only tells the teacher to double-check it.",
        },
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

// ─── Diagram detection + classification ─────────────────────────────────────

const MAX_DIAGRAMS_PER_QUESTION = 6;

// Sanitise a model-supplied array of short strings (matching columns, word
// bank): trim each, drop blanks, clamp length and cap the count. Returns [].
function sanitiseStringList(value, maxItems = 20, maxLen = 200) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const s = clampString(item, maxLen).trim();
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}
// Below this model-reported confidence (or when the model is explicitly
// unsure / can't name the figure) a detected diagram is routed to "needs
// teacher review" instead of being auto-handled.
const DIAGRAM_REVIEW_CONFIDENCE = 0.45;
// "Complex" figures must stay as an image — re-drawing them would lose
// information (a real map, a labelled organ, a photo of an animal/plant/tool).
const COMPLEX_DIAGRAM_KINDS = new Set([
  "map", "labelled_science", "body_part", "plant", "animal", "tool",
  "food_chart", "circuit", "photo",
]);
// "Simple" figures can be redrawn accurately as an editable diagram, so we
// offer that — number lines, basic shapes, Venn diagrams, charts, tables.
const SIMPLE_DIAGRAM_KINDS = new Set([
  "number_line", "shape", "venn", "bar_chart", "line_graph", "pie_chart",
  "table", "measurement",
]);

/**
 * Decide how a detected diagram should be handled, per the product rules:
 *   - preserve : keep it exactly as an image (complex/realistic figures).
 *   - recreate : offer to rebuild it as an editable diagram (simple figures).
 *   - clean    : keep it as an image but tidy it (a line drawing we don't
 *                recognise as recreatable).
 *   - review   : ask the teacher (low confidence or genuinely unsure).
 *
 * Uncertainty wins: a low-confidence or "unsure" figure always goes to review
 * so we never silently mis-handle a question's figure. Exported for tests.
 */
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
  // Kind not in either bucket (e.g. a generic "drawing") — lean on the
  // complexity signal, else treat it as a keepable image to clean.
  if (cx === "complex") return "preserve";
  if (cx === "simple") return "recreate";
  return "clean";
}

/**
 * Normalise one model-reported diagram into
 * `{ box, caption, kind, complexity, confidence, classification }`, or null
 * when it has no usable bounding box (we can't crop it — the question's
 * hasDiagram flag still attaches the whole page as a fallback).
 */
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

// Normalise a list of detected diagrams, dropping boxless ones and capping the
// count. Exported for tests.
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
  // The model may classify each item beyond MCQ. We trust an EXPLICIT,
  // recognised type to relax the "needs ≥2 options" gate (an optionless
  // short-answer / fill-blank / matching question is legitimate); without an
  // explicit non-option type we keep the original strict MCQ gate so a misread
  // 1-option fragment is still dropped rather than imported as junk.
  const explicitType = normaliseQuestionType(raw?.questionType);
  const OPTIONLESS_TYPES = new Set(["short_answer", "fill_blank", "matching", "diagram_label"]);
  if (!optionsAreImages) {
    options = rawOptions.filter(Boolean).slice(0, 6);
    if (options.length < 2) {
      if (OPTIONLESS_TYPES.has(explicitType)) {
        options = []; // typed non-option question — keep it
      } else if (explicitType === "true_false") {
        options = ["True", "False"]; // a T/F item printed without its options
      } else {
        return null; // strict MCQ gate (unchanged default behaviour)
      }
    }
  } else if (options.length < 2) {
    return null;
  }

  // Final type: an explicit recognised type wins; otherwise classify from the
  // content (so a two-option True/False set is typed tf, not mcq, and a
  // "label the diagram" with a figure is typed diagram_label).
  const type = explicitType ||
    classifyQuestionType({prompt, options, optionsAreImages, hasDiagram: Boolean(raw?.hasDiagram)});
  // Marks: an explicit model value wins; else a trailing "[3 marks]" on the
  // stem; else default 1. Bounded to a sane 1..50.
  const parsedMarks = extractMarks(prompt).marks;
  const rawMarks = Number.parseInt(raw?.marks, 10);
  const marks = Math.min(50, Math.max(1,
    Number.isFinite(rawMarks) && rawMarks > 0 ? rawMarks : (parsedMarks || 1)));

  const num = Number.parseInt(raw?.sourceQuestionNumber, 10);
  const diagrams = sanitiseDiagrams(raw?.diagrams);

  // Structured extras printed on the paper, carried so the editor opens the
  // right block pre-populated (the teacher still sets the pairing/answers —
  // ECZ papers print no answer key). Only attach for the relevant type.
  const matchingLeft = type === "matching" ? sanitiseStringList(raw?.matchingLeft, 20) : [];
  const matchingRight = type === "matching" ? sanitiseStringList(raw?.matchingRight, 20) : [];
  const wordBank = sanitiseStringList(raw?.wordBank, 30);
  // The parts the learner must name on a "label the diagram" question.
  const diagramLabels = type === "diagram_label" ? sanitiseStringList(raw?.diagramLabels, 12) : [];
  // Blank ruled answer lines printed under a written-answer question. Only
  // meaningful for written types; bounded to a sane 0..30.
  const WRITTEN_TYPES = new Set(["short_answer", "fill_blank", "diagram_label"]);
  const rawAnswerLines = Number.parseInt(raw?.answerLines, 10);
  const answerLines = WRITTEN_TYPES.has(type) && Number.isFinite(rawAnswerLines) && rawAnswerLines > 0 ?
    Math.min(30, rawAnswerLines) : null;

  // Whether the item was handwritten on the paper. Handwriting is transcribed to
  // clean typed text regardless (never kept as an image); the flag only routes
  // the item toward the review band so the teacher double-checks the reading.
  const source = clampString(raw?.source, 20).toLowerCase() === "handwritten" ?
    "handwritten" : "printed";

  // Per-question OCR confidence (0-1). Trust the model's own number when it gave
  // one; otherwise leave it null (the review model treats null as "review", never
  // auto-approve). Handwritten items are capped below the auto-approve bar so a
  // confident-looking handwriting read still gets a human glance.
  let ocrConfidence = Number(raw?.confidence);
  ocrConfidence = Number.isFinite(ocrConfidence) ?
    Math.min(1, Math.max(0, ocrConfidence)) : null;
  if (source === "handwritten" && (ocrConfidence == null || ocrConfidence > 0.9)) {
    ocrConfidence = 0.9;
  }

  return {
    sourceQuestionNumber: Number.isFinite(num) && num > 0 ? num : null,
    text: prompt,
    options,
    correctAnswer: "", // never imported from a question paper
    explanation: "",
    type,
    marks,
    // A figure present in diagrams[] implies hasDiagram even if the model
    // forgot to set the flag — we must never silently drop a question's figure.
    // A label-the-diagram question always depends on its figure.
    hasDiagram: Boolean(raw?.hasDiagram) || diagrams.length > 0 || type === "diagram_label",
    diagrams,
    optionsAreImages,
    optionImageBoxes,
    matchingLeft,
    matchingRight,
    wordBank,
    diagramLabels,
    answerLines,
    sectionTitle: clampString(raw?.sectionTitle, 160).trim(),
    sharedInstruction: clampString(raw?.instruction, 1200).trim(),
    sourcePage: pageNumberFor(raw?.sourcePageIndex, pageNumbers),
    source,
    ocrConfidence,
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

/**
 * A 0-1 confidence penalty for a batch where the assist (Gemini) recall count
 * disagrees with the primary (Claude) extraction count. Model self-reported
 * confidence is not calibrated, so when the two models disagree about how many
 * questions are on the page we DON'T trust a high per-question score — we scale
 * every question's confidence down proportionally to the shortfall, which drops
 * an over-confident batch out of the auto-approve band and onto the review desk.
 *
 * Pure. Returns 0 (no penalty) when the counts agree closely or Gemini gave no
 * usable number. Capped at 0.5 so a wild Gemini miscount can't zero everything.
 */
function countDisagreementPenalty(claudeCount, geminiCount) {
  if (!Number.isFinite(geminiCount) || geminiCount <= 0) return 0;
  if (!Number.isFinite(claudeCount) || claudeCount < 0) return 0;
  // Same 1-question slack reconcileCounts allows for header/example over-counts.
  const shortfall = geminiCount - 1 - claudeCount;
  if (shortfall <= 0) return 0;
  return Math.min(0.5, shortfall / geminiCount);
}

/**
 * Apply a batch-level confidence penalty to every question in a section list,
 * in place-safe fashion (returns the same list). Used to fold the cross-model
 * disagreement into per-question `ocrConfidence`. Pure aside from the number it
 * writes back onto each question.
 */
function penaliseSectionConfidence(sections, penalty) {
  if (!(penalty > 0) || !Array.isArray(sections)) return sections;
  const apply = (q) => {
    if (!q) return;
    // Treat null/undefined as "no score" — Number(null) is 0, which would wrongly
    // read as a known-zero confidence.
    const c = q.ocrConfidence == null ? NaN : Number(q.ocrConfidence);
    if (Number.isFinite(c)) {
      q.ocrConfidence = Math.max(0, Math.min(1, c * (1 - penalty)));
    } else {
      // No score to scale — an unread batch is uncertain by definition, so mark
      // it low enough to require approval rather than leaving it "review".
      q.ocrConfidence = 0.7;
    }
  };
  for (const section of sections) {
    if (section?.kind === "passage") {
      (Array.isArray(section.questions) ? section.questions : []).forEach(apply);
    } else if (section?.question) {
      apply(section.question);
    }
  }
  return sections;
}

// Parse the printed question numbers Gemini reports for a batch. Returns a
// sorted, de-duplicated list of positive integers. This is the EXPECTED set we
// hold Claude's extraction against, so we can re-ask for any number it missed.
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

// Flatten every question (standalone + passage children) out of normalised
// sections, in order.
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

// Set of printed question numbers present in normalised sections.
function extractedNumberSet(sections = []) {
  const set = new Set();
  flattenSectionQuestions(sections).forEach((q) => {
    if (Number.isInteger(q?.sourceQuestionNumber) && q.sourceQuestionNumber > 0) {
      set.add(q.sourceQuestionNumber);
    }
  });
  return set;
}

// Printed numbers Gemini saw that Claude did not return (sorted). Capped so a
// hallucinated Gemini list can't trigger an unbounded re-ask.
function computeMissingNumbers(expected = [], extractedSet = new Set()) {
  return expected
    .filter((n) => !extractedSet.has(n))
    .slice(0, MAX_REASK_NUMBERS);
}

// The expected set of printed numbers for a batch: the numbers Gemini saw,
// UNION the contiguous range the first pass already spans. ECZ papers are
// numbered with no gaps, so if a batch caught Q25 and Q29 then 26-28 must
// exist too — even when BOTH models skipped them (which is why Gemini-only
// recovery left questions missing). A size guard stops a single misread
// number from inflating the range.
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

// Targeted re-ask: the first pass missed these printed question numbers, so we
// send the same page images back and ask ONLY for those questions. Re-asking
// for a short, explicit list is far more reliable than the model
// self-enumerating a long run, which is how questions go missing in the first
// place (especially English Section A lists and post-passage questions).
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
  const now = deps.now || Date.now;
  const startedAt = now();

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

  // Number-driven completeness: hold Claude's first pass against the printed
  // numbers Gemini saw, and re-ask specifically for any it missed. Re-asking a
  // short explicit list is far more reliable than the model self-enumerating a
  // long run, so this recovers the questions that otherwise go missing.
  let recovered = 0;
  {
    const extracted = extractedNumberSet(sections);
    const expected = expectedBatchNumbers(geminiNumbers, extracted);
    let missing = computeMissingNumbers(expected, extracted);
    let round = 0;
    while (missing.length && round < MAX_REASK_ROUNDS) {
      // Stop re-asking before the function deadline: returning the partial
      // result (with a warning) beats being killed mid-round and returning
      // NOTHING — a dead batch loses even the questions already extracted.
      if (now() - startedAt > REASK_TIME_BUDGET_MS) {
        warnings.push(
          "This batch ran out of time while double-checking for missed " +
          "questions — some numbered questions on these pages may be " +
          "missing. The importer will retry those pages automatically; " +
          "re-import if any are still absent.",
        );
        console.warn("[scannedQuizImport] re-ask stopped by time budget", {
          elapsedMs: now() - startedAt,
          missing: missing.length,
        });
        break;
      }
      round += 1;
      let reask;
      try {
        reask = await callClaude(anthropicKey, {
          systemPrompt: CLAUDE_SYSTEM_PROMPT,
          messages: buildReaskMessages(pages, hints, missing),
          model: VISION_MODEL,
          maxTokens: 8000,
          temperature: 0.1,
          mode: "tool",
          toolName: "return_sections",
          toolDescription: "Return only the requested missing questions.",
          toolInputSchema: SCANNED_TOOL_SCHEMA,
        });
      } catch (err) {
        console.warn("[scannedQuizImport] re-ask round failed", {
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
      if (!added) break; // model recovered nothing this round — stop
      missing = computeMissingNumbers(expected, extracted);
    }
    if (recovered > 0) {
      console.warn("[scannedQuizImport] recovered missing questions via re-ask", {
        recovered,
        rounds: round,
      });
    }
  }

  const extractedCount = countSectionQuestions(sections);

  const countWarning = reconcileCounts(extractedCount, geminiCount);
  if (countWarning) warnings.push(countWarning);

  // Calibration guard: when the assist model saw more questions than we
  // extracted, don't trust a high per-question confidence — scale it down so the
  // batch lands on the review desk instead of being silently auto-approved.
  const disagreement = countDisagreementPenalty(extractedCount, geminiCount);
  if (disagreement > 0) penaliseSectionConfidence(sections, disagreement);

  return {
    sections,
    warnings,
    pageNumbers,
    detectedCount: geminiCount,
    extractedCount,
    recovered,
    engineVersion: SCANNED_IMPORT_ENGINE_VERSION,
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
  classifyDiagram,
  sanitiseDiagram,
  sanitiseDiagrams,
  reconcileCounts,
  countDisagreementPenalty,
  penaliseSectionConfidence,
  parseGeminiCount,
  parseGeminiNumbers,
  flattenSectionQuestions,
  extractedNumberSet,
  computeMissingNumbers,
  expectedBatchNumbers,
  buildReaskMessages,
  MAX_REASK_ROUNDS,
  MAX_REASK_NUMBERS,
  REASK_TIME_BUDGET_MS,
  buildClaudeMessages,
  buildGeminiImages,
  CLAUDE_SYSTEM_PROMPT,
  SCANNED_TOOL_SCHEMA,
  MAX_PAGES_PER_CALL,
  VISION_MODEL,
  SCANNED_IMPORT_ENGINE_VERSION,
};
