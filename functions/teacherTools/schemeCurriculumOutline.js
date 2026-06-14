/**
 * Scheme-of-Work curriculum outline.
 *
 * The Scheme of Work Studio must not guess topics. Before generation we pull
 * the official topic/subtopic outline for the grade+subject straight from the
 * curriculum knowledge base — which is itself layered (Syllabi Studio data →
 * in-code seed → admin Firestore overlay), exactly the merge `getAllTopics()`
 * performs. The resulting outline is injected into the prompt as an
 * authoritative `<curriculum_outline>` block so the model sequences REAL
 * topics across the term instead of inventing them.
 *
 * Two halves:
 *   - pure helpers (buildOutlineFromTopics / renderOutlineBlock / source
 *     mapping) — DOM-free, Firestore-free, unit-tested by
 *     functions/teacherTools/schemeCurriculumOutline.test.js
 *   - resolveSchemeOutline() — the thin async wrapper that reads the merged
 *     topic set and hands the pure half its input.
 */

// Canonical provenance labels surfaced to teachers ("show where it came from").
const SOURCE_SYLLABI = "syllabi_studio";
const SOURCE_MODULE = "uploaded_module";
const SOURCE_AI = "ai_inferred";
const SOURCE_TEACHER = "teacher";

const VALID_SOURCES = Object.freeze([
  SOURCE_SYLLABI, SOURCE_MODULE, SOURCE_AI, SOURCE_TEACHER,
]);

/**
 * Map a getAllTopics() `_source` tag onto a teacher-facing provenance label.
 * The seed + admin-Firestore overlay are official curriculum data, so they
 * collapse to "Syllabi Studio" alongside the syllabi-data rows themselves;
 * RAG/uploaded-module matches map to "uploaded module".
 */
function mapTopicSource(internalSource) {
  switch (internalSource) {
    case "syllabi_studio":
    case "seed":
    case "firestore":
      return SOURCE_SYLLABI;
    case "private_curriculum":
    case "curriculum_module":
    case "module":
      return SOURCE_MODULE;
    default:
      return SOURCE_SYLLABI;
  }
}

/** Normalise a per-week source string written by the model to a known label. */
function normalizeSource(value) {
  const s = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (VALID_SOURCES.includes(s)) return s;
  // Tolerate a few synonyms the model might emit.
  if (s === "syllabus" || s === "syllabi" || s === "curriculum") {
    return SOURCE_SYLLABI;
  }
  if (s === "module" || s === "modules") return SOURCE_MODULE;
  if (s === "ai" || s === "inferred" || s === "general") return SOURCE_AI;
  return "";
}

/** A sub-topic may be a plain string or a `{name, ...}` object — flatten it. */
function subtopicName(s) {
  if (s == null) return "";
  if (typeof s === "string") return s.trim();
  if (typeof s === "object" && typeof s.name === "string") return s.name.trim();
  return String(s).trim();
}

function uniqueClean(arr, max) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(arr) ? arr : []) {
    const v = typeof item === "string" ? item.trim() : "";
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (max && out.length >= max) break;
  }
  return out;
}

/**
 * Build an ordered topic outline from a merged topic set.
 *
 * @param {Array} topics  output of getAllTopics() (each {grade, subject,
 *   topic, subtopics, specificOutcomes, keyCompetencies, suggestedMaterials,
 *   _source})
 * @param {{grade:string, subject:string, normalizeGrade?:Function}} opts
 * @returns {{
 *   topics: Array<{topic, subtopics:string[], specificOutcomes:string[],
 *     keyCompetencies:string[], suggestedMaterials:string[], source:string}>,
 *   topicCount:number, subtopicCount:number, sources:string[]
 * }}
 */
function buildOutlineFromTopics(topics, opts = {}) {
  const gradeNorm = String(
    opts.normalizeGrade ? opts.normalizeGrade(opts.grade) : opts.grade,
  ).toUpperCase();
  const subjectNorm = String(opts.subject || "").toLowerCase()
      .replace(/[^a-z]/g, "_");

  const matched = (Array.isArray(topics) ? topics : []).filter((t) =>
    String(t.grade || "").toUpperCase() === gradeNorm &&
    String(t.subject || "").toLowerCase() === subjectNorm,
  );

  const sources = new Set();
  const outTopics = matched.map((t) => {
    const source = mapTopicSource(t._source);
    sources.add(source);
    return {
      topic: String(t.topic || "").trim(),
      subtopics: uniqueClean((t.subtopics || []).map(subtopicName), 12),
      specificOutcomes: uniqueClean(t.specificOutcomes, 8),
      keyCompetencies: uniqueClean(t.keyCompetencies, 6),
      suggestedMaterials: uniqueClean(t.suggestedMaterials, 8),
      source,
    };
  }).filter((t) => t.topic);

  const subtopicCount = outTopics.reduce((n, t) => n + t.subtopics.length, 0);
  return {
    topics: outTopics,
    topicCount: outTopics.length,
    subtopicCount,
    sources: Array.from(sources),
  };
}

/**
 * Render the outline as the `<curriculum_outline>` prompt block. Empty string
 * when there are no topics (caller then leans on resolveCbcContext's block /
 * general CBC knowledge and flags the gap via an advisory).
 */
function renderOutlineBlock(outline, meta = {}) {
  const topics = (outline && Array.isArray(outline.topics)) ?
    outline.topics : [];
  if (topics.length === 0) return "";

  const gradeLabel = String(meta.grade || "").replace(/^G/i, "");
  const lines = [
    "<curriculum_outline>",
    "This is the OFFICIAL topic outline for this grade and subject, pulled " +
    "from the Syllabi Studio curriculum (with uploaded modules folded in " +
    "where available). It is the authoritative list of topics and sub-topics.",
    "Build the scheme of work by sequencing THESE topics across the term, " +
    "simpler to more complex. Do NOT invent topics that aren't represented " +
    "here. If the outline has more material than the available weeks, combine " +
    "or carry topics over rather than padding with invented content.",
    "",
    `Grade: ${gradeLabel}`,
    `Subject: ${meta.subjectLabel || meta.subject || ""}`,
    meta.term ? `Term: ${meta.term}` : "",
    "",
  ];
  topics.forEach((t, i) => {
    lines.push(`${i + 1}. TOPIC: ${t.topic}  [source: ${t.source}]`);
    if (t.subtopics.length) {
      lines.push("   Sub-topics:");
      for (const s of t.subtopics) lines.push(`     - ${s}`);
    }
    if (t.specificOutcomes.length) {
      lines.push("   Specific competences / outcomes:");
      for (const o of t.specificOutcomes) lines.push(`     - ${o}`);
    }
    if (t.suggestedMaterials.length) {
      lines.push(`   Suggested T/L materials: ${t.suggestedMaterials.join("; ")}`);
    }
    lines.push("");
  });
  lines.push("</curriculum_outline>");
  return lines.filter((l) => l !== undefined).join("\n");
}

/**
 * Async wrapper: read the merged topic set and build the outline. `deps`
 * lets tests inject a getAllTopics stub; production passes the real one.
 */
async function resolveSchemeOutline({grade, subject, term, framework}, deps) {
  const {getAllTopics, normalizeGrade} = deps ||
    require("./cbcKnowledge");
  let topics = [];
  try {
    topics = await getAllTopics({framework});
  } catch (err) {
    console.error("resolveSchemeOutline: getAllTopics failed", err);
    topics = [];
  }
  const outline = buildOutlineFromTopics(topics, {
    grade, subject, normalizeGrade,
  });
  outline.block = renderOutlineBlock(outline, {grade, subject, term});
  return outline;
}

module.exports = {
  SOURCE_SYLLABI,
  SOURCE_MODULE,
  SOURCE_AI,
  SOURCE_TEACHER,
  VALID_SOURCES,
  mapTopicSource,
  normalizeSource,
  subtopicName,
  buildOutlineFromTopics,
  renderOutlineBlock,
  resolveSchemeOutline,
};
