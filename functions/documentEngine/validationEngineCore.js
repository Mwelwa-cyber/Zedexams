/**
 * functions/documentEngine/validationEngineCore.js
 *
 * The shared Document Understanding Engine's **validation stage** — the single
 * place structural checks live so every import surface (Past Paper Studio, the
 * Teacher Scan importer, and the Quiz Editor) validates a paper identically.
 *
 * This module is PURE and dependency-free (no firebase-functions) so it unit
 * tests under plain `node` (see validationEngineCore.test.js), matching the
 * repo's `*Core.js` convention. It has an ESM twin at
 * `src/documentEngine/validationEngine.js`; the two are pinned in lockstep by
 * `scripts/test-document-engine-parity.mjs` (same mechanism as
 * `scripts/test-question-consistency.mjs`).
 *
 * Design: it does NOT reimplement the numbering / dedupe / report / confidence
 * logic that already exists and is tested in `pastPaperImportHelpers.js`. It
 * re-exports those and layers on the genuine gaps the importer was missing:
 *   - analyzeNumbering      — missing / duplicate / out-of-order / restarted
 *   - analyzeMcqCompleteness — "Question 18 — Missing Option D"
 *   - detectUnclear         — surface the [UNCLEAR] "never guess" token
 *   - detectAnswerKeyBlock  — keep marking schemes OUT of the questions
 *   - mergeContinuations    — page/paragraph continuation backstop
 *   - computeValidationStatus — the per-card ok|warning|error rollup
 *   - gateImport            — the fail-graceful gate BEFORE the Quiz Editor
 *
 * The working question shape this operates on is the importer's, produced by
 * `normaliseImportedQuestion`:
 *   { type, prompt, options[], correctAnswer, explanation, sourceNumber,
 *     answerKnown, order, requiresReview, passage?, table? }
 */

const {
  parseSourceNumber,
  findSourceNumberGaps,
  dedupeExtractedQuestions,
  dedupeBySourceNumber,
  mergeAndRenumber,
  buildImportReport,
  computeConfidence,
  validateImport,
  collectPassages,
  countByType,
  canonicalType,
} = require("../teacherTools/pastPaperImportHelpers");

// The literal token OCR must emit for text it cannot read. Enforced in the
// three OCR prompts; surfaced here so a "never guess" gap is visible rather
// than silently invented. Keep in sync with the ESM twin + the prompts.
const UNCLEAR_TOKEN = "[UNCLEAR]";

// Standard MCQ option letters. ECZ multiple-choice items are A–D; matching /
// word-bank items rebuilt as MCQ can run longer, hence the headroom.
const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

// A block is an answer key / marking scheme when its heading says so …
const ANSWER_KEY_HEADING_RE =
  /\b(answers?|answer\s*key|marking\s*(?:scheme|key|guide)|mark\s*scheme|memorandum|\bmemo\b)\b/i;
// … or its body is a dense run of "N A", "12) B", "3. true" answer pairs.
const ANSWER_KEY_PAIR_RE =
  /(?:^|\s)(\d{1,3})\s*[).:-]?\s*(?:answer\s*[:-]?\s*)?([A-E]|true|false)\b/gi;

// ── small pure utilities ──────────────────────────────────────────

function str(v) {
  return v == null ? "" : String(v);
}

function uniqueSortedInts(list) {
  return Array.from(new Set(list.filter((n) => Number.isInteger(n)))).sort(
    (a, b) => a - b,
  );
}

function resolveType(question) {
  const q = question || {};
  const t = canonicalType(q.type);
  if (t) return t;
  return Array.isArray(q.options) && q.options.length >= 2 ? "mcq" : "short_answer";
}

// ── Numbering analysis (req: missing/dup/skipped/out-of-order/restart) ──

/**
 * Analyse the printed question numbering for structural problems.
 *
 * `missing` reuses the tested `findSourceNumberGaps` (union of min..max, so a
 * section that restarts numbering never produces false "missing" entries).
 * On top of that we walk the numbers in DOCUMENT order and classify:
 *   - restart    — the number drops back to at/under the current run's start
 *                  (ECZ papers legitimately restart per Section — NOT a duplicate)
 *   - duplicate  — the same number repeats WITHIN a run (OCR re-read drift)
 *   - outOfOrder — a backwards step that is not a full restart (e.g. 1,2,4,3,5)
 *
 * `reliable` mirrors findSourceNumberGaps' guard (≥3 numbers and ≥60% of
 * questions numbered); when false the signal is too noisy to act on and every
 * list is empty so the gate never blocks an un-numbered paper.
 */
function analyzeNumbering(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const numbered = list
    .map((q, i) => ({ num: parseSourceNumber(q && q.sourceNumber), i }))
    .filter((s) => s.num != null);

  const reliable =
    numbered.length >= 3 && numbered.length >= list.length * 0.6;

  if (!reliable) {
    return {
      reliable: false,
      count: numbered.length,
      missing: [],
      duplicates: [],
      outOfOrder: [],
      restarts: [],
    };
  }

  const missing = findSourceNumberGaps(list);
  const duplicates = [];
  const outOfOrder = [];
  const restarts = [];

  let runStart = null;
  let prev = null;
  const seenInRun = new Set();

  for (const { num, i } of numbered) {
    if (prev == null) {
      runStart = num;
      seenInRun.clear();
      seenInRun.add(num);
      prev = num;
      continue;
    }
    // A drop back to at/under the run's opening number is a genuine restart
    // (new Section), not a duplicate or an out-of-order slip.
    if (num < prev && num <= runStart) {
      restarts.push({ at: i, value: num });
      runStart = num;
      seenInRun.clear();
      seenInRun.add(num);
      prev = num;
      continue;
    }
    if (seenInRun.has(num)) {
      duplicates.push(num);
    } else if (num < prev) {
      outOfOrder.push(num);
    }
    seenInRun.add(num);
    prev = num;
  }

  return {
    reliable: true,
    count: numbered.length,
    missing,
    duplicates: uniqueSortedInts(duplicates),
    outOfOrder: uniqueSortedInts(outOfOrder),
    restarts,
  };
}

// ── MCQ completeness (req: "Question 18 — Missing Option D") ──────

function optionLetter(opt) {
  const m = str(opt).trim().match(/^\(?([A-Ha-h])\s*[).:-]/);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Detect an incomplete multiple-choice question WITHOUT ever fabricating an
 * option. Returns null when complete, else { severity, missingLetters[],
 * message }.
 *
 * When the options carry explicit letter labels ("A. …", "(B) …") we detect
 * INTERNAL gaps precisely and hard-flag them (severity 'error'). Without
 * reliable labels we can only spot a shortfall against the ECZ-standard four
 * options, which we soft-flag ('warning') so a genuine 3-option MCQ is not
 * treated as broken.
 */
function analyzeMcqCompleteness(question, label = "Question") {
  const q = question || {};
  if (resolveType(q) !== "mcq") return null;

  const options = (Array.isArray(q.options) ? q.options : [])
    .map((o) => str(o).trim())
    .filter(Boolean);

  if (options.length < 2) {
    return {
      severity: "error",
      missingLetters: [],
      message: `${label} — has fewer than 2 options`,
    };
  }

  const letters = options.map(optionLetter);
  const labeled = letters.filter(Boolean);
  if (labeled.length >= 2 && labeled.length === options.length) {
    const present = new Set(labeled);
    const maxIdx = Math.max(...labeled.map((l) => OPTION_LETTERS.indexOf(l)));
    const missingLetters = [];
    for (let k = 0; k <= maxIdx; k++) {
      if (!present.has(OPTION_LETTERS[k])) missingLetters.push(OPTION_LETTERS[k]);
    }
    if (missingLetters.length) {
      return {
        severity: "error",
        missingLetters,
        message: `${label} — Missing Option ${missingLetters.join(", ")}`,
      };
    }
    return null;
  }

  // No reliable letters: flag a shortfall vs the standard four-option MCQ.
  if (options.length < 4) {
    const missingLetters = OPTION_LETTERS.slice(options.length, 4);
    return {
      severity: "warning",
      missingLetters,
      message:
        `${label} — only ${options.length} options ` +
        `(expected 4: missing ${missingLetters.join(", ")})`,
    };
  }
  return null;
}

// ── [UNCLEAR] detection (req: never invent, mark unreadable text) ──

/**
 * Find every [UNCLEAR] token the OCR emitted on a question. Returns an array of
 * { field, index } hits so the report can count them and the editor can
 * highlight them. Never mutates the question.
 */
function detectUnclear(question) {
  const q = question || {};
  const hits = [];
  const scan = (field, value) => {
    const s = str(value);
    if (!s) return;
    let idx = s.indexOf(UNCLEAR_TOKEN);
    while (idx !== -1) {
      hits.push({ field, index: idx });
      idx = s.indexOf(UNCLEAR_TOKEN, idx + UNCLEAR_TOKEN.length);
    }
  };
  scan("prompt", q.prompt);
  scan("explanation", q.explanation);
  (Array.isArray(q.options) ? q.options : []).forEach((o, i) =>
    scan(`option[${i}]`, o),
  );
  if (q.passage) {
    scan("passage.text", q.passage.text);
    scan("passage.title", q.passage.title);
  }
  return hits;
}

// ── Manifest comparison (req: expectedQuestionNumbers === importedQuestionNumbers) ──

/**
 * Compare the ACTUAL printed numbers on the accepted questions against the
 * paper's own declared/expected set (from reconcilePastPaper's `expectedNumbers`
 * — a continuous 1..N run built from the cover-page count and/or printed Part
 * ranges). This is the strict, SET-based check the count-only invariant needs:
 * a list of 60 records containing 1..58, 59, 61 (missing 60, extra 61) has the
 * RIGHT COUNT but the WRONG SET, and must fail — findSourceNumberGaps alone
 * cannot see this because it only looks for gaps between the observed min and
 * max, so it misses both a truncated tail (paper stops at 55 of 60) and an
 * extra number sitting past the declared end.
 *
 * Returns null when no expected set was supplied (callers that have no
 * declared-range manifest keep the pre-existing, looser gap-based behaviour).
 */
function analyzeAgainstManifest(questions, expectedNumbers) {
  const expected = Array.isArray(expectedNumbers) ?
    expectedNumbers.filter((n) => Number.isInteger(n)) : [];
  if (!expected.length) return null;

  const expectedSet = new Set(expected);
  const actualNums = [];
  (Array.isArray(questions) ? questions : []).forEach((q) => {
    const n = parseSourceNumber(q && q.sourceNumber);
    if (n != null) actualNums.push(n);
  });
  const actualSet = new Set(actualNums);

  const missing = expected.filter((n) => !actualSet.has(n));
  const extras = uniqueSortedInts(actualNums.filter((n) => !expectedSet.has(n)));

  const counts = new Map();
  actualNums.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
  const duplicates = uniqueSortedInts(
    [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n),
  );

  return {
    expectedCount: expected.length,
    actualCount: actualNums.length,
    missing,
    extras,
    duplicates,
    exact:
      missing.length === 0 && extras.length === 0 && duplicates.length === 0 &&
      actualNums.length === expected.length,
  };
}

// ── Answer-key detection (req: keys must not become questions) ─────

/**
 * Whether a block (a raw string, or a question-like object with `.prompt`) is
 * an answer key / marking scheme rather than a question. Used to keep keys OUT
 * of the imported question set and to report them separately.
 */
function detectAnswerKeyBlock(block) {
  const text =
    typeof block === "string" ? block : str(block && block.prompt);
  const t = text.trim();
  if (!t) return false;
  const firstLine = (t.split(/\r?\n/)[0] || t).slice(0, 80);
  if (ANSWER_KEY_HEADING_RE.test(firstLine)) return true;
  // A dense run of "N X" answer pairs (and little else) is a key even without
  // a heading. Reset lastIndex — the regex is /g and is reused.
  ANSWER_KEY_PAIR_RE.lastIndex = 0;
  const pairs = t.match(ANSWER_KEY_PAIR_RE) || [];
  const words = t.split(/\s+/).filter(Boolean).length;
  return pairs.length >= 5 && pairs.length >= words * 0.3;
}

// ── Page / paragraph continuation backstop (req 4) ────────────────

/**
 * Deterministic backstop for a question OCR split across a page/paragraph. A
 * fragment that carries NO printed number, NO options, and follows a question
 * whose prompt did not end on sentence-ending punctuation is treated as the
 * TAIL of the previous question and merged in — never a new question.
 *
 * Conservative on purpose (only merges clear continuations) so it can never
 * swallow a real question. Returns { questions, merged }.
 */
function mergeContinuations(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const out = [];
  let merged = 0;
  for (const q of list) {
    const prev = out[out.length - 1];
    const num = parseSourceNumber(q && q.sourceNumber);
    const hasOptions = Array.isArray(q && q.options) && q.options.length > 0;
    const promptText = str(q && q.prompt).trim();
    const prevPrompt = str(prev && prev.prompt).trim();
    const prevEndsOpen = prevPrompt && !/[.?!:;)"']\s*$/.test(prevPrompt);
    const looksLikeTail =
      prev &&
      num == null &&
      !hasOptions &&
      promptText &&
      prevEndsOpen &&
      // A tail continues a sentence — starts lowercase or with a connector.
      /^[a-z(]|^(and|or|but|the|a|an|to|of|in|on|for|with|that|which)\b/.test(
        promptText,
      );
    if (looksLikeTail) {
      prev.prompt = `${prevPrompt} ${promptText}`.trim();
      merged += 1;
      continue;
    }
    out.push(q);
  }
  return { questions: out, merged };
}

// ── Per-card validation rollup (feeds question.validationStatus) ──

/**
 * Roll a single question up to 'ok' | 'warning' | 'error' for the editor card
 * chip. 'error' = structurally broken (no prompt, MCQ with a real option gap);
 * 'warning' = imported but needs a look ([UNCLEAR], no answer, thin MCQ);
 * 'ok' = passed.
 */
function computeValidationStatus(question) {
  const q = question || {};
  if (!str(q.prompt).trim()) return "error";
  const mcq = analyzeMcqCompleteness(q);
  if (mcq && mcq.severity === "error") return "error";
  const unclear = detectUnclear(q);
  const noAnswer = !q.answerKnown && resolveType(q) !== "essay";
  if ((mcq && mcq.severity === "warning") || unclear.length || noAnswer) {
    return "warning";
  }
  return "ok";
}

// ── The gate before the Quiz Editor (req: fail graceful with report) ──

/**
 * Structural gate run BEFORE anything reaches the Quiz Editor. Accepts a
 * StructuredDocument, `{ questions, expectedNumbers? }`, or a bare questions
 * array. Hard-blocks on:
 *   1. missing printed question numbers ("Missing questions: 24, 47")
 *   2. an answer key / marking scheme imported among the questions
 *   3. (degenerate) nothing extracted at all
 *   4. WHEN a declared-range manifest (`expectedNumbers`) is supplied: any
 *      printed number outside the declared set ("extras" — the 61/62/63
 *      phantom-count bug) and any duplicate printed number among the accepted
 *      questions. This is the exact-set enforcement
 *      (expectedQuestionNumbers === importedQuestionNumbers) — count alone is
 *      not enough, since 60 records that are 1..58,59,61 still "has 60".
 * Everything else — out-of-order, restarts, [UNCLEAR], thin MCQs, no-answer —
 * is surfaced as a non-blocking warning so a review flow (Scan, Editor) is
 * informed without being over-gated.
 *
 * Returns { ok, blockers[], warnings[], numbering, manifest }.
 */
function gateImport(input) {
  const questions = Array.isArray(input)
    ? input
    : input && Array.isArray(input.questions)
      ? input.questions
      : [];
  const expectedNumbers =
    input && !Array.isArray(input) ? input.expectedNumbers : undefined;

  const blockers = [];
  const warnings = [];
  const numbering = analyzeNumbering(questions);
  const manifest = analyzeAgainstManifest(questions, expectedNumbers);

  if (!questions.length) {
    blockers.push("No questions could be extracted from this paper.");
    return { ok: false, blockers, warnings, numbering, manifest };
  }

  // Missing numbers: prefer the manifest's exact declared set (catches a
  // truncated tail past the observed max, which the gap-based check below
  // cannot see) — fall back to the gap-based check when there's no manifest.
  if (manifest) {
    if (manifest.missing.length) {
      const shown = manifest.missing.slice(0, 20).join(", ");
      blockers.push(
        `Missing questions: ${shown}` +
          (manifest.missing.length > 20 ? ", …" : ""),
      );
    }
    if (manifest.extras.length) {
      const shown = manifest.extras.slice(0, 20).join(", ");
      blockers.push(
        `Unexpected extra question number(s) not declared on the paper: ${shown}` +
          (manifest.extras.length > 20 ? ", …" : "") +
          ` (the paper declares ${manifest.expectedCount} question(s)).`,
      );
    }
    if (manifest.duplicates.length) {
      blockers.push(
        `Duplicate question number(s) must be resolved before import: ` +
          manifest.duplicates.join(", "),
      );
    }
  } else if (numbering.missing.length) {
    const shown = numbering.missing.slice(0, 20).join(", ");
    blockers.push(
      `Missing questions: ${shown}` +
        (numbering.missing.length > 20 ? ", …" : ""),
    );
  }

  const keyBlocks = questions.filter(detectAnswerKeyBlock).length;
  if (keyBlocks) {
    blockers.push(
      `An answer key / marking scheme was detected among the questions ` +
        `(${keyBlocks} block${keyBlocks === 1 ? "" : "s"}). Remove it before ` +
        `importing — a key must not become a quiz question.`,
    );
  }

  if (numbering.duplicates.length) {
    warnings.push(
      `Duplicate question number(s): ${numbering.duplicates.join(", ")}`,
    );
  }
  if (numbering.outOfOrder.length) {
    warnings.push(
      `Out-of-order question number(s): ${numbering.outOfOrder.join(", ")}`,
    );
  }
  if (numbering.restarts.length) {
    warnings.push(
      `Numbering restarts ${numbering.restarts.length} time(s) — expected for ` +
        `multi-section papers, but confirm the sections are correct.`,
    );
  }

  let unclearTotal = 0;
  questions.forEach((q, i) => {
    unclearTotal += detectUnclear(q).length;
    const mcq = analyzeMcqCompleteness(
      q,
      `Question ${parseSourceNumber(q && q.sourceNumber) || i + 1}`,
    );
    if (mcq) warnings.push(mcq.message);
  });
  if (unclearTotal) {
    warnings.push(
      `${unclearTotal} unreadable [UNCLEAR] span(s) — review before publishing.`,
    );
  }

  const noAnswer = questions.filter(
    (q) => !q.answerKnown && resolveType(q) !== "essay",
  ).length;
  if (noAnswer) {
    warnings.push(
      `${noAnswer} question(s) have no answer set — the paper printed no key, ` +
        `so set the correct answer before publishing.`,
    );
  }

  // A stem-less item whose Part instruction couldn't be resolved (no matching
  // range, or the range carries no instruction) still has an empty prompt at
  // this point — surfaced, never silently written as a blank question.
  const emptyPrompt = questions.filter((q) => !str(q && q.prompt).trim()).length;
  if (emptyPrompt) {
    warnings.push(
      `${emptyPrompt} question(s) still have no question text after Part-` +
        `instruction reconciliation — add a stem manually before publishing.`,
    );
  }

  return { ok: blockers.length === 0, blockers, warnings, numbering, manifest };
}

module.exports = {
  UNCLEAR_TOKEN,
  // Re-exported tested helpers (single source of truth stays in the helpers).
  parseSourceNumber,
  findSourceNumberGaps,
  dedupeExtractedQuestions,
  dedupeBySourceNumber,
  mergeAndRenumber,
  buildImportReport,
  computeConfidence,
  validateImport,
  collectPassages,
  countByType,
  canonicalType,
  // New gap-closing validators.
  analyzeNumbering,
  analyzeAgainstManifest,
  analyzeMcqCompleteness,
  detectUnclear,
  detectAnswerKeyBlock,
  mergeContinuations,
  computeValidationStatus,
  gateImport,
};
