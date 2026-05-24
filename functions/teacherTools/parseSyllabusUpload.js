/**
 * parseSyllabusUpload — Storage onFinalize trigger.
 *
 * Watches Cloud Storage path
 *   syllabus-uploads/{version}/{filename}.xlsx
 * and parses each .xlsx into Firestore draft documents under
 *   cbcKnowledgeBase/{version}/draftTopics/*
 *   cbcKnowledgeBase/{version}/pacing/*
 *   cbcKnowledgeBase/{version}/uploadStatus/*
 *
 * Drafts are intentionally separate from the live `topics/*` subcollection
 * so a Phase A upload never disturbs the currently active KB. Phase C will
 * add an approve step that promotes drafts to `topics/*` and flips the
 * active-version pointer.
 *
 * Workbook conventions (Zambia CDC 2024/2026 syllabi):
 *  - Single-subject workbooks have one "Syllabus" sheet + a "Key Competences" sheet.
 *  - ECE workbooks have multiple "<Subject> - Syllabus" + "<Subject> - Competences" sheets.
 *  - Scheme-of-Work workbooks have a single "Scheme of Work" sheet with WEEK | TOPIC | ...
 *
 * Columns vary slightly: TOPIC ↔ CONCEPTS, SPECIFIC COMPETENCE ↔ SPECIFIC
 * COMPETENCES. HEADER_ALIASES maps them to one canonical key.
 */

const {onObjectFinalized} = require("firebase-functions/v2/storage");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");
const crypto = require("node:crypto");

const {normalizeGrade, normalizeSubject} = require("./cbcKnowledge");

const STORAGE_PREFIX = "syllabus-uploads/";

const SYLLABUS_SHEET_REGEX = /(?:^|\s-\s)syllabus$/i;
const COMPETENCES_SHEET_REGEX = /(?:^|\s-\s)(?:key\s+)?competen[cs]es?$/i;
const SOW_SHEET_REGEX = /^scheme\s+of\s+work$/i;
const COVER_SHEET_REGEX = /^cover$/i;

const HEADER_ALIASES = {
  topic: ["topic", "topics", "concept", "concepts"],
  subtopic: ["sub-topic", "sub-topics", "subtopic", "subtopics"],
  competence: ["specific competence", "specific competences"],
  activities: ["learning activities", "learning activity"],
  standard: ["expected standard", "expected standards"],
  week: ["week"],
  methods: ["methods", "method"],
  aids: ["t/l aids", "teaching/learning aids", "teaching aids"],
  ref: ["ref", "reference", "references"],
};

// Maps the free-text subject phrase on a workbook filename to the canonical
// subject key used by the existing CBC system. Anything not matched falls back
// to a lowercase/underscore slug.
const SUBJECT_NORMALISE = {
  "mathematics": "mathematics",
  "maths": "mathematics",
  "english": "english",
  "english language": "english",
  "biology": "biology",
  "chemistry": "chemistry",
  "physics": "physics",
  "geography": "geography",
  "history": "history",
  "ict": "ict",
  "social studies": "social_studies",
  "science": "integrated_science",
  "integrated science": "integrated_science",
  "civic education": "civic_education",
  "religious education": "religious_education",
  "art and design": "art_and_design",
  "music": "music",
  "physical education": "physical_education",
  "food and nutrition": "food_and_nutrition",
  "home economics": "home_economics",
  "home economics and hospitality": "home_economics",
  "expressive arts": "expressive_arts",
  "technology studies": "technology_studies",
  "creative and technology studies": "creative_and_technology_studies",
  "creative": "creative_and_technology_studies",
  "creative arts": "creative_and_technology_studies",
  "commerce": "commerce",
  "principles of accounts": "principles_of_accounts",
  "literature in english": "literature_in_english",
  "literature": "literature_in_english",
  "zambian languages": "zambian_language",
  "zambian language": "zambian_language",
  "zambian lang": "zambian_language",
  "maths-sci": "maths_science",
  "maths sci": "maths_science",
};

// --- Entry point --------------------------------------------------------

exports.parseSyllabusUpload = onObjectFinalized(
  {
    // Storage triggers MUST live in the same region as the bucket they
    // watch. The project's default bucket is in africa-south1 (matches
    // the country we serve); the other Cloud Functions are us-central1
    // because they're HTTP/callable and have no colocation requirement.
    region: "africa-south1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (event) => {
    const filePath = event.data?.name || "";
    const bucketName = event.data?.bucket;
    if (!filePath || !bucketName) return;
    if (!filePath.startsWith(STORAGE_PREFIX)) return;
    if (!filePath.toLowerCase().endsWith(".xlsx")) return;

    const segments = filePath.split("/");
    // syllabus-uploads/{version}/{filename}.xlsx
    if (segments.length < 3) {
      console.warn("[parseSyllabusUpload] path missing version segment", filePath);
      return;
    }
    const version = segments[1];
    const filename = segments.slice(2).join("/");
    if (!version || !filename) return;

    const log = (msg, extra) =>
      console.log("[parseSyllabusUpload]", filename, msg, extra || "");

    log("start", {version, bucket: bucketName, size: event.data.size});

    try {
      await writeUploadStatus(version, filename, {status: "parsing"});

      const buffer = await downloadFile(bucketName, filePath);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);

      const filenameHints = parseFilenameHints(filename);
      const result = parseWorkbook(wb, {filename, version, filenameHints});

      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      await writeResultsToFirestore(result, {
        version, filename, filePath, filenameHints, sha256,
      });
      log("done", {
        topics: result.topicDocs.length,
        pacingEntries: result.pacingEntries.length,
        sheetsProcessed: result.sheetsProcessed,
        warnings: result.warnings.length,
      });
    } catch (err) {
      const message = err?.message || String(err);
      console.error("[parseSyllabusUpload]", filename, "FAILED", message);
      // Best-effort status write — failing here must not mask the original
      // throw a few lines down. .catch returns the rejection swallow value.
      await writeUploadStatus(version, filename, {
        status: "error",
        error: message.slice(0, 1000),
      }).catch(() => null);
      throw err;
    }
  },
);

// --- Storage download ---------------------------------------------------

async function downloadFile(bucketName, filePath) {
  const file = admin.storage().bucket(bucketName).file(filePath);
  const [contents] = await file.download();
  return contents;
}

// --- Filename hints -----------------------------------------------------

function parseFilenameHints(filename) {
  const base = filename.replace(/\.xlsx$/i, "").trim();
  const hints = {
    grade: null,
    subject: null,
    subjectDisplay: null,
    isScheme: /scheme\s+of\s+work/i.test(base),
  };

  let m;
  if (/\bECE\b/i.test(base) || /\bLevel\s*\d/i.test(base)) {
    hints.grade = "ECE";
  } else if ((m = base.match(/Grade\s*(\d{1,2})/i))) {
    hints.grade = `G${m[1]}`;
  } else if ((m = base.match(/Form\s*(\d{1,2})/i))) {
    hints.grade = `F${m[1]}`;
  } else if ((m = base.match(/\bG(\d{1,2})\b/i))) {
    hints.grade = `G${m[1]}`;
  }

  let subject = base;
  subject = subject.replace(/(?:Grade|Form)\s*\d{1,2}/gi, "");
  subject = subject.replace(/ECE\s*Level\s*\d(?:\s*-\s*\d)?/gi, "");
  subject = subject.replace(/\bECE\b/gi, "");
  subject = subject.replace(/\bG\d{1,2}\b/gi, ""); // standalone "G4" grade marker
  subject = subject.replace(/\bF\d{1,2}\b/gi, ""); // standalone "F1" form marker
  subject = subject.replace(/\bSyllabus\b/gi, "");
  subject = subject.replace(/\bScheme\s+of\s+Work\b/gi, "");
  subject = subject.replace(/\bExample\b/gi, "");
  subject = subject.replace(/20\d{2}/g, "");
  subject = subject.replace(/\s+/g, " ").trim();
  if (subject) {
    hints.subjectDisplay = subject;
    hints.subject = normaliseSubjectKey(subject);
  }
  return hints;
}

function normaliseSubjectKey(raw) {
  const key = String(raw || "").toLowerCase().trim();
  if (SUBJECT_NORMALISE[key]) return SUBJECT_NORMALISE[key];
  return key.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// --- Sheet scope helpers ------------------------------------------------

// "Key Competences"           -> ""
// "English - Competences"     -> "English"
function competenceScope(sheetName) {
  const m = sheetName.match(/^(.*?)\s*-\s*(?:key\s+)?competen[cs]es?$/i);
  return m ? m[1].trim() : "";
}
// "Syllabus"             -> ""
// "English - Syllabus"   -> "English"
function subjectScope(sheetName) {
  const m = sheetName.match(/^(.*?)\s*-\s*syllabus$/i);
  return m ? m[1].trim() : "";
}

// --- Cell helpers -------------------------------------------------------

function cellString(cell) {
  if (!cell) return "";
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text.trim();
    if (Array.isArray(v.richText)) {
      return v.richText.map((r) => r.text || "").join("").trim();
    }
    if (v.result !== undefined && v.result !== null) {
      return String(v.result).trim();
    }
    if (v.hyperlink && typeof v.hyperlink === "object" && v.hyperlink.text) {
      return String(v.hyperlink.text).trim();
    }
  }
  return String(v).trim();
}

function detectHeaderRow(sheet, mustContainAny) {
  const limit = Math.min(sheet.actualRowCount || sheet.rowCount || 0, 20);
  for (let r = 1; r <= limit; r++) {
    const row = sheet.getRow(r);
    const cells = [];
    row.eachCell({includeEmpty: false}, (c) => {
      cells.push(cellString(c).toLowerCase());
    });
    if (mustContainAny.some((token) => cells.some((cs) => cs.includes(token)))) {
      return r;
    }
  }
  return null;
}

function headerMap(sheet, rowNumber) {
  const headers = [];
  const row = sheet.getRow(rowNumber);
  row.eachCell({includeEmpty: true}, (cell, colNumber) => {
    headers[colNumber - 1] = cellString(cell).toLowerCase();
  });
  return headers;
}

function findColumn(headers, key) {
  const aliases = HEADER_ALIASES[key] || [key];
  for (let i = 0; i < headers.length; i++) {
    if (aliases.includes(headers[i])) return i + 1;
  }
  return -1;
}

function splitBulleted(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/^[•·\-*+•·]\s*/, "").trim())
    .filter(Boolean);
}

// --- Parsing ------------------------------------------------------------

function parseWorkbook(wb, ctx) {
  const result = {
    topicDocs: [],
    pacingEntries: [],
    sheetsProcessed: 0,
    warnings: [],
  };

  // Pass 1: competences per subject scope.
  const competencesByScope = new Map();
  for (const sheet of wb.worksheets) {
    const name = String(sheet.name || "").trim();
    if (COVER_SHEET_REGEX.test(name)) continue;
    if (!COMPETENCES_SHEET_REGEX.test(name)) continue;
    const scope = competenceScope(name);
    competencesByScope.set(scope, parseCompetences(sheet));
    result.sheetsProcessed += 1;
  }

  // Pass 2: syllabus + scheme-of-work sheets.
  for (const sheet of wb.worksheets) {
    const name = String(sheet.name || "").trim();
    if (COVER_SHEET_REGEX.test(name)) continue;
    if (COMPETENCES_SHEET_REGEX.test(name)) continue;

    if (SOW_SHEET_REGEX.test(name)) {
      const rows = parseSchemeOfWork(sheet);
      result.pacingEntries.push({
        subject: ctx.filenameHints.subject || "unknown",
        subjectDisplay: ctx.filenameHints.subjectDisplay || "",
        grade: ctx.filenameHints.grade || "unknown",
        rows,
      });
      result.sheetsProcessed += 1;
      continue;
    }

    if (SYLLABUS_SHEET_REGEX.test(name)) {
      const scope = subjectScope(name);
      const subjectDisplay = scope || ctx.filenameHints.subjectDisplay || "";
      const subjectKey = scope ?
        normaliseSubjectKey(scope) :
        ctx.filenameHints.subject;
      const grade = ctx.filenameHints.grade;
      if (!subjectKey || !grade) {
        result.warnings.push(
          `Sheet "${name}": could not resolve subject/grade ` +
          `(subject=${subjectKey}, grade=${grade})`,
        );
        continue;
      }
      const competencies =
        competencesByScope.get(scope) ||
        competencesByScope.get("") ||
        [];
      const docs = parseSyllabusSheet(sheet, {
        subjectKey, subjectDisplay, grade, competencies,
        sourceWorkbook: ctx.filename,
        sourceSheet: name,
      });
      result.topicDocs.push(...docs);
      result.sheetsProcessed += 1;
    }
  }

  return result;
}

function parseCompetences(sheet) {
  const headerRow = detectHeaderRow(sheet, ["competence"]);
  if (!headerRow) return [];
  const headers = headerMap(sheet, headerRow);
  const competenceCol = -1 +
    Math.max(
      ...["competence", "competences"].map((label) => {
        const i = headers.indexOf(label);
        return i < 0 ? -1 : i + 1;
      }),
    );
  if (competenceCol < 0) return [];
  const lastRow = sheet.actualRowCount || sheet.rowCount || headerRow;
  const out = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const name = cellString(sheet.getRow(r).getCell(competenceCol + 1));
    if (name) out.push(name);
  }
  return out;
}

function parseSyllabusSheet(sheet, ctx) {
  const headerRow = detectHeaderRow(sheet, ["topic", "concept"]);
  if (!headerRow) return [];

  const headers = headerMap(sheet, headerRow);
  const cTopic = findColumn(headers, "topic");
  const cSub = findColumn(headers, "subtopic");
  const cComp = findColumn(headers, "competence");
  const cActs = findColumn(headers, "activities");
  const cStd = findColumn(headers, "standard");
  if (cTopic < 0) return [];

  const lastRow = sheet.actualRowCount || sheet.rowCount || headerRow;
  const docsById = new Map();
  let lastTopic = "";

  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    let topic = cellString(row.getCell(cTopic));
    const subtopic = cSub > 0 ? cellString(row.getCell(cSub)) : "";
    const competence = cComp > 0 ? cellString(row.getCell(cComp)) : "";
    const activities = cActs > 0 ? cellString(row.getCell(cActs)) : "";
    const standard = cStd > 0 ? cellString(row.getCell(cStd)) : "";

    if (!topic && !subtopic && !competence && !activities && !standard) continue;

    // Skip banner / section-header rows that put a grade-level label in the
    // Topic column (e.g. "Grade 4 – Primary School", "Form 1", "ECE Level 2").
    // We were previously capturing those as real topic docs, which then
    // surfaced in the Lesson Plan Studio's topic dropdown. Treat them like
    // an empty row — don't update lastTopic either, so the next content row
    // doesn't inherit the banner.
    if (topic && looksLikeGradeBanner(topic)) continue;

    if (!topic && lastTopic) topic = lastTopic;
    if (topic) lastTopic = topic;
    if (!topic) continue;

    const id = buildTopicId(ctx.grade, ctx.subjectKey, topic);
    if (!id) continue;

    let doc = docsById.get(id);
    if (!doc) {
      doc = {
        id,
        grade: String(ctx.grade).toUpperCase(),
        subject: ctx.subjectKey,
        subjectDisplay: ctx.subjectDisplay || "",
        term: 1,
        topic,
        subtopics: [],
        keyCompetencies: ctx.competencies.slice(),
        values: [],
        sourceWorkbook: ctx.sourceWorkbook,
        sourceSheet: ctx.sourceSheet,
        sourceRow: r,
      };
      docsById.set(id, doc);
    }

    doc.subtopics.push({
      name: subtopic || competence || "(unnamed sub-topic)",
      specificCompetence: competence,
      learningActivities: splitBulleted(activities),
      expectedStandard: standard,
      sourceRow: r,
    });
  }

  return Array.from(docsById.values());
}

function parseSchemeOfWork(sheet) {
  const headerRow = detectHeaderRow(sheet, ["week"]);
  if (!headerRow) return [];
  const headers = headerMap(sheet, headerRow);
  const cWeek = findColumn(headers, "week");
  const cTopic = findColumn(headers, "topic");
  const cSub = findColumn(headers, "subtopic");
  const cComp = findColumn(headers, "competence");
  const cActs = findColumn(headers, "activities");
  const cStd = findColumn(headers, "standard");
  const cMethods = findColumn(headers, "methods");
  const cAids = findColumn(headers, "aids");
  const cRef = findColumn(headers, "ref");

  const lastRow = sheet.actualRowCount || sheet.rowCount || headerRow;
  const out = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const weekRaw = cellString(row.getCell(cWeek));
    if (!weekRaw) continue;
    const topic = cTopic > 0 ? cellString(row.getCell(cTopic)) : "";
    const subtopic = cSub > 0 ? cellString(row.getCell(cSub)) : "";
    // Empty template weeks (just a number, no content) are recorded as a
    // scaffold so the admin UI can show "Week 1: not yet filled" cleanly.
    out.push({
      week: Number(weekRaw) || weekRaw,
      topic,
      subtopic,
      specificCompetence: cComp > 0 ? cellString(row.getCell(cComp)) : "",
      learningActivities: cActs > 0 ?
        splitBulleted(cellString(row.getCell(cActs))) : [],
      expectedStandard: cStd > 0 ? cellString(row.getCell(cStd)) : "",
      methods: cMethods > 0 ? cellString(row.getCell(cMethods)) : "",
      aids: cAids > 0 ? cellString(row.getCell(cAids)) : "",
      ref: cRef > 0 ? cellString(row.getCell(cRef)) : "",
    });
  }
  return out;
}

// --- IDs + slugs --------------------------------------------------------

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function buildTopicId(grade, subject, topic) {
  const g = slug(grade);
  const s = slug(subject);
  const t = slug(topic);
  if (!g || !s || !t) return null;
  return `${g}-${s}-${t}`;
}

// Returns true when a Topic-column cell holds a grade/level banner rather
// than a real topic name. Zambian syllabus workbooks commonly have a single
// row like "Grade 4 – Primary School" or "Form 1" sitting between the
// header row and the first real topic — we don't want those landing in the
// dropdowns. Patterns are intentionally narrow so a legitimate topic that
// happens to mention a grade ("Money in Grade 5 contexts") isn't filtered.
function looksLikeGradeBanner(topic) {
  const t = String(topic || "").trim();
  if (!t) return false;
  // "Grade 4", "Grade 4 – Primary School", "Grade 4 Primary"
  if (/^grade\s*\d{1,2}\b/i.test(t)) return true;
  // "Form 1", "Form 1 – Junior Secondary"
  if (/^form\s*\d{1,2}\b/i.test(t)) return true;
  // "ECE", "ECE Level 1", "ECE Level 1-2"
  if (/^ece(\s|$)/i.test(t)) return true;
  if (/^level\s*\d/i.test(t)) return true;
  // Bare level labels
  if (/^(primary|secondary|junior\s+secondary|senior\s+secondary|lower\s+primary|upper\s+primary)(\s+school)?$/i.test(t)) return true;
  // Sheet-name leakage
  if (/^syllabus$/i.test(t)) return true;
  return false;
}

// --- approvedSyllabi linking ------------------------------------------
//
// The strict learner-AI resolver
// (functions/agents/learnerAi/curriculumResolver.js) refuses every task
// whose matched KB module has no `sourceDocId` field pointing at an
// `approvedSyllabi` doc. Previously the only way to populate either was
// via `scripts/seed-approved-syllabi.mjs` + `scripts/backfill-kb-source-refs.mjs`
// run from a workstation, so admins who uploaded a syllabus through the
// UI saw every agent sit idle on `no_source_doc_ref`. Building the link
// at parse time closes that gap — one upload → one approvedSyllabi doc
// → every parsed draft tagged with the right sourceDocId.

/**
 * Deterministic id for an approvedSyllabi doc derived from a single
 * uploaded workbook. Mirrors the slug style used by
 * scripts/seed-approved-syllabi.mjs so re-runs over the same source
 * file collide (and merge) instead of duplicating.
 *
 * @param {object} hints Filename hints — { grade, subject, term, ... }.
 * @param {string} filename Original .xlsx basename (for the title suffix).
 * @returns {string|null} slug id, or null when grade/subject can't be parsed.
 */
function buildApprovedSyllabusId(hints, filename) {
  if (!hints || !hints.grade || !hints.subject) return null;
  const grade = normalizeGrade(hints.grade).toLowerCase() || slug(hints.grade);
  const subject = normalizeSubject(hints.subject) || slug(hints.subject);
  const term = hints.term != null ? String(hints.term) : "all";
  const title = String(filename || "").replace(/\.[^.]+$/, "");
  return slug(`${grade}-${subject}-${term}-${title}`);
}

/**
 * Pure builder for the approvedSyllabi/{id} record. Whatever value
 * shows up under `grade` and `subject` here is what the resolver
 * compares against `task.grade` and `task.subject`, normalized on both
 * sides — storing the canonical KB shape ("G4", "integrated_science")
 * makes that comparison stable regardless of which client wrote the
 * task.
 *
 * @param {object} ctx Writer context — { filePath, filename, sha256, version }.
 * @param {object} hints Filename hints — { grade, subject, term, subjectDisplay }.
 * @param {Function} ts Server-timestamp sentinel factory. Injected so the
 *   pure helper stays unit-testable.
 * @returns {object|null} record, or null when the link can't be built.
 */
function buildApprovedSyllabusRecord({ctx, hints, ts}) {
  if (!ctx || !hints || !hints.grade || !hints.subject) return null;
  return {
    schemaVersion: 1,
    title: String(ctx.filename || "").replace(/\.[^.]+$/, ""),
    grade: normalizeGrade(hints.grade),
    subject: normalizeSubject(hints.subject),
    subjectDisplay: hints.subjectDisplay || "",
    term: hints.term != null ? Number(hints.term) : null,
    storagePath: ctx.filePath || "",
    sha256: ctx.sha256 || "",
    uploadedAt: ts(),
    approvedAt: ts(),
    approvedBy: "syllabus-upload-parser",
    kbVersion: ctx.version,
    coverage: {topics: [], subtopics: []},
  };
}

/**
 * Project the parser's topic shape into the alias fields the strict
 * resolver's `pickExcerpts` reads (contentSummary / outcomes /
 * competencies / assessmentCriteria / learnerActivities). The parser
 * captures these under richer per-subtopic structures (`subtopics[]`
 * with specificCompetence + learningActivities + expectedStandard, plus
 * top-level `keyCompetencies`); without aliasing them the resolver's
 * topic-only fallback returned zero cited excerpts and refused with
 * `no_cited_excerpts`. Returns only the fields that have content so we
 * don't overwrite richer KB data on idempotent re-runs (merge:true).
 *
 * @param {object} draft One parsed draftTopic doc.
 * @returns {object} Field aliases to merge onto the draft.
 */
function deriveExcerptAliases(draft) {
  const out = {};
  const subs = Array.isArray(draft.subtopics) ? draft.subtopics : [];

  const competencies = [];
  if (Array.isArray(draft.keyCompetencies)) {
    for (const c of draft.keyCompetencies) {
      if (typeof c === "string" && c.trim()) competencies.push(c.trim());
    }
  }
  for (const s of subs) {
    const sc = s && typeof s === "object" ? s.specificCompetence : null;
    if (typeof sc === "string" && sc.trim()) competencies.push(sc.trim());
  }
  if (competencies.length) out.competencies = competencies;

  const outcomes = [];
  for (const s of subs) {
    const es = s && typeof s === "object" ? s.expectedStandard : null;
    if (typeof es === "string" && es.trim()) outcomes.push(es.trim());
  }
  if (outcomes.length) {
    out.outcomes = outcomes;
    // Same source field doubles as assessment criteria — the CDC
    // workbooks use "Expected Standard" as a learner-facing acceptance
    // criterion, so it carries grading signal for the quality gate too.
    out.assessmentCriteria = outcomes.slice();
  }

  const activities = [];
  for (const s of subs) {
    const a = s && typeof s === "object" ? s.learningActivities : null;
    if (Array.isArray(a)) {
      for (const item of a) {
        if (typeof item === "string" && item.trim()) {
          activities.push(item.trim());
        }
      }
    }
  }
  if (activities.length) out.learnerActivities = activities;

  const summaryItems = [];
  for (const s of subs) {
    const name = s && typeof s === "object" ? s.name : (typeof s === "string" ? s : "");
    if (typeof name === "string" && name.trim() && name.trim() !== "(unnamed sub-topic)") {
      summaryItems.push(name.trim());
    }
  }
  if (summaryItems.length) {
    out.contentSummary = `Sub-topics covered: ${summaryItems.join("; ")}.`;
  }

  return out;
}

// --- Firestore writes ---------------------------------------------------

async function writeResultsToFirestore(result, ctx) {
  const db = admin.firestore();
  const ts = () => admin.firestore.FieldValue.serverTimestamp();
  const now = ts();
  const BATCH_LIMIT = 450; // leave headroom under the 500-op cap

  let batch = db.batch();
  let inBatch = 0;
  const flush = async () => {
    if (inBatch > 0) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  };

  // Upsert the approvedSyllabi doc first. The draftTopics below carry
  // its id forward as `sourceDocId`, which the strict resolver requires
  // before any learner-AI generator can run. Skipped only when
  // filename hints couldn't yield a grade+subject — in that case the
  // parser also produced no topicDocs, so no draft is left dangling.
  const syllabusId =
    buildApprovedSyllabusId(ctx.filenameHints || {}, ctx.filename);
  const syllabusRecord = buildApprovedSyllabusRecord({
    ctx, hints: ctx.filenameHints || {}, ts,
  });
  if (syllabusId && syllabusRecord) {
    batch.set(
        db.collection("approvedSyllabi").doc(syllabusId),
        syllabusRecord,
        {merge: true},
    );
    inBatch += 1;
  }

  for (const doc of result.topicDocs) {
    const ref = db
      .collection("cbcKnowledgeBase")
      .doc(ctx.version)
      .collection("draftTopics")
      .doc(doc.id);
    const aliases = deriveExcerptAliases(doc);
    const sourceFields = syllabusId ? {
      sourceDocId: syllabusId,
      sourceStoragePath: ctx.filePath || "",
    } : {};
    batch.set(ref, {
      ...doc,
      ...aliases,
      ...sourceFields,
      updatedAt: now,
      importedAt: now,
    }, {merge: true});
    inBatch += 1;
    if (inBatch >= BATCH_LIMIT) await flush();
  }

  for (const entry of result.pacingEntries) {
    const g = slug(entry.grade);
    const s = slug(entry.subject);
    if (!g || !s) continue;
    const ref = db
      .collection("cbcKnowledgeBase")
      .doc(ctx.version)
      .collection("pacing")
      .doc(`${s}_${g}`);
    batch.set(ref, {
      subject: entry.subject,
      subjectDisplay: entry.subjectDisplay || "",
      grade: entry.grade,
      weeks: entry.rows,
      sourceWorkbook: ctx.filename,
      updatedAt: now,
      importedAt: now,
    }, {merge: true});
    inBatch += 1;
    if (inBatch >= BATCH_LIMIT) await flush();
  }

  const statusRef = db
    .collection("cbcKnowledgeBase")
    .doc(ctx.version)
    .collection("uploadStatus")
    .doc(slug(ctx.filename));
  batch.set(statusRef, {
    filename: ctx.filename,
    status: "parsed",
    topicCount: result.topicDocs.length,
    pacingEntryCount: result.pacingEntries.length,
    sheetsProcessed: result.sheetsProcessed,
    warnings: result.warnings.slice(0, 50),
    parsedAt: now,
    updatedAt: now,
  }, {merge: true});
  inBatch += 1;

  await flush();
}

async function writeUploadStatus(version, filename, patch) {
  const db = admin.firestore();
  const ref = db
    .collection("cbcKnowledgeBase")
    .doc(version)
    .collection("uploadStatus")
    .doc(slug(filename));
  await ref.set({
    filename,
    ...patch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
}

// Exposed for unit testing.
exports.__test__ = {
  parseFilenameHints,
  normaliseSubjectKey,
  competenceScope,
  subjectScope,
  buildTopicId,
  splitBulleted,
  parseWorkbook,
  buildApprovedSyllabusId,
  buildApprovedSyllabusRecord,
  deriveExcerptAliases,
};
