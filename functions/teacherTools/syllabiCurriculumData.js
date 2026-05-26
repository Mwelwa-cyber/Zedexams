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

function rowKey(studioSubject, sheetName, topic, subtopic) {
  return [studioSubject, sheetName, topic || "", subtopic || ""]
      .map((p) => String(p || "").trim().toLowerCase().replace(/\s+/g, "_"))
      .join("||");
}

let _dataCache = null;
let _dataCachePath = null;

function locateDataFile() {
  // Prefer the per-functions data copy; fall back to the public asset when
  // running tests from the repo root.
  const candidates = [
    path.join(__dirname, "..", "data", "curriculum-data.json"),
    path.join(__dirname, "..", "..", "public", "syllabi", "curriculum-data.json"),
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

function loadRawData() {
  if (_dataCache) return _dataCache;
  const p = locateDataFile();
  if (!p) {
    _dataCache = {};
    return _dataCache;
  }
  try {
    _dataCachePath = p;
    _dataCache = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    console.error("syllabiCurriculumData: read failed for", p, err);
    _dataCache = {};
  }
  return _dataCache;
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

/**
 * Returns the Studio rows as flat KB-topic entries. One entry per
 * grade+subject+topic, with enriched sub-topic objects underneath.
 */
async function getCurriculumDataTopics(version) {
  const raw = loadRawData();
  const overrides = version ? await loadOverrides(version) : [];
  const merged = applyOverridesToRaw(raw, overrides);
  const byKey = new Map();
  for (const [studioSubject, sheets] of Object.entries(merged || {})) {
    const subject = STUDIO_SUBJECT_TO_KB[studioSubject];
    if (!subject) continue;
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      const grade = sheetNameToGrade(sheetName);
      if (!grade) continue;
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
 * with admin overrides applied.
 */
async function getMergedStudioData(version) {
  const raw = loadRawData();
  const overrides = version ? await loadOverrides(version) : [];
  return applyOverridesToRaw(raw, overrides);
}

function invalidateCache() {
  _dataCache = null;
  _dataCachePath = null;
}

module.exports = {
  STUDIO_SUBJECT_TO_KB,
  sheetNameToGrade,
  rowKey,
  loadRawData,
  loadOverrides,
  applyOverridesToRaw,
  getCurriculumDataTopics,
  getMergedStudioData,
  invalidateCache,
  _dataCachePath: () => _dataCachePath,
};
