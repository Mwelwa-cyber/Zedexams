/**
 * Strict Curriculum Resolver — the no-guess safety gate.
 *
 * This is a SIBLING to functions/teacherTools/cbcKnowledge.js's
 * resolveCbcContext. The teacher resolver layers four sources and falls
 * back to "general CBC knowledge" when nothing matches. That fallback is
 * fine for teacher tools (a teacher can audit the warning and edit the
 * draft), but it violates the learner-AI rule that the model must never
 * guess curriculum content.
 *
 * `resolveStrictCurriculumRef` mirrors steps 1–3 of resolveCbcContext —
 * stored sub-topic module, private RAG curriculum, editable topic KB —
 * and stops there. If nothing matches it returns `{ok:false}` with a
 * structured reason so the dispatcher can refuse to invoke a generator.
 *
 * Additionally, even a curated KB match must point at an APPROVED
 * Zambian syllabus document (cbcKnowledgeBase/.../lessons module with
 * `sourceDocId` set, resolved against `approvedSyllabi`). A module
 * without a source-doc ref is treated as a miss — this is what enforces
 * the "every artifact cites an approved syllabus" requirement.
 */

const admin = require("firebase-admin");
const {
  KB_VERSION,
  lookupSubtopicModule,
  lookupTopic,
} = require("../../teacherTools/cbcKnowledge");

function safeString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function pickExcerpts(module, limit = 5) {
  const out = [];
  const push = (text, anchor) => {
    const t = safeString(text);
    if (!t) return;
    out.push({text: t.slice(0, 480), anchor: anchor || ""});
  };
  // The KB module fields that constitute the source-of-truth excerpts.
  // We deliberately keep this list small and aligned with the module
  // schema — generators receive these verbatim and must ground claims
  // against them (Quality Check then string-matches).
  const fields = [
    ["contentSummary", "content"],
    ["outcomes", "outcomes"],
    ["competencies", "competencies"],
    ["assessmentCriteria", "assessment"],
    ["learnerActivities", "activities"],
  ];
  for (const [field, anchor] of fields) {
    const v = module && module[field];
    if (Array.isArray(v)) {
      for (const item of v) push(item, anchor);
    } else if (typeof v === "string") {
      push(v, anchor);
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

async function loadApprovedSyllabus(sourceDocId) {
  if (!safeString(sourceDocId)) return null;
  try {
    const snap = await admin.firestore()
        .collection("approvedSyllabi")
        .doc(sourceDocId)
        .get();
    return snap.exists ? {id: snap.id, ...snap.data()} : null;
  } catch (err) {
    console.warn("loadApprovedSyllabus failed", err && err.message);
    return null;
  }
}

function refusal(reason, suggestions) {
  return {
    ok: false,
    reason,
    suggestions: Array.isArray(suggestions) ? suggestions : [],
  };
}

/**
 * @param {object} args
 * @param {string} args.grade
 * @param {string} args.subject
 * @param {string} args.topic
 * @param {string} [args.subtopic]
 * @param {number|string} [args.term]
 * @returns {Promise<
 *   | { ok: true, curriculumRef: object, matchedModule: object,
 *       matchKind: 'subtopic_exact' | 'topic_only' }
 *   | { ok: false, reason: string, suggestions: string[] }
 * >}
 *
 * On success, callers also get the raw `matchedModule` (the KB lesson
 * doc, including its `competencies[]`, `outcomes[]`, `vocabulary[]`,
 * `teachingMaterials[]`, etc.) plus `matchKind` so a downstream
 * projector (Curriculum Reader runner) can build a richer agent
 * output without re-reading the KB. The slim `curriculumRef` shape
 * is unchanged for the audit slice persisted onto aiGeneratedContent.
 */
async function resolveStrictCurriculumRef({grade, subject, topic, subtopic, term}) {
  if (!safeString(grade) || !safeString(subject) || !safeString(topic)) {
    return refusal("missing_required_inputs", []);
  }

  // 1. Stored sub-topic curriculum module — the canonical match.
  let module = null;
  if (safeString(subtopic) && term != null) {
    module = await lookupSubtopicModule({grade, subject, topic, subtopic, term});
  }

  // 2. Topic-level KB fallback (no LLM, no general knowledge).
  let topicMatch = null;
  if (!module) {
    topicMatch = await lookupTopic({grade, subject, topic});
  }

  if (!module && !topicMatch) {
    return refusal("no_curriculum_match", []);
  }

  // 3. Approved syllabus reference. A module without `sourceDocId` is
  //    treated as ungrounded — the backfill script must run before the
  //    Curriculum Reader can succeed. This is intentional: we'd rather
  //    refuse 100% of generations on day one than ship guesses.
  const sourceDocId = safeString(module && module.sourceDocId) ||
    safeString(topicMatch && topicMatch.sourceDocId);
  if (!sourceDocId) {
    return refusal("no_source_doc_ref", []);
  }
  const syllabus = await loadApprovedSyllabus(sourceDocId);
  if (!syllabus) {
    return refusal("source_doc_not_found", []);
  }
  if (syllabus.grade && safeString(grade) && safeString(syllabus.grade) !== safeString(grade)) {
    return refusal("source_doc_grade_mismatch", []);
  }
  if (syllabus.subject && safeString(subject) &&
      safeString(syllabus.subject).toLowerCase() !== safeString(subject).toLowerCase()) {
    return refusal("source_doc_subject_mismatch", []);
  }

  const matchedModule = module || topicMatch;
  const citedExcerpts = pickExcerpts(matchedModule);
  if (!citedExcerpts.length) {
    return refusal("no_cited_excerpts", []);
  }

  const curriculumRef = {
    kbVersion: KB_VERSION,
    sourceDocId,
    storagePath: safeString(syllabus.storagePath) ||
      safeString(matchedModule.sourceStoragePath) || "",
    sourceChecksums: syllabus.sha256 ? [
      {storagePath: syllabus.storagePath || "", sha256: syllabus.sha256},
    ] : [],
    moduleId: matchedModule.id || "",
    topicCode: safeString(matchedModule.topicCode) || "",
    subtopicCode: safeString(matchedModule.subtopicCode) || "",
    competenceCode: safeString(matchedModule.competenceCode) || "",
    grade: safeString(matchedModule.grade) || safeString(grade),
    subject: safeString(matchedModule.subject) || safeString(subject),
    term: matchedModule.term != null ? matchedModule.term : (term != null ? Number(term) : null),
    topic: safeString(matchedModule.topic) || safeString(topic),
    subtopic: safeString(matchedModule.subtopic) || safeString(subtopic),
    competency: Array.isArray(matchedModule.competencies) && matchedModule.competencies.length ?
      String(matchedModule.competencies[0]).slice(0, 200) : "",
    learningOutcome: Array.isArray(matchedModule.outcomes) && matchedModule.outcomes.length ?
      String(matchedModule.outcomes[0]).slice(0, 240) : "",
    citedExcerpts,
    verifiedAt: matchedModule.verifiedAt || null,
    verifiedBy: matchedModule.verifiedBy || null,
    matchedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const matchKind = module ? "subtopic_exact" : "topic_only";

  return {ok: true, curriculumRef, matchedModule, matchKind};
}

module.exports = {
  resolveStrictCurriculumRef,
  pickExcerpts,
};
