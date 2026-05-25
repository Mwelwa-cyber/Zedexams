/**
 * backfillKbSourceRefs — admin-only one-click linker.
 *
 * Mirrors scripts/backfill-kb-source-refs.mjs as a callable so admins
 * can run it from /admin/learner-ai without a service-account shell.
 *
 * For every doc in
 *   cbcKnowledgeBase/{activeVersion}/topics/{topicId}/lessons/{moduleId}
 * looks up a matching approvedSyllabi entry (by grade+subject, with
 * term as a tiebreak when present) and writes:
 *   sourceDocId         — the approved-syllabus doc id
 *   sourceStoragePath   — its storage path (if any)
 *   verifiedAt          — server timestamp
 *   verifiedBy          — 'admin-backfill'
 *
 * Idempotent: skips modules that already have a sourceDocId.
 *
 * Input:
 *   { dryRun?: boolean = true,
 *     grade?:  string,    // optional: scope to a single grade
 *     subject?: string }  // optional: scope to a single subject
 *
 * Output:
 *   { ok, dryRun, updated, alreadySet, noMatch, totalScanned,
 *     totalSyllabi, kbVersion,
 *     noMatchSamples: [{ path, grade, subject, term }] }
 *
 * Safety:
 *   - Defaults to dryRun=true so a misclick reports rather than writes.
 *   - Hard cap of 4000 lesson modules per invocation to stay inside
 *     the function's memory + timeout budget. If you have more, narrow
 *     by grade/subject or run twice.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {
  invalidateKbCache,
  getActiveKbVersion,
  normalizeGrade,
  normalizeSubject,
} = require("./cbcKnowledge");

const MAX_LESSONS = 4000;
const NO_MATCH_SAMPLE_CAP = 25;

function normTerm(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : null;
}

function syllabusKey(grade, subject) {
  return `${normalizeGrade(grade)}::${normalizeSubject(subject)}`;
}

async function loadSyllabusIndex(db) {
  const snap = await db.collection("approvedSyllabi").get();
  // grade+subject → [{id, storagePath, term}]
  const idx = new Map();
  snap.forEach((d) => {
    const v = d.data() || {};
    const key = syllabusKey(v.grade, v.subject);
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push({
      id: d.id,
      storagePath: v.storagePath || null,
      term: normTerm(v.term),
    });
  });
  return idx;
}

function pickSyllabus(candidates, term) {
  if (!candidates || !candidates.length) return null;
  const t = normTerm(term);
  if (t != null) {
    const exact = candidates.find((c) => c.term === t);
    if (exact) return exact;
  }
  // Term-agnostic (term: null) is the preferred fallback.
  const any = candidates.find((c) => c.term == null);
  return any || candidates[0];
}

exports.backfillKbSourceRefs = onCall(
    {timeoutSeconds: 540, memory: "512MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
      const role = await getUserRole(uid);
      if (role !== "admin") {
        throw new HttpsError("permission-denied", "Admin only.");
      }

      const data = (request && request.data) || {};
      const dryRun = data.dryRun !== false; // default true
      const gradeFilter = typeof data.grade === "string" && data.grade ?
        normalizeGrade(data.grade) : null;
      const subjectFilter = typeof data.subject === "string" && data.subject ?
        normalizeSubject(data.subject) : null;

      const db = admin.firestore();
      const kbVersion = await getActiveKbVersion();
      const idx = await loadSyllabusIndex(db);

      const topicsCol = db.collection("cbcKnowledgeBase")
          .doc(kbVersion).collection("topics");
      const topicsSnap = await topicsCol.get();

      let updated = 0;
      let alreadySet = 0;
      let noMatch = 0;
      let totalScanned = 0;
      const noMatchSamples = [];

      // Firestore batched writes max at 500 ops per batch.
      const BATCH_SIZE = 400;
      let batch = db.batch();
      let inBatch = 0;
      const flush = async () => {
        if (inBatch === 0) return;
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      };

      outer:
      for (const topicDoc of topicsSnap.docs) {
        const lessonsSnap = await topicDoc.ref.collection("lessons").get();
        for (const lessonDoc of lessonsSnap.docs) {
          if (totalScanned >= MAX_LESSONS) break outer;
          totalScanned += 1;
          const lesson = lessonDoc.data() || {};

          if (gradeFilter && normalizeGrade(lesson.grade) !== gradeFilter) continue;
          if (subjectFilter && normalizeSubject(lesson.subject) !== subjectFilter) continue;

          if (lesson.sourceDocId) { alreadySet += 1; continue; }

          const pick = pickSyllabus(
              idx.get(syllabusKey(lesson.grade, lesson.subject)),
              lesson.term,
          );
          if (!pick) {
            noMatch += 1;
            if (noMatchSamples.length < NO_MATCH_SAMPLE_CAP) {
              noMatchSamples.push({
                path: lessonDoc.ref.path,
                grade: String(lesson.grade || ""),
                subject: String(lesson.subject || ""),
                term: lesson.term ?? null,
              });
            }
            continue;
          }

          updated += 1;
          if (dryRun) continue;

          batch.set(lessonDoc.ref, {
            sourceDocId: pick.id,
            sourceStoragePath: pick.storagePath || null,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            verifiedBy: "admin-backfill",
          }, {merge: true});
          inBatch += 1;
          if (inBatch >= BATCH_SIZE) await flush();
        }
      }
      if (!dryRun) await flush();

      // Drop the in-process resolver caches so the next preflight reads
      // the freshly-linked sourceDocId values rather than the stale set.
      if (!dryRun) {
        try { invalidateKbCache(); } catch { /* best effort */ }
      }

      return {
        ok: true,
        dryRun,
        updated,
        alreadySet,
        noMatch,
        totalScanned,
        totalSyllabi: Array.from(idx.values()).reduce((n, arr) => n + arr.length, 0),
        kbVersion,
        noMatchSamples,
      };
    },
);

// Exported for unit tests so the matching logic can be exercised without
// loading firebase-admin / firebase-functions. Internal use only.
exports.__test = {
  pickSyllabus,
  syllabusKey,
  normTerm,
};
