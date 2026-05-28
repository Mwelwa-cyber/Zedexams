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

const STUDIO_SUBJECT_TO_KB = {
  "Early Childhood Education Syllabi (3-5 Years)": "expressive_arts",
  "Lower Primary Syllabi (Grades 1-3)": "english",
  "Mathematics Syllabus (Grades 4-6)": "mathematics",
  "Science Syllabus (Grades 4-6)": "integrated_science",
  "Social Studies Syllabus (Grades 4-6)": "social_studies",
  "Home Economics & Hospitality Syllabus (Grades 4-6)": "home_economics",
  "Technology Studies Syllabus (Grades 4-6)": "technology_studies",
  "Mathematics Syllabus (Forms 1-4)": "mathematics",
  "Mathematics II Syllabus (Forms 1-4)": "mathematics",
  "Physics Syllabus (Forms 1-4)": "physics",
  "History Syllabus (Forms 1-4)": "history",
  "Geography Syllabus (Forms 1-4)": "geography",
  "ICT Syllabus (Forms 1-4)": "technology_studies",
  "Literature in English Syllabus (Forms 1-4)": "english",
  "Religious Education Syllabus (Forms 1-4)": "religious_education",
  "Physical Education Syllabus (Forms 1-4)": "physical_education",
  "Food & Nutrition Syllabus (Forms 1-4)": "home_economics",
  "Fashion & Fabrics Syllabus (Forms 1-4)": "home_economics",
  "Hospitality Management Syllabus (Forms 1-4)": "home_economics",
  "Travel & Tourism Syllabus (Forms 1-4)": "social_studies",
};

// Legacy 2013-curriculum subject → KB key map. Names mirror exactly the
// top-level keys in /public/syllabi/curriculum-data-2013.json, so a new
// 2013 syllabus shows up in the AI knowledge base as soon as it's added to
// the data file + listed here.
const STUDIO_SUBJECT_TO_KB_2013 = {
  "Integrated Science Syllabus (Grades 1-7, 2013)": "integrated_science",
  "Mathematics Syllabus (Grades 1-7, 2013)": "mathematics",
  "Social Studies Syllabus (Grades 1-7, 2013)": "social_studies",
  "English Language Syllabus (Grades 2-7, 2013)": "english",
  "Creative & Technology Studies Syllabus (2013)": "creative_and_technology_studies",
  "Home Economics Syllabus (Grades 5-7, 2013)": "home_economics",
  "Design & Technology Syllabus (Grades 5-7, 2013)": "design_and_technology",
  "Expressive Arts Syllabus (Grades 5-7, 2013)": "expressive_arts",
  "Zambian Language Syllabus (Grades 5-7, 2013)": "zambian_language",
  "Physical Education Syllabus (Grades 8-9, 2013)": "physical_education",
  "Agricultural Science Syllabus (Grades 10-12, 2013)": "agricultural_science",
  "Art & Design Syllabus (Grades 10-12, 2013)": "art_and_design",
  "Biology Syllabus (Grades 10-12, 2013)": "biology",
  "Chemistry Syllabus (Grades 10-12, 2013)": "chemistry",
  "Civic Education Syllabus (Grades 10-12, 2013)": "civic_education",
  "Food & Nutrition Syllabus (Grades 10-12, 2013)": "home_economics",
  "Geography Syllabus (Grades 10-12, 2013)": "geography",
  "History Syllabus (Senior Secondary, 2013)": "history",
  "Home Management Syllabus (Grades 10-12, 2013)": "home_economics",
  "Mathematics Syllabus (Grades 10-12, 2013)": "mathematics",
  "Physical Education Syllabus (Grades 10-12, 2013)": "physical_education",
  "Religious Education 2044 Syllabus (Grades 10-12, 2013)": "religious_education",
  "Religious Education 2046 Syllabus (Grades 10-12, 2013)": "religious_education",
};

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

const FORM_TO_GRADE = {
  "form 1": "G8",
  "form 2": "G9",
  "form 3": "G10",
  "form 4": "G11",
  "form 3 - 4": "G10",
  "form 5": "G12",
};

const ECE_AGE_PATTERNS = [/3-4\s*years?/i, /4-5\s*years?/i, /3-5\s*years?/i];

function sheetNameToGrade(sheetName) {
  if (!sheetName) return "";
  const lower = String(sheetName).trim().toLowerCase();
  if (ECE_AGE_PATTERNS.some((re) => re.test(lower))) return "ECE";
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
    const raw = String(cells.TOPIC || "").trim();
    if (raw) topic = raw;
    out.push({
      topic,
      section,
      subtopic: String(cells["SUB-TOPIC"] || cells.SUBTOPIC || "").trim(),
      specificCompetence: String(cells["SPECIFIC COMPETENCES"] || "").trim(),
      learningActivities: String(cells["LEARNING ACTIVITIES"] || "").trim(),
      expectedStandard: String(cells["EXPECTED STANDARD"] || "").trim(),
    });
  }
  return out;
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
// Legacy sheets use a different column layout to the current 2023 sheets:
//   2023: TOPIC, SUB-TOPIC, SPECIFIC COMPETENCES, LEARNING ACTIVITIES, EXPECTED STANDARD
//   2013: <topic-code column>, TOPIC, SPECIFIC OUTCOMES, KNOWLEDGE, SKILLS, VALUES
// The "topic-code column" is named after the first topic on the sheet
// (e.g. "4.1 SETS") and contains all topic codes for that sheet, so we
// detect it dynamically.

const _2013_KNOWN_COLS = new Set([
  "TOPIC", "SPECIFIC OUTCOMES", "KNOWLEDGE", "SKILLS", "VALUES",
]);

function detect2013TopicColumn(sheet) {
  const cols = Array.isArray(sheet?.columns) ? sheet.columns : [];
  for (const c of cols) {
    if (c && !_2013_KNOWN_COLS.has(c)) return c;
  }
  return null;
}

function rows2013WithPropagatedTopic(rows, topicColumn) {
  const out = [];
  let topic = "";
  for (const row of rows || []) {
    if (row.type !== "data") continue;
    const cells = row.cells || {};
    const codeRaw = topicColumn ? String(cells[topicColumn] || "").trim() : "";
    if (codeRaw) topic = codeRaw;
    if (!topic) continue;
    out.push({
      topic,
      specificOutcomes: String(cells["SPECIFIC OUTCOMES"] || "").trim(),
      knowledge: String(cells.KNOWLEDGE || "").trim(),
      skills: String(cells.SKILLS || "").trim(),
      values: String(cells.VALUES || "").trim(),
    });
  }
  return out;
}

// Split a "4.1.1 Foo. 4.1.2 Bar. 4.1.3 Baz" string into discrete outcomes.
function splitNumberedOutcomes(s) {
  const str = String(s || "").trim();
  if (!str) return [];
  const parts = str.split(/(?=\b\d+\.\d+(?:\.\d+)?\s)/g)
      .map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [str];
}

// Split bullet-led lists (• Foo • Bar) into discrete items. Falls back to
// the whole string when there are no bullets.
function splitBulletList(s) {
  const str = String(s || "").trim();
  if (!str) return [];
  const parts = str.split(/[•●·•]\s*/g).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [str];
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
      const topicCol = detect2013TopicColumn(sheet);
      const parsed = rows2013WithPropagatedTopic(sheet?.rows || [], topicCol);
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
        for (const o of splitNumberedOutcomes(r.specificOutcomes)) {
          entry.specificOutcomes.push(o);
        }
        for (const k of splitBulletList(r.knowledge)) {
          entry.subtopics.push({
            name: k,
            specificCompetence: "",
            learningActivities: "",
            expectedStandard: "",
          });
        }
        for (const sk of splitBulletList(r.skills)) {
          entry.keyCompetencies.push(sk);
        }
        for (const v of splitBulletList(r.values)) {
          entry.values.push(v);
        }
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
            entry.specificOutcomes.push(r.specificCompetence);
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
