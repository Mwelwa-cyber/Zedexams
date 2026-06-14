/**
 * cdcModuleParser — turn the plain text of a Zambian CDC "Teaching Module"
 * PDF into the curriculum-module shape that functions/teacherTools/
 * curriculumModuleSchema.js validates (one module per sub-topic).
 *
 * The 2025 CDC teaching modules come in two layouts that share the same
 * section vocabulary (the "Icon Guide": Topic, Sub Topic, Specific Competence,
 * General Competence(s), Learning Activities, Teaching and Learning Materials,
 * Expected Standard, Assessment, Key Terms/Key words, Content Tips):
 *
 *   • decimal  — Civic Education: "1.1 TITLE" / "1.1.1 Sub-title" /
 *                "1.1.1.1 Specific Competence" then "Learners to: <competence>".
 *   • labelled — Commerce / Design & Technology / CTS: "TOPIC: NAME" /
 *                "Sub Topic: Name" (or "Sub-Topic 1- Name") /
 *                "Specific Competence: <competence>".
 *
 * The parser handles both by classifying each body line as a TOPIC header, a
 * SUB-TOPIC header, a SECTION label, or content for the current section. Table-
 * of-contents lines are dropped up front — every TOC entry carries a run of dot
 * leaders ("...."), which never appears in the body.
 *
 * Pure + dependency-free (ESM) so scripts/test-cdc-module-parser.mjs can unit
 * test it with plain node, per repo convention. The PDF→text step lives in the
 * CLI (scripts/curriculum/parse-cdc-module.mjs); this module never touches the
 * filesystem.
 */

// ── line cleaning ──────────────────────────────────────────────────────────

const DOT_LEADER = /\.{4,}/; // TOC rows: "1.1.1 Civic Education ....... 10"
const BOOKMARK_ERR = /Error!\s*Bookmark/i;
const PAGE_NUM = /^\s*(?:\d{1,3}|[ivxlcdm]{1,6})\s*(?:\|\s*P\s*a\s*g\s*e)?\s*$/i;
const PAGE_TAG = /\|\s*P\s*a\s*g\s*e/i;

// CDC PDFs frequently glue a header straight onto its body text with no line
// break — "1.5.1 POLITICAL PARTYIntroduction This subtopic…" or "Sub-Topic:
// Fire Fighting Introduction Firefighting…". These are the section markers that
// start a fresh field; inserting a newline before each one (longest first, so
// "Teaching and Learning Materials" wins over "Teaching Materials") un-glues
// the headers so the line classifier can see them. Markers are matched only
// when stuck to a preceding word/punctuation, so already-spaced text (where the
// marker starts its own line) is untouched.
const SEGMENT_MARKERS = [
  "Suggested Teaching and Learning Materials", "Suggested Methodology",
  "Teaching and Learning Materials", "Suggested Learning Environment",
  "Suggested Activity Process", "Teaching Materials",
  "Specific Competence", "General Competence",
  "Learning Activities", "Learning Activity", "Learning Environment",
  "Expected Standard", "Assessment Guidelines", "Assessment Strategies",
  "Assessment Methods", "Assessment Criteria", "ASSESSMENT CRITERIA",
  "ASSESSMENT", "Assessment",
  "Key Terms", "Key Words", "Key words",
  "Content Tips", "Content Tip",
  "INTRODUCTION", "INTRODOCTION", "Introduction",
  "Methodology", "Summary", "Learners to", "Learner to", "Activity",
  // De-glue topic/sub-topic headers from running-header prefixes
  // ("…TEACHING MODULE -TERM 20.1.2 TOPIC: DRAMA").
  "Sub-Topic", "Sub Topic", "Sub-topic", "Subtopic", "SUBTOPIC", "TOPIC",
// Longest first so "Teaching and Learning Materials" wins over "Teaching
// Materials" when both match at one position.
].sort((a, b) => b.length - a.length);
// Running headers/footers repeat on every page and glue onto real headers
// ("GRADE 1 TERM 2TOPIC: 1.6 SOUNDS"). Strip the boilerplate so the page
// furniture stops masking the structure. Subject-agnostic — safe across docs.
const BOILERPLATE = [
  // Strip the running header as the WHOLE "<subject> teaching module" phrase —
  // never the bare subject name, which also appears inside real titles
  // ("1.1 INTRODUCTION TO CIVIC EDUCATION").
  /EARLY CHILDHOOD EDUCATION\s*:?\s*CREATIVE AND TECHNOLOGY STUDIES\s*TEACHING MODULE/gi,
  /CREATIVE AND TECHNOLOGY STUDIES\s*TEACHING MODULE/gi,
  /DESIGN AND TECHNOLOGY\s*TEACHING MODULE/gi,
  /CIVIC EDUCATION\s*TEACHING MODULE/gi,
  /COMMERCE\s*TEACHING MODULE/gi,
  /\bTEACHING\s*MODULE\b/gi,
  /MODULE ICONS?:?/gi,
  /ICON GUIDE/gi,
  // The (?![\d.]) guard stops "TERM 2" eating the next code's lead digit when
  // they're glued ("…-TERM 20.1.2 TOPIC: …" must keep "0.1.2"). The (?=\d)
  // variant handles the glued case itself — drop "TERM 2", keep the code.
  /GRADE\s*\d+\s*-?\s*TERM\s*[123](?![\d.])/gi,
  /FORM\s*\d+\s*-?\s*TERM\s*[123](?![\d.])/gi,
  /-?\s*TERM\s*[123](?=\d)/gi,
  /\bTERM\s*[123](?![\d.])/gi,
  /Republic of Zambia/gi,
  /Ministry of Education/gi,
  /Directorate of Curriculum Development/gi,
  /Curriculum Development Centre/gi,
];
export function stripBoilerplate(text) {
  let t = String(text || "");
  for (const re of BOILERPLATE) t = t.replace(re, " ");
  return t;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const SEGMENT_RE = new RegExp(
  "([A-Za-z0-9)\\].,;:])(" + SEGMENT_MARKERS.map(escapeRe).join("|") + ")", "g");

// Distinctive multi-word markers also appear in lower/mixed case in some
// modules ("…plays.Learning environment: Indoor…"). These phrases are long
// enough to break on case-insensitively without splitting ordinary prose.
const CI_MARKERS = [
  "Suggested Teaching and Learning Materials",
  "Teaching and Learning Materials", "Learning Environment",
  "Specific Competence", "General Competence", "Expected Standard",
  "Assessment Criteria", "Assessment Strategies", "Assessment Guidelines",
  "Learning Activities", "Learning Activity", "Content Tips",
].sort((a, b) => b.length - a.length);
const CI_RE = new RegExp(
  "([A-Za-z0-9)\\].,;:])(" + CI_MARKERS.map(escapeRe).join("|") + ")", "gi");

// Some modules pack several fields onto ONE space-separated line ("Specific
// Competence(s) – Learners to: X Activity 1 …" or "…equipment. Learning
// Activity 1: …"). Break before these distinctive multi-word section markers
// even when a space precedes them — they're long enough not to fire inside
// ordinary prose. (SEGMENT_RE/CI_RE only handle the glued, no-space case.)
const STRONG_MARKERS = [
  "Suggested Teaching and Learning Materials", "Suggested Methodology",
  "Teaching and Learning Materials", "Learning Environment",
  "Specific Competence", "General Competence", "Expected Standard",
  "Assessment Criteria", "Assessment Strategies", "Assessment Guidelines",
  "Learning Activities", "Learning Activity", "Content Tips",
].sort((a, b) => b.length - a.length);
const STRONG_RE = new RegExp(
  "\\s+(" + STRONG_MARKERS.map(escapeRe).join("|") + ")\\b", "gi");

// All-caps topic/sub-topic headers (and Introduction) also sit mid-line after
// the previous section's prose ("…resources 1.1.2. SUB-TOPIC 2: POPULATION").
// Break before them when space-separated — CASE-SENSITIVE so lowercase "topic"
// in running prose ("the focus of this topic") is left alone.
// NB: not "Introduction" — it appears inside legit titles ("INTRODUCTION TO
// CIVIC EDUCATION"); headerTitle() trims a glued intro instead.
const STRONG_CS_MARKERS = [
  "SUB-TOPIC", "SUB TOPIC", "SUBTOPIC", "Sub-Topic", "Sub Topic", "Subtopic",
  "TOPIC", "Activity", "ACTIVITY",
].sort((a, b) => b.length - a.length);
const STRONG_CS_RE = new RegExp(
  "\\s+(" + STRONG_CS_MARKERS.map(escapeRe).join("|") + ")\\b", "g");

export function injectBreaks(text) {
  return String(text || "")
    .replace(SEGMENT_RE, "$1\n$2")
    .replace(CI_RE, "$1\n$2")
    .replace(STRONG_RE, "\n$1")
    .replace(STRONG_CS_RE, "\n$1");
}

const TERM_WORD = { one: 1, two: 2, three: 3 };
function termNum(s) {
  const k = String(s || "").toLowerCase();
  return TERM_WORD[k] || Number(s) || 0;
}

// Some modules cover several terms in one PDF with a standalone "TERM 2"
// divider page (e.g. Expressive Arts Grade 4 Term 1 & 2). Convert those
// divider lines into a sentinel that survives boilerplate stripping (no
// "TERM" text, so the TERM strippers leave it alone) — the parser switches
// the active term when it reaches one.
function markTermDividers(rawText) {
  return String(rawText || "").split("\n").map((l) => {
    const m = l.replace(/\s+/g, " ").trim()
      .match(/^TERM\s*(ONE|TWO|THREE|[123])$/i);
    return m ? ` §§T${termNum(m[1])}§§ ` : l;
  }).join("\n");
}
const TERM_SENTINEL = /§§T([123])§§/;

/** Split into trimmed body lines with TOC / page-furniture removed. */
export function cleanLines(rawText) {
  return injectBreaks(stripBoilerplate(markTermDividers(String(rawText || ""))))
    .split("\n")
    // Collapse whitespace, then drop leading bullet/dash furniture left behind
    // by stripped running headers ("- 0.1.2 TOPIC: …" → "0.1.2 TOPIC: …").
    .map((l) => l.replace(/\s+/g, " ").trim().replace(/^[\-–—•·]+\s*/, ""))
    .filter((l) =>
      l &&
      !DOT_LEADER.test(l) &&
      !BOOKMARK_ERR.test(l) &&
      !PAGE_NUM.test(l) &&
      !PAGE_TAG.test(l));
}

// ── header / section detectors ─────────────────────────────────────────────

const RE = {
  // "1.1 INTRODUCTION TO CIVIC EDUCATION"  (exactly 2 dotted numbers)
  topicDecimal: /^(\d+\.\d+)\s+(\S.*)$/,
  // "1.1.1 Civic Education"  (exactly 3 dotted numbers)
  subDecimal: /^(\d+\.\d+\.\d+)\s+(\S.*)$/,
  // "1.1.1.1 Specific Competence"  (exactly 4 dotted numbers)
  competenceDecimal: /^\d+\.\d+\.\d+\.\d+\s+specific competence/i,
  // "TOPIC: PRODUCTION", "0.1.1 TOPIC: : FOOD", "TOPIC: 1.6 SOUNDS",
  // "1.1. TOPIC 1: NATURAL RESOURCES", "TOPIC 1.5: …" (dotted code after label)
  topicLabelled: /^(?:\d[\d.]*\s+)?topic\s*[\d.]*\s*[:\-]+\s*(\S.*)$/i,
  // "Sub Topic: Name" / "Sub-Topic 1 - Name" / "SUB-TOPIC:1.6.1: Name"
  subLabelled: /^(?:\d[\d.]*\s+)?sub\s*-?\s*topic\s*[\d.]*\s*[:\-]+?\s*(\S.*)$/i,
  // "Specific Competence: X" / "Specific Competence(s) – Learners to: X" /
  // "Specific Competence 1.1.5.1: X" — tolerate (s), a dotted code, en/em-dashes.
  specific: /^specific\s+competenc(?:e|es|y|ies)\s*(?:\(s\))?\s*[\d.]*\s*[:;\-–—]*\s*(.*)$/i,
  general: /^general\s+competenc(?:e|es|y|ies)\s*(?:\(s\))?\s*[\d.]*\s*[:;\-–—]*\s*(.*)$/i,
  learnersTo: /^learners?\s*to\s*[:;\-–—]*\s*(.+)$/i,
  learningActivities: /^learning\s+activit(?:y|ies)\b\s*\d*\s*[:\-]?\s*(.*)$/i,
  materials: /^(?:suggested\s+)?teaching\s+and\s+learning\s+materials?\s*[:\-]?\s*(.*)$/i,
  learningEnv: /^(?:suggested\s+)?learning\s+environments?\s*[:\-]?\s*(.*)$/i,
  expectedStandard: /^expected\s+standards?\s*[:\-]?\s*(.*)$/i,
  assessment: /^assessment\s*[:\-]?\s*(.*)$/i,
  keyTerms: /^key\s+(?:terms?|words?)\s*[:\-]?\s*(.*)$/i,
  contentTips: /^content\s+tips?\s*[:\-]?\s*(.*)$/i,
  introduction: /^introduction\s*[:\-]?\s*(.*)$/i,
  hook: /^hook\s*[:\-]?\s*(.*)$/i,
  methodology: /^methodology\s*[:\-]?\s*(.*)$/i,
  steps: /^steps?\s*[:\-]?\s*(.*)$/i,
  summary: /^(?:unit\s+)?summary\s*[:\-]?\s*$/i,
  activity: /^activity\s*\d*\s*[:\-]?\s*(.*)$/i,
};

// Section labels that close the current free-text bucket without starting a
// captured one (so their prose doesn't leak into the previous field).
const NEUTRAL = ["hook", "methodology", "steps", "summary", "activity"];

// A header title runs until the body begins. Trim it at the first section
// marker still glued on, strip any trailing page number, and cap the length so
// a stray match on a prose line can't swallow a paragraph as a "title".
function headerTitle(raw) {
  let t = String(raw).trim().replace(/^[-–:\s]+/, "");
  // A code sometimes sits after the label ("SUB-TOPIC:1.6.1: Name") — drop it.
  // Require a trailing colon so a real title like "1.6 SOUNDS" is left intact.
  t = t.replace(/^\d[\d.]*\s*:\s*/, "");
  // No trailing \b — the next word is often glued ("…IntroductionPopulation…")
  // so the body keyword must still cut the title.
  const cut = t.search(/\b(Introduction|INTRODUCTION|INTRODOCTION|Specific [Cc]ompetence|General [Cc]ompetence|Learning Activit|Teaching|Expected Standard|Assessment|Key Terms|Key Words|Content Tip|Hook)/);
  if (cut > 0) t = t.slice(0, cut).trim();
  t = t.replace(/\s+\d{1,3}\s*$/, "").replace(/^topic\s*[:\-]\s*/i, "").trim();
  return t;
}
function isHeadline(t) { return t.length >= 2 && t.length <= 80 && !/^summary$|^unit summary$/i.test(t); }

function isTopicHeader(line) {
  const m = line.match(RE.topicLabelled);
  if (m) { const t = headerTitle(m[1]); return isHeadline(t) ? t : null; }
  const d = line.match(RE.topicDecimal);
  if (d) { const t = headerTitle(d[2]); return isHeadline(t) ? `${d[1]} ${t}` : null; }
  return null;
}

function isSubHeader(line) {
  const d = line.match(RE.subDecimal);
  if (d) { const t = headerTitle(d[2]); return isHeadline(t) ? `${d[1]} ${t}` : null; }
  const m = line.match(RE.subLabelled);
  if (m) { const t = headerTitle(m[1]); return isHeadline(t) ? t : null; }
  return null;
}

// ── main parse ─────────────────────────────────────────────────────────────

const MAX_SUMMARY = 8000;

function pushUnique(arr, val) {
  const v = String(val || "").trim();
  if (v && v.length >= 2 && !arr.includes(v)) arr.push(v);
}

/**
 * @param {string} rawText  extracted PDF text (ideally space-corrected)
 * @param {{grade:string, subject:string, term:number}} meta
 * @returns {{ modules: object[], warnings: string[] }}
 */
export function parseCdcModule(rawText, meta = {}) {
  const lines = cleanLines(rawText);
  const warnings = [];

  let topic = null; // { name, competencies:[], vocabulary:[] }
  let mod = null; // current sub-topic module
  const modules = [];
  let section = null; // where free-text content currently flows
  let curTerm = Number(meta.term) || 1; // switched by in-document TERM dividers

  const startSub = (name) => {
    if (!topic) {
      // A sub-topic before any topic header — synthesise a topic from it.
      topic = { name, competencies: [], vocabulary: [] };
    }
    mod = {
      grade: meta.grade,
      subject: meta.subject,
      term: curTerm,
      topic: topic.name,
      subtopic: name,
      outcomes: [],
      competencies: [...topic.competencies],
      vocabulary: [...topic.vocabulary],
      teacherActivities: [],
      learnerActivities: [],
      teachingMaterials: [],
      assessmentCriteria: [],
      exercises: [],
      _summary: [],
    };
    modules.push(mod);
    section = "intro";
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const tm = line.match(TERM_SENTINEL);
    if (tm) { curTerm = Number(tm[1]); continue; }

    const th = isTopicHeader(line);
    if (th) {
      topic = { name: th, competencies: [], vocabulary: [] };
      mod = null;
      section = null;
      continue;
    }
    const sh = isSubHeader(line);
    if (sh) {
      startSub(sh);
      continue;
    }

    // Section labels — set where the following content flows. Many carry their
    // value inline after the colon, which we capture immediately. A specific
    // competence under a topic with no explicit sub-topic (the Grade 1 / ECE
    // layout) opens an implicit sub-topic named after the topic.
    let m;
    if (RE.competenceDecimal.test(line)) {
      if (!mod && topic) startSub(topic.name);
      section = "outcome";
      continue;
    }
    if ((m = line.match(RE.specific))) {
      if (!mod && topic) startSub(topic.name);
      // An inline competence is complete on this line, so stop capturing; a
      // bare label waits for the next "Learners to:" / content line. This
      // keeps the following Learning environment / materials prose out of the
      // outcome.
      if (m[1].trim() && mod) { pushUnique(mod.outcomes, stripLeadCode(stripLearnersTo(m[1]))); section = "afterOutcome"; }
      else section = "outcome";
      continue;
    }
    if ((m = line.match(RE.learnersTo)) && section === "outcome" && mod) {
      pushUnique(mod.outcomes, stripLeadCode(m[1]));
      section = "afterOutcome";
      continue;
    }
    if (line.match(RE.learningEnv)) { section = null; continue; }
    if ((m = line.match(RE.general))) {
      section = "competency";
      if (m[1].trim()) pushUnique(curList(mod, topic, "competencies"), m[1]);
      continue;
    }
    if ((m = line.match(RE.materials))) {
      section = "materials";
      splitList(m[1]).forEach((x) => pushUnique(listOf(mod, "teachingMaterials"), x));
      continue;
    }
    if ((m = line.match(RE.expectedStandard))) {
      section = "standard";
      if (m[1].trim()) pushUnique(listOf(mod, "assessmentCriteria"), stripTrailingCode(m[1]));
      continue;
    }
    if ((m = line.match(RE.assessment))) {
      section = "assessment";
      if (m[1].trim()) pushUnique(listOf(mod, "exercises"), m[1]);
      continue;
    }
    if ((m = line.match(RE.keyTerms))) {
      section = "vocab";
      if (m[1].trim()) pushUnique(curList(mod, topic, "vocabulary"), vocabHead(m[1]));
      continue;
    }
    if ((m = line.match(RE.learningActivities))) {
      section = "activities";
      if (m[1].trim()) pushUnique(listOf(mod, "learnerActivities"), m[1]);
      continue;
    }
    if ((m = line.match(RE.contentTips))) {
      section = "summary";
      if (m[1].trim()) addSummary(mod, m[1]);
      continue;
    }
    if ((m = line.match(RE.introduction))) {
      section = "summary";
      if (m[1].trim()) addSummary(mod, m[1]);
      continue;
    }
    if (NEUTRAL.some((k) => RE[k] && RE[k].test(line))) {
      // Activity prose is a learner task; keep its lead line, then idle.
      const am = line.match(RE.activity);
      if (am && am[1] && am[1].trim() && mod) pushUnique(mod.learnerActivities, am[1]);
      section = null;
      continue;
    }

    // Plain content line → flows into the active section.
    if (!mod) continue;
    switch (section) {
      // Capture one competence line, then stop so following prose doesn't leak
      // into the outcome (the next competence has its own label).
      case "outcome": pushUnique(mod.outcomes, stripLeadCode(stripLearnersTo(line))); section = "afterOutcome"; break;
      case "competency": pushUnique(mod.competencies, line); break;
      case "materials": splitList(line).forEach((x) => pushUnique(mod.teachingMaterials, x)); break;
      case "standard": pushUnique(mod.assessmentCriteria, stripTrailingCode(line)); break;
      case "assessment": pushUnique(mod.exercises, line); break;
      case "vocab": pushUnique(mod.vocabulary, vocabHead(line)); break;
      case "activities": pushUnique(mod.learnerActivities, line); break;
      case "intro":
      case "summary": addSummary(mod, line); break;
      default: break;
    }
  }

  // Finalise: collapse the summary buffer, drop helper fields, warn on gaps.
  const out = modules.map((mraw) => {
    const { _summary, ...rest } = mraw;
    const contentSummary = (_summary || []).join(" ").slice(0, MAX_SUMMARY);
    return { schemaVersion: "1.0", ...rest, contentSummary };
  });

  for (const mm of out) {
    if (!mm.outcomes.length) {
      warnings.push(`No specific competence captured for sub-topic "${mm.subtopic}" (topic "${mm.topic}").`);
    }
  }
  if (!out.length) warnings.push("No sub-topics detected — check the source layout.");

  return { modules: out, warnings };
}

// ── helpers ────────────────────────────────────────────────────────────────

// Competencies / vocabulary attach to the topic when no sub-topic is open yet,
// otherwise to the current module.
function curList(mod, topic, field) {
  if (mod) return mod[field];
  if (topic) {
    if (field === "competencies") return topic.competencies;
    if (field === "vocabulary") return topic.vocabulary;
  }
  return [];
}
function target(mod, topic, field) { return mod ? mod[field] : (topic ? topic[field] || [] : []); }
function listOf(mod, field) { return mod ? mod[field] : []; }

function addSummary(mod, text) {
  if (!mod) return;
  const cur = mod._summary.join(" ").length;
  if (cur < MAX_SUMMARY) mod._summary.push(String(text).trim());
}

// "chart, posters; real objects" → ["chart","posters","real objects"]
function splitList(s) {
  return String(s || "")
    .split(/[,;]|•|\sand\s/i)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && x.length <= 200);
}

// Strip a leading "Learners to:" even behind a dash ("– Learners to: X" → "X").
function stripLearnersTo(s) {
  return String(s)
    .replace(/^[\s–—•·-]*learners?\s*to\s*[:;\-–—]*\s*/i, "")
    .trim();
}
// Outcomes sometimes lead with the competence code: "1.7.1.1 Practice simple
// plays." → "Practice simple plays."
function stripLeadCode(s) { return String(s).replace(/^\s*\d+(?:\.\d+)*\s+/, "").trim(); }
// "... shown accordingly 7" / "...- text 30" → drop a trailing page number.
function stripTrailingCode(s) { return String(s).replace(/\s+\d{1,3}\s*$/, "").trim(); }
// Key term entries are "Term: definition" — keep the term head for vocabulary.
function vocabHead(s) {
  const t = String(s).split(":")[0].trim();
  return t.length >= 2 && t.length <= 60 ? t : "";
}
