/**
 * Server-side loader for the Syllabi Studio curriculum data, exposed as
 * KB-shape topics so `cbcKnowledge.getAllTopics()` can fold it into the
 * merged set behind the in-code seed and the Firestore admin overlay.
 *
 * Mirrors the client-side mapping in src/utils/syllabusMapping.js. Keep
 * the two files in lock-step when the Studio subject set changes.
 *
 * The data file itself lives at `functions/data/curriculum-data.json`
 * (a copy of the same JSON the client reads from /syllabi/). Keeping a
 * server-side copy means Cloud Functions don't need a Hosting round-trip
 * to read the curriculum on every cold start.
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

// The studio-subject → KB-subject tables + the "form N" → grade map live in
// kbLookupCandidates.js (a firebase-free module) so the KB grade/subject
// candidate helpers and their plain-node tests can share them without
// pulling in firebase-admin. Re-exported from this module below, so
// existing consumers keep importing them from here.
const {
  STUDIO_SUBJECT_TO_KB,
  STUDIO_SUBJECT_TO_KB_2013,
  FORM_TO_GRADE,
} = require("./kbLookupCandidates");

// Filenames for each curriculum framework — used by locateDataFile().
const FRAMEWORK_FILES = {
  "2023": "curriculum-data.json",
  "2013": "curriculum-data-2013.json",
};

const VALID_FRAMEWORKS = Object.freeze(["2023", "2013"]);
const DEFAULT_FRAMEWORK = "2023";

function normalizeFramework(framework) {
  if (framework == null) return DEFAULT_FRAMEWORK;
  const s = String(framework).trim();
  return VALID_FRAMEWORKS.includes(s) ? s : DEFAULT_FRAMEWORK;
}

// ECE age bands map to distinct grade codes (Nursery 3-4 → ECE_N,
// Reception 4-5 → ECE_R) so KB topics are scoped per band. Mirrors
// sheetNameToGrade in src/utils/syllabusMapping.js — keep in lock-step.
const ECE_NURSERY_PATTERN = /3-4\s*years?/i;
const ECE_RECEPTION_PATTERN = /4-5\s*years?/i;
const ECE_COMBINED_PATTERN = /3-5\s*years?/i;

function sheetNameToGrade(sheetName) {
  if (!sheetName) return "";
  const lower = String(sheetName).trim().toLowerCase();
  if (ECE_NURSERY_PATTERN.test(lower)) return "ECE_N";
  if (ECE_RECEPTION_PATTERN.test(lower)) return "ECE_R";
  if (ECE_COMBINED_PATTERN.test(lower)) return "ECE";
  const gradeMatch = lower.match(/grade\s*(\d+)/);
  if (gradeMatch) return `G${gradeMatch[1]}`;
  for (const [pattern, grade] of Object.entries(FORM_TO_GRADE)) {
    if (lower.startsWith(pattern)) return grade;
  }
  const formMatch = lower.match(/form\s*(\d+)/);
  if (formMatch) {
    const n = Number(formMatch[1]);
    if (n >= 1 && n <= 5) return `G${n + 7}`;
  }
  return "";
}

function slug(s) {
  return String(s || "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
}

/**
 * Translate a (studioSubject, sheetName) pair into the canonical CBC
 * subject key. The top-level STUDIO_SUBJECT_TO_KB map covers single-
 * subject syllabi cleanly; ECE + Lower Primary bundle several strands
 * under one top-level entry and need the sheet name to pick the right
 * CBC subject. Mirrors studioSubjectToKbSubject in
 * src/utils/syllabusMapping.js — keep in lock-step.
 */
function resolveKbSubject(studioSubject, sheetName) {
  if (
    studioSubject === "Early Childhood Education Syllabi (3-5 Years)" ||
    studioSubject === "Lower Primary Syllabi (Grades 1-3)"
  ) {
    const lower = String(sheetName || "").toLowerCase();
    const isEce = studioSubject.startsWith("Early");
    if (lower.includes("english")) return "english";
    if (lower.includes("zambian")) return "zambian_language";
    if (lower.includes("creative") || lower.includes("tech")) {
      return isEce ? "expressive_arts" : "creative_and_technology_studies";
    }
    if (
      lower.includes("math") || lower.includes("numeracy") || lower.includes("science")
    ) {
      return "numeracy";
    }
    return STUDIO_SUBJECT_TO_KB[studioSubject] || "";
  }
  return STUDIO_SUBJECT_TO_KB[studioSubject] || "";
}

function rowKey(studioSubject, sheetName, topic, subtopic) {
  return [studioSubject, sheetName, topic || "", subtopic || ""]
      .map((p) => String(p || "").trim().toLowerCase().replace(/\s+/g, "_"))
      .join("||");
}

// One cache + one cache-path entry per framework so loadRawData("2023") and
// loadRawData("2013") don't trample each other.
const _dataCache = new Map();
const _dataCachePathByFramework = new Map();

function locateDataFile(framework = DEFAULT_FRAMEWORK) {
  const fw = normalizeFramework(framework);
  const filename = FRAMEWORK_FILES[fw];
  // Prefer the per-functions data copy; fall back to the public asset when
  // running tests from the repo root.
  const candidates = [
    path.join(__dirname, "..", "data", filename),
    path.join(__dirname, "..", "..", "public", "syllabi", filename),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // continue probing
    }
  }
  return null;
}

function loadRawData(framework = DEFAULT_FRAMEWORK) {
  const fw = normalizeFramework(framework);
  if (_dataCache.has(fw)) return _dataCache.get(fw);
  const p = locateDataFile(fw);
  if (!p) {
    _dataCache.set(fw, {});
    return {};
  }
  try {
    _dataCachePathByFramework.set(fw, p);
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    _dataCache.set(fw, parsed);
    return parsed;
  } catch (err) {
    console.error("syllabiCurriculumData: read failed for", p, err);
    _dataCache.set(fw, {});
    return {};
  }
}

// Keep in lock-step with COLUMN_HEADER_NAMES / isHeaderEchoRow /
// rowsWithPropagatedTopic in src/utils/syllabusMapping.js.
const COLUMN_HEADER_NAMES = new Set([
  "TOPIC", "SUB-TOPIC", "SUBTOPIC", "SPECIFIC COMPETENCES",
  "LEARNING ACTIVITIES", "EXPECTED STANDARD",
]);

// True when a data row is just the sheet's column-header line repeated in the
// body (captured at PDF page breaks). These would otherwise surface as a bogus
// "TOPIC" topic with a "SUB-TOPIC" sub-topic.
function isHeaderEchoRow(cells) {
  const values = ["TOPIC", "SUB-TOPIC", "SPECIFIC COMPETENCES", "LEARNING ACTIVITIES", "EXPECTED STANDARD"]
      .map((k) => String(cells[k] || cells[k.replace("-", "")] || "").trim().toUpperCase())
      .filter(Boolean);
  return values.length >= 2 && values.every((v) => COLUMN_HEADER_NAMES.has(v));
}

function rowsWithPropagatedTopic(rows) {
  const out = [];
  let topic = "";
  let section = "";
  for (const row of rows || []) {
    if (row.type === "section") {
      section = row.label || "";
      continue;
    }
    if (row.type !== "data") continue;
    const cells = row.cells || {};
    if (isHeaderEchoRow(cells)) continue;
    const raw = String(cells.TOPIC || "").trim();
    if (raw) topic = raw;
    const subtopic = String(cells["SUB-TOPIC"] || cells.SUBTOPIC || "").trim();
    const specificCompetence = String(cells["SPECIFIC COMPETENCES"] || "").trim();
    const learningActivities = String(cells["LEARNING ACTIVITIES"] || "").trim();
    const expectedStandard = String(cells["EXPECTED STANDARD"] || "").trim();
    // Page-break continuation row (no sub-topic/competence, only the tail of
    // the previous row's activities/standard, often cut mid-phrase): join it
    // back onto the previous row — mirror of rowsWithPropagatedTopic in
    // src/utils/syllabusMapping.js.
    const prev = out.length ? out[out.length - 1] : null;
    if (prev && !raw && !subtopic && !specificCompetence && (learningActivities || expectedStandard)) {
      prev.learningActivities = joinCellTextSrv(prev.learningActivities, learningActivities);
      prev.expectedStandard = joinCellTextSrv(prev.expectedStandard, expectedStandard);
      continue;
    }
    out.push({
      topic,
      section,
      subtopic,
      specificCompetence,
      learningActivities,
      expectedStandard,
    });
  }

  // Drop topics that never carry a sub-topic or any content — empty strand
  // banners (READING / WRITING / …) mis-tagged as topics during ingestion.
  const topicHasSubstance = new Map();
  for (const r of out) {
    if (topicHasSubstance.get(r.topic)) continue;
    if (r.subtopic || r.specificCompetence || r.learningActivities || r.expectedStandard) {
      topicHasSubstance.set(r.topic, true);
    }
  }
  return out.filter((r) => !r.topic || topicHasSubstance.get(r.topic));
}

function buildTopicId(grade, subject, topic) {
  const g = slug(grade);
  const s = slug(subject);
  const t = slug(topic);
  if (!g || !s || !t) return null;
  return `${g}-${s}-${t}`;
}

/**
 * Load all syllabi-overrides docs under the active KB version. Each
 * override doc carries one of:
 *   { deleted: true }                            — hide this row
 *   { cells: { ... } }                           — replace cells in place
 *   { inserted: true, studioSubject, sheet, cells } — net-new row
 */
async function loadOverrides(version) {
  try {
    const db = admin.firestore();
    const snap = await db
        .collection("cbcKnowledgeBase")
        .doc(version)
        .collection("syllabusOverrides")
        .get();
    return snap.docs.map((d) => ({id: d.id, ...d.data()}));
  } catch (err) {
    console.error("syllabiCurriculumData: loadOverrides failed", err);
    return [];
  }
}

function applyOverridesToRaw(raw, overrides) {
  if (!overrides || overrides.length === 0) return raw;
  const clone = JSON.parse(JSON.stringify(raw));
  for (const ov of overrides) {
    if (!ov || typeof ov !== "object") continue;
    const subj = ov.studioSubject;
    const sheet = ov.sheet;
    if (!subj || !sheet) continue;
    if (!clone[subj]) clone[subj] = {};
    if (!clone[subj][sheet]) {
      clone[subj][sheet] = {
        title: sheet,
        columns: [
          "TOPIC", "SUB-TOPIC", "SPECIFIC COMPETENCES",
          "LEARNING ACTIVITIES", "EXPECTED STANDARD",
        ],
        rows: [],
      };
    }
    const sheetData = clone[subj][sheet];
    if (!Array.isArray(sheetData.rows)) sheetData.rows = [];

    if (ov.inserted) {
      sheetData.rows.push({type: "data", cells: ov.cells || {}});
      continue;
    }

    // Updates and deletes match by topic+subtopic (the keys an admin
    // would visually pick to edit a specific row). Topic may be blank
    // on continuation rows; we resolve it here using the same forward-
    // propagation rule the UI uses to display.
    let lastTopic = "";
    let matched = false;
    for (const row of sheetData.rows) {
      if (row.type !== "data") continue;
      const cells = row.cells || {};
      const raw = String(cells.TOPIC || "").trim();
      if (raw) lastTopic = raw;
      const effectiveTopic = raw || lastTopic;
      const sub = String(cells["SUB-TOPIC"] || cells.SUBTOPIC || "").trim();
      if (
        effectiveTopic.toLowerCase() === String(ov.topic || "").toLowerCase() &&
        sub.toLowerCase() === String(ov.subtopic || "").toLowerCase()
      ) {
        if (ov.deleted) {
          row.__deleted = true;
        } else if (ov.cells) {
          row.cells = {...row.cells, ...ov.cells};
        }
        matched = true;
        break;
      }
    }
    if (!matched && ov.cells) {
      sheetData.rows.push({type: "data", cells: ov.cells});
    }
  }
  // Strip tombstoned rows
  for (const subjData of Object.values(clone)) {
    for (const sheetData of Object.values(subjData || {})) {
      if (Array.isArray(sheetData?.rows)) {
        sheetData.rows = sheetData.rows.filter((r) => !r.__deleted);
      }
    }
  }
  return clone;
}

// ── 2013 schema parser ───────────────────────────────────────────────────
// Legacy sheets use a different column layout to the current 2023 sheets AND
// vary wildly among themselves (~28 header spellings incl. OCR artefacts and
// leading THEME/COMPONENT/UNIT columns). The single hardcoded read this used to
// do (TOPIC + KNOWLEDGE-as-subtopics) DROPPED the real SUB-TOPIC + CONTENT
// columns on most sheets and mis-filed content as sub-topics. We now resolve
// each column's ROLE and split joined outcomes the same way the client-side
// canonical parser (src/utils/curriculum2013Parser.js) does — keep the two in
// lock-step.

const _2013_norm = (c) => String(c == null ? "" : c).toLowerCase().replace(/[^a-z]/g, "");
const _2013_HEADER_WORDS = new Set([
  "knowledge", "skills", "skill", "values", "value", "content", "contents",
  "specificoutcomes", "specificoutcome", "activities", "activity", "topic",
  "topics", "subtopic", "subtopics", "theme", "component", "unit", "strand",
]);

// Map a 2013 sheet's actual headers to canonical roles (mirror of
// resolveColumnRoles in the client parser).
function resolve2013ColumnRoles(columns) {
  const cols = (Array.isArray(columns) ? columns : []).filter(Boolean);
  const roles = {theme: null, topic: null, subtopic: null, outcomes: null, content: [], skills: null, values: null, activities: null};
  for (const col of cols) {
    const n = _2013_norm(col);
    if (!n) continue;
    if (/^(theme|component|unit|strand)/.test(n)) { if (!roles.theme) roles.theme = col; }
    else if (n.includes("subtopic")) { if (!roles.subtopic) roles.subtopic = col; }
    else if (n === "topic" || n === "topics") { if (!roles.topic) roles.topic = col; }
    else if (n.includes("specificout") || n.includes("outcome")) { if (!roles.outcomes) roles.outcomes = col; }
    else if (n.includes("content") || n.includes("knowledge")) { roles.content.push(col); }
    else if (n.includes("activit")) { if (!roles.activities) roles.activities = col; }
    else if (n.includes("skill")) { if (!roles.skills) roles.skills = col; }
    else if (n.includes("value")) { if (!roles.values) roles.values = col; }
  }
  if (!roles.topic && roles.theme) { roles.topic = roles.theme; roles.theme = null; }
  return roles;
}

function is2013HeaderEchoRow(cells) {
  const values = Object.values(cells || {}).map((v) => String(v || "").trim()).filter(Boolean);
  if (values.length === 0) return false;
  return values.every((v) => _2013_HEADER_WORDS.has(_2013_norm(v)) || /^(sub\s*-?\s*topic|specific\s+outcomes?)$/i.test(v.trim()));
}

// Re-align a page-break row whose cells shifted left (outcome text lands in
// the TOPIC column). The tell: a real TOPIC cell never starts with a 4+-segment
// outcome code. Mirrors repairColumnShiftedRow in the client parser.
function repair2013ColumnShiftedRow(cells, columns, roles) {
  const src = cells || {};
  const cols = Array.isArray(columns) ? columns : [];
  if (!roles || !roles.topic || !roles.outcomes) return src;
  const topicRaw = String(src[roles.topic] || "").trim();
  const m = topicRaw.match(/^(\d+(?:\.\d+)*)/);
  if (!m || m[1].split(".").length < 4) return src;
  const from = cols.indexOf(roles.topic);
  const to = cols.indexOf(roles.outcomes);
  if (from < 0 || to <= from) return src;
  const offset = to - from;
  const out = {};
  for (let j = 0; j < cols.length; j++) {
    const srcIdx = j - offset;
    out[cols[j]] = srcIdx >= 0 ? String(src[cols[srcIdx]] || "") : "";
  }
  return out;
}

function rows2013WithPropagatedTopic(rows, roles, columns) {
  const out = [];
  let topic = "";
  let subtopic = "";
  for (const row of rows || []) {
    if (row.type !== "data") continue;
    let cells = row.cells || {};
    if (is2013HeaderEchoRow(cells)) continue;
    cells = repair2013ColumnShiftedRow(cells, columns, roles);
    const topicRaw = roles.topic ? String(cells[roles.topic] || "").trim() : "";
    const subRaw = roles.subtopic ? String(cells[roles.subtopic] || "").trim() : "";
    if (topicRaw) { topic = topicRaw; subtopic = ""; }         // new topic resets subtopic scope
    if (subRaw) subtopic = subRaw;                              // else inherit merged cell
    if (!topic && !subtopic) continue;
    out.push({
      topic: topic || subtopic,
      subtopic,
      specificOutcomes: roles.outcomes ? String(cells[roles.outcomes] || "").trim() : "",
      content: (roles.content || []).map((c) => String(cells[c] || "").trim()).filter(Boolean).join(" "),
      skills: roles.skills ? String(cells[roles.skills] || "").trim() : "",
      values: roles.values ? String(cells[roles.values] || "").trim() : "",
    });
  }
  return out;
}

// Split a joined SPECIFIC OUTCOMES cell into discrete outcome strings. Outcome
// depth is detected PER CELL (3 segments for primary Maths, 4 for Integrated
// Science / secondary) and the split is driven by the code structure, never
// punctuation — so a statement's own decimals never break it (mirror of the
// client parser's splitSpecificOutcomes).
function splitNumberedOutcomes(s) {
  const str = String(s || "")
      .replace(/(\d)\s*\.\s*\.+\s*(\d)/g, "$1.$2")  // OCR double-dots "10.1.3..5"
      .replace(/(\d)\s+\.(\d)/g, "$1.$2")            // stray space before dot
      .trim();
  if (!str) return [];
  const re = /\d+(?:\.\d+)+/g;
  const cand = [];
  let m;
  while ((m = re.exec(str)) !== null) {
    const prev = m.index > 0 ? str[m.index - 1] : "";
    if (prev && /[\d.]/.test(prev)) continue;
    cand.push({idx: m.index, depth: m[0].split(".").length});
  }
  const anchor = cand.find((c) => c.depth >= 3);
  if (!anchor) return [str];
  const starts = cand.filter((c) => c.depth === anchor.depth).map((c) => c.idx);
  if (starts[0] !== anchor.idx) starts.unshift(anchor.idx);
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const seg = str.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : str.length).trim();
    if (seg) out.push(seg);
  }
  return out.length ? out : [str];
}

// Split bullet-led lists (• Foo • Bar) into discrete items. Falls back to
// the whole string when there are no bullets.
function splitBulletList(s) {
  const str = String(s || "").trim();
  if (!str) return [];
  const parts = str.split(/[•●·▪◦]\s*/g).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [str];
}

// True when two adjacent fragments were split MID-PHRASE by a page break
// (mirror of isMidPhraseBreak in the client parser): unclosed bracket, or no
// sentence-terminal punctuation + lowercase/connector boundary.
function is2013MidPhraseBreak(prev, next) {
  const a = String(prev || "").trim();
  const b = String(next || "").trim();
  if (!a || !b) return false;
  const opens = (a.match(/\(/g) || []).length;
  const closes = (a.match(/\)/g) || []).length;
  if (opens > closes) return true;
  if (/[.!?;:]$/.test(a)) return false;
  if (/^[a-z(]/.test(b)) return true;
  if (/,$/.test(a) || /\b(and|or|of|in|on|for|to|the|a|an|with|by|from|such as|e\.g)$/i.test(a)) return true;
  return false;
}

// Join two raw cell strings across a page break: glued with a space when the
// break was mid-phrase, otherwise as separate bullet points (mirror of
// joinCellText in the client parser). Era-agnostic despite the 2013-named
// break detector — the CBC sheets have the same page-break artefacts.
function joinCellTextSrv(prevRaw, nextRaw) {
  const a = String(prevRaw || "").trim();
  const b = String(nextRaw || "").trim();
  if (!a) return b;
  if (!b) return a;
  return is2013MidPhraseBreak(a, b) ? `${a} ${b}` : `${a} • ${b}`;
}

// Push items onto a list, healing a mid-phrase page-break fragment by merging
// it into the previous item ("Comparing" + "urban and rural environment").
function pushJoined(arr, items) {
  for (const it of items) {
    const last = arr.length ? arr[arr.length - 1] : "";
    if (last && is2013MidPhraseBreak(last, it)) {
      arr[arr.length - 1] = `${last} ${it}`;
    } else {
      arr.push(it);
    }
  }
}

function get2013CurriculumDataTopics() {
  const raw = loadRawData("2013");
  const byKey = new Map();
  for (const [studioSubject, sheets] of Object.entries(raw || {})) {
    const subject = STUDIO_SUBJECT_TO_KB_2013[studioSubject];
    if (!subject) continue;
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      const grade = sheetNameToGrade(sheetName);
      if (!grade) continue;
      const roles = resolve2013ColumnRoles(sheet?.columns);
      const parsed = rows2013WithPropagatedTopic(sheet?.rows || [], roles, sheet?.columns);
      for (const r of parsed) {
        const key = `${grade}|${subject}|${r.topic.toLowerCase()}`;
        let entry = byKey.get(key);
        if (!entry) {
          entry = {
            id: buildTopicId(grade, subject, r.topic),
            grade,
            subject,
            topic: r.topic,
            subtopics: [],
            specificOutcomes: [],
            keyCompetencies: [],
            values: [],
            suggestedMaterials: [],
            framework: "2013",
            origin: "syllabi_studio_2013",
          };
          byKey.set(key, entry);
        }
        // Real sub-topics come from the SUB-TOPIC column (deduped), NOT from
        // the content/knowledge bullets as before. Sheets with no sub-topic
        // column at all (schema E, e.g. primary Mathematics) synthesise one
        // selectable sub-topic per split outcome so the subject stays usable —
        // mirroring propagatePreviousRows in the client data service.
        const outcomes = splitNumberedOutcomes(r.specificOutcomes);
        if (r.subtopic) {
          if (!entry.subtopics.some((st) => st.name === r.subtopic)) {
            entry.subtopics.push({
              name: r.subtopic,
              specificCompetence: "",
              learningActivities: "",
              expectedStandard: "",
            });
          }
        } else if (!roles.subtopic) {
          for (const o of outcomes) {
            if (!entry.subtopics.some((st) => st.name === o)) {
              entry.subtopics.push({
                name: o,
                specificCompetence: o,
                learningActivities: "",
                expectedStandard: "",
              });
            }
          }
        }
        for (const o of outcomes) {
          entry.specificOutcomes.push(o);
        }
        pushJoined(entry.keyCompetencies, splitBulletList(r.skills));
        pushJoined(entry.values, splitBulletList(r.values));
        pushJoined(entry.suggestedMaterials, splitBulletList(r.content));
      }
    }
  }
  return Array.from(byKey.values());
}

/**
 * Returns the Studio rows as flat KB-topic entries. One entry per
 * grade+subject+topic, with enriched sub-topic objects underneath.
 *
 * Framework defaults to "2023" — passing "2013" reads the legacy file via
 * its own schema parser. Every topic returned carries a `framework` field
 * so downstream filters can pick the right era cleanly.
 */
async function getCurriculumDataTopics(version, opts = {}) {
  const framework = normalizeFramework(opts.framework);
  if (framework === "2013") return get2013CurriculumDataTopics();

  const raw = loadRawData("2023");
  const overrides = version ? await loadOverrides(version) : [];
  const merged = applyOverridesToRaw(raw, overrides);
  const byKey = new Map();
  for (const [studioSubject, sheets] of Object.entries(merged || {})) {
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      const grade = sheetNameToGrade(sheetName);
      const subject = resolveKbSubject(studioSubject, sheetName);
      if (!grade || !subject) continue;
      const rows = rowsWithPropagatedTopic(sheet?.rows || []);
      for (const r of rows) {
        if (!r.topic) continue;
        const key = `${grade}|${subject}|${r.topic.toLowerCase()}`;
        let entry = byKey.get(key);
        if (!entry) {
          entry = {
            id: buildTopicId(grade, subject, r.topic),
            grade,
            subject,
            topic: r.topic,
            subtopics: [],
            specificOutcomes: [],
            keyCompetencies: [],
            values: [],
            suggestedMaterials: [],
            framework: "2023",
            origin: "syllabi_studio",
          };
          byKey.set(key, entry);
        }
        if (r.subtopic) {
          entry.subtopics.push({
            name: r.subtopic,
            specificCompetence: r.specificCompetence || "",
            learningActivities: r.learningActivities || "",
            expectedStandard: r.expectedStandard || "",
          });
          if (r.specificCompetence) {
            // A cell can hold SEVERAL coded competences (the ECE sheets join
            // "0.1.1.6.1 Name… 0.1.1.6.2 Use…") — one outcome per code.
            for (const o of splitNumberedOutcomes(r.specificCompetence)) {
              entry.specificOutcomes.push(o);
            }
          }
        }
      }
    }
  }
  return Array.from(byKey.values());
}

/**
 * Returns the merged Studio shape (subject → sheet → rows). Used by the
 * admin/teacher pages that want to render the same browsable layout but
 * with admin overrides applied. Defaults to the 2023 framework.
 */
async function getMergedStudioData(version, opts = {}) {
  const framework = normalizeFramework(opts.framework);
  const raw = loadRawData(framework);
  // Overrides are only defined for the current (2023) era today.
  const overrides = (version && framework === "2023") ?
    await loadOverrides(version) : [];
  return applyOverridesToRaw(raw, overrides);
}

function invalidateCache() {
  _dataCache.clear();
  _dataCachePathByFramework.clear();
}

module.exports = {
  STUDIO_SUBJECT_TO_KB,
  STUDIO_SUBJECT_TO_KB_2013,
  FRAMEWORK_FILES,
  VALID_FRAMEWORKS,
  DEFAULT_FRAMEWORK,
  normalizeFramework,
  sheetNameToGrade,
  resolveKbSubject,
  rowKey,
  loadRawData,
  loadOverrides,
  applyOverridesToRaw,
  getCurriculumDataTopics,
  get2013CurriculumDataTopics,
  getMergedStudioData,
  invalidateCache,
  _dataCachePath: (framework = DEFAULT_FRAMEWORK) =>
    _dataCachePathByFramework.get(normalizeFramework(framework)) || null,
};
