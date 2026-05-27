/**
 * expandKbLessons — admin-only maintenance callable.
 *
 * Writes lessons/{subtopicSlug}-t{1|2|3} subcollection docs for every
 * topic in a KB version without changing the active-version pointer.
 * This is the "re-expand" path for versions that were activated before
 * the lesson-expansion logic existed in activateSyllabusVersion.
 *
 * Input:
 *   { version?: string,   // defaults to active version
 *     grade?:   string,   // optional: scope to a single grade
 *     subject?: string,   // optional: scope to a single subject
 *     dryRun?:  boolean } // default false — set true to count only
 *
 * Output:
 *   { ok, version, topicsScanned, lessonsWritten, skipped, dryRun }
 *
 * Safety:
 *   - Defaults to dryRun=false (this is a safe idempotent write —
 *     set() with merge:true never deletes existing richer content).
 *   - Hard cap of 3000 topic docs to stay inside the timeout budget.
 *     Narrow by grade/subject if you have more.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {
  getActiveKbVersion,
  normalizeGrade,
  normalizeSubject,
} = require("./cbcKnowledge");
const {buildModuleId} = require("./curriculumModuleSchema");

const MAX_TOPICS = 3000;
const BATCH_WRITE_LIMIT = 480;

function makeBatchWriter(db) {
  let batch = db.batch();
  let count = 0;
  let totalWrites = 0;

  const flush = async () => {
    if (count === 0) return;
    await batch.commit();
    batch = db.batch();
    count = 0;
  };

  const set = async (ref, data, opts) => {
    if (count >= BATCH_WRITE_LIMIT) await flush();
    batch.set(ref, data, opts || {});
    count++;
    totalWrites++;
  };

  const finish = async () => { await flush(); return totalWrites; };

  return {set, finish};
}

function subtopicName(s) {
  if (s == null) return "";
  if (typeof s === "string") return s.trim();
  if (typeof s === "object" && typeof s.name === "string") return s.name.trim();
  return "";
}

async function expandTopicLessons({topicId, topicData, topicsCol, writer, now, dryRun}) {
  const subs = Array.isArray(topicData.subtopics) ? topicData.subtopics : [];
  const competencies = Array.isArray(topicData.keyCompetencies) ?
    topicData.keyCompetencies.filter((s) => typeof s === "string" && s.trim()) :
    (Array.isArray(topicData.competencies) ?
      topicData.competencies.filter((s) => typeof s === "string" && s.trim()) : []);

  let written = 0;
  for (const sub of subs) {
    const name = subtopicName(sub);
    if (!name || name === "(unnamed sub-topic)") continue;

    const specificCompetence = typeof sub === "object" && typeof sub.specificCompetence === "string" ?
      sub.specificCompetence.trim() : "";
    const learningActivities = typeof sub === "object" && Array.isArray(sub.learningActivities) ?
      sub.learningActivities.filter((s) => typeof s === "string" && s.trim()) : [];
    const expectedStandard = typeof sub === "object" && typeof sub.expectedStandard === "string" ?
      sub.expectedStandard.trim() : "";

    const hasContent = specificCompetence || learningActivities.length || expectedStandard ||
      competencies.length;
    if (!hasContent) continue;

    const outcomes = specificCompetence ? [specificCompetence] : [];
    const assessmentCriteria = expectedStandard ? [expectedStandard] : [];
    const contentSummary = specificCompetence || expectedStandard ||
      (learningActivities.length ? learningActivities[0] : "");

    const lessonBase = {
      schemaVersion: "1.0",
      grade: topicData.grade || "",
      subject: topicData.subject || "",
      topic: topicData.topic || "",
      subtopic: name,
      suggestedLessons: 2,
      outcomes,
      competencies,
      vocabulary: [],
      contentSummary,
      teacherActivities: [],
      learnerActivities,
      teachingMaterials: [],
      assessmentCriteria,
      exercises: [],
      remedialActivities: [],
      extensionActivities: [],
      sourceDocId: topicData.sourceDocId || "",
      sourceStoragePath: topicData.sourceStoragePath || "",
      verifiedAt: now,
      verifiedBy: "expand_kb_lessons",
      origin: "expand_kb_lessons",
      updatedAt: now,
    };

    for (const term of [1, 2, 3]) {
      const moduleId = buildModuleId(name, term);
      if (!moduleId) continue;
      if (!dryRun) {
        const lessonRef = topicsCol.doc(topicId).collection("lessons").doc(moduleId);
        await writer.set(lessonRef, {...lessonBase, term}, {merge: true});
      }
      written++;
    }
  }
  return written;
}

exports.expandKbLessons = onCall(
    {timeoutSeconds: 540, memory: "512MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
      const role = await getUserRole(uid);
      if (role !== "admin" && role !== "superAdmin") {
        throw new HttpsError("permission-denied", "Admin only.");
      }

      const data = (request && request.data) || {};
      const dryRun = data.dryRun === true;
      const gradeFilter = typeof data.grade === "string" && data.grade ?
        normalizeGrade(data.grade) : null;
      const subjectFilter = typeof data.subject === "string" && data.subject ?
        normalizeSubject(data.subject) : null;

      const db = admin.firestore();
      const version = (typeof data.version === "string" && data.version) ||
        await getActiveKbVersion();

      const topicsCol = db.collection("cbcKnowledgeBase").doc(version).collection("topics");
      const writer = makeBatchWriter(db);
      const now = admin.firestore.FieldValue.serverTimestamp();

      let topicsScanned = 0;
      let lessonsWritten = 0;
      let skipped = 0;

      let pageStart = null;
      let morePages = true;
      const PAGE_SIZE = 200;

      /* eslint-disable no-await-in-loop */
      while (morePages) {
        let q = topicsCol.orderBy("__name__").limit(PAGE_SIZE);
        if (pageStart) q = q.startAfter(pageStart);
        const page = await q.get();
        if (page.empty) { morePages = false; break; }

        for (const docSnap of page.docs) {
          if (topicsScanned >= MAX_TOPICS) { morePages = false; break; }
          topicsScanned++;

          const topicData = docSnap.data() || {};
          if (gradeFilter && normalizeGrade(topicData.grade) !== gradeFilter) {
            skipped++;
            continue;
          }
          if (subjectFilter && normalizeSubject(topicData.subject) !== subjectFilter) {
            skipped++;
            continue;
          }

          lessonsWritten += await expandTopicLessons({
            topicId: docSnap.id,
            topicData,
            topicsCol,
            writer,
            now,
            dryRun,
          });
        }

        if (page.docs.length < PAGE_SIZE) morePages = false;
        else pageStart = page.docs[page.docs.length - 1];
      }
      /* eslint-enable no-await-in-loop */

      if (!dryRun) await writer.finish();

      return {
        ok: true,
        version,
        topicsScanned,
        lessonsWritten,
        skipped,
        dryRun,
      };
    },
);
