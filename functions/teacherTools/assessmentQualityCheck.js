/**
 * assessmentQualityCheck — the deterministic "Assessment Quality Checker".
 *
 * A pure, dependency-free (bar bloomTaxonomy) pass that judges whether a
 * generated paper reads like a real Zambian assessment rather than a
 * topic-by-topic worksheet. It runs in generateAssessment AFTER the model
 * returns and BEFORE the paper is filed — no LLM call, no cost.
 *
 * Two exports:
 *   - checkAssessmentQuality(assessment, {grade, topics}) → a structured
 *     report {verdict, checks, warnings, clustered, topicsTagged, ...}. Pure
 *     analysis; never mutates.
 *   - interleaveSections(sections) → the same sections with each section's
 *     questions re-sequenced round-robin across their topics, so a clustered
 *     ("all of Topic 1, then all of Topic 2") paper becomes an interleaved one.
 *     Question numbers are stripped so validateAssessment renumbers cleanly.
 *
 * The checker is advisory (auto-fix + warn, never a hard block): the runner
 * interleaves when the paper is clustered + tagged, then surfaces the
 * remaining findings as non-blocking warnings the studio shows the teacher.
 *
 * Works on BOTH the raw model shape and the validated (assessmentSchema)
 * shape — it reads q.topic / q.bloomLevel / q.prompt / q.marks and folds
 * bloom spellings via bloomTaxonomy, so either shape is fine.
 */

const {
  normalizeBloom,
  bloomProfileForGrade,
  bloomWithinCeiling,
} = require("./bloomTaxonomy");

// Command words that don't change what a question assesses — stripped before
// the duplicate check so "Name two bones" / "State two bones" collide.
const COMMAND_WORDS = new Set([
  "name", "state", "list", "mention", "give", "write", "define", "identify",
  "describe", "explain", "outline", "what", "which", "who", "where", "when",
  "how", "why", "the", "a", "an", "is", "are", "of", "two", "three", "four",
  "one", "some", "any", "and", "or", "to", "in", "on", "for",
]);

function plainText(value) {
  return String(value == null ? "" : value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Reduce a question to its assessed "core" for duplicate detection: drop
// markup, command words and punctuation, but KEEP digits — otherwise real
// maths items ("2 + 2" vs "9 + 9") would look identical. This catches reworded
// recall ("Name two bones" / "State two bones" → "bones") without false
// positives on numerically-distinct questions.
function questionCore(prompt) {
  const words = plainText(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !COMMAND_WORDS.has(w));
  return words.sort().join(" ");
}

function topicOf(q) {
  const t = (q && typeof q.topic === "string") ? q.topic.trim() : "";
  return t;
}

function flattenQuestions(assessment) {
  const sections = Array.isArray(assessment && assessment.sections) ?
    assessment.sections : [];
  const out = [];
  for (const s of sections) {
    const qs = Array.isArray(s && s.questions) ? s.questions : [];
    for (const q of qs) if (q && typeof q === "object") out.push(q);
  }
  return out;
}

// Longest run of consecutive identical (non-empty) topics in a list.
function longestRun(topics) {
  let best = 0;
  let cur = 0;
  let prev = null;
  for (const t of topics) {
    if (t && t === prev) {
      cur += 1;
    } else {
      cur = 1;
      prev = t;
    }
    if (cur > best) best = cur;
  }
  return best;
}

/**
 * Is a section clustered — i.e. does it group a topic into a block instead of
 * rotating? Only meaningful when the section spans ≥ 2 tagged topics.
 */
function sectionClustered(questions) {
  const topics = questions.map(topicOf).filter(Boolean);
  const distinct = new Set(topics);
  if (distinct.size < 2) return false;
  const n = topics.length;
  const run = longestRun(topics);
  const ideal = Math.ceil(n / distinct.size);
  return run >= 3 || (run >= 2 && run > ideal);
}

/**
 * Re-sequence one section's questions round-robin across their topics so no
 * topic sits in a block. Untagged questions form their own bucket and are
 * spread in too. Stable within a topic (keeps the model's easy→hard order).
 * Strips `number` so the caller can renumber via validateAssessment.
 */
function interleaveQuestions(questions) {
  const buckets = new Map();
  const order = [];
  for (const q of questions) {
    const key = topicOf(q) || "untagged";
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key).push(q);
  }
  if (order.length < 2) return questions.slice();
  const out = [];
  let remaining = questions.length;
  while (remaining > 0) {
    for (const key of order) {
      const bucket = buckets.get(key);
      if (bucket.length) {
        const q = bucket.shift();
        const {number, ...rest} = q; // drop number → clean renumber downstream
        void number;
        out.push(rest);
        remaining -= 1;
      }
    }
  }
  return out;
}

/**
 * Re-sequence every section that is clustered. Returns a NEW sections array
 * (inputs untouched); unclustered sections pass through unchanged.
 * @param {Array} sections
 * @returns {Array}
 */
function interleaveSections(sections) {
  const list = Array.isArray(sections) ? sections : [];
  return list.map((s) => {
    const questions = Array.isArray(s && s.questions) ? s.questions : [];
    if (!sectionClustered(questions)) return {...s, questions: questions.slice()};
    return {...s, questions: interleaveQuestions(questions)};
  });
}

/**
 * Judge the assessment. Advisory only.
 * @param {object} assessment validated (or raw) assessment object
 * @param {{grade?:string, topics?:string[]}} [opts] requested grade + topics
 * @returns {{
 *   verdict: 'pass'|'warn',
 *   checks: object,
 *   warnings: string[],
 *   clustered: boolean,
 *   topicsTagged: boolean,
 *   reordered: boolean,
 * }}
 */
function checkAssessmentQuality(assessment, opts = {}) {
  const grade = String(opts.grade || "");
  const requested = (Array.isArray(opts.topics) ? opts.topics : [])
    .map((t) => String(t || "").trim()).filter(Boolean);
  const questions = flattenQuestions(assessment);
  const sections = Array.isArray(assessment && assessment.sections) ?
    assessment.sections : [];
  const warnings = [];
  const checks = {};

  const total = questions.length;
  const tagged = questions.filter((q) => topicOf(q)).length;
  const topicsTagged = total > 0 && (tagged / total) >= 0.6;

  // ── Topic mixing ─────────────────────────────────────────────────────────
  const clustered = sections.some((s) =>
    sectionClustered(Array.isArray(s && s.questions) ? s.questions : []));
  checks.topicMixing = {
    ok: !clustered,
    detail: clustered ?
      "Questions from one topic are grouped in a block — a real test rotates " +
      "topics." :
      "Topics are mixed through the paper.",
  };
  if (clustered) {
    warnings.push("Some topics are grouped together like a worksheet — " +
      "the questions were re-ordered to mix topics through the paper.");
  }

  // ── Curriculum coverage ──────────────────────────────────────────────────
  const presentTopics = new Set(questions.map(topicOf).filter(Boolean));
  const missing = requested.filter((t) =>
    !presentTopics.has(t) &&
    ![...presentTopics].some((p) => p.toLowerCase() === t.toLowerCase()));
  // Distribution skew: with ≥2 topics, no single topic should dominate.
  const counts = {};
  for (const t of presentTopics) counts[t] = 0;
  for (const q of questions) {
    const t = topicOf(q);
    if (t) counts[t] = (counts[t] || 0) + 1;
  }
  const maxShare = tagged > 0 ?
    Math.max(0, ...Object.values(counts)) / tagged : 0;
  const skewed = presentTopics.size >= 2 && maxShare > 0.7;
  checks.coverage = {
    ok: missing.length === 0 && !skewed,
    detail: missing.length ?
      `Not every requested topic is covered (missing: ${missing.join(", ")}).` :
      skewed ? "One topic dominates the paper." : "Curriculum coverage is balanced.",
  };
  if (missing.length) {
    warnings.push(`These topics were requested but not covered: ${missing.join(", ")}.`);
  } else if (skewed) {
    warnings.push("One topic takes up most of the paper — spread the questions more evenly.");
  }

  // ── Bloom variety ────────────────────────────────────────────────────────
  const profile = bloomProfileForGrade(grade);
  const levels = questions.map((q) => normalizeBloom(q && q.bloomLevel)).filter(Boolean);
  const distinctLevels = new Set(levels);
  const overCeiling = [...distinctLevels].filter((l) => !bloomWithinCeiling(l, grade));
  const bloomTagged = levels.length >= Math.ceil(total * 0.6);
  const allRecall = distinctLevels.size === 1 && distinctLevels.has("remember");
  const tooFlat = bloomTagged && distinctLevels.size < profile.minDistinct;
  checks.bloomVariety = {
    ok: !allRecall && !tooFlat && overCeiling.length === 0,
    detail: allRecall ? "Every question is recall — vary the thinking skills." :
      tooFlat ? `Only ${distinctLevels.size} cognitive level(s) — aim for at ` +
        `least ${profile.minDistinct}.` :
      overCeiling.length ? `Some questions are above the grade's level ` +
        `(${overCeiling.join(", ")}).` :
      "A good mix of thinking skills.",
  };
  if (allRecall) {
    warnings.push("The paper is all recall questions — add some that need understanding, application or analysis.");
  } else if (tooFlat) {
    warnings.push(`The paper uses only ${distinctLevels.size} cognitive level(s); a balanced test mixes more.`);
  } else if (overCeiling.length) {
    warnings.push(`Some questions may be too demanding for ${grade || "this grade"} (${overCeiling.join(", ")}).`);
  }

  // ── Duplicate detection ──────────────────────────────────────────────────
  const seen = new Map();
  const dupes = [];
  questions.forEach((q, i) => {
    const core = questionCore(q && q.prompt);
    if (!core || core.length < 3) return;
    if (seen.has(core)) {
      dupes.push([seen.get(core), i]);
    } else {
      seen.set(core, i);
    }
  });
  checks.noDuplicates = {
    ok: dupes.length === 0,
    detail: dupes.length ?
      `${dupes.length} question(s) repeat another with different wording.` :
      "No repeated questions.",
  };
  if (dupes.length) {
    warnings.push(`${dupes.length} question(s) look like reworded duplicates — each question should assess something different.`);
  }

  // ── Mark allocation ──────────────────────────────────────────────────────
  const sumMarks = questions.reduce((s, q) =>
    s + (Number(q && q.marks) > 0 ? Number(q.marks) : 0), 0);
  const headerTotal = Number(assessment && assessment.header &&
    assessment.header.totalMarks) || 0;
  const zeroMark = questions.some((q) => !(Number(q && q.marks) > 0));
  const marksMismatch = headerTotal > 0 && Math.abs(headerTotal - sumMarks) > 0;
  checks.markAllocation = {
    ok: !zeroMark && !marksMismatch,
    detail: zeroMark ? "A question has no marks." :
      marksMismatch ? `Header total (${headerTotal}) ≠ sum of marks (${sumMarks}).` :
      "Marks add up sensibly.",
  };
  if (zeroMark) warnings.push("A question has no marks allocated.");

  const verdict = warnings.length === 0 ? "pass" : "warn";
  return {
    verdict,
    checks,
    warnings,
    clustered,
    topicsTagged,
    reordered: false,
    stats: {
      questions: total,
      taggedTopics: tagged,
      distinctBloomLevels: distinctLevels.size,
      distinctTopics: presentTopics.size,
    },
  };
}

module.exports = {
  checkAssessmentQuality,
  interleaveSections,
  // exported for unit tests
  sectionClustered,
  interleaveQuestions,
  questionCore,
  longestRun,
};
