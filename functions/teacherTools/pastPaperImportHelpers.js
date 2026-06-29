"use strict";

/**
 * Pure, dependency-free helpers for the past-paper AI import. Kept separate
 * from pastPaperImport.js (which pulls firebase-admin, mammoth, and
 * firebase-functions at require time) so the logic can be unit-tested with a
 * plain `node` run — the CI "Tests" job installs root deps only, not the
 * functions/ package.
 *
 * The 2026-06 redesign moved the import from a single capped Claude call to a
 * page-batched, loop-until-dry extraction so a paper of ANY length imports in
 * full. The orchestration that makes that safe — batch planning, cross-round
 * de-duplication, completeness checks, the report — all lives here as pure
 * functions so it stays under unit test.
 */

// Question types this importer can emit. These all write cleanly into the quiz
// editor's question schema with nothing more than text + options + an answer
// (no extra structured fields), so a record we write can always be re-saved
// from the editor without tripping the strict write schema. Anything the model
// reports as matching / sequence / diagram / structured is captured as the
// closest of these (short_answer or essay) with its full prompt preserved —
// the question is never dropped, only simplified for the editor.
const SUPPORTED_TYPES = new Set([
  "mcq", "tf", "short_answer", "fill_blanks", "essay", "numeric",
]);

// Per-question option ceiling. The editor schema allows up to 20; ECZ MCQs are
// A–D (4) but matching/word-bank items rebuilt as an MCQ can run longer, so we
// keep generous headroom without being unbounded.
const MAX_OPTIONS = 10;

// Map the many spellings the model (and source papers) use for a type onto the
// editor's canonical enum. Mirrors src/utils/questionType.js but kept local so
// this module stays dependency-free.
const TYPE_ALIASES = {
  "multiple_choice": "mcq",
  "multiple choice": "mcq",
  "multiplechoice": "mcq",
  "choice": "mcq",
  "truefalse": "tf",
  "true_false": "tf",
  "true/false": "tf",
  "true false": "tf",
  "boolean": "tf",
  "fill": "fill_blanks",
  "fill_blank": "fill_blanks",
  "fill_in_blank": "fill_blanks",
  "fill_in_the_blank": "fill_blanks",
  "fill_in_the_blanks": "fill_blanks",
  "fill in the blank": "fill_blanks",
  "fill in the blanks": "fill_blanks",
  "gap_fill": "fill_blanks",
  "cloze": "fill_blanks",
  "short": "short_answer",
  "short answer": "short_answer",
  "shortanswer": "short_answer",
  "short_response": "short_answer",
  // Question shapes the editor has no first-class importer support for collapse
  // to the nearest free-text type so the content is preserved, not dropped.
  "structured": "short_answer",
  "matching": "short_answer",
  "match": "short_answer",
  "sequence": "short_answer",
  "ordering": "short_answer",
  "diagram": "short_answer",
  "label": "short_answer",
  "table": "short_answer",
  "calculation": "numeric",
  "essay": "essay",
  "long_answer": "essay",
  "extended": "essay",
};

function str(v) {
  return v == null ? "" : String(v);
}

function escapeHtml(s) {
  return str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert a plain-text passage/extract into the simple paragraph HTML the quiz
 * runner's <RichContent> renders. Blank lines become paragraph breaks, single
 * newlines become <br> so a comprehension story keeps its shape. Returns "" for
 * empty input.
 */
function textToParagraphHtml(text) {
  const t = str(text).trim();
  if (!t) return "";
  return t
    .split(/\n{2,}/)
    .map((p) => "<p>" + escapeHtml(p.trim()).replace(/\n/g, "<br>") + "</p>")
    .join("");
}

// Table capture bounds. The quiz runner renders sanitised <table> HTML (the
// rich-text sanitiser allows table tags), so a captured table shows as a real
// grid rather than a wall of pipes. These caps just keep a mis-read table from
// ballooning a doc.
const TABLE_MAX_COLS = 12;
const TABLE_MAX_ROWS = 60;
const TABLE_CELL_MAX = 200;

function cleanCell(v) {
  return str(v).replace(/\s+/g, " ").trim().slice(0, TABLE_CELL_MAX);
}

/**
 * Clamp a raw model table into a clean {headers, rows} grid, or null when it
 * isn't a real table (fewer than 2 columns, or no data). Ragged rows are
 * squared off to the column count so the rendered grid is never jagged.
 */
function normaliseTable(raw) {
  if (!raw || typeof raw !== "object") return null;
  let headers = Array.isArray(raw.headers) ?
    raw.headers.map(cleanCell).slice(0, TABLE_MAX_COLS) : [];
  let rows = Array.isArray(raw.rows) ?
    raw.rows
      .filter(Array.isArray)
      .map((r) => r.map(cleanCell).slice(0, TABLE_MAX_COLS))
      .filter((r) => r.some((c) => c !== ""))
      .slice(0, TABLE_MAX_ROWS) : [];
  const cols = Math.max(
    headers.length,
    rows.reduce((m, r) => Math.max(m, r.length), 0),
  );
  if (cols < 2 || (!rows.length && !headers.some((h) => h !== ""))) return null;
  if (headers.length) {
    headers = headers.slice(0, cols);
    while (headers.length < cols) headers.push("");
  }
  rows = rows.map((r) => {
    const rr = r.slice(0, cols);
    while (rr.length < cols) rr.push("");
    return rr;
  });
  if (!rows.length) return null;
  return {headers: headers.some((h) => h !== "") ? headers : [], rows};
}

function tableCellCount(t) {
  if (!t) return 0;
  return (t.headers || []).length +
    (t.rows || []).reduce((n, r) => n + r.length, 0);
}

/**
 * Render a {headers, rows} table as sanitiser-safe HTML the quiz runner's
 * <RichContent> displays as a real grid. Cells are HTML-escaped. Returns "" for
 * a non-table.
 */
function tableToHtml(raw) {
  const t = normaliseTable(raw);
  if (!t) return "";
  const head = t.headers.length ?
    "<thead><tr>" +
      t.headers.map((h) => "<th>" + escapeHtml(h) + "</th>").join("") +
      "</tr></thead>" : "";
  const body = "<tbody>" +
    t.rows.map((r) =>
      "<tr>" + r.map((c) => "<td>" + escapeHtml(c) + "</td>").join("") + "</tr>",
    ).join("") +
    "</tbody>";
  return "<table>" + head + body + "</table>";
}

// A passage block is either a reading "comprehension" extract or a shared
// "map"/figure/table several questions read from. Fold the model's wording onto
// the editor's two passageKind values.
function canonicalPassageKind(raw) {
  const s = str(raw).trim().toLowerCase();
  if (/map|diagram|figure|table|graph|chart|apparatus|picture/.test(s)) return "map";
  return "comprehension";
}

/**
 * Normalise the optional passage descriptor the model attaches to a
 * comprehension/map question into {ref,title,text,kind}, or null when there's
 * nothing usable. `ref` is the stable group key shared by every question about
 * the same passage; when the model omits it we synthesise one from the title or
 * a text prefix so the questions still group.
 */
function normalisePassageRef(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ref = str(raw.ref).trim();
  const title = str(raw.title).trim();
  const text = str(raw.text).trim();
  const table = normaliseTable(raw.table);
  if (!ref && !title && !text && !table) return null;
  const key = ref ||
    (title ? "title:" + title.toLowerCase() :
      (text ? "text:" + text.slice(0, 48).toLowerCase() :
        "table:" + JSON.stringify((table.rows[0] || [])).slice(0, 48).toLowerCase()));
  if (!key) return null;
  return {
    ref: key, title, text, kind: canonicalPassageKind(raw.kind),
    ...(table ? {table} : {}),
  };
}

function canonicalType(raw) {
  const key = str(raw).trim().toLowerCase();
  if (!key) return "";
  if (SUPPORTED_TYPES.has(key)) return key;
  return TYPE_ALIASES[key] || "";
}

/**
 * Stable identity for a question used to collapse duplicates across extraction
 * rounds and page batches. Stem + option-set, normalised for case/whitespace.
 * Two questions with the same stem but different options stay distinct (e.g.
 * "Pick the odd one out" with two different option sets).
 */
function questionKey(q) {
  const stem = str(q && q.prompt).toLowerCase().replace(/\s+/g, " ").trim();
  const opts = (Array.isArray(q && q.options) ? q.options : [])
    .map((o) => str(o).toLowerCase().replace(/\s+/g, " ").trim())
    .join("␟");
  return stem + "␟" + opts;
}

/**
 * Drop questions the model returned twice. LLM extraction occasionally emits
 * the same MCQ more than once (especially on long papers), which lands as a
 * duplicate card in the editor. Two questions are the same when their stem and
 * option set are identical after normalisation — order/position is ignored.
 * Survivors are re-sequenced so `order` stays 0..N.
 */
function dedupeExtractedQuestions(questions) {
  const seen = new Set();
  const out = [];
  for (const q of questions) {
    const key = questionKey(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(out.length === q.order ? q : {...q, order: out.length});
  }
  return out;
}

/**
 * Whether `uid` may overwrite the questions of a target quiz. Past-paper import
 * clears + rewrites the entire `quizzes/{quizId}/questions` subcollection, so
 * the caller must own that quiz (or be a true admin) — otherwise a staff user
 * passing an arbitrary `quizId` could wipe another teacher's quiz (IDOR).
 * `quizData` is the quiz doc's data (or null when the quiz doesn't exist).
 */
function canWriteQuiz(quizData, uid, isAdmin) {
  if (isAdmin) return true;
  return Boolean(quizData) && quizData.createdBy === uid;
}

/**
 * Split an ordered list of page-image assets into batches of `size`. Each batch
 * carries its 1-based page range so the extraction prompt can tell the model
 * which pages it is looking at. There is NO cap on the number of batches — a
 * 60-page paper yields 60/size batches, every one of them processed.
 */
function planPageBatches(items, size) {
  const batchSize = Math.max(1, Number(size) || 1);
  const list = Array.isArray(items) ? items : [];
  const batches = [];
  for (let i = 0; i < list.length; i += batchSize) {
    const pages = list.slice(i, i + batchSize);
    batches.push({
      pages,
      startPage: i + 1,
      endPage: i + pages.length,
    });
  }
  return batches;
}

/**
 * From a fresh batch of extracted questions, return only the ones not already
 * seen (by questionKey), and the updated set of keys. Drives the loop-until-dry
 * coverage loop: each round we ask the model for anything it has NOT yet
 * returned, accept only the genuinely new questions, and stop when a round adds
 * nothing. `seenKeys` is mutated in place (and also returned for convenience).
 */
function selectNewQuestions(seenKeys, incoming) {
  const keys = seenKeys instanceof Set ? seenKeys : new Set();
  const fresh = [];
  for (const q of (Array.isArray(incoming) ? incoming : [])) {
    const key = questionKey(q);
    if (keys.has(key)) continue;
    keys.add(key);
    fresh.push(q);
  }
  return {fresh, seenKeys: keys};
}

/**
 * Summarise how far extraction has progressed through a segment: how many
 * questions are captured and the highest printed question number seen so far.
 * A continuation round uses this to tell the model where to RESUME — without it
 * the model re-reads the same source from the top, re-emits the early questions
 * (which dedupe to nothing), and the loop stalls at whatever fit in the first
 * response (the "stops at ~40" bug on long PDFs). `maxSourceNumber` is null when
 * the paper prints no usable numbering, in which case the caller falls back to a
 * count-based resume.
 */
function extractionProgress(questions) {
  const list = Array.isArray(questions) ? questions : [];
  let maxSourceNumber = null;
  for (const q of list) {
    const n = parseSourceNumber(q && q.sourceNumber);
    if (n != null && (maxSourceNumber == null || n > maxSourceNumber)) {
      maxSourceNumber = n;
    }
  }
  return {count: list.length, maxSourceNumber};
}

/**
 * Build a compact, bounded list of the question stems already extracted, for
 * the "do not repeat these" half of a continuation prompt. Bounded in both the
 * number of stems and the length of each so a 100-question paper's reask prompt
 * stays small. Most-recent stems are the useful ones (the model resumes from
 * where it stopped), so we keep the tail.
 */
function summariseSeenStems(questions, limit = 60, perStem = 90) {
  const list = Array.isArray(questions) ? questions : [];
  const tail = list.slice(-Math.max(1, limit));
  return tail.map((q, i) => {
    const stem = str(q && q.prompt).replace(/\s+/g, " ").trim().slice(0, perStem);
    return `${i + 1}. ${stem}`;
  });
}

/**
 * Coerce a raw model question into the importer's working shape, resolving the
 * type and the per-type answer. Returns null for an unusable question (no
 * prompt, or an MCQ with fewer than two options) so the caller can filter.
 *
 * Type resolution is defensive: an MCQ that arrives without enough options is
 * downgraded to short_answer (keeps the text), and a "numeric" whose answer
 * isn't a finite number is downgraded to short_answer (keeps the answer string)
 * — both because the editor's strict write schema rejects an MCQ with <2
 * options off a re-save, and a numeric without a finite answer. We never write
 * a record the editor can't re-save.
 */
function normaliseImportedQuestion(raw, idx) {
  const prompt = str(raw && raw.prompt).trim();
  if (!prompt) return null;

  const optionsRaw = Array.isArray(raw && raw.options) ? raw.options : [];
  let options = optionsRaw
    .map((o) => str(o).trim())
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);

  let type = canonicalType(raw && raw.type);
  // Infer when the model omitted/garbled the type: 2+ options ⇒ MCQ-like.
  if (!type) type = options.length >= 2 ? "mcq" : "short_answer";

  const explanation = str(raw && raw.explanation).trim();
  const sourceNumber = parseSourceNumber(raw && raw.sourceNumber);
  const rawAnswer = raw == null ? null : raw.correctAnswer;
  // "Never guess." Treat null / undefined / "" as no answer printed on the
  // paper. Crucially this guards against Number(null) === 0 silently marking an
  // unanswered MCQ as "the answer is option A".
  const answerProvided =
    rawAnswer !== null && rawAnswer !== undefined && str(rawAnswer).trim() !== "";
  let correctAnswer;
  let answerKnown = false;

  if (type === "tf") {
    options = ["True", "False"];
    const idxFromBool = answerProvided ? boolToIndex(rawAnswer) : null;
    if (idxFromBool != null) {
      correctAnswer = idxFromBool;
      answerKnown = true;
    } else {
      correctAnswer = 0; // editor requires an index; flagged for review
    }
  } else if (type === "mcq") {
    if (options.length < 2) {
      // Not enough options to be a real MCQ — keep the content as short answer.
      type = "short_answer";
      options = [];
      correctAnswer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
      answerKnown = Boolean(correctAnswer);
    } else {
      const n = answerProvided ? Number(rawAnswer) : NaN;
      if (Number.isInteger(n) && n >= 0 && n < options.length) {
        correctAnswer = n;
        answerKnown = true;
      } else {
        correctAnswer = 0; // editor requires an index; flagged for review
      }
    }
  } else if (type === "numeric") {
    const n = answerProvided ? Number(rawAnswer) : NaN;
    if (Number.isFinite(n)) {
      options = [];
      correctAnswer = n;
      answerKnown = true;
    } else if (answerProvided) {
      // A non-numeric answer was given — preserve it as a short answer.
      type = "short_answer";
      options = [];
      correctAnswer = str(rawAnswer).trim();
      answerKnown = Boolean(correctAnswer);
    } else {
      // Numeric question, no answer printed — keep the type, placeholder 0,
      // flag for review (the editor's schema needs a finite numeric answer).
      options = [];
      correctAnswer = 0;
      answerKnown = false;
    }
  } else {
    // short_answer / fill_blanks / essay — free-text answer, no options.
    options = [];
    correctAnswer = type === "essay" || !answerProvided ? "" :
      (typeof rawAnswer === "number" ? String(rawAnswer) : str(rawAnswer).trim());
    answerKnown = type !== "essay" && Boolean(correctAnswer);
  }

  const passage = normalisePassageRef(raw && raw.passage);
  const table = normaliseTable(raw && raw.table);

  return {
    type,
    prompt,
    options,
    correctAnswer,
    explanation,
    sourceNumber,
    answerKnown,
    order: Number.isInteger(idx) ? idx : 0,
    requiresReview: true,
    ...(passage ? {passage} : {}),
    ...(table ? {table} : {}),
  };
}

/**
 * Pull shared reading passages / maps out of the flat question list and turn
 * them into the editor's passage model: a deduped `passages[]` array (one entry
 * per distinct passage ref, richest title/text kept) plus the same questions
 * with `passageId` stamped on each child (null on standalone questions and the
 * transient `passage` descriptor stripped).
 *
 * A ref that ends up with no text AND only one question is treated as a misfire
 * (a standalone question the model mislabelled) — its question stays standalone
 * rather than creating an empty passage block.
 */
function collectPassages(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const groups = new Map();
  list.forEach((q, i) => {
    const p = q && q.passage;
    if (!p || !p.ref) return;
    const ord = Number.isInteger(q.order) ? q.order : i;
    let g = groups.get(p.ref);
    if (!g) {
      g = {ref: p.ref, title: "", passageText: "", passageKind: p.kind || "comprehension", order: ord, count: 0, table: null};
      groups.set(p.ref, g);
    }
    g.count += 1;
    if (p.title && p.title.length > g.title.length) g.title = p.title;
    if (p.text && p.text.length > g.passageText.length) g.passageText = p.text;
    if (p.table && tableCellCount(p.table) > tableCellCount(g.table)) g.table = p.table;
    if (p.kind === "map") g.passageKind = "map";
    if (ord < g.order) g.order = ord;
  });

  const refToId = new Map();
  const passages = [];
  let idx = 0;
  for (const g of groups.values()) {
    // A lone block with no text AND no table is a mislabelled standalone.
    if (!g.passageText && !g.table && g.count < 2) continue;
    idx += 1;
    const id = `p${String(idx).padStart(3, "0")}`;
    refToId.set(g.ref, id);
    passages.push({
      id,
      title: g.title,
      passageText: g.passageText,
      passageKind: g.table && !g.passageText ? "map" : g.passageKind || "comprehension",
      order: g.order,
      ...(g.table ? {table: g.table} : {}),
    });
  }

  const outQuestions = list.map((q) => {
    const rest = {...q};
    delete rest.passage;
    const pid = q && q.passage && q.passage.ref ? refToId.get(q.passage.ref) : null;
    rest.passageId = pid || null;
    return rest;
  });

  return {passages, questions: outQuestions};
}

function boolToIndex(v) {
  // tf options are ["True","False"] ⇒ index 0 = True, 1 = False.
  if (v === true) return 0;
  if (v === false) return 1;
  if (typeof v === "number") return v === 0 ? 0 : (v === 1 ? 1 : null);
  const s = str(v).trim().toLowerCase();
  if (s === "true" || s === "t" || s === "0" || s === "a") return 0;
  if (s === "false" || s === "f" || s === "1" || s === "b") return 1;
  return null;
}

/**
 * Pull a positive integer source-paper question number out of whatever the
 * model returned ("12", "Q12", "12.", 12). Returns null when absent/unparseable
 * so gap detection can ignore it rather than guess.
 */
function parseSourceNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  const m = str(v).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isInteger(n) && n > 0 && n < 10000 ? n : null;
}

/**
 * Detect gaps in the source-paper numbering. When the model reported numbers
 * 1,2,3,5,6 we surface "4" as missing so the admin knows a question may not
 * have been captured. Only runs when enough questions carry a source number
 * (≥60%) — otherwise the signal is too noisy to trust. Returns the sorted list
 * of missing integers between the min and max observed.
 */
function findSourceNumberGaps(questions) {
  const nums = (Array.isArray(questions) ? questions : [])
    .map((q) => parseSourceNumber(q && q.sourceNumber))
    .filter((n) => n != null);
  if (nums.length < 3) return [];
  if (nums.length < (Array.isArray(questions) ? questions.length : 0) * 0.6) {
    return [];
  }
  const set = new Set(nums);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  // Guard against an absurd span (a mis-read "1999") producing a huge list.
  if (hi - lo > 500) return [];
  const missing = [];
  for (let n = lo; n <= hi; n++) {
    if (!set.has(n)) missing.push(n);
  }
  return missing;
}

/**
 * Final pass over the accumulated questions: dedupe, then re-sequence `order`
 * 0..N. Returns {questions, duplicatesRemoved}.
 */
function mergeAndRenumber(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const deduped = dedupeExtractedQuestions(
    list.map((q, i) => (q.order === i ? q : {...q, order: i})),
  );
  return {
    questions: deduped,
    duplicatesRemoved: list.length - deduped.length,
  };
}

/**
 * Deterministic completeness check run after extraction. Surfaces the problems
 * the brief asked about — missing answers, thin MCQs, numbering gaps — as
 * human-readable strings for the report. It does not mutate the questions; the
 * coverage loop and dedupe already applied the automatic corrections.
 */
function validateImport(questions, opts = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const issues = [];
  const gaps = findSourceNumberGaps(list);
  if (gaps.length) {
    const shown = gaps.slice(0, 12).join(", ");
    issues.push(
      `Source numbering skips ${gaps.length} number(s): ${shown}` +
      (gaps.length > 12 ? ", …" : "") +
      ". Check the paper for questions that may not have been captured.",
    );
  }
  const thinMcq = list.filter(
    (q) => q.type === "mcq" && (q.options || []).length < 2,
  ).length;
  if (thinMcq) {
    issues.push(`${thinMcq} multiple-choice question(s) have fewer than 2 options.`);
  }
  const noAnswer = list.filter((q) => !q.answerKnown && q.type !== "essay").length;
  if (noAnswer) {
    issues.push(
      `${noAnswer} question(s) have no answer marked — the paper did not print ` +
      "a key, so an admin should set the correct answer before publishing.",
    );
  }
  if (opts.truncationHit) {
    issues.push(
      "Extraction hit the per-segment round limit — a very long paper may need " +
      "a second import run to be sure every question was captured.",
    );
  }
  if (!list.length) {
    issues.push("No questions could be extracted from this paper.");
  }
  return {issues, gaps};
}

/**
 * A 0..1 confidence that the import is complete and clean, derived purely from
 * deterministic signals (no extra model call). Penalises numbering gaps, missing
 * answers, and a round-limit hit. Used for the report's "OCR confidence score".
 */
function computeConfidence(questions, opts = {}) {
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length) return 0;
  let score = 1;
  const gaps = findSourceNumberGaps(list);
  const denom = list.length + gaps.length;
  if (gaps.length) score -= 0.4 * (gaps.length / denom);
  const noAnswer = list.filter((q) => !q.answerKnown && q.type !== "essay").length;
  if (noAnswer) score -= 0.2 * (noAnswer / list.length);
  if (opts.truncationHit) score -= 0.15;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function countByType(questions) {
  const out = {};
  for (const q of (Array.isArray(questions) ? questions : [])) {
    const t = q && q.type ? q.type : "unknown";
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}

/**
 * Assemble the import report surfaced in the studio after a run. Pure assembly
 * of already-computed numbers so it round-trips in tests.
 */
function buildImportReport({
  pagesProcessed = 0,
  segments = 0,
  questionsFound = 0,
  questionsImported = 0,
  duplicatesRemoved = 0,
  extractionRounds = 0,
  truncationHit = false,
  droppedForSize = 0,
  passagesCaptured = 0,
  tablesCaptured = 0,
  questions = [],
  extraNotes = [],
} = {}) {
  const {issues, gaps} = validateImport(questions, {truncationHit});
  const corrections = [];
  if (duplicatesRemoved > 0) {
    corrections.push(
      `Removed ${duplicatesRemoved} duplicate question(s) the model returned twice.`,
    );
  }
  if (extractionRounds > segments) {
    corrections.push(
      "Re-queried the paper for questions a first pass missed until no new " +
      "questions were found (loop-until-complete).",
    );
  }
  if (passagesCaptured > 0) {
    corrections.push(
      `Captured ${passagesCaptured} reading passage/figure block(s) and linked ` +
      "each comprehension question to its passage.",
    );
  }
  if (tablesCaptured > 0) {
    corrections.push(
      `Rebuilt ${tablesCaptured} printed table(s) as a formatted grid.`,
    );
  }
  const withAnswer = questions.filter((q) => q.answerKnown).length;
  return {
    pagesProcessed,
    segments,
    questionsFound,
    questionsImported,
    duplicatesRemoved,
    withAnswerKey: withAnswer,
    withoutAnswerKey: questionsImported - withAnswer,
    byType: countByType(questions),
    sourceNumberGaps: gaps,
    extractionRounds,
    truncationHit: Boolean(truncationHit),
    droppedForSize,
    passagesCaptured,
    tablesCaptured,
    confidence: computeConfidence(questions, {truncationHit}),
    issues,
    corrections,
    notes: Array.isArray(extraNotes) ? extraNotes.filter(Boolean) : [],
  };
}

module.exports = {
  // Existing exports — keep stable for callers + the original tests.
  dedupeExtractedQuestions,
  canWriteQuiz,
  // Redesign helpers.
  SUPPORTED_TYPES,
  MAX_OPTIONS,
  canonicalType,
  questionKey,
  planPageBatches,
  selectNewQuestions,
  extractionProgress,
  summariseSeenStems,
  normaliseImportedQuestion,
  parseSourceNumber,
  findSourceNumberGaps,
  mergeAndRenumber,
  validateImport,
  computeConfidence,
  countByType,
  buildImportReport,
  // Passage capture.
  canonicalPassageKind,
  normalisePassageRef,
  collectPassages,
  textToParagraphHtml,
  // Table capture.
  normaliseTable,
  tableToHtml,
};
