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
 * Clamp a model-reported figure bounding box ({x,y,w,h} as fractions 0-1 of the
 * page) into a usable crop region, or null when degenerate. Overflow past the
 * right/bottom edge is clamped rather than rejected. Unlike the scanned-quiz
 * sanitiser this KEEPS a near-full-page box — a full-page map is a real figure
 * and cropping ~the whole page is still the correct image.
 */
function sanitiseFigureBox(raw) {
  if (!raw || typeof raw !== "object") return null;
  const clamp = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : NaN;
  };
  const x = clamp(raw.x);
  const y = clamp(raw.y);
  let w = clamp(raw.w);
  let h = clamp(raw.h);
  if ([x, y, w, h].some((n) => !Number.isFinite(n))) return null;
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  if (w < 0.03 || h < 0.03) return null; // too small to be a real figure
  return {x, y, w, h};
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
  // Where the figure is PRINTED — lets the studio attach the actual image.
  const sourcePage = parseSourceNumber(raw.sourcePage);
  const figureBox = sanitiseFigureBox(raw.figureBox);
  if (!ref && !title && !text && !table && !sourcePage) return null;
  const key = ref ||
    (title ? "title:" + title.toLowerCase() :
      (text ? "text:" + text.slice(0, 48).toLowerCase() :
        (table ? "table:" + JSON.stringify((table.rows[0] || [])).slice(0, 48).toLowerCase() :
          "page:" + sourcePage)));
  if (!key) return null;
  return {
    ref: key, title, text, kind: canonicalPassageKind(raw.kind),
    ...(table ? {table} : {}),
    ...(sourcePage ? {sourcePage} : {}),
    ...(figureBox ? {figureBox} : {}),
  };
}

function canonicalType(raw) {
  const key = str(raw).trim().toLowerCase();
  if (!key) return "";
  if (SUPPORTED_TYPES.has(key)) return key;
  return TYPE_ALIASES[key] || "";
}

// Content roles a raw extracted block can carry. Only 'question' may become a
// quiz question — everything else (a worked Example, a Part's shared
// instruction sentence, a heading) is rejected before normalisation so it can
// never enter the ledger, get a number, or occupy a slot a real question needs.
const CONTENT_ROLES = new Set(["question", "example", "instruction", "heading"]);

// A worked Example is never printed with its own question number and starts
// with the word "Example" (optionally "Worked Example"). Gated on the ABSENCE
// of a printed number so a genuine numbered question that happens to mention
// "example" in its wording is never misclassified.
const EXAMPLE_TEXT_RE = /^\s*(worked\s+)?example\b\s*[:.\-]?\s*/i;

/**
 * Classify a RAW model-returned block before it is normalised into a question.
 * Trusts an explicit `raw.contentRole` / `raw.isExample` signal from the model
 * first; falls back to a conservative text heuristic. Returns one of
 * CONTENT_ROLES ('question' unless there's a concrete signal otherwise) so a
 * borderline case defaults to being KEPT — dropping a real question is far
 * worse than occasionally letting a stray example through the deterministic
 * gate downstream.
 */
function classifyContentRole(raw) {
  const explicit = str(raw && raw.contentRole).trim().toLowerCase();
  if (CONTENT_ROLES.has(explicit)) return explicit;
  if (raw && raw.isExample === true) return "example";
  const num = parseSourceNumber(raw && raw.sourceNumber);
  const prompt = str(raw && raw.prompt).trim();
  if (num == null && prompt && EXAMPLE_TEXT_RE.test(prompt)) return "example";
  return "question";
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

function normaliseSectionLabel(v) {
  return str(v).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Identity of a question's PRINTED number, scoped by its printed section
 * heading — e.g. "section b#3". ECZ papers legitimately RESTART numbering at 1
 * in each section, so treating the bare number as globally unique made Section
 * B's Q1..Q20 collide with Section A's and silently drop them (questions then
 * shift so the content at a position no longer matches the paper). Scoping by
 * the section label keeps restarted numbers distinct while still collapsing a
 * true re-read (same section, same number). Returns null when the question has
 * no parseable printed number.
 */
function numberKey(q) {
  const num = parseSourceNumber(q && q.sourceNumber);
  if (num == null) return null;
  return normaliseSectionLabel(q && q.sectionLabel) + "#" + num;
}

/**
 * Drop questions the model returned twice. LLM extraction occasionally emits
 * the same MCQ more than once (especially on long papers), which lands as a
 * duplicate card in the editor. Two questions are the same when their stem and
 * option set are identical after normalisation — order/position is ignored.
 * Survivors are re-sequenced so `order` stays 0..N.
 *
 * Number-aware exception: two DISTINCT printed questions can legitimately share
 * an identical stem — options-less items like "Give a reason for your answer."
 * repeat verbatim on real ECZ papers. A stem-duplicate that carries a printed
 * number the earlier occurrence(s) did NOT is therefore kept, not collapsed;
 * an unnumbered repeat (or a repeat of the same printed number) is a true
 * duplicate and is still dropped.
 */
function dedupeExtractedQuestions(questions) {
  const seenByStem = new Map(); // questionKey → Set of numberKeys seen for it
  const out = [];
  for (const q of questions) {
    const key = questionKey(q);
    const nkey = numberKey(q);
    const prior = seenByStem.get(key);
    if (prior) {
      if (nkey == null || prior.has(nkey)) continue; // true duplicate
      prior.add(nkey); // distinct printed question sharing a stem — keep
    } else {
      seenByStem.set(key, new Set(nkey == null ? [] : [nkey]));
    }
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
 * seen, and the updated seen-sets. Drives the loop-until-dry coverage loop: each
 * round we ask the model for anything it has NOT yet returned, accept only the
 * genuinely new questions, and stop when a round adds nothing.
 *
 * Two de-dupe keys, because a SCANNED paper is re-OCR'd from the top on every
 * continuation round and the same question comes back with slightly different
 * text each time (e.g. "Mufulira" vs "Mufülira"), which slips past a stem match
 * and inflates the count (a 60-question paper imported as 105). So a question is
 * a re-read — NOT new — when EITHER its stem+options match a seen one OR its
 * PRINTED question number (section-scoped, see numberKey) is one already
 * captured. `seenNumbers` (optional, a Set of numberKey strings) enables the
 * number guard; when omitted the behaviour is the original stem-only de-dupe.
 * Both sets are mutated in place + returned.
 *
 * Same-stem exception — BATCH-SCOPED. Distinct printed questions can share a
 * verbatim stem ("Give a reason for your answer." repeats on real papers), and
 * when they do they arrive TOGETHER in one model response (they're printed
 * near each other, read in one pass). So a repeated stem is kept as a distinct
 * question only when its first occurrence was in THIS batch and it carries a
 * new printed number. A stem already known from a PREVIOUS round/segment is a
 * re-read whose printed number may have DRIFTED (misread digit, dropped
 * section heading) — keeping it would (a) import a duplicate, (b) poison
 * seenNumbers with the drifted number so the REAL question carrying it later
 * gets dropped, and (c) hide that number from gap detection and the gate's
 * missing-numbers blocker. All three were confirmed live failure modes, so a
 * cross-batch stem repeat is always dropped and its number never recorded.
 */
function selectNewQuestions(seenKeys, incoming, seenNumbers) {
  const keys = seenKeys instanceof Set ? seenKeys : new Set();
  const nums = seenNumbers instanceof Set ? seenNumbers : null;
  const fresh = [];
  // Stems first accepted within THIS call — the only scope where a repeated
  // stem with a new number is trusted as a genuinely distinct question.
  const batchKeys = new Set();
  for (const q of (Array.isArray(incoming) ? incoming : [])) {
    const nkey = numberKey(q);
    // A re-read of an already-captured printed number is the same question.
    if (nums && nkey != null && nums.has(nkey)) continue;
    const key = questionKey(q);
    if (keys.has(key)) {
      const distinctSameStem = batchKeys.has(key) && nums && nkey != null;
      if (!distinctSameStem) continue; // cross-batch re-read (or unnumbered)
    }
    batchKeys.add(key);
    keys.add(key);
    if (nums && nkey != null) nums.add(nkey);
    fresh.push(q);
  }
  return {fresh, seenKeys: keys, seenNumbers: nums};
}

/**
 * ANTI-INVENTION GUARD for gap recovery. Under "find the missing numbers"
 * pressure the model sometimes fabricates a hit: it re-words a question it
 * already returned, or re-numbers a nearby one, to satisfy a listed number —
 * which imported questions that DON'T EXIST on the paper (the "questions
 * replaced with other questions" bug). Keep only questions whose parsed
 * printed number is one of the numbers explicitly asked for; a recovered item
 * with no number, or an un-requested number, is discarded. An unfilled gap is
 * honest (it stays in the report's missing list); an invented question is
 * silent corruption.
 */
function filterRecoveredToWanted(questions, wantedNumbers) {
  const wanted = new Set(
    (Array.isArray(wantedNumbers) ? wantedNumbers : [])
      .map((n) => parseSourceNumber(n))
      .filter((n) => n != null),
  );
  return (Array.isArray(questions) ? questions : [])
    .filter((q) => {
      const num = parseSourceNumber(q && q.sourceNumber);
      return num != null && wanted.has(num);
    });
}

// How "complete" a candidate read is, for choosing between two same-number
// duplicates: more non-empty options first, then meaningfully higher
// confidence. Mirrors the scoring the declared-range reconciler uses
// (pastPaperImportReconcile.js's completenessScore) so both dedupe layers
// agree on which read is "better".
function optionCompleteness(q) {
  return Array.isArray(q && q.options) ?
    q.options.filter((o) => str(o).trim()).length : 0;
}

function questionConfidence(q) {
  const c = Number(q && q.confidence);
  return Number.isFinite(c) ? c : 0.5;
}

/**
 * Collapse questions that share the same PRINTED question number — they are the
 * same item re-read with OCR drift across continuation rounds. The FIRST
 * occurrence's POSITION in the list is kept, but the more COMPLETE candidate's
 * content wins that slot: a re-read with strictly more printed options, or the
 * same option count with meaningfully (>0.15) higher confidence, replaces a
 * thinner earlier read (Phase 2: "keep the most complete and highest-
 * confidence transcription" for a duplicate candidate). Two near-identical
 * reads with no meaningful completeness difference keep the first occurrence,
 * unaffected by incidental OCR noise (a stray space, a punctuation slip).
 * Numbers are section-scoped (numberKey), so a paper that restarts numbering
 * per section does not collide Section B's Q1 with Section A's. Questions with
 * no printed number are left untouched (they can't be number-matched and are
 * handled by the stem de-dupe instead). Returns {questions, removed}.
 */
function dedupeBySourceNumber(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const bestByKey = new Map(); // nkey → {q, optionCount, confidence}
  list.forEach((q) => {
    const nkey = numberKey(q);
    if (nkey == null) return;
    const optionCount = optionCompleteness(q);
    const confidence = questionConfidence(q);
    const current = bestByKey.get(nkey);
    if (!current) {
      bestByKey.set(nkey, {q, optionCount, confidence});
      return;
    }
    const meaningfullyBetter =
      optionCount > current.optionCount ||
      (optionCount === current.optionCount && confidence - current.confidence > 0.15);
    if (meaningfullyBetter) bestByKey.set(nkey, {q, optionCount, confidence});
  });

  const emitted = new Set();
  const out = [];
  let removed = 0;
  list.forEach((q) => {
    const nkey = numberKey(q);
    if (nkey == null) { out.push(q); return; }
    if (emitted.has(nkey)) { removed += 1; return; }
    emitted.add(nkey);
    out.push(bestByKey.get(nkey).q);
  });
  return {questions: out, removed};
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
 * prompt AND not a valid stem-less item, or an MCQ with fewer than two
 * options) so the caller can filter.
 *
 * STEM-LESS EXCEPTION: a spelling/punctuation item legitimately has NO printed
 * stem — the options themselves ARE the question ("Choose the correctly
 * spelled word: A tributaly B tributary …") and the Part's shared instruction
 * becomes the prompt during reconciliation (see pastPaperImportReconcile.js).
 * Dropping every empty-prompt candidate here — before the reconciler ever runs
 * — silently deleted those legitimate questions, so an empty prompt is kept
 * when the candidate has a verifiable printed number AND at least two printed
 * options; it is dropped only when it has neither a stem nor that pairing.
 *
 * Type resolution is defensive: an MCQ that arrives without enough options is
 * downgraded to short_answer (keeps the text), and a "numeric" whose answer
 * isn't a finite number is downgraded to short_answer (keeps the answer string)
 * — both because the editor's strict write schema rejects an MCQ with <2
 * options off a re-save, and a numeric without a finite answer. We never write
 * a record the editor can't re-save.
 */
/**
 * Pull a bracketed prose picture-description out of a question prompt —
 * "[Picture shows a person running]" / "(image of a maize plant)" — whether it
 * sits on its own line or inline at the end of a sentence. Older imports (and
 * a model that ignores the hasFigure contract) describe a question's picture
 * in prose because the schema gave it nowhere structured to put it; the
 * description is useful CONTEXT for the admin attaching the real image, but it
 * must never sit in the learner-visible question text. Returns
 * { prompt, figureDescription } — prompt unchanged and description '' when no
 * bracketed description is found. Conservative: the bracket content must
 * contain a picture keyword, so "[UNCLEAR]" or a legit bracketed part like
 * "(a)" is never touched.
 */
// The bracket must OPEN with a picture keyword and carry a real description
// after it (8+ chars) — so a terse printed cross-reference like "(figure 2)"
// or an "[UNCLEAR]" marker is never stripped from the stem.
const FIGURE_DESCRIPTION_RE = new RegExp(
  "[\\[(]\\s*(?:the\\s+)?(?:picture|image|photo(?:graph)?|diagram|figure|graph|chart|illustration|drawing)\\b[^\\])]{8,}[\\])]",
  "gi",
);
function extractFigureDescription(prompt) {
  const source = str(prompt);
  const matches = source.match(FIGURE_DESCRIPTION_RE);
  if (!matches || !matches.length) return {prompt: source.trim(), figureDescription: ""};
  const stripped = source.replace(FIGURE_DESCRIPTION_RE, " ").replace(/\s{2,}/g, " ").trim();
  const description = matches
    .map((m) => m.slice(1, -1).trim())
    .filter(Boolean)
    .join(" · ");
  // Never let the extraction erase the whole question: a prompt that IS only
  // the description keeps its original text (the admin still sees something).
  if (!stripped) return {prompt: source.trim(), figureDescription: description};
  return {prompt: stripped, figureDescription: description};
}

function normaliseImportedQuestion(raw, idx) {
  const promptFull = str(raw && raw.prompt).trim();
  // Split a prose picture-description out of the stem (kept as diagramText on
  // the question doc — see toQuestionDoc). Finding one is also a figure signal.
  const {prompt: promptStripped, figureDescription} = extractFigureDescription(promptFull);
  const promptRaw = promptStripped;

  const optionsRaw = Array.isArray(raw && raw.options) ? raw.options : [];
  let options = optionsRaw
    .map((o) => str(o).trim())
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);

  const sourceNumberEarly = parseSourceNumber(raw && raw.sourceNumber);
  const isStemless = !promptRaw && options.length >= 2 && sourceNumberEarly != null;
  if (!promptRaw && !isStemless) return null;
  const prompt = promptRaw;

  let type = canonicalType(raw && raw.type);
  // Infer when the model omitted/garbled the type: 2+ options ⇒ MCQ-like.
  if (!type) type = options.length >= 2 ? "mcq" : "short_answer";
  // A stem-less item's printed choices ARE the question — never let a
  // mis-typed short_answer/essay below wipe them back to [].
  if (isStemless && type !== "mcq" && type !== "tf") type = "mcq";

  const explanation = str(raw && raw.explanation).trim();
  const sourceNumber = sourceNumberEarly;
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

  // The printed section heading ("SECTION B") — scopes the printed number so
  // restart-numbering papers dedupe correctly (see numberKey).
  const sectionLabel = str(raw && raw.sectionLabel).trim().slice(0, 80);

  // The REAL page this question is printed on — separate from sourceNumber
  // (the printed question NUMBER). Never conflate the two (see toQuestionDoc).
  const sourcePageNumber = parseSourceNumber(raw && raw.sourcePageNumber);

  // The question's OWN printed picture (distinct from a shared passage/map
  // figure): the model reports hasFigure + a fractional figureBox; a prose
  // description found in the stem is an equally strong signal on papers
  // imported before the structured contract existed.
  const figureBox = sanitiseFigureBox(raw && raw.figureBox);
  const hasFigure = Boolean(raw && raw.hasFigure) || Boolean(figureBox) ||
    Boolean(figureDescription);

  return {
    type,
    prompt,
    options,
    correctAnswer,
    explanation,
    sourceNumber,
    ...(sourcePageNumber != null ? {sourcePageNumber} : {}),
    ...(sectionLabel ? {sectionLabel} : {}),
    answerKnown,
    order: Number.isInteger(idx) ? idx : 0,
    requiresReview: true,
    ...(hasFigure ? {hasFigure: true} : {}),
    ...(figureBox ? {figureBox} : {}),
    ...(figureDescription ? {figureDescription} : {}),
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
  const boxArea = (b) => (b ? b.w * b.h : 0);
  list.forEach((q, i) => {
    const p = q && q.passage;
    if (!p || !p.ref) return;
    const ord = Number.isInteger(q.order) ? q.order : i;
    let g = groups.get(p.ref);
    if (!g) {
      g = {ref: p.ref, title: "", passageText: "", passageKind: p.kind || "comprehension", order: ord, count: 0, table: null, figureLoc: null};
      groups.set(p.ref, g);
    }
    g.count += 1;
    if (p.title && p.title.length > g.title.length) g.title = p.title;
    if (p.text && p.text.length > g.passageText.length) g.passageText = p.text;
    if (p.table && tableCellCount(p.table) > tableCellCount(g.table)) g.table = p.table;
    if (p.kind === "map") g.passageKind = "map";
    // Figure location: page + box are an ATOMIC pair — a box only means
    // anything on the page it was reported with, so re-reads must never mix
    // one read's page with another's box (that crops a random region).
    // Preference: a complete page+box pair beats a page-only report; among
    // complete pairs the LARGEST box wins (jittery re-reads of the same
    // figure — the generous crop keeps the whole figure).
    if (p.sourcePage) {
      const incoming = {page: p.sourcePage, box: p.figureBox || null};
      const cur = g.figureLoc;
      if (!cur) {
        g.figureLoc = incoming;
      } else if (incoming.box && !cur.box) {
        g.figureLoc = incoming;
      } else if (incoming.box && cur.box && incoming.page === cur.page &&
                 boxArea(incoming.box) > boxArea(cur.box)) {
        g.figureLoc = incoming;
      }
    }
    if (ord < g.order) g.order = ord;
  });

  const refToId = new Map();
  const passages = [];
  let idx = 0;
  for (const g of groups.values()) {
    // A lone block with no text AND no table is a mislabelled standalone —
    // EXCEPT a map/figure block that carries a printed location (page/box):
    // a pure visual map has no OCR-able text but is real shared content the
    // studio attaches an image to. Dropping it was why imported Social
    // Studies maps vanished entirely.
    if (!g.passageText && !g.table && g.count < 2 &&
        !(g.passageKind === "map" && g.figureLoc)) continue;
    idx += 1;
    const id = `p${String(idx).padStart(3, "0")}`;
    refToId.set(g.ref, id);
    // Figure location only travels on MAP passages: a comprehension passage
    // is its text — attaching the raw page scan under a story just because
    // the model reported the page it starts on was a confirmed mis-feature.
    const loc = g.passageKind === "map" ? g.figureLoc : null;
    passages.push({
      id,
      title: g.title,
      passageText: g.passageText,
      passageKind: g.table && !g.passageText ? "map" : g.passageKind || "comprehension",
      order: g.order,
      ...(g.table ? {table: g.table} : {}),
      ...(loc ? {sourcePage: loc.page} : {}),
      ...(loc && loc.box ? {figureBox: loc.box} : {}),
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
 * (≥60% overall) — otherwise the signal is too noisy to trust.
 *
 * SECTION-SCOPED: papers that restart numbering per section are checked per
 * section label, else Section A's Q12 would mask a missing Q12 in Section B
 * (the union of restarted runs looks complete when it isn't). The returned
 * list is the sorted, de-duplicated union of every section's missing numbers
 * — plain integers, because the recovery prompt asks by printed number.
 */
function findSourceNumberGaps(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const bySection = new Map();
  let numbered = 0;
  for (const q of list) {
    const n = parseSourceNumber(q && q.sourceNumber);
    if (n == null) continue;
    numbered += 1;
    const section = normaliseSectionLabel(q && q.sectionLabel);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section).push(n);
  }
  if (numbered < 3) return [];
  if (numbered < list.length * 0.6) return [];

  const missing = new Set();
  for (const nums of bySection.values()) {
    // A section needs a few numbers of its own before its run is trusted —
    // one stray mislabelled question must not spawn a phantom gap list.
    if (nums.length < 3) continue;
    const set = new Set(nums);
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    // Guard against an absurd span (a mis-read "1999") producing a huge list.
    if (hi - lo > 500) continue;
    for (let n = lo; n <= hi; n++) {
      if (!set.has(n)) missing.add(n);
    }
  }
  return [...missing].sort((a, b) => a - b);
}

/**
 * Final pass over the accumulated questions: dedupe, then re-sequence `order`
 * 0..N. Returns {questions, duplicatesRemoved}.
 */
function mergeAndRenumber(questions) {
  const list = Array.isArray(questions) ? questions : [];
  // Collapse OCR-drift re-reads (same printed number) FIRST, then exact
  // stem/option duplicates — a final backstop in case any path accumulated
  // without the number-aware selectNewQuestions guard.
  const byNumber = dedupeBySourceNumber(list);
  const deduped = dedupeExtractedQuestions(
    byNumber.questions.map((q, i) => (q.order === i ? q : {...q, order: i})),
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

// Per-question confidence band — mirrors the client policy in
// src/utils/objectConfidence.js (>0.95 auto / 0.80-0.95 review / <0.80 approve).
// Kept as a small CJS copy here because that module is frontend ESM and can't be
// required from these CommonJS Cloud Functions. An unknown score reads as
// "review" — we never silently treat a missing score as high-confidence.
function confidenceBand(value) {
  const c = value == null ? NaN : Number(value);
  if (!Number.isFinite(c)) return "review";
  if (c >= 0.95) return "auto";
  if (c >= 0.8) return "review";
  return "approve";
}

// Tally the import's per-question confidence into the three bands. Reads
// aiConfidence (set by normaliseImportedQuestion from the model's per-question
// score) and falls back to a raw `confidence` field. Questions with no score at
// all are not counted — only ones the model actually scored.
function countConfidenceBands(questions) {
  const bands = {auto: 0, review: 0, approve: 0, scored: 0};
  for (const q of (Array.isArray(questions) ? questions : [])) {
    const raw = q && (q.aiConfidence != null ? q.aiConfidence : q.confidence);
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    bands[confidenceBand(raw)] += 1;
    bands.scored += 1;
  }
  return bands;
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
  figures = [],
  engineVersion = "",
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
  const figureList = Array.isArray(figures) ? figures : [];
  if (figureList.length > 0) {
    corrections.push(
      `Located ${figureList.length} printed figure/map(s) — attaching the ` +
      "image(s) from the uploaded paper.",
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
    // Per-question confidence banding so the studio can show how many questions
    // the AI was sure about vs. which to check first. Empty scored count when the
    // model returned no per-question scores (older runs).
    confidenceBands: countConfidenceBands(questions),
    issues,
    corrections,
    notes: Array.isArray(extraNotes) ? extraNotes.filter(Boolean) : [],
    // Printed figures/maps located on the paper — {passageId, title,
    // sourcePage, box}. The studio uses these to crop + attach each figure's
    // image from the uploaded source so the map is visible, not lost.
    figures: figureList,
    // Deploy observability: the version of the import engine that actually
    // ran. Surfaced in the studio's report so a stale Cloud Function deploy
    // (the silent firebase-tools "exit 0 but stale" failure) is visible.
    engineVersion: str(engineVersion),
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
  CONTENT_ROLES,
  classifyContentRole,
  questionKey,
  numberKey,
  sanitiseFigureBox,
  planPageBatches,
  selectNewQuestions,
  filterRecoveredToWanted,
  dedupeBySourceNumber,
  extractionProgress,
  summariseSeenStems,
  normaliseImportedQuestion,
  extractFigureDescription,
  parseSourceNumber,
  findSourceNumberGaps,
  mergeAndRenumber,
  validateImport,
  computeConfidence,
  countByType,
  confidenceBand,
  countConfidenceBands,
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
