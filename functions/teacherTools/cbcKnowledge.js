/**
 * CBC Knowledge Base — lookup, suggest, and context-rendering logic.
 *
 * Two sources of topic data:
 *   1. Firestore — `cbcKnowledgeBase/{KB_VERSION}/topics/*` — admin-editable.
 *   2. In-code — `cbcTopics.js` — hand-curated seed (G1-9). Acts as fallback
 *      when a topic isn't in Firestore yet.
 *
 * We merge both on every generation call. Firestore entries win on
 * grade+subject+topic collision. In-process cache holds the merged set for
 * 60 seconds to keep Firestore costs negligible.
 */

const admin = require("firebase-admin");
const {TOPICS: SEED_TOPICS} = require("./cbcTopics");
const {
  invalidatePrivateCurriculumCache,
  resolvePrivateCurriculumContext,
} = require("./privateCurriculum");
const {buildModuleId} = require("./curriculumModuleSchema");
const {getLearningEnvironment} = require("./learningEnvironments");
const {
  getCurriculumDataTopics,
  invalidateCache: invalidateSyllabiCache,
  normalizeFramework,
  DEFAULT_FRAMEWORK,
  VALID_FRAMEWORKS,
} = require("./syllabiCurriculumData");
const {gradeCandidates, subjectCandidates} = require("./kbLookupCandidates");

// Default ("seed") KB version. Used as the fallback active version when
// cbcKnowledgeBase/_meta doesn't exist yet — i.e. before the first Phase-C
// approve-and-activate flow ever runs. After Phase B ships, callers should
// prefer getActiveKbVersion() instead of this constant for any path that
// has to follow a runtime version switch.
const KB_VERSION = "cbc-kb-2026-04-seed";
const KB_DEFAULT_VERSION = KB_VERSION;

// ── 2023 CBC framework structure ─────────────────────────────────────────
// The Zambian 2023 curriculum framework groups grades into bands. The 2013
// framework used a different split (Lower Primary G1-4, Middle Primary G5-7).
// We expose both pieces of metadata so the AI prompt can name the band the
// teacher is teaching, and so we can flag subjects that aren't part of a
// given grade's syllabus (e.g. RE/Creative Arts at G4 in the 2023 framework).
const CBC_2023_BANDS = Object.freeze({
  ECE: "Lower Primary (Pre-Primary)",
  ECE_N: "Lower Primary (Pre-Primary)", // Nursery (3-4)
  ECE_R: "Lower Primary (Pre-Primary)", // Reception (4-5)
  G1: "Lower Primary",
  G2: "Lower Primary",
  G3: "Lower Primary",
  G4: "Upper Primary",
  G5: "Upper Primary",
  G6: "Upper Primary",
  G7: "Upper Primary",
  G8: "Junior Secondary",
  G9: "Junior Secondary",
  G10: "Senior Secondary",
  G11: "Senior Secondary",
  G12: "Senior Secondary",
});

// Canonical subject keys (matching normalizeSubject output) for each grade
// under the 2023 framework. Only grades the project owner has explicitly
// confirmed are listed — generators only enforce the "not in this grade's
// syllabus" warning for grades present here, so the system never invents
// rules for grades that haven't been verified.
const CBC_2023_GRADE_SUBJECTS = Object.freeze({
  // Early Childhood Education — the 2023 ECE syllabus defines exactly four
  // learning areas (the four sheets in curriculum-data.json). Nursery and
  // Reception share the same set. Keys are normalizeSubject() output and
  // match the codes the ECE teacher studios pass (see ECE_SUBJECTS in
  // src/config/teacherTaxonomy.js).
  ECE_N: Object.freeze([
    "english",
    "zambian_language",
    "numeracy",
    "expressive_arts",
  ]),
  ECE_R: Object.freeze([
    "english",
    "zambian_language",
    "numeracy",
    "expressive_arts",
  ]),
  G4: Object.freeze([
    "english",
    "mathematics",
    "integrated_science",
    "social_studies",
    "technology_studies",
    "home_economics",
    "expressive_arts",
  ]),
});

function getGradeBand(grade) {
  const g = normalizeGrade(grade);
  return CBC_2023_BANDS[g] || null;
}

function getOfficialSubjectsForGrade(grade) {
  const g = normalizeGrade(grade);
  return CBC_2023_GRADE_SUBJECTS[g] || null;
}

/**
 * Classify a (grade, subject) pair against the 2023 framework. Returns:
 *   'in_syllabus'  — subject IS part of this grade's syllabus
 *   'not_in_grade' — subject is NOT part of this grade's syllabus
 *   'unknown'      — we don't have an authoritative list for this grade
 *
 * `unknown` is the safe default for any grade we haven't verified yet, so
 * adding a new grade to CBC_2023_GRADE_SUBJECTS opts it into validation
 * without retroactively breaking anything.
 */
function classifySubjectForGrade(grade, subject) {
  const official = getOfficialSubjectsForGrade(grade);
  if (!official) return "unknown";
  const subjectNorm = normalizeSubject(subject);
  if (!subjectNorm) return "unknown";
  return official.includes(subjectNorm) ? "in_syllabus" : "not_in_grade";
}

// Module-level cache to avoid hitting Firestore on every generation.
// One slot per framework so 2013 and 2023 lookups don't trample each other.
const _cacheByFramework = new Map();
const CACHE_TTL_MS = 60_000;

// ── Active KB pointer ────────────────────────────────────────────────────
// `cbcKnowledgeBase/_meta` is a runtime-switchable doc:
//   { version, usePrivateCurriculum, cacheBust, updatedAt }
// Missing doc / read failure ⇒ fall back to the seed default with RAG ON,
// which matches pre-Phase-B behaviour byte-for-byte. Cached for
// ACTIVE_STATE_TTL_MS so admin rollback (Phase D) propagates within seconds
// across warm containers instead of waiting on the topic cache's 60s TTL.

const ACTIVE_KB_DOC_PATH = "cbcKnowledgeBase/_meta";
const ACTIVE_STATE_TTL_MS = 10_000;
const ACTIVE_DEFAULT = Object.freeze({
  version: KB_DEFAULT_VERSION,
  usePrivateCurriculum: true,
  cacheBust: 0,
});

let _activeStateCache = null;
let _activeStateAt = 0;
// null on cold start so the first-ever read does NOT spuriously
// invalidate the empty topic cache. After the first successful read it
// tracks the last-observed cacheBust counter.
let _lastSeenCacheBust = null;

/**
 * Read the runtime KB pointer. Falls back to the seed default + RAG ON when
 * the doc is missing or unreadable, so the system keeps working before
 * Phase C ever writes _meta. The cacheBust field lets the Phase D rollback
 * invalidate every warm container's caches within ACTIVE_STATE_TTL_MS.
 */
async function getActiveKbState() {
  const now = Date.now();
  if (_activeStateCache && (now - _activeStateAt) < ACTIVE_STATE_TTL_MS) {
    return _activeStateCache;
  }
  try {
    const db = admin.firestore();
    const snap = await db.doc(ACTIVE_KB_DOC_PATH).get();
    let next;
    if (!snap.exists) {
      next = ACTIVE_DEFAULT;
    } else {
      const data = snap.data() || {};
      next = {
        version: (typeof data.version === "string" && data.version) ?
          data.version : KB_DEFAULT_VERSION,
        // Default ON — explicit false from admin disables the RAG path.
        usePrivateCurriculum: data.usePrivateCurriculum !== false,
        cacheBust: Number(data.cacheBust) || 0,
      };
    }
    // Cross-container cache invalidation: when cacheBust ticks up since
    // we last observed it, treat the topic-set + RAG caches as stale.
    if (_lastSeenCacheBust !== null && next.cacheBust !== _lastSeenCacheBust) {
      _cacheByFramework.clear();
      try {
        invalidatePrivateCurriculumCache();
      } catch {
        // Best effort only.
      }
    }
    _lastSeenCacheBust = next.cacheBust;
    _activeStateCache = next;
    _activeStateAt = now;
    return next;
  } catch (err) {
    console.error("getActiveKbState failed", err);
    _activeStateCache = ACTIVE_DEFAULT;
    _activeStateAt = now;
    return ACTIVE_DEFAULT;
  }
}

/** Convenience: just the active version string. */
async function getActiveKbVersion() {
  return (await getActiveKbState()).version;
}

/**
 * Fetch topics from Firestore for the active KB version. Returns [] if the
 * collection doesn't exist yet or the request fails — the in-code fallback
 * still works.
 */
async function fetchFirestoreTopics() {
  try {
    const db = admin.firestore();
    const version = await getActiveKbVersion();
    const snap = await db
      .collection("cbcKnowledgeBase")
      .doc(version)
      .collection("topics")
      .get();
    return snap.docs.map((d) => ({id: d.id, ...d.data()}));
  } catch (err) {
    console.error("fetchFirestoreTopics failed", err);
    return [];
  }
}

/**
 * Return the merged topic list. Three layers, lowest priority first:
 *   1. Syllabi Studio curriculum-data.json — every CDC syllabus the admin
 *      page surfaces. Acts as a wide base coverage layer so generators
 *      always see the full national curriculum, not just the seed.
 *   2. In-code seed (cbcTopics.js) — the curated G1-9 entries with the
 *      Specific Outcomes / Key Competencies / Values fields generators
 *      have historically grounded on. Overrides the syllabi base.
 *   3. Firestore overlay — admin edits via the CBC KB admin page. Wins
 *      over everything so a hand-edit always takes effect.
 */
async function getAllTopics(opts = {}) {
  const framework = normalizeFramework(opts.framework);
  const now = Date.now();
  const cached = _cacheByFramework.get(framework);
  if (cached && (now - cached.at) < CACHE_TTL_MS) return cached.value;

  const version = await getActiveKbVersion();
  const [fromSyllabi, fromFirestore] = await Promise.all([
    getCurriculumDataTopics(version, {framework}).catch((err) => {
      console.error("getCurriculumDataTopics failed", err);
      return [];
    }),
    fetchFirestoreTopics(),
  ]);
  const byKey = new Map();
  // Base — syllabi-data rows (broadest coverage, thinnest grounding).
  // Already filtered by framework upstream.
  for (const t of fromSyllabi) {
    byKey.set(topicKey(t), {...t, _source: "syllabi_studio"});
  }
  // Seed — curated outcomes/competencies. The seed is a mixed bag (its
  // header comment says "Based on the 2013 Zambia Education" but it has
  // been edited over years and contains entries valid for both eras).
  // Until each entry is individually audited and tagged, we keep the seed
  // available to BOTH frameworks so callers that depend on its grounding
  // (e.g. the Cala matcher) don't regress when the 2023 path is taken.
  for (const t of SEED_TOPICS) {
    byKey.set(topicKey(t), {...t, _source: "seed"});
  }
  // Firestore — admin edits win. Stamp the requested framework so callers
  // that filter on `t.framework` still see them.
  for (const t of fromFirestore) {
    byKey.set(topicKey(t), {
      ...t,
      framework: t.framework || framework,
      _source: "firestore",
    });
  }
  const value = Array.from(byKey.values());
  _cacheByFramework.set(framework, {at: now, value});
  return value;
}

function topicKey(t) {
  const grade = String(t.grade || "").toUpperCase();
  const subject = String(t.subject || "").toLowerCase();
  const topic = String(t.topic || "").toLowerCase().trim();
  return `${grade}|${subject}|${topic}`;
}

/**
 * Subtopic compatibility helper.
 *
 * Legacy topic docs store subtopics as plain strings. The Phase-A syllabus
 * parser writes them as `{name, specificCompetence, learningActivities,
 * expectedStandard}` objects to preserve the richer per-subtopic detail in
 * the new CDC workbooks. This helper hides that shape difference from the
 * lookup and rendering paths so both formats coexist during the migration.
 */
function subtopicName(s) {
  if (s == null) return "";
  if (typeof s === "string") return s;
  if (typeof s === "object" && typeof s.name === "string") return s.name;
  return String(s);
}

/** Force the next getAllTopics() call to bypass the cache. Used after writes. */
function invalidateKbCache() {
  _cacheByFramework.clear();
  _activeStateCache = null;
  _activeStateAt = 0;
  _lastSeenCacheBust = null;
  try {
    invalidatePrivateCurriculumCache();
  } catch {
    // Best effort only — the editable seed cache is the important part here.
  }
  try {
    invalidateSyllabiCache();
  } catch {
    // Best effort — module-cache only, the next read re-loads from disk.
  }
}

// Legacy synchronous reference used by the older lookup functions. Now a
// getter that returns the cached set (may be empty on cold start — the async
// paths above are preferred).
const TOPICS = SEED_TOPICS;

/**
 * Filter the merged topic set to entries matching the requested
 * grade+subject, including their folded equivalents: the KB stores
 * Forms-syllabus topics under G-codes (F1 → G8 … F4 → G11) and some
 * syllabi under core subject keys (travel_tourism → social_studies,
 * literature_in_english → english, …) — see kbLookupCandidates.js. Exact
 * grade+subject matches come FIRST in the returned list, so at every match
 * tier below an exact match wins over a folded one.
 */
function filterGradeSubjectCandidates(allTopics, gradeNorm, subjectNorm) {
  // Always keep the caller's normalized values in the accepted sets so the
  // pre-candidates exact-equality behaviour is preserved byte-for-byte.
  const gradeSet = new Set([...gradeCandidates(gradeNorm), gradeNorm]);
  const subjectSet = new Set([...subjectCandidates(subjectNorm), subjectNorm]);
  const exact = [];
  const folded = [];
  for (const t of allTopics) {
    const g = String(t.grade || "").toUpperCase();
    const s = String(t.subject || "").toLowerCase();
    if (!gradeSet.has(g) || !subjectSet.has(s)) continue;
    if (g === gradeNorm && s === subjectNorm) exact.push(t);
    else folded.push(t);
  }
  return exact.concat(folded);
}

/**
 * Look up a topic. Fuzzy-matches on the topic string within a grade+subject
 * (including folded F-code / vocational-subject equivalents — see
 * filterGradeSubjectCandidates). Returns null if no confident match.
 *
 * Now async — pulls merged topic set (Firestore + seed).
 */
async function lookupTopic({grade, subject, topic, framework}) {
  if (!grade || !subject || !topic) return null;
  const gradeNorm = normalizeGrade(grade);
  const subjectNorm = String(subject).toLowerCase().replace(/[^a-z]/g, "_");
  const topicNorm = String(topic).toLowerCase().trim();
  const allTopics = await getAllTopics({framework});
  const candidates =
    filterGradeSubjectCandidates(allTopics, gradeNorm, subjectNorm);
  if (candidates.length === 0) return null;

  // Exact topic match wins.
  const exact = candidates.find(
    (t) => t.topic.toLowerCase() === topicNorm,
  );
  if (exact) return exact;

  // Contains-match — either direction (topic contains candidate, or vice versa).
  const contains = candidates.find((t) => {
    const cand = t.topic.toLowerCase();
    return cand.includes(topicNorm) || topicNorm.includes(cand);
  });
  if (contains) return contains;

  // Sub-topic match. subtopicName() handles both legacy string subtopics
  // and Phase-A enriched {name, ...} objects from the new syllabus parser.
  const subMatch = candidates.find((t) =>
    (t.subtopics || []).some((s) => {
      const sn = subtopicName(s).toLowerCase();
      if (!sn) return false;
      return sn.includes(topicNorm) || topicNorm.includes(sn);
    }),
  );
  if (subMatch) return subMatch;

  // Token-overlap fallback (>= 1 shared non-stopword token).
  const STOP = new Set([
    "the", "and", "of", "a", "an", "to", "with", "in", "for", "on",
  ]);
  const topicTokens = topicNorm
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
  const partial = candidates.find((t) => {
    const candTokens = t.topic.toLowerCase().split(/\s+/);
    return topicTokens.some((tok) => candTokens.includes(tok));
  });
  return partial || null;
}

/**
 * Suggest up to 5 topic strings for a grade + subject (including folded
 * F-code / vocational-subject equivalents, exact matches first). Used when
 * we can't find a confident match — teacher sees: "Did you mean one of
 * these?"
 */
async function suggestTopics({grade, subject, framework}) {
  const gradeNorm = normalizeGrade(grade);
  const subjectNorm = String(subject || "").toLowerCase().replace(/[^a-z]/g, "_");
  const allTopics = await getAllTopics({framework});
  return filterGradeSubjectCandidates(allTopics, gradeNorm, subjectNorm)
    .map((t) => t.topic)
    .slice(0, 5);
}

/**
 * Render a topic entry as the `<cbc_context>` block we inject into the prompt.
 */
function renderContextBlock(entry) {
  if (!entry) return "";
  const subs = (entry.subtopics || [])
    .map((s) => `- ${subtopicName(s)}`)
    .join("\n");
  const outcomes = (entry.specificOutcomes || []).map((s) => `- ${s}`).join("\n");
  const comps = (entry.keyCompetencies || []).map((s) => `- ${s}`).join("\n");
  const vals = (entry.values || []).map((s) => `- ${s}`).join("\n");
  const mats = (entry.suggestedMaterials || []).map((s) => `- ${s}`).join("\n");
  return [
    "<cbc_context>",
    `Grade: ${entry.grade}`,
    `Subject: ${entry.subject}`,
    `Term: ${entry.term}`,
    `Topic: ${entry.topic}`,
    "",
    "Official sub-topics covered under this topic in the CDC syllabus:",
    subs,
    "",
    "Typical Specific Outcomes:",
    outcomes,
    "",
    "Key Competencies most relevant here:",
    comps,
    "",
    "Values typically emphasised:",
    vals,
    "",
    "Suggested Teaching/Learning Materials:",
    mats,
    "</cbc_context>",
  ].join("\n");
}

/**
 * Fallback context used when the KB has no confident match. Rather than
 * rejecting the request, give Claude a structured brief that leans on its
 * general knowledge of the Zambian CBC.
 */
function renderFallbackContext({grade, subject, topic, subtopic, framework}) {
  const fw = normalizeFramework(framework);
  const band = getGradeBand(grade);
  // Subject-validity check only applies to the 2023 framework — 2013 has
  // a different subject list and isn't covered by CBC_2023_GRADE_SUBJECTS.
  const official = fw === "2023" ? getOfficialSubjectsForGrade(grade) : null;
  const classification = fw === "2023" ?
    classifySubjectForGrade(grade, subject) : "unknown";

  const lines = [
    "<cbc_context>",
    `Grade: ${grade}`,
    `Subject: ${subject}`,
    `Topic: ${topic}`,
    subtopic ? `Sub-topic: ${subtopic}` : "",
    "",
    fw === "2013" ?
      "Framework: Zambian Competence-Based Curriculum (CBC/CDC), 2013 " +
      "legacy framework. The 2013 framework predates the 2023 reform and " +
      "uses Specific Outcomes / Knowledge / Skills / Values column headings." :
      "Framework: Zambian Competence-Based Curriculum (CBC/CDC), 2023 " +
      "framework. The 2023 framework groups grades as:",
  ];
  if (fw === "2023") {
    lines.push(
      "  - Lower Primary: ECE → Grade 3",
      "  - Upper Primary: Grade 4 → Grade 7",
      "  - Junior Secondary: Grade 8 → Grade 9 (Forms 1-2)",
      "  - Senior Secondary: Grade 10 → Grade 12 (Forms 3-5)",
    );
  }

  if (band) {
    lines.push(`This grade falls under: ${band}.`);
  }

  if (official && classification === "not_in_grade") {
    lines.push(
      "",
      `IMPORTANT: "${subject}" is NOT one of the official subjects in the`,
      `Grade ${String(grade).replace(/^G/i, "")} 2023 syllabus. The official`,
      `subjects for this grade are: ${official.join(", ")}.`,
      "",
      "Do NOT fabricate a Grade-level syllabus for a subject that doesn't",
      "exist at this grade. Instead, produce content that:",
      "  - Is honest that this subject isn't part of the official grade",
      "    syllabus, and",
      "  - Falls back to age-appropriate CBC-aligned material that maps to",
      "    the closest official learning area for this grade.",
    );
  } else if (official && classification === "in_syllabus") {
    lines.push(
      "",
      `"${subject}" IS part of the official Grade ${String(grade).replace(/^G/i, "")}`,
      "2023 syllabus, but the specific topic above isn't in our verified",
      "topic list yet. Stay within what the official syllabus would cover",
      "for this subject at this grade.",
    );
  } else {
    lines.push(
      "",
      "NOTE: This specific topic isn't in our verified syllabus list yet.",
      `Produce the content using your expert knowledge of the Zambian CBC ${
        fw === "2013" ? "(2013 legacy framework)" : "(2023 framework)"
      }`,
      "for this grade and subject.",
    );
  }

  lines.push(
    "",
    "Guidelines:",
    "- Use authentic Zambian CDC terminology: Specific Outcomes, Key",
    "  Competencies, Values, Pupils' Activities, Teacher's Activities,",
    "  Teacher's Reflection.",
    `- Align Specific Outcomes, Key Competencies and Values with what CDC ${
      fw === "2013" ?
        "emphasised at this grade level under the 2013 framework." :
        "typically emphasises at this grade level under the 2023 framework."
    }`,
    "- Cite the appropriate grade-and-subject Pupil's Book (CDC) when",
    "  listing teaching materials.",
    "</cbc_context>",
  );
  return lines.filter(Boolean).join("\n");
}

// ── Lesson-level curriculum modules (source of truth) ────────────────────

/**
 * Canonicalise a grade label for KB lookups. The CBC seeds + the
 * teacher-side AgentBriefForm both write grades as "G4" (with the
 * leading "G"). The learner-AI runtime + per-attempt task writers
 * (src/utils/aiPracticeQuizService.js) sometimes pass a bare digit
 * like "4". The admin Live Monitor's manual test trigger (PR #566,
 * pre-#569 fix) wrote the human-readable "Grade 4" form. All three
 * must resolve to the same KB entry.
 *
 * Rules:
 *   "4"        → "G4"
 *   "g4"       → "G4"
 *   "G4"       → "G4"
 *   " G 4 "    → "G4"
 *   "Grade 4"  → "G4"
 *   "GRADE 4"  → "G4"
 *   "grade 4"  → "G4"
 *   ""         → ""
 *
 * Idempotent. Called from every public lookup helper below.
 */
function normalizeGrade(grade) {
  if (grade == null) return "";
  const raw = String(grade).trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (/^G\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `G${raw}`;
  // "GRADE4" / "GRADE 4" → "G4" (whitespace already stripped above).
  const gradeMatch = raw.match(/^GRADE(\d+)$/);
  if (gradeMatch) return `G${gradeMatch[1]}`;
  // Anything else (e.g. "ECE", "PP1") is left alone — KB stores it verbatim.
  return raw;
}

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 60);
}

/**
 * Canonical subject key used for KB lookups and approvedSyllabi
 * matches. Mirrors the inline rule lookupTopic / suggestTopics use
 * ("Integrated Science" → "integrated_science"), exposed so other
 * modules (the strict resolver, the syllabus upload writer) can
 * compare on the same shape without re-deriving it.
 */
function normalizeSubject(subject) {
  return String(subject || "").toLowerCase().replace(/[^a-z]/g, "_");
}

// Must match buildTopicId() in importCurriculumModules.js and the client
// src/utils/adminCbcKbService.js so we read the right topic subcollection.
function buildTopicId(grade, subject, topic) {
  const g = slug(grade);
  const s = slug(subject);
  const t = slug(topic);
  if (!g || !s || !t) return null;
  return `${g}-${s}-${t}`;
}

/**
 * Look up the stored curriculum module for a sub-topic. One module per
 * sub-topic; the teacher chooses how many lessons to split it into at
 * generation time, so lessonNumber is NOT part of the lookup. Deterministic
 * doc read (no query/index): topic & sub-topic slugify the same way at
 * import time and here, so case/punctuation differences don't matter.
 * Returns the module object or null.
 */
async function lookupSubtopicModule({grade, subject, topic, subtopic, term}) {
  const t = Number(term);
  if (!grade || !subject || !topic || !subtopic ||
      !(Number.isInteger(t) && t >= 1 && t <= 3)) {
    return null;
  }
  const gradeNorm = normalizeGrade(grade);
  const topicId = buildTopicId(gradeNorm, subject, topic);
  const moduleId = buildModuleId(subtopic, t);
  if (!topicId || !moduleId) return null;
  try {
    const db = admin.firestore();
    const version = await getActiveKbVersion();
    const doc = await db.collection("cbcKnowledgeBase").doc(version)
        .collection("topics").doc(topicId)
        .collection("lessons").doc(moduleId).get();
    return doc.exists ? {id: doc.id, ...doc.data()} : null;
  } catch (err) {
    console.error("lookupLessonModule failed", err);
    return null;
  }
}

function bullets(arr) {
  return (Array.isArray(arr) ? arr : [])
      .filter((s) => typeof s === "string" && s.trim())
      .map((s) => `- ${s}`).join("\n");
}

/**
 * Render a stored sub-topic module as the authoritative <curriculum_module>
 * block. Outranks RAG / topic KB / general knowledge.
 *
 * `framing` carries the TEACHER's choice of how to split this sub-topic:
 *   { lessonNumber, totalLessons }. The module itself only stores a
 *   `suggestedLessons` default — the teacher decides the real split, and we
 *   frame the prompt around that so Lesson N doesn't repeat Lesson N-1.
 */
function renderCurriculumModuleBlock(m, framing = {}) {
  if (!m) return "";
  const suggested = Number(m.suggestedLessons);
  const askedTotal = Number(framing.totalLessons);
  const total = Number.isInteger(askedTotal) && askedTotal >= 1 ?
    askedTotal :
    (Number.isInteger(suggested) && suggested >= 1 ? suggested : 1);
  const askedN = Number(framing.lessonNumber);
  const n = Number.isInteger(askedN) && askedN >= 1 && askedN <= total ?
    askedN : null;

  // When a syllabus block is shown alongside this module (framing.paired),
  // the two are reconciled by the <curriculum_sources> directive, so we drop
  // the "single source of truth" wording that would contradict it.
  const intro = framing.paired ? [
    "<curriculum_module>",
    "This is the VERIFIED Zambian CBC curriculum module (uploaded) for this",
    "exact grade + sub-topic. It is detailed and authoritative — use it as a",
    "primary source, reconciled with the syllabus outline above. Do not invent",
    "outcomes, content or activities that go beyond or contradict these sources.",
    "",
  ] : [
    "<curriculum_module>",
    "This is the VERIFIED Zambian CBC curriculum module for this exact",
    "grade + sub-topic. It is the single source of truth. Base ALL generated",
    "content strictly on it. Do not invent outcomes, content or activities",
    "that go beyond or contradict this module.",
    "",
  ];

  const lines = [
    ...intro,
    `Grade: ${m.grade}`,
    `Subject: ${m.subject}`,
    `Term: ${m.term}`,
    `Topic: ${m.topic}`,
    `Sub-topic: ${m.subtopic}`,
  ];
  if (n && total > 1) {
    lines.push(
        "",
        `The teacher is teaching this sub-topic over ${total} lessons and ` +
        `wants LESSON ${n} of ${total}. Cover only the share of the ` +
        `sub-topic's outcomes/content that belongs to Lesson ${n}. Assume ` +
        `Lessons 1..${n - 1} were already taught — do NOT re-teach their ` +
        "content, build forward from it; and do NOT pre-empt content that " +
        "belongs to later lessons. Distribute the outcomes below sensibly " +
        `across the ${total} lessons.`,
    );
  } else if (total > 1) {
    lines.push(
        "",
        `This sub-topic is typically delivered over about ${total} lessons. ` +
        "Produce one coherent lesson's worth of content drawn from the " +
        "outcomes below; do not try to cram the whole sub-topic into one.",
    );
  }
  const section = (title, arr) => {
    const b = bullets(arr);
    if (b) lines.push("", `${title}:`, b);
  };
  if (typeof m.contentSummary === "string" && m.contentSummary.trim()) {
    lines.push("", "Content summary:", m.contentSummary.trim());
  }
  section("Specific learning outcomes", m.outcomes);
  section("Competencies", m.competencies);
  section("Key vocabulary", m.vocabulary);
  section("Teacher activities", m.teacherActivities);
  section("Learner activities", m.learnerActivities);
  section("Teaching and learning materials", m.teachingMaterials);
  section("Assessment criteria", m.assessmentCriteria);
  section("Sample exercises / questions", m.exercises);
  section("Remedial activities", m.remedialActivities);
  section("Extension activities", m.extensionActivities);
  lines.push("</curriculum_module>");
  return lines.join("\n");
}

/**
 * Directive shown when BOTH a syllabus outline (topic KB) and a detailed
 * uploaded module are available for the same topic. The product decision is
 * to hand both to the model and let it reconcile them rather than hard-coding
 * one above the other — the syllabus is canonical for codes/sequence, the
 * module is usually richer on content/activities.
 */
function renderSourceReconciliation() {
  return [
    "<curriculum_sources>",
    "You have TWO complementary Zambian CBC curriculum sources for this topic:",
    "a syllabus outline (from the Syllabus / Curriculum Studio) below, and a",
    "detailed uploaded module that follows it. Both are authoritative. Use the",
    "syllabus for canonical topic/sub-topic naming, codes and sequence, and the",
    "module for fuller outcomes, activities, materials and assessment. Where",
    "they overlap, prefer whichever is more complete, specific and",
    "curriculum-accurate; where only one covers a point, use it. Reconcile them",
    "into one coherent result and do not invent anything beyond what these",
    "sources support.",
    "</curriculum_sources>",
  ].join("\n");
}

/**
 * Look up EVERY stored sub-topic module for a (grade, subject, term) so the
 * Scheme of Work generator and the Weekly Forecast can see how the curriculum
 * arranges topics → sub-topics across the term. Reads the topic cards for the
 * grade+subject (a small, bounded set) then their `lessons` sub-collections,
 * filtering to the requested term in memory. Querying the parent `topics`
 * collection (not a `lessons` collection-group) avoids colliding with the
 * lesson-library `lessons` sub-collection, which shares the same name.
 *
 * Returns { topics: [...], weeks: [...], topicsCount, subtopicsCount } or
 * null when nothing is uploaded for the term. `weeks` are shaped like the
 * official 9-column scheme week so the Weekly Forecast can reuse its existing
 * normaliser/day-builder.
 */
async function lookupTermModules({grade, subject, term}) {
  const t = Number(term);
  if (!grade || !subject || !(Number.isInteger(t) && t >= 1 && t <= 3)) {
    return null;
  }
  const gradeNorm = normalizeGrade(grade);
  const subjectNorm = String(subject || "").toLowerCase()
      .replace(/[^a-z_]/g, "_").slice(0, 40);
  try {
    const db = admin.firestore();
    const version = await getActiveKbVersion();
    const topicsSnap = await db.collection("cbcKnowledgeBase").doc(version)
        .collection("topics")
        .where("grade", "==", gradeNorm)
        .where("subject", "==", subjectNorm)
        .limit(80)
        .get();
    if (topicsSnap.empty) return null;

    const topics = [];
    for (const topicDoc of topicsSnap.docs) {
      const td = topicDoc.data() || {};
      const lessonsSnap = await topicDoc.ref.collection("lessons")
          .where("term", "==", t)
          .limit(60)
          .get();
      if (lessonsSnap.empty) continue;
      const subtopics = lessonsSnap.docs
          .map((d) => ({id: d.id, ...d.data()}))
          .filter((m) => m && m.subtopic);
      if (subtopics.length === 0) continue;
      topics.push({
        topic: td.topic || subtopics[0].topic || "",
        subtopics,
      });
    }
    if (topics.length === 0) return null;

    // Stable order: by topic name, then sub-topic name, so schemes sequence
    // predictably regardless of Firestore doc-id ordering.
    topics.sort((a, b) => String(a.topic).localeCompare(String(b.topic)));
    let subtopicsCount = 0;
    const weeks = [];
    for (const tp of topics) {
      tp.subtopics.sort((a, b) =>
        String(a.subtopic).localeCompare(String(b.subtopic)));
      for (const m of tp.subtopics) {
        subtopicsCount += 1;
        weeks.push({
          week: weeks.length + 1,
          topic: tp.topic,
          subtopic: m.subtopic,
          specificCompetences: [
            ...(Array.isArray(m.outcomes) ? m.outcomes : []),
            ...(Array.isArray(m.competencies) ? m.competencies : []),
          ].filter(Boolean).slice(0, 6),
          learningActivities: (Array.isArray(m.learnerActivities) &&
            m.learnerActivities.length ? m.learnerActivities :
            (Array.isArray(m.teacherActivities) ? m.teacherActivities : []))
              .filter(Boolean).slice(0, 6),
          expectedStandard: (Array.isArray(m.assessmentCriteria) ?
            m.assessmentCriteria : []).filter(Boolean).join("; "),
          methods: [],
          tlAids: (Array.isArray(m.teachingMaterials) ?
            m.teachingMaterials : []).filter(Boolean).slice(0, 6),
          references: "",
        });
      }
    }
    return {topics, weeks, topicsCount: topics.length, subtopicsCount};
  } catch (err) {
    console.error("lookupTermModules failed", err);
    return null;
  }
}

/**
 * Render the term's module arrangement as a compact <term_module_outline>
 * block for the Scheme of Work prompt: topic → sub-topics, each with its
 * specific competences / learning activities / expected standard so the model
 * follows the uploaded curriculum's own ordering rather than inventing one.
 */
function renderTermModuleOutline(outline, {grade, subject, term} = {}) {
  if (!outline || !Array.isArray(outline.topics) || !outline.topics.length) {
    return "";
  }
  const lines = [
    "<term_module_outline>",
    "These are the VERIFIED uploaded curriculum modules for this grade +",
    `subject + Term ${term}. They show how the curriculum arranges topics and`,
    "sub-topics for the term. Use this arrangement as the backbone for",
    "sequencing the weeks — keep the topic/sub-topic order and naming, and",
    "draw each week's competences, activities and standards from here. Do not",
    "invent topics that are not represented below.",
    "",
    `Grade: ${grade || ""}    Subject: ${subject || ""}    Term: ${term || ""}`,
  ];
  for (const tp of outline.topics) {
    lines.push("", `TOPIC: ${tp.topic}`);
    for (const m of tp.subtopics) {
      lines.push(`  Sub-topic: ${m.subtopic}`);
      const comp = [
        ...(Array.isArray(m.outcomes) ? m.outcomes : []),
        ...(Array.isArray(m.competencies) ? m.competencies : []),
      ].filter(Boolean).slice(0, 4);
      if (comp.length) {
        lines.push(`    Specific competences: ${comp.join("; ")}`);
      }
      const acts = (Array.isArray(m.learnerActivities) &&
        m.learnerActivities.length ? m.learnerActivities :
        (Array.isArray(m.teacherActivities) ? m.teacherActivities : []))
          .filter(Boolean).slice(0, 4);
      if (acts.length) {
        lines.push(`    Learning activities: ${acts.join("; ")}`);
      }
      const std = (Array.isArray(m.assessmentCriteria) ?
        m.assessmentCriteria : []).filter(Boolean).slice(0, 2).join("; ");
      if (std) lines.push(`    Expected standard: ${std}`);
      const mats = (Array.isArray(m.teachingMaterials) ?
        m.teachingMaterials : []).filter(Boolean).slice(0, 4);
      if (mats.length) lines.push(`    T/L materials: ${mats.join("; ")}`);
    }
  }
  lines.push("</term_module_outline>");
  return lines.join("\n");
}

/**
 * High-level term-outline resolver: returns the rendered block plus the
 * structured weeks (for the Weekly Forecast) or null. Thin wrapper so callers
 * don't have to know about lookupTermModules / renderTermModuleOutline.
 */
async function resolveTermModuleOutline({grade, subject, term} = {}) {
  const outline = await lookupTermModules({grade, subject, term});
  if (!outline) return null;
  return {
    outlineBlock: renderTermModuleOutline(outline, {grade, subject, term}),
    weeks: outline.weeks,
    topicsCount: outline.topicsCount,
    subtopicsCount: outline.subtopicsCount,
  };
}

/**
 * A directive appended to whatever context block we return so the selected
 * learning environment shapes activities/materials. Maps the concrete choice
 * onto the existing 4-value CBC category so the lesson-plan schema is
 * untouched. Empty string when nothing selected (no behaviour change).
 */
function renderLearningEnvironmentDirective(value) {
  if (!value) return "";
  const env = getLearningEnvironment(value);
  if (!env) return "";
  return [
    "<learning_environment>",
    `This lesson will be delivered in: ${env.label} ` +
    `(CBC category: ${env.cbcCategory}).`,
    `Shape ALL activities, teaching/learning materials, examples and ` +
    `learner tasks so they genuinely fit a ${env.label}. Use what that ` +
    "setting makes possible; avoid steps that need a different environment.",
    `Where the output has a learning-environment field, set its category ` +
    `to "${env.cbcCategory}" and the specific environment to "${env.label}".`,
    "</learning_environment>",
  ].join("\n");
}

function normKey(s) {
  return String(s || "").trim().toLowerCase();
}

/**
 * Query the teacher's OWN prior completed generations for earlier lessons of
 * this exact sub-topic+term and collect what they already covered. Index-free:
 * uses the existing (ownerUid, createdAt) index and filters the rest in
 * memory, so no new composite index is needed. Returns
 * [{ lessonNumber, items: string[] }] sorted ascending, or [].
 */
async function resolvePriorCoverage({
  ownerUid, grade, subject, topic, subtopic, term, lessonNumber,
}) {
  const n = Number(lessonNumber);
  if (!ownerUid || !subtopic || !(Number.isInteger(n) && n > 1)) return [];
  const g = String(grade || "").toUpperCase().replace(/\s+/g, "");
  const s = String(subject || "").toLowerCase();
  const tp = normKey(topic);
  const st = normKey(subtopic);
  const tm = Number(term);
  try {
    const db = admin.firestore();
    const snap = await db.collection("aiGenerations")
        .where("ownerUid", "==", ownerUid)
        .orderBy("createdAt", "desc")
        .limit(250)
        .get();
    const byLesson = new Map();
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      if (d.status !== "complete") continue;
      const inp = d.inputs || {};
      const ln = Number(inp.lessonNumber);
      if (!(Number.isInteger(ln) && ln >= 1 && ln < n)) continue;
      if (String(inp.grade || "").toUpperCase().replace(/\s+/g, "") !== g) {
        continue;
      }
      if (String(inp.subject || "").toLowerCase() !== s) continue;
      if (normKey(inp.topic) !== tp) continue;
      if (normKey(inp.subtopic) !== st) continue;
      if (Number(inp.term) !== tm) continue;
      const items = Array.isArray(d.coveredContent) ?
        d.coveredContent
            .filter((x) => typeof x === "string" && x.trim())
            .slice(0, 12) :
        [];
      if (items.length === 0) continue;
      // snap is newest-first → keep the most recent per lesson number.
      if (!byLesson.has(ln)) byLesson.set(ln, items);
    }
    return Array.from(byLesson.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([ln, items]) => ({lessonNumber: ln, items}));
  } catch (err) {
    console.error("resolvePriorCoverage failed", err);
    return [];
  }
}

/**
 * Render the concrete "already taught" block. Empty string when there's no
 * prior coverage (no behaviour change for Lesson 1 / non-curriculum runs).
 */
function renderPreviouslyCovered(coverage) {
  if (!Array.isArray(coverage) || coverage.length === 0) return "";
  const lines = [
    "<previously_covered>",
    "This teacher has already generated and taught the earlier lessons of",
    "THIS sub-topic. The points below were already covered — do NOT",
    "re-teach or repeat them; build forward from them only.",
  ];
  for (const c of coverage) {
    lines.push("", `Lesson ${c.lessonNumber} already covered:`);
    for (const it of c.items) lines.push(`- ${it}`);
  }
  lines.push("</previously_covered>");
  return lines.join("\n");
}

/**
 * High-level resolver used by the Cloud Functions. Returns:
 *   { contextBlock, kbMatch, kbWarning }
 * where kbMatch is the matched module/topic entry (or null) and kbWarning
 * is either null or a human-readable string to surface in the UI.
 *
 * Resolution priority:
 *   1. Stored lesson-level curriculum module (source of truth)
 *   2. Private RAG curriculum
 *   3. Editable topic KB
 *   4. General CBC fallback
 *
 * A stored module is looked up only when BOTH `subtopic` and `term` are
 * supplied (modules are keyed by grade+subject+topic+sub-topic+term). When
 * found it becomes the source of truth and the teacher's lessonNumber /
 * totalLessons frame the prompt. `lessonNumber`, `totalLessons` and
 * `learningEnvironment` are optional; callers that pass no sub-topic/term
 * keep the exact pre-upgrade behaviour, so every existing caller is safe.
 */
async function resolveCbcContext({
  grade, subject, topic, subtopic, term, ownerUid,
  lessonNumber, totalLessons, learningEnvironment, framework,
} = {}) {
  // Read the runtime active-version pointer once per call. Every return
  // path carries kbVersion forward so generators can stamp it on their
  // aiGenerations log row. usePrivateCurriculum gates step #2 below — when
  // false (Phase C activate sets this), the RAG fallback is bypassed so
  // the newly approved syllabus is the sole source for any topic without
  // a stored sub-topic module.
  const activeState = await getActiveKbState();
  const kbVersion = activeState.version;
  const fw = normalizeFramework(framework);

  const leDirective = renderLearningEnvironmentDirective(learningEnvironment);
  const priorBlock = renderPreviouslyCovered(
      await resolvePriorCoverage({
        ownerUid, grade, subject, topic, subtopic, term, lessonNumber,
      }),
  );
  const extras = [leDirective, priorBlock].filter(Boolean).join("\n\n");
  const decorate = (res) => {
    const withVersion = {...res, kbVersion, framework: fw};
    return extras ?
      {...withVersion, contextBlock: `${withVersion.contextBlock}\n\n${extras}`} :
      withVersion;
  };

  // Editable topic KB / syllabus block — resolved up front so a stored module
  // can be reconciled WITH the syllabus rather than silently replacing it
  // (product decision: hand the model both sources and let it reconcile).
  const match = await lookupTopic({grade, subject, topic, framework: fw});
  const syllabusBlock = match ? renderContextBlock(match) : "";

  // 1. Stored sub-topic curriculum module — the primary, most detailed source.
  // When a syllabus block also exists we present BOTH, headed by the
  // <curriculum_sources> reconciliation directive.
  if (subtopic && term) {
    const moduleMatch = await lookupSubtopicModule({
      grade, subject, topic, subtopic, term,
    });
    if (moduleMatch) {
      const moduleBlock = renderCurriculumModuleBlock(moduleMatch, {
        lessonNumber, totalLessons, paired: Boolean(syllabusBlock),
      });
      const contextBlock = syllabusBlock ?
        [renderSourceReconciliation(), syllabusBlock, moduleBlock].join("\n\n") :
        moduleBlock;
      return decorate({
        contextBlock,
        kbMatch: moduleMatch,
        kbWarning: null,
      });
    }
  }

  // 2. Private RAG curriculum — gated by active.usePrivateCurriculum so the
  // Phase C activate flow can disable this short-circuit and force every
  // topic to come from the new editable KB (steps 3 + 4 below).
  if (activeState.usePrivateCurriculum) {
    const privateResult = await resolvePrivateCurriculumContext({
      grade,
      subject,
      topic,
      subtopic,
    });
    if (privateResult) {
      return decorate({
        contextBlock: privateResult.contextBlock,
        kbMatch: privateResult.match,
        kbWarning: null,
      });
    }
  }

  // 3. Editable topic KB (framework-aware) — resolved above.
  if (match) {
    return decorate({
      contextBlock: syllabusBlock,
      kbMatch: match,
      kbWarning: null,
    });
  }

  // 4. General CBC fallback.
  // When we have an authoritative subject list for the grade (2023
  // framework), surface a sharper warning so teachers immediately see
  // whether the gap is "subject not in this grade's syllabus" vs "subject
  // valid, just not uploaded yet" — instead of all gaps reading the same.
  // Subject-validity rules only apply when the caller is on the 2023
  // framework — the 2013 framework has its own (very different) subject
  // list and isn't covered by CBC_2023_GRADE_SUBJECTS.
  const suggestions = await suggestTopics({grade, subject, framework: fw});
  const classification = fw === "2023" ?
    classifySubjectForGrade(grade, subject) : "unknown";
  const official = fw === "2023" ?
    getOfficialSubjectsForGrade(grade) : null;
  const gradeLabel = String(grade || "").replace(/^G/i, "");

  let kbWarning;
  if (classification === "not_in_grade" && official) {
    kbWarning =
      `"${subject}" isn't part of the Grade ${gradeLabel} syllabus in the ` +
      `2023 CBC framework. Official subjects for Grade ${gradeLabel}: ` +
      `${official.join(", ")}. Used general CBC knowledge.`;
  } else if (classification === "in_syllabus") {
    kbWarning =
      `"${subject}" is a valid Grade ${gradeLabel} subject, but the syllabus ` +
      `for it hasn't been uploaded yet — used general CBC knowledge. ` +
      (suggestions.length ?
        `Nearby verified topics: ${suggestions.join(", ")}.` :
        "");
  } else if (suggestions.length) {
    kbWarning =
      `"${topic}" isn't in our verified syllabus list yet — used general ` +
      `CBC knowledge. Nearby verified topics for this grade+subject: ` +
      `${suggestions.join(", ")}.`;
  } else {
    kbWarning =
      `"${topic}" used general CBC knowledge (no verified syllabus data ` +
      `for this grade+subject yet).`;
  }

  return decorate({
    contextBlock: renderFallbackContext({
      grade, subject, topic, subtopic, framework: fw,
    }),
    kbMatch: null,
    kbWarning,
  });
}

module.exports = {
  KB_VERSION,
  KB_DEFAULT_VERSION,
  CBC_2023_BANDS,
  CBC_2023_GRADE_SUBJECTS,
  VALID_FRAMEWORKS,
  DEFAULT_FRAMEWORK,
  normalizeFramework,
  getActiveKbVersion,
  getActiveKbState,
  getGradeBand,
  getOfficialSubjectsForGrade,
  classifySubjectForGrade,
  lookupTopic,
  suggestTopics,
  renderContextBlock,
  renderFallbackContext,
  resolveCbcContext,
  lookupSubtopicModule,
  lookupTermModules,
  resolveTermModuleOutline,
  renderTermModuleOutline,
  renderSourceReconciliation,
  renderCurriculumModuleBlock,
  renderLearningEnvironmentDirective,
  invalidateKbCache,
  getAllTopics,
  normalizeGrade,
  normalizeSubject,
  _topics: TOPICS,
};
