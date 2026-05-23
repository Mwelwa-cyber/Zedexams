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

// Default ("seed") KB version. Used as the fallback active version when
// cbcKnowledgeBase/_meta doesn't exist yet — i.e. before the first Phase-C
// approve-and-activate flow ever runs. After Phase B ships, callers should
// prefer getActiveKbVersion() instead of this constant for any path that
// has to follow a runtime version switch.
const KB_VERSION = "cbc-kb-2026-04-seed";
const KB_DEFAULT_VERSION = KB_VERSION;

// Module-level cache to avoid hitting Firestore on every generation.
let _cache = null;
let _cacheAt = 0;
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
      _cache = null;
      _cacheAt = 0;
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
 * Return the merged topic list (Firestore + in-code). Firestore wins on
 * matching grade+subject+topic-name triplets.
 */
async function getAllTopics() {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < CACHE_TTL_MS) return _cache;

  const fromFirestore = await fetchFirestoreTopics();
  const byKey = new Map();
  // Seed first...
  for (const t of SEED_TOPICS) {
    byKey.set(topicKey(t), {...t, _source: "seed"});
  }
  // ...then Firestore overrides.
  for (const t of fromFirestore) {
    byKey.set(topicKey(t), {...t, _source: "firestore"});
  }
  _cache = Array.from(byKey.values());
  _cacheAt = now;
  return _cache;
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
  _cache = null;
  _cacheAt = 0;
  _activeStateCache = null;
  _activeStateAt = 0;
  _lastSeenCacheBust = null;
  try {
    invalidatePrivateCurriculumCache();
  } catch {
    // Best effort only — the editable seed cache is the important part here.
  }
}

// Legacy synchronous reference used by the older lookup functions. Now a
// getter that returns the cached set (may be empty on cold start — the async
// paths above are preferred).
const TOPICS = SEED_TOPICS;

/**
 * Look up a topic. Fuzzy-matches on the topic string within a grade+subject.
 * Returns null if no confident match.
 *
 * Now async — pulls merged topic set (Firestore + seed).
 */
async function lookupTopic({grade, subject, topic}) {
  if (!grade || !subject || !topic) return null;
  const gradeNorm = normalizeGrade(grade);
  const subjectNorm = String(subject).toLowerCase().replace(/[^a-z]/g, "_");
  const topicNorm = String(topic).toLowerCase().trim();
  const allTopics = await getAllTopics();
  const candidates = allTopics.filter((t) =>
    String(t.grade || "").toUpperCase() === gradeNorm &&
    String(t.subject || "").toLowerCase() === subjectNorm,
  );
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
 * Suggest up to 5 topic strings for a grade + subject. Used when we can't
 * find a confident match — teacher sees: "Did you mean one of these?"
 */
async function suggestTopics({grade, subject}) {
  const gradeNorm = normalizeGrade(grade);
  const subjectNorm = String(subject || "").toLowerCase().replace(/[^a-z]/g, "_");
  const allTopics = await getAllTopics();
  return allTopics
    .filter((t) =>
      String(t.grade || "").toUpperCase() === gradeNorm &&
      String(t.subject || "").toLowerCase() === subjectNorm,
    )
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
function renderFallbackContext({grade, subject, topic, subtopic}) {
  return [
    "<cbc_context>",
    `Grade: ${grade}`,
    `Subject: ${subject}`,
    `Topic: ${topic}`,
    subtopic ? `Sub-topic: ${subtopic}` : "",
    "",
    "NOTE: This specific topic is not in our curated Zambian CBC topic list",
    "yet. Produce the lesson plan using your expert knowledge of the Zambian",
    "Competence-Based Curriculum (2013 framework, CDC) for this grade and",
    "subject. Guidelines:",
    "",
    "- Use authentic Zambian CDC terminology: Specific Outcomes, Key",
    "  Competencies, Values, Pupils' Activities, Teacher's Activities,",
    "  Teacher's Reflection.",
    "- Align Specific Outcomes, Key Competencies and Values with what CDC",
    "  typically emphasises at this grade level.",
    "- If you are unsure whether this exact topic is part of the official",
    "  Zambian syllabus at this grade, still produce a usable lesson plan,",
    "  adapting the sub-topic breakdown to the closest CBC-aligned concept.",
    "- Cite the appropriate grade-and-subject Pupil's Book (CDC) when listing",
    "  teaching materials.",
    "</cbc_context>",
  ].filter(Boolean).join("\n");
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

  const lines = [
    "<curriculum_module>",
    "This is the VERIFIED Zambian CBC curriculum module for this exact",
    "grade + sub-topic. It is the single source of truth. Base ALL generated",
    "content strictly on it. Do not invent outcomes, content or activities",
    "that go beyond or contradict this module.",
    "",
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
  lessonNumber, totalLessons, learningEnvironment,
} = {}) {
  // Read the runtime active-version pointer once per call. Every return
  // path carries kbVersion forward so generators can stamp it on their
  // aiGenerations log row. usePrivateCurriculum gates step #2 below — when
  // false (Phase C activate sets this), the RAG fallback is bypassed so
  // the newly approved syllabus is the sole source for any topic without
  // a stored sub-topic module.
  const activeState = await getActiveKbState();
  const kbVersion = activeState.version;

  const leDirective = renderLearningEnvironmentDirective(learningEnvironment);
  const priorBlock = renderPreviouslyCovered(
      await resolvePriorCoverage({
        ownerUid, grade, subject, topic, subtopic, term, lessonNumber,
      }),
  );
  const extras = [leDirective, priorBlock].filter(Boolean).join("\n\n");
  const decorate = (res) => {
    const withVersion = {...res, kbVersion};
    return extras ?
      {...withVersion, contextBlock: `${withVersion.contextBlock}\n\n${extras}`} :
      withVersion;
  };

  // 1. Stored sub-topic curriculum module — outranks everything else.
  if (subtopic && term) {
    const moduleMatch = await lookupSubtopicModule({
      grade, subject, topic, subtopic, term,
    });
    if (moduleMatch) {
      return decorate({
        contextBlock: renderCurriculumModuleBlock(moduleMatch, {
          lessonNumber, totalLessons,
        }),
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

  // 3. Editable topic KB (unchanged).
  const match = await lookupTopic({grade, subject, topic});
  if (match) {
    return decorate({
      contextBlock: renderContextBlock(match),
      kbMatch: match,
      kbWarning: null,
    });
  }

  // 4. General CBC fallback (unchanged).
  const suggestions = await suggestTopics({grade, subject});
  return decorate({
    contextBlock: renderFallbackContext({grade, subject, topic, subtopic}),
    kbMatch: null,
    kbWarning: suggestions.length ?
      `"${topic}" isn't in our verified syllabus list yet — used general ` +
      `CBC knowledge. Nearby verified topics for this grade+subject: ` +
      `${suggestions.join(", ")}.` :
      `"${topic}" used general CBC knowledge (no verified syllabus data for ` +
      `this grade+subject yet).`,
  });
}

module.exports = {
  KB_VERSION,
  KB_DEFAULT_VERSION,
  getActiveKbVersion,
  getActiveKbState,
  lookupTopic,
  suggestTopics,
  renderContextBlock,
  renderFallbackContext,
  resolveCbcContext,
  lookupSubtopicModule,
  renderCurriculumModuleBlock,
  renderLearningEnvironmentDirective,
  invalidateKbCache,
  getAllTopics,
  normalizeGrade,
  _topics: TOPICS,
};
