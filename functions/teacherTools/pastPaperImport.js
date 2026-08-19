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
// mammoth is required lazily inside extractDocxText() — see the note there.
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("../authGuard");
const {assertCallableRateLimit} = require("../rateLimit");
const {inspectDocxBuffer, safeUserError} = require("./docxArchiveInspect");

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
  filterRecoveredToWanted,
  extractionProgress,
  summariseSeenStems,
  normaliseImportedQuestion,
  mergeAndRenumber,
  findSourceNumberGaps,
  collectPassages,
  textToParagraphHtml,
  tableToHtml,
  buildImportReport,
  dedupeExtractedQuestions,
  classifyContentRole,
} = require("./pastPaperImportHelpers");
// Declared-range reconciliation — drops phantom over-counts, repairs mis-read
// numbering, and turns stem-less spelling/punctuation items into real questions,
// using the paper's printed "Questions X–Y" ranges as ground truth. Mirrors the
// client scanned importer (src/components/quiz/pastPaperParts.js).
const {reconcilePastPaper} = require("./pastPaperImportReconcile");
// Shared Document Understanding Engine — the single validation stage every
// import surface runs. `gateImport` fails the import gracefully (with a report)
// on a structural blocker BEFORE anything is written; `computeValidationStatus`
// stamps each card's ok|warning|error chip for the editor.
const {
  gateImport,
  computeValidationStatus,
} = require("../documentEngine/validationEngineCore");

// A reusable JSON-schema fragment describing a printed table/timetable, shared
// by the per-question and per-passage table slots.
const TABLE_SCHEMA = {
  type: ["object", "null"],
  description:
    "A printed table/timetable/data grid this question (or passage) reads " +
    "from. Capture headers + every row so it rebuilds as a real table.",
  properties: {
    headers: {
      type: "array",
      items: {type: "string"},
      description: "Column headings in order. Empty array if the table has none.",
    },
    rows: {
      type: "array",
      items: {type: "array", items: {type: "string"}},
      description: "Each row as an array of cell strings, left to right.",
    },
  },
};

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
// After the main extraction, if the printed numbering has holes (the model
// confidently returned "nothing new" while specific numbers are missing), chase
// those exact numbers over the source. Bounded so a number that genuinely isn't
// on the paper can't loop forever.
const MAX_GAP_RECOVERY_ROUNDS = 2;
const MAX_GAP_NUMBERS_PER_ASK = 40;

// Engine version stamp, returned on every import report and shown in the
// studio's Import Report card. If the version shown after a live import
// doesn't match this string, the deployed Cloud Function is running OLD code
// (the silent firebase-tools "exit 0 but stale" deploy failure that made
// importer fixes look broken in production while passing every test). Bump on
// any change to the extraction/dedup/recovery logic in this pipeline.
const PAST_PAPER_ENGINE_VERSION = "2026.08.08-question-figures";

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
    // Cover/instruction-page declared TOTAL — "There are 60 questions in this
    // paper." Detection priority 1: the strongest ground-truth signal for the
    // paper's exact count, used even when the paper prints no "Part"
    // structure at all (a plainly continuous 1..N paper). Null when the
    // cover states no explicit total.
    declaredQuestionCount: {
      type: ["integer", "null"],
      description:
        "The EXACT total number of questions the cover/instruction page " +
        "states, e.g. 'There are 60 questions in this paper.' → 60. Null if " +
        "no explicit total is printed. Never guess — only report a number " +
        "that is actually printed on the paper.",
    },
    // Declared Part/section structure — the paper's OWN ground truth. The
    // server reconciler uses these ranges to drop phantom over-counts, repair
    // mis-read numbers, and fill stem-less spelling/punctuation items.
    parts: {
      type: "array",
      description:
        "One entry per numbered Part / section group on these pages, read from " +
        "its heading (e.g. 'Part 3: Questions 26 – 30'). Include a Part even " +
        "when its items have no stem of their own (spelling / punctuation lists).",
      items: {
        type: "object",
        properties: {
          label: {type: "string", description: "Printed Part label, e.g. 'Part 3'. '' if none."},
          sectionLabel: {type: "string", description: "Enclosing section heading, e.g. 'SECTION A'. '' if none."},
          firstNumber: {type: "integer", description: "FIRST printed question number in this Part (from 'Questions 26 – 30' → 26)."},
          lastNumber: {type: "integer", description: "LAST printed question number in this Part (from 'Questions 26 – 30' → 30)."},
          instruction: {type: "string", description: "The Part's shared instruction sentence, verbatim; do NOT include the worked Example."},
          hasExample: {type: "boolean", description: "true if a worked 'Example' is shown under this Part (which you must NOT emit as a question)."},
        },
        required: ["firstNumber", "lastNumber"],
      },
    },
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
          sourcePageNumber: {
            type: ["integer", "null"],
            description:
              "The 1-based page this question is PRINTED on: for a PDF, the " +
              "page counting the cover; for photographed pages, the number " +
              "in the '--- Uploaded page N ---' marker directly above the " +
              "image (always use the marker, never your own count). Null if " +
              "unclear.",
          },
          contentRole: {
            type: "string",
            description:
              "'question' for a real numbered/printed question (the default " +
              "— use this unless one of the others clearly applies). " +
              "'example' for a worked Example shown under a Part (never " +
              "printed with its own question number) — you should normally " +
              "omit examples entirely rather than return them, but if you do " +
              "include one, mark it 'example' so it is never scored as a " +
              "question. 'instruction' for a Part's shared instruction " +
              "sentence with no question of its own. 'heading' for a section " +
              "title. Leave unset ('') to default to 'question'.",
          },
          sectionLabel: {
            type: ["string", "null"],
            description:
              "The printed section heading this question sits under (e.g. " +
              "'SECTION B'), copied verbatim. Null when the paper prints " +
              "none. CRITICAL on papers that restart question numbering in " +
              "each section — the label keeps restarted numbers distinct.",
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
          passage: {
            type: ["object", "null"],
            description:
              "Set ONLY when this question depends on a shared reading passage, " +
              "story, extract, map, figure or table that several questions read " +
              "from. Standalone questions omit it (null).",
            properties: {
              ref: {
                type: "string",
                description:
                  "A short stable label (e.g. 'P1') identical for EVERY " +
                  "question that reads from the same passage, so they group.",
              },
              title: {type: "string", description: "The passage/section heading, if printed."},
              text: {
                type: "string",
                description:
                  "The FULL passage/extract text, verbatim. Include it on at " +
                  "least the first question of the group; later questions with " +
                  "the same ref may leave it empty.",
              },
              kind: {
                type: "string",
                description: "'comprehension' for a reading text, or 'map' for a shared map/figure/table.",
              },
              table: TABLE_SCHEMA,
              sourcePage: {
                type: ["integer", "null"],
                description:
                  "The 1-based page of the paper where this passage/figure " +
                  "is PRINTED. Required for kind:'map' so the figure image " +
                  "can be attached automatically.",
              },
              figureBox: {
                type: ["object", "null"],
                description:
                  "For kind:'map': a TIGHT bounding box around JUST the " +
                  "printed figure/map on sourcePage, as fractions 0-1 of the " +
                  "page ({x,y,w,h}). Exclude the questions and their options.",
                properties: {
                  x: {type: "number"},
                  y: {type: "number"},
                  w: {type: "number"},
                  h: {type: "number"},
                },
              },
            },
          },
          table: TABLE_SCHEMA,
          hasFigure: {
            type: "boolean",
            description:
              "true when THIS question has its OWN printed picture, " +
              "photograph, diagram, graph or figure beside it (not a shared " +
              "passage/map figure — those use the passage object). NEVER " +
              "describe such a picture in prose; report its location here.",
          },
          figureBox: {
            type: ["object", "null"],
            description:
              "When hasFigure is true: a TIGHT bounding box around JUST this " +
              "question's printed picture/diagram on sourcePageNumber, as " +
              "fractions 0-1 of the page ({x,y,w,h}). Exclude the question " +
              "text and options. Null if you cannot locate it precisely.",
            properties: {
              x: {type: "number"},
              y: {type: "number"},
              w: {type: "number"},
              h: {type: "number"},
            },
          },
          explanation: {type: "string"},
          confidence: {
            type: "number",
            description:
              "How confident you are (0-1) that you read THIS question " +
              "correctly (wording, options, marks). Use > 0.95 only for crisp, " +
              "unambiguous text; use < 0.8 for anything smudged, cut off or " +
              "ambiguous so the admin checks it first. Be honest.",
          },
        },
        required: ["prompt"],
      },
    },
  },
  required: ["questions"],
};

const SYSTEM_PROMPT = `You are digitising a Zambian ECZ examination paper. The user sends the paper as a PDF, a Word document's text, or scanned page images. Read it with very high accuracy and return EVERY question as structured JSON via the tool.

COMPLETENESS IS THE TOP PRIORITY. Capture every question on every page, in the order they appear. Do not stop early, do not summarise, do not skip a question because it has a diagram or is hard to read — transcribe what you can. A paper may have 20, 50, or 100+ questions; return all of them.

SKIP THE COVER / INSTRUCTION PAGE. The front page (and any instruction page) of an exam paper carries only the heading — the exam title, candidate-information boxes (name, examination number, school), the time allowed, the total marks, and general directions such as "Answer ALL questions", "Do not open this paper until told", or "Write your answers in the spaces provided". These are NOT questions. Never turn an instruction, a heading, or a candidate-info field into a question. Begin extracting at the FIRST printed, numbered question, and number each question with the number printed beside it on the paper. HOWEVER, read that cover/instruction page for one thing: an explicit statement of the total number of questions ("There are 60 questions in this paper.", "This paper has 50 questions."). Report that exact number as the top-level declaredQuestionCount — this is the strongest ground truth for the paper's exact count, used even on a paper that prints no Part/Section structure at all. Report null when no such statement is printed; never guess a total.

WORKED EXAMPLES ARE NEVER QUESTIONS. A Part often shows a worked "Example" (with its own answer) directly under the instruction, before the real numbered items begin. It never carries a printed question number. Do not extract it as a question at all — skip straight from the instruction to the first numbered item. If you are ever unsure whether something is the worked Example, set that item's contentRole to "example" rather than risk it being scored as a real question.

REPORT WHICH PAGE EACH QUESTION IS ON. Set sourcePageNumber on every question to the page it is printed on (the PDF's own 1-based page count, or the "--- Uploaded page N ---" marker for photographed pages) — this is DIFFERENT from sourceNumber (the printed question number); never put the question number in sourcePageNumber or vice versa.

READING PASSAGES & SHARED FIGURES — DO NOT MISS THESE. Many papers include a comprehension passage (a story, letter, poem, advert, dialogue, notice or report) or a shared map/figure/table/graph that a GROUP of questions is based on. Whenever the paper prints such a passage/figure, OR any question refers to "the passage", "the story", "the advert", "the poem", "the figure/map/table above", a named character, or says "according to the passage" / "read the following", there IS a shared passage. You MUST then: (1) transcribe the FULL passage/extract text VERBATIM into passage.text — never summarise, shorten or skip it; (2) attach the passage (same identical passage.ref, e.g. "P1") to EVERY question that reads from it; (3) put the full text on at least the first such question. Returning a comprehension question WITHOUT its passage text is an error — find the passage and include it.

A QUESTION'S OWN PICTURE — REPORT ITS LOCATION, NEVER DESCRIBE IT. When ONE question has its own printed picture, photograph, diagram, graph or figure (e.g. "Which activity is shown in the picture below?" with a photo under it), set that question's hasFigure=true AND report figureBox (a tight {x,y,w,h} bounding box around JUST the picture, as fractions 0-1 of the page it is printed on — the same page you report in sourcePageNumber). NEVER write a prose description of the picture into the prompt — no "[Picture shows a person running]", no "(see diagram)", no "[image of ...]". Transcribe ONLY the printed words of the question; the actual picture is cropped out of the uploaded paper automatically from your location report, and a prose description permanently loses the picture. If several questions share one figure, use the passage object (kind:"map") instead. When answer OPTIONS are pictures (A-D each a small image), still set hasFigure=true with a box around the whole option strip and transcribe any printed option letters/captions.

SHARED MAPS & PRINTED FIGURES — REPORT WHERE THEY ARE. For a shared map, diagram, picture or figure (kind:"map"), ALSO report passage.sourcePage and passage.figureBox (a tight {x,y,w,h} bounding box around JUST the figure, as fractions 0-1 of that page, excluding the questions and options). sourcePage is: for a PDF, the 1-based page of the PDF counting the cover; for photographed pages, the number printed in the "--- Uploaded page N ---" marker directly above the image the figure appears in — always use the marker number, never your own count. The figure image is attached automatically from your location report — without it the map is lost. Never skip a map-based question because the map is a picture; transcribe the question and report the figure's location.

FAITHFUL TRANSCRIPTION — NEVER INVENT. Transcribe questions EXACTLY as printed. Never re-word, paraphrase, reconstruct, complete or invent a question, an option, or a number. If part of a question is unreadable, transcribe what you can read and mark the unreadable part [UNCLEAR]. Returning a question that is not printed on the paper is the worst possible error — far worse than omitting one.

For each question:
- type: choose the closest of mcq, tf (true/false), short_answer, fill_blanks, essay, numeric. For matching, ordering, structured (a/b/c parts), table, or diagram-label questions that don't fit those, use short_answer and put the full question (including its parts) in the prompt. NEVER discard a question.
- prompt: the full question text. Preserve maths, fractions, powers/superscripts, subscripts, units, chemical formulae, currency, percentages, scientific notation, and labels exactly. Keep multi-part questions (a), (b), (c) together in one prompt with their parts.
- options: for mcq list every choice (usually A–D) with exact wording; for tf use ["True","False"]; leave empty otherwise.
- passage: when a question depends on a shared reading passage, story, letter, poem, advert, dialogue, OR a shared map/figure/table that several questions read from, set the passage object — give every question about that same passage an IDENTICAL ref (e.g. "P1"), and include the FULL passage text (verbatim) on at least the first of them. Transcribe the whole comprehension extract; do not summarise it. Use kind:"comprehension" for reading text and kind:"map" for a shared figure/map/table. Standalone questions omit passage.
- table: whenever a question (or a shared passage) includes a printed TABLE, TIMETABLE or data grid, capture it in the table field — headers as the column headings and rows as arrays of cell strings, transcribing EVERY row and column. Put a table that several questions share on the passage.table; put a table belonging to one question on that question's table. Capture the table data even when the cells also appear in the text.
- correctAnswer: only if the paper actually marks it (answer key, asterisk, shading) — the 0-based option index for mcq/tf, or the answer text for short_answer/fill_blanks/numeric. If the answer is NOT printed, return null. NEVER guess an answer.
- sourceNumber: the question number printed on the paper, so skipped numbers can be detected.
- sectionLabel: the printed section heading the question sits under ("SECTION A", "SECTION B: STRUCTURED QUESTIONS"), copied verbatim — null when the paper has no section headings. Papers often RESTART numbering at 1 in each section; the label is what keeps a restarted Q1 distinct from Section A's Q1, so never omit it when headings are printed. A section continues until the next heading: questions on a continuation page (no heading visible on that page) still belong to the most recent heading — report that same label for them, spelled identically every time.
- explanation: one short sentence on the concept tested, or empty if unsure.
- confidence: 0-1, how sure you are you read this question correctly. Use > 0.95 only for crisp, unambiguous text; use < 0.8 for anything smudged, cut off or ambiguous so the admin checks it first. Be honest — a low score is a helpful flag, not a failure.

PARTS / SECTION STRUCTURE — return a top-level "parts" array. Zambian papers group questions into numbered Parts, each with a heading that prints its question range and a shared instruction, e.g. 'Part 3: Questions 26 – 30' then 'Choose the sentence which is correctly punctuated.' then an 'Example:' then the numbered items. For EACH such Part return one entry: label ('Part 3'), sectionLabel ('SECTION A'), firstNumber (26) and lastNumber (30) read from the heading, the shared instruction verbatim, and hasExample=true when a worked Example is shown. These ranges are ground truth — read the 'Questions X – Y' heading carefully.

STEM-LESS ITEMS (spelling / punctuation). In some Parts a numbered item has NO question sentence of its own — the printed choices ARE the question (e.g. 'Choose the correctly spelled word': A tributaly B tributary …; or 'Choose the correctly punctuated sentence': four near-identical sentences). For these: set the item's prompt to '' (empty), put the printed choices in options[] exactly as printed, and rely on the Part instruction (returned in "parts") — the editor uses it as the question. Do NOT copy the instruction into every item's prompt yourself, and never invent a stem. The worked Example under such a Part is NOT a question — skip it.

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
  // SEC-007: guard the archive BEFORE mammoth decompresses it. A .docx is a
  // ZIP; a bomb / traversal / fake-.docx is rejected on central-directory
  // metadata here, so mammoth never decompresses a hostile archive. Legacy
  // .doc (OLE compound file, not a ZIP) is exempt — mammoth handles/fails it
  // as before (see the DOC_MIME note below).
  if (source.mime !== DOC_MIME) {
    const insp = inspectDocxBuffer(buf);
    if (!insp.ok) {
      console.warn("[pastPaperImport] docx_archive_rejected",
        JSON.stringify({event: "docx_archive_rejected", code: insp.code}));
      throw new HttpsError("failed-precondition", safeUserError());
    }
  }
  let note = "";
  if (source.mime === DOC_MIME) {
    note = "Legacy .doc files may import partially. Re-save as .docx for the " +
      "best results.";
  }
  let text = "";
  try {
    // Lazy require: mammoth is 18.2 MiB of RSS and ~78 ms to load, paid by all
    // 196 exports through functions/index.js for a .docx text extractor only
    // the past-paper importer reaches. Required AFTER the archive guard above,
    // so a hostile upload is still rejected before any ZIP parser is loaded.
    const mammoth = require("mammoth");
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

  // images — download every page once, drop oversize, batch the rest. Each
  // page keeps its ORIGINAL 1-based position in the uploaded page list and is
  // preceded by a printed "--- Uploaded page N ---" marker. That marker is the
  // page number the model reports in passage.sourcePage, and it's the SAME
  // index the studio's figure-attach pass uses to pick the photo to crop —
  // without it the model could only report its position within a 4-page batch
  // (and a >5MB page being dropped shifted every later page), so the map was
  // cropped from the WRONG photo.
  const prepared = [];
  let droppedForSize = 0;
  for (let i = 0; i < source.items.length; i++) {
    const item = source.items[i];
    const buf = await downloadAsset(item.path);
    if (buf.length > MAX_IMAGE_BYTES) {
      droppedForSize += 1;
      continue;
    }
    prepared.push({page: i + 1, block: imageBlock(item.contentType, buf)});
  }
  if (!prepared.length) {
    throw new HttpsError("failed-precondition",
      "Every page asset was over 5MB. Compress the scans and retry.");
  }
  const batches = planPageBatches(prepared, IMAGE_PAGES_PER_BATCH);
  const segments = batches.map((b) => {
    const first = b.pages[0].page;
    const last = b.pages[b.pages.length - 1].page;
    return {
      label: first === last ?
        `uploaded page ${first}` : `uploaded pages ${first}–${last}`,
      pageCount: b.pages.length,
      blocks: b.pages.flatMap((p) => [
        {type: "text", text: `--- Uploaded page ${p.page} ---`},
        p.block,
      ]),
    };
  });
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

function buildExtractionPrompt({paper, segment, seenStems, round, progress}) {
  const context = buildContextLines(paper);
  if (round === 0) {
    return [
      `Extract EVERY question from ${segment.label} of this past paper, in the ` +
      "order they appear. Use the tool schema exactly.",
      "",
      context,
    ].join("\n");
  }
  // Continuation round. The model re-reads the SAME source each round, so it
  // must be told to CONTINUE from where it stopped — otherwise it restarts from
  // the top, re-emits the early questions (which dedupe to nothing), and the
  // loop stalls at whatever fit in the first response (the "stops at ~40" bug on
  // long PDFs). Resume by printed question number when the paper has one; fall
  // back to a count-based resume when it doesn't.
  const count = progress && Number.isInteger(progress.count) ? progress.count : 0;
  const maxNum = progress ? progress.maxSourceNumber : null;
  const resumeLine = maxNum != null ?
    `So far you have captured ${count} question(s), up to and including ` +
    `question number ${maxNum}. CONTINUE from the next question ` +
    `(number ${maxNum + 1} onward) and extract every remaining question, in ` +
    "order, through to the end of the paper." :
    `So far you have captured ${count} question(s). CONTINUE from exactly where ` +
    "you stopped and extract every remaining question, in order, through to the " +
    "end of the paper.";
  const already = seenStems.length ?
    seenStems.join("\n") : "(none yet)";
  return [
    resumeLine,
    "",
    "For reference, here are the most recent questions already captured from " +
    `${segment.label} — do NOT return any of these again:`,
    already,
    "",
    "Return ONLY questions you have NOT already returned — the ones that come " +
    "AFTER the list above. Do not restart from the beginning, do not repeat or " +
    "re-number a question listed above. If you have genuinely reached the end of " +
    "the paper and every question is now captured, return an empty questions array.",
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
async function extractSegment({
  apiKey, paper, segment, seenKeys, seenNumbers, accum, partsAccum,
  declaredCounts, roleRejections,
}) {
  const segmentQuestions = [];
  let rounds = 0;
  let truncationHit = false;
  const usage = {inputTokens: 0, outputTokens: 0};

  for (let round = 0; round < MAX_ROUNDS_PER_SEGMENT; round++) {
    rounds += 1;
    const seenStems = summariseSeenStems(segmentQuestions);
    const progress = extractionProgress(segmentQuestions);
    const promptText = buildExtractionPrompt({
      paper, segment, seenStems, round, progress,
    });
    const messages = [{
      role: "user",
      content: [...segment.blocks, {type: "text", text: promptText}],
    }];

    let result;
    try {
      result = await callClaude(apiKey, {
        track: {tool: "pastPaperImport"},
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

    // Declared Part ranges the model read on this segment — ground truth for
    // the reconciler. Accumulated raw; deduped/merged after extraction.
    if (partsAccum && Array.isArray(result?.parsed?.parts)) {
      partsAccum.push(...result.parsed.parts);
    }
    // Cover-page declared TOTAL — usually only reported on the segment that
    // actually contains the cover, so most segments report null. Collected
    // raw; runPastPaperImport picks the most-agreed-on value.
    if (declaredCounts && Number.isInteger(result?.parsed?.declaredQuestionCount)) {
      declaredCounts.push(result.parsed.declaredQuestionCount);
    }

    const rawQuestions = Array.isArray(result?.parsed?.questions) ?
      result.parsed.questions : [];
    // Reject worked Examples / Part instructions / headings BEFORE they ever
    // become a candidate question — a rejected block never gets a number, a
    // ledger slot, or a chance to occupy a real question's place.
    const questionBlocks = [];
    rawQuestions.forEach((q) => {
      const role = classifyContentRole(q);
      if (role === "question") {
        questionBlocks.push(q);
      } else if (roleRejections) {
        roleRejections[role] = (roleRejections[role] || 0) + 1;
      }
    });
    const normalised = questionBlocks
      .map((q, i) => normaliseImportedQuestion(q, accum.length + i))
      .filter(Boolean);
    const {fresh} = selectNewQuestions(seenKeys, normalised, seenNumbers);
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

function buildGapRecoveryPrompt({paper, segment, missingNumbers}) {
  const nums = missingNumbers.join(", ");
  return [
    `The paper contains questions printed with these numbers which have NOT ` +
    `yet been captured: ${nums}.`,
    `Look carefully at ${segment.label} and return ONLY those questions you ` +
    "can find there — full prompt text, options, type and sourceNumber, using " +
    "the tool schema. If a listed number is genuinely not printed on this part " +
    "of the paper, simply omit it. Do not return any other questions.",
    "Set each returned question's sourceNumber to its PRINTED number exactly — " +
    "it must be one of the listed numbers. NEVER re-word, reconstruct or " +
    "re-number a question to make it fit a listed number; if you cannot " +
    "actually see a question printed with that number, omit it. Returning an " +
    "invented or re-numbered question is the worst possible error.",
    "",
    buildContextLines(paper),
  ].join("\n");
}

/**
 * Targeted recovery for holes in the printed numbering. The main coverage loop
 * stops when the model reports nothing new, but a model can confidently skip a
 * specific numbered question. After extraction we look for gaps in the source
 * numbering and re-ask the model for those EXACT numbers over each segment —
 * the same number-driven recovery the scanned-paper importer uses. Bounded by
 * round + count caps so a number that truly isn't on the paper can't loop.
 */
async function recoverNumberGaps({apiKey, paper, segments, accum, seenKeys, seenNumbers, roleRejections}) {
  let rounds = 0;
  const usage = {inputTokens: 0, outputTokens: 0};
  for (let r = 0; r < MAX_GAP_RECOVERY_ROUNDS; r++) {
    const merged = mergeAndRenumber(accum);
    const gaps = findSourceNumberGaps(merged.questions).slice(0, MAX_GAP_NUMBERS_PER_ASK);
    if (!gaps.length) break;
    rounds += 1;
    let recoveredAny = false;
    for (const segment of segments) {
      const promptText = buildGapRecoveryPrompt({paper, segment, missingNumbers: gaps});
      let result;
      try {
        result = await callClaude(apiKey, {
          track: {tool: "pastPaperImport"},
          systemPrompt: SYSTEM_PROMPT,
          messages: [{role: "user", content: [...segment.blocks, {type: "text", text: promptText}]}],
          model: IMPORT_MODEL,
          maxTokens: EXTRACTION_MAX_TOKENS,
          temperature: 0,
          mode: "tool",
          toolName: "return_questions",
          toolDescription: "Return the recovered exam questions.",
          toolInputSchema: QUESTIONS_TOOL_SCHEMA,
        });
      } catch (err) {
        console.warn("[pastPaperImport] gap recovery round failed",
          segment.label, err && err.message);
        continue;
      }
      usage.inputTokens += Number(result?.usage?.inputTokens || 0);
      usage.outputTokens += Number(result?.usage?.outputTokens || 0);
      const raw = Array.isArray(result?.parsed?.questions) ? result.parsed.questions : [];
      // Same content-role rejection as the main coverage loop — a worked
      // Example or Part instruction must never fill a missing-number gap.
      const questionBlocks = [];
      raw.forEach((q) => {
        const role = classifyContentRole(q);
        if (role === "question") {
          questionBlocks.push(q);
        } else if (roleRejections) {
          roleRejections[role] = (roleRejections[role] || 0) + 1;
        }
      });
      // ANTI-INVENTION GUARD (see filterRecoveredToWanted). Under gap-recovery
      // pressure the model sometimes "finds" a listed number by re-wording a
      // question it already returned, or by re-numbering a nearby one — which
      // imported WRONG questions that don't exist on the paper. Accept ONLY
      // questions whose printed number is one we explicitly asked for.
      const normalised = filterRecoveredToWanted(
        questionBlocks
          .map((q, i) => normaliseImportedQuestion(q, accum.length + i))
          .filter(Boolean),
        gaps,
      );
      const {fresh} = selectNewQuestions(seenKeys, normalised, seenNumbers);
      fresh.forEach((q) => accum.push(q));
      if (fresh.length) recoveredAny = true;
    }
    if (!recoveredAny) break; // the missing numbers truly aren't recoverable
  }
  return {rounds, usage};
}

/**
 * Remove the questions a fresh import did NOT rewrite.
 *
 * This used to be `clearQuizQuestions`, and it ran BEFORE the write: erase
 * everything, then write the new set. Idempotency was fine either way — the
 * ids are deterministic (`q001`…), so a re-run converges — but the ORDER put
 * the destructive half first, on a quiz learners can be sitting in. Between
 * the clear and the write the paper had no questions at all, and a write that
 * failed in between left it that way.
 *
 * Writing first and pruning after closes both. The overlap is a re-import
 * rewriting `q001`…`qN` in place, which is what the deterministic ids are for;
 * the only documents removed are the ones the new set does not cover — a
 * shorter extraction's tail, and any legacy auto-id docs from an import that
 * predates the deterministic scheme, which is why this takes the ids to KEEP
 * rather than a count.
 */
async function pruneQuestionsNotIn(quizId, keepIds) {
  const ref = admin.firestore().collection(`quizzes/${quizId}/questions`);
  const snap = await ref.get();
  if (snap.empty) return 0;
  const stale = snap.docs.filter((d) => !keepIds.has(d.id));
  for (let i = 0; i < stale.length; i += 400) {
    const chunk = stale.slice(i, i + 400);
    const batch = admin.firestore().batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return stale.length;
}

/** The deterministic id a question at 0-based `index` is written under. */
function questionDocId(index) {
  return `q${String(index + 1).padStart(3, "0")}`;
}

/**
 * Build the Firestore question doc for one normalised question, with the
 * per-type fields the editor's schema expects (no options on free-text/numeric
 * types; a finite number for numeric; an index for mcq/tf).
 */
function toQuestionDoc(q, order) {
  // A question-level table renders as sanitised <table> HTML appended to the
  // (escaped) prompt; otherwise the prompt stays plain text as before.
  const tableHtml = q.table ? tableToHtml(q.table) : "";
  const text = tableHtml ?
    textToParagraphHtml(q.prompt) + tableHtml : q.prompt;
  const base = {
    type: q.type,
    text,
    textJSON: null,
    explanation: q.explanation || "",
    explanationJSON: null,
    marks: 1,
    order,
    // Link comprehension/map questions to their passage block on the quiz doc;
    // null for standalone questions.
    passageId: q.passageId || null,
    requiresReview: true,
    // Per-card structural verdict from the shared engine, shown as a status
    // chip in the Quiz Editor (ok | warning | error).
    validationStatus: computeValidationStatus(q),
    importedAt: admin.firestore.FieldValue.serverTimestamp(),
    importSource: "past_paper_ai",
  };
  if (q.sourceNumber != null) {
    // Dedicated integer field for the PRINTED QUESTION NUMBER — never conflate
    // this with sourcePage (below), which every other import path in this
    // codebase (the Teacher Scan importer, documentQuizImporter, CSV import)
    // already uses for the real page number. Earlier versions of this writer
    // stored the question number IN sourcePage, which broke that convention
    // and made a genuine page-provenance feature (view/crop from the right
    // page) impossible to build on top of it.
    const n = Number(q.sourceNumber);
    if (Number.isInteger(n) && n >= 1 && n <= 9999) base.sourceQuestionNumber = n;
  }
  if (q.sourcePageNumber != null) {
    // The REAL page this question is printed on, when the model reported one.
    // Old imported questions may still carry the printed number in sourcePage
    // (pre-fix docs) — readers needing backward compatibility should prefer
    // sourceQuestionNumber and only fall back to parsing sourcePage as an int.
    const p = Number(q.sourcePageNumber);
    if (Number.isInteger(p) && p >= 1 && p <= 9999) base.sourcePage = p;
  }
  // Carry an importer confidence onto the card when the extractor provided one.
  if (q.confidence != null && Number.isFinite(Number(q.confidence))) {
    base.aiConfidence = Math.max(0, Math.min(1, Number(q.confidence)));
  }
  // The question's OWN printed picture. figureMeta mirrors the passage-level
  // field: sourcePage + an optional fractional crop box. Persisted so the
  // studio's figure-attach pass can crop the real image out of the uploaded
  // paper, and so the Quiz Editor's "Crop from page" opens on the right page
  // with the AI-detected box pre-selected. The image itself is attached by
  // the studio (the server has no rasteriser).
  if (q.hasFigure || q.figureBox) {
    base.figureMeta = {
      sourcePage: base.sourcePage || null,
      box: q.figureBox || null,
    };
  }
  // A prose picture-description stripped from the stem lands in diagramText —
  // the editor's caption/"what the picture shows" field — never in the
  // learner-visible question text.
  if (q.figureDescription) {
    base.diagramText = String(q.figureDescription).slice(0, 2000);
  }

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
async function writeQuestionsToQuiz(quizId, questions, provenance = {}) {
  if (!questions.length) return 0;
  for (let i = 0; i < questions.length; i += 400) {
    const chunk = questions.slice(i, i + 400);
    const batch = admin.firestore().batch();
    chunk.forEach((q, offset) => {
      const id = questionDocId(i + offset);
      const ref = admin.firestore().doc(`quizzes/${quizId}/questions/${id}`);
      batch.set(ref, {...toQuestionDoc(q, i + offset), ...provenance}, {merge: false});
    });
    await batch.commit();
  }
  return questions.length;
}

/**
 * The provenance stamp every imported question carries: which paper it came
 * out of, and whether that paper is a real ECZ examination.
 *
 * Weak-topic advice aggregates a learner's answers per topic, and a question
 * from a commercial mock is not evidence about the national exam — the two are
 * written to different standards. `paperIsOfficial` is DERIVED from the source
 * here rather than copied off the document, so a paper whose two fields
 * disagree cannot stamp a mock's questions as official. (The id list mirrors
 * PAPER_SOURCES in src/config/paperSources.js — see pastPapersIndexHelpers.js
 * for why the mirror exists and what keeps it honest.)
 */
function paperProvenanceFields(paper) {
  const source = typeof paper?.source === "string"
    ? paper.source.trim().toLowerCase()
    : null;
  return {
    paperSource: source || null,
    paperIsOfficial: source === "ecz",
  };
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
  // Declared Part ranges + instructions the model read across all segments —
  // ground truth for the reconciler below (drop phantoms, repair numbering,
  // fill stem-less spelling/punctuation items).
  const partsAccum = [];
  // Printed question numbers captured so far — a re-read of an already-seen
  // number (OCR drift across continuation rounds) is dropped rather than
  // inflating the count. Shared across segments + the gap-recovery pass.
  const seenNumbers = new Set();
  // Cover-page declared totals ("There are 60 questions in this paper")
  // reported per-segment — usually only the cover-carrying segment reports
  // one. Reduced to a single value below (majority vote).
  const declaredCounts = [];
  // Worked-Example / Part-instruction / heading blocks rejected before they
  // could become a question candidate — surfaced in the report, never in the
  // quiz (learners must never see a rejected candidate).
  const roleRejections = {example: 0, instruction: 0, heading: 0};
  let pagesProcessed = 0;
  let extractionRounds = 0;
  let truncationHit = false;
  const usage = {inputTokens: 0, outputTokens: 0};

  for (const segment of segments) {
    const segResult = await extractSegment({
      apiKey, paper, segment, seenKeys, seenNumbers, accum, partsAccum,
      declaredCounts, roleRejections,
    });
    extractionRounds += segResult.rounds;
    if (segResult.truncationHit) truncationHit = true;
    usage.inputTokens += segResult.usage.inputTokens;
    usage.outputTokens += segResult.usage.outputTokens;
    pagesProcessed += segment.pageCount;
  }

  // Targeted recovery for holes in the printed numbering (e.g. the model
  // skipped Q21/Q22 while reporting "nothing new"). No-op when the numbering is
  // already complete or too sparse to trust.
  const gapRecovery = await recoverNumberGaps({
    apiKey, paper, segments, accum, seenKeys, seenNumbers, roleRejections,
  });
  extractionRounds += gapRecovery.rounds;
  usage.inputTokens += gapRecovery.usage.inputTokens;
  usage.outputTokens += gapRecovery.usage.outputTokens;

  const questionsFound = accum.length;
  const merged = mergeAndRenumber(accum);
  const duplicatesRemoved = merged.duplicatesRemoved;
  const examplesRejected = roleRejections.example + roleRejections.instruction + roleRejections.heading;

  // Cover-declared total: the value most segments agree on (ties broken by
  // first-seen). Null when the cover states no explicit total — reconcile()
  // then falls back to its own regex scan / the paper's Part ranges alone.
  let declaredQuestionCount = null;
  if (declaredCounts.length) {
    const tally = new Map();
    declaredCounts.forEach((n) => tally.set(n, (tally.get(n) || 0) + 1));
    let bestCount = -1;
    declaredCounts.forEach((n) => {
      const c = tally.get(n);
      if (c > bestCount) { bestCount = c; declaredQuestionCount = n; }
    });
  }

  // ── Declared-range reconciliation (printed "Questions X–Y" — or a bare
  // cover-page total on a paper with no Part headings — as ground truth) ──
  // Drop questions numbered outside every declared range (the phantom
  // over-count), dedupe same-number reads, snap mis-read numbers to the printed
  // sequence when the count lines up, and give a stem-less spelling/punctuation
  // item the Part instruction as its question. Skips the number reconcile on a
  // restart-numbering paper (overlapping ranges) and no-ops when the paper
  // declares no ranges/total at all. Same logic as the client scanned importer.
  const reconciled = reconcilePastPaper(merged.questions, partsAccum, declaredQuestionCount);

  // Lift shared reading passages / maps out of the flat list into the editor's
  // passage model: a deduped passages[] array + a passageId stamped on each
  // child question.
  const {passages, questions} = collectPassages(reconciled.questions);
  const passagesForQuiz = passages.map((p) => ({
    id: p.id,
    title: p.title || "",
    instructions: "",
    // A shared table renders as a real grid under the passage prose.
    passageText: textToParagraphHtml(p.passageText) +
      (p.table ? tableToHtml(p.table) : ""),
    // The image itself is attached by the studio's figure-attach pass (the
    // server has no rasteriser); figureMeta below tells it where to crop.
    imageUrl: "",
    imageAlt: "",
    passageKind: p.passageKind || "comprehension",
    manualMarks: null,
    order: p.order,
    // Where the printed figure lives on the uploaded source: 1-based page +
    // an optional {x,y,w,h} fractional crop box. Persisted so the map can be
    // (re)attached — and so a failed attach is visible, not silent.
    ...(p.sourcePage || p.figureBox ? {
      figureMeta: {
        sourcePage: p.sourcePage || null,
        box: p.figureBox || null,
      },
    } : {}),
  }));
  // Printed figures/maps the model located — the studio crops each one out of
  // the uploaded paper and writes it onto the passage's imageUrl.
  const figuresDetected = passagesForQuiz
    .filter((p) => p.figureMeta)
    .map((p) => ({
      passageId: p.id,
      title: p.title || "",
      sourcePage: p.figureMeta.sourcePage,
      box: p.figureMeta.box,
    }));
  // Question-OWN figures ("Which activity is shown in the picture below?").
  // questionId mirrors writeQuestionsToQuiz's deterministic q001, q002, … ids
  // (assigned by list position), so the client attach pass can write the
  // cropped image straight onto the right question doc.
  const questionFiguresDetected = questions
    .map((q, i) => ((q.hasFigure || q.figureBox) && q.sourcePageNumber ? {
      questionId: `q${String(i + 1).padStart(3, "0")}`,
      sourceQuestionNumber: q.sourceNumber != null ? q.sourceNumber : null,
      sourcePage: q.sourcePageNumber,
      box: q.figureBox || null,
    } : null))
    .filter(Boolean);
  const allFiguresDetected = [...figuresDetected, ...questionFiguresDetected];
  const tablesCaptured =
    questions.filter((q) => q.table).length +
    passages.filter((p) => p.table).length;

  // ── Validation gate ──────────────────────────────────────────────
  // Run the shared engine's structural gate BEFORE the destructive write. A
  // blocker (missing printed numbers, an extra number outside the declared
  // range, a duplicate number, an answer key imported as a question, or
  // nothing extracted) fails the import gracefully: we return the report so
  // the admin sees exactly what's wrong and DO NOT clear/overwrite the
  // existing quiz. Non-blocking problems (out-of-order, [UNCLEAR], thin MCQs,
  // no-answer) ride through as warnings so a good-enough paper still imports.
  // `expectedNumbers` — when the reconciler resolved a continuous declared
  // range — makes this an EXACT set comparison
  // (expectedQuestionNumbers === importedQuestionNumbers), not just a count or
  // a gap check: it also catches extras past the declared end and a
  // truncated tail the gap-only check can't see.
  const gate = gateImport({questions, expectedNumbers: reconciled.expectedNumbers});

  // Persist + keep the parent quiz count + passages in sync — only when the
  // gate passes. When gated, nothing is cleared or written (non-destructive).
  let cleared = 0;
  let written = 0;
  if (quizId && questions.length && gate.ok) {
    // Write FIRST, prune after — see pruneQuestionsNotIn. `questionsCleared`
    // keeps its meaning (documents the re-import removed); it is now the stale
    // tail rather than the whole previous set, because everything the new set
    // covers was rewritten in place instead of being deleted and re-created.
    written = await writeQuestionsToQuiz(quizId, questions, paperProvenanceFields(paper));
    const keepIds = new Set(questions.map((_q, i) => questionDocId(i)));
    cleared = await pruneQuestionsNotIn(quizId, keepIds);
    try {
      await admin.firestore().doc(`quizzes/${quizId}`).set({
        questionCount: written,
        // The quiz inherits the paper's provenance too, so a surface holding
        // only the quiz can tell an ECZ practice run from a mock one.
        ...paperProvenanceFields(paper),
        // Always write the array (empty when the paper has no passages) so a
        // re-run clears any stale passages from a previous import.
        passages: passagesForQuiz,
        passageCount: passagesForQuiz.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    } catch (err) {
      console.warn("[pastPaperImport] quiz count sync failed",
        err && err.message);
    }
  }

  // Every rejected candidate, for audit — never shown to learners, only in the
  // admin-facing verification report (Phase 7 / Phase 11).
  const rejectedExtras = [
    ...reconciled.droppedNumbers.outOfRange.map((n) =>
      ({sourceQuestionNumber: n, reason: "outside_declared_range"})),
    ...reconciled.droppedNumbers.duplicate.map((n) =>
      ({sourceQuestionNumber: n, reason: "duplicate_candidate"})),
    ...Array.from({length: roleRejections.example},
      () => ({sourceQuestionNumber: null, reason: "worked_example"})),
    ...Array.from({length: roleRejections.instruction},
      () => ({sourceQuestionNumber: null, reason: "instruction_block"})),
    ...Array.from({length: roleRejections.heading},
      () => ({sourceQuestionNumber: null, reason: "heading_block"})),
  ];

  const report = {
    ...buildImportReport({
      pagesProcessed,
      segments: segments.length,
      questionsFound,
      // Nothing is written when the gate blocks or there's no target quiz.
      questionsImported: quizId ? written : questions.length,
      duplicatesRemoved,
      extractionRounds,
      truncationHit,
      droppedForSize,
      passagesCaptured: passagesForQuiz.length,
      tablesCaptured,
      questions,
      extraNotes: [extraNote],
      figures: allFiguresDetected,
      engineVersion: PAST_PAPER_ENGINE_VERSION,
    }),
    // Engine gate result — the studio surfaces blockers ("Missing questions:
    // 24, 47") prominently and warnings below them.
    gated: !gate.ok,
    blockers: gate.blockers,
    validationWarnings: gate.warnings,
    numbering: gate.numbering,
    // ── Exact-count verification (Phase 7 / Phase 11 report shape) ──
    // expectedCount is null when the paper declared no total/ranges at all
    // (nothing to compare against — count-only papers keep the old behaviour).
    expectedCount: reconciled.expectedNumbers.length || reconciled.declaredQuestionCount || null,
    candidateCount: questionsFound,
    validCount: questions.length,
    missingNumbers: gate.manifest ? gate.manifest.missing : gate.numbering.missing,
    duplicateNumbers: gate.manifest ? gate.manifest.duplicates : gate.numbering.duplicates,
    rejectedExtras,
    examplesRejected,
    // Diagram counts: the server only LOCATES figures (no rasteriser); the
    // studio's client-side figure-attach pass fills attached/needingReview
    // after cropping runs (see PastPaperStudio's ImportReportCard merge).
    diagramsDetected: allFiguresDetected.length,
    diagramsAttached: 0,
    diagramsNeedingReview: allFiguresDetected.length,
    gatePassed: gate.ok,
    reconcileWarnings: reconciled.warnings,
  };

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
      passagesCaptured: passagesForQuiz.length,
      tablesCaptured,
      confidence: report.confidence,
      gated: !gate.ok,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("[pastPaperImport] usage log failed", err && err.message);
  }

  const warnings = [];
  // Lead with the hard blockers so the studio's warning line names them even
  // before the admin opens the structured report.
  if (!gate.ok) {
    warnings.push(
      "Import paused before saving — " + gate.blockers.join(" "));
  }
  if (droppedForSize > 0) {
    warnings.push(`${droppedForSize} page${droppedForSize === 1 ? "" : "s"} ` +
      "skipped because they were over 5MB each.");
  }
  if (extraNote) warnings.push(extraNote);
  if (truncationHit) {
    warnings.push("A very long section reached the extraction round limit — " +
      "re-run the import to be sure every question was captured.");
  }
  // Declared-range reconciliation notices — honest about what was auto-fixed
  // against the paper's own printed structure.
  {
    const removed = reconciled.droppedOutOfRange + reconciled.droppedDuplicate;
    if (removed > 0) {
      warnings.push(
        `Removed ${removed} extra question${removed === 1 ? "" : "s"} the reader added that ` +
        `${removed === 1 ? "isn't" : "aren't"} on the paper (it prints ${reconciled.declaredTotal} questions). ` +
        "Check the count looks right.");
    }
    if (reconciled.snapped) {
      warnings.push(
        `Question numbers were re-aligned to the paper's printed 1–${reconciled.declaredTotal} sequence — ` +
        "check a few land where you expect.");
    }
    if (reconciled.stemsFilled > 0) {
      warnings.push(
        `${reconciled.stemsFilled} question${reconciled.stemsFilled === 1 ? "" : "s"} (e.g. spelling / punctuation) had no printed wording, ` +
        "so the Part's instruction was used as the question and the printed choices as the options — review them before publishing.");
    }
    reconciled.warnings.forEach((w) => warnings.push(w));
  }
  if (examplesRejected > 0) {
    warnings.push(
      `${examplesRejected} worked example / instruction block${examplesRejected === 1 ? "" : "s"} ` +
      "was found and correctly excluded from the questions.");
  }
  if (questions.length === 0) {
    warnings.push("The AI could not extract any questions from this paper.");
  }

  return {
    questions,
    questionsWritten: written,
    questionsCleared: cleared,
    // True when the gate blocked the write — the caller must NOT advance to the
    // editor as if the import succeeded.
    gated: !gate.ok,
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
      const uid = await assertVerifiedAuth(request, "Please sign in.");
      const role = await getUserRole(uid);
      // Only admins can import — past papers are admin-curated content.
      if (role !== "admin" && !isStaffRole(role)) {
        throw new HttpsError("permission-denied",
          "Admin access is required to import past-paper questions.");
      }
      // This is the single highest-cost AI endpoint: up to MAX_ROUNDS_PER_SEGMENT
      // sequential Claude vision passes at 16k output tokens over a 32 MB PDF.
      // The monthly treasury budget bounds TOTAL spend, but nothing else stopped
      // a leaked teacher token (or an accidental client loop) from firing these
      // back-to-back. A tight per-minute burst cap (fail-open) closes that before
      // any provider call. A human runs one import at a time; 4/min is generous.
      await assertCallableRateLimit(request, {action: "past-paper-import", userPerMin: 4});
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
  // Deploy-observability stamp (see the constant's comment).
  PAST_PAPER_ENGINE_VERSION,
};
