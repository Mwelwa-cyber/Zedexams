/**
 * Per-class analytics for teachers (audit A10 PR 4).
 *
 * Why a Cloud Function:
 *   - The `results` collection is gated by Firestore rules so a
 *     teacher can only read results for quizzes they created. A
 *     teacher who assigns a published quiz they didn't create
 *     can't read the class's results directly. Admin SDK bypasses
 *     these rules and lets us aggregate.
 *   - Aggregation is read-only and bounded; we want a single
 *     callable that returns the rendered stats so the client
 *     doesn't accidentally do N+1 reads.
 *
 * The function is intentionally pessimistic about read budget:
 *   - Bounded by a 30-day completedAt window (so a long-running
 *     class doesn't grow its read cost over time).
 *   - Bounded to the first 200 learners (= the per-class cap).
 *   - Bounded to the first 25 active assignments (anything older
 *     gets soft-archived in practice).
 *
 * Returns:
 *   {
 *     classId, totalLearners,
 *     summary: {
 *       totalAttempts, activeLearners7d, averagePercentage,
 *       windowDays
 *     },
 *     subjectBreakdown: [{ subject, count, averagePercentage }],
 *     assignments: [{ id, resourceTitle, resourceId,
 *                     assignedAt, completedCount, totalLearners }],
 *     generatedAt
 *   }
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const REGION = "us-central1";
const WINDOW_DAYS = 30;
const ACTIVE_WINDOW_DAYS = 7;
const MAX_LEARNERS_TO_SCAN = 200;
const MAX_ASSIGNMENTS_TO_SCAN = 25;

async function getCallerProfile(db, uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function loadClassOwnedBy(db, classId, uid, isAdmin) {
  const snap = await db.collection("classes").doc(classId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Class not found.");
  const data = snap.data() || {};
  if (!isAdmin && data.teacherUid !== uid) {
    throw new HttpsError("permission-denied", "Only the class owner can read these stats.");
  }
  return {ref: snap.ref, data};
}

async function fetchResultsForLearners(db, learnerUids, sinceTs) {
  // Firestore `in` accepts up to 30 values per query — chunk through.
  const all = [];
  for (let i = 0; i < learnerUids.length; i += 30) {
    const chunk = learnerUids.slice(i, i + 30);
    if (chunk.length === 0) continue;
    try {
      const snap = await db.collection("results")
          .where("userId", "in", chunk)
          .where("completedAt", ">=", sinceTs)
          .get();
      snap.docs.forEach((d) => all.push({id: d.id, ...d.data()}));
    } catch (err) {
      // Composite index missing? Fall back to per-userId reads — slower
      // but always works. We only hit this on first deploy before the
      // composite index propagates.
      console.warn("[classAnalytics] in/where index unavailable, fanning out", err);
      for (const learnerUid of chunk) {
        try {
          const snap = await db.collection("results")
              .where("userId", "==", learnerUid)
              .where("completedAt", ">=", sinceTs)
              .get();
          snap.docs.forEach((d) => all.push({id: d.id, ...d.data()}));
        } catch (err2) {
          console.warn(`[classAnalytics] result fan-out for ${learnerUid} failed`, err2);
        }
      }
    }
  }
  return all;
}

const getClassStats = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const classId = String(request.data?.classId || "").trim();
  if (!classId) throw new HttpsError("invalid-argument", "classId is required.");

  const db = admin.firestore();
  const callerProfile = await getCallerProfile(db, uid);
  const isAdmin = callerProfile?.role === "admin";

  const {data: classData} = await loadClassOwnedBy(db, classId, uid, isAdmin);
  const learners = Array.isArray(classData.learners) ? classData.learners : [];
  const learnerSet = new Set(learners.slice(0, MAX_LEARNERS_TO_SCAN));

  // Window timestamps
  const now = Date.now();
  const sinceWindowMs = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sinceActiveMs = now - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sinceWindowTs = admin.firestore.Timestamp.fromMillis(sinceWindowMs);

  // Pull results for the class members in the window. Empty class → empty stats.
  const results = learners.length > 0
      ? await fetchResultsForLearners(db, [...learnerSet], sinceWindowTs)
      : [];

  let totalAttempts = 0;
  let percentageSum = 0;
  let percentageCount = 0;
  const subjectBuckets = new Map(); // subject → { count, sum }
  const activeLearners = new Set();
  const learnersByQuizId = new Map(); // quizId → Set<userId>

  for (const r of results) {
    totalAttempts += 1;
    const completedAtMs = r.completedAt?.toMillis ? r.completedAt.toMillis() : 0;
    if (completedAtMs >= sinceActiveMs) activeLearners.add(r.userId);

    if (typeof r.percentage === "number" && Number.isFinite(r.percentage)) {
      percentageSum += r.percentage;
      percentageCount += 1;
    }

    if (r.subject) {
      const b = subjectBuckets.get(r.subject) || {count: 0, sum: 0};
      b.count += 1;
      if (typeof r.percentage === "number") b.sum += r.percentage;
      subjectBuckets.set(r.subject, b);
    }

    if (r.quizId && learnerSet.has(r.userId)) {
      const set = learnersByQuizId.get(r.quizId) || new Set();
      set.add(r.userId);
      learnersByQuizId.set(r.quizId, set);
    }
  }

  // Active assignments — bounded scan.
  const assignmentsSnap = await db.collection("assignments")
      .where("classId", "==", classId)
      .where("active", "==", true)
      .orderBy("assignedAt", "desc")
      .limit(MAX_ASSIGNMENTS_TO_SCAN)
      .get()
      .catch((err) => {
        console.warn("[classAnalytics] assignments query failed", err);
        return null;
      });
  const assignments = assignmentsSnap
      ? assignmentsSnap.docs.map((d) => {
        const data = d.data() || {};
        const completed = learnersByQuizId.get(data.resourceId)?.size || 0;
        return {
          id: d.id,
          resourceTitle: data.resourceTitle || "Assigned work",
          resourceId: data.resourceId || null,
          resourceType: data.resourceType || "quiz",
          subject: data.subject || null,
          assignedAtMs: data.assignedAt?.toMillis ? data.assignedAt.toMillis() : null,
          dueAtMs: data.dueAt?.toMillis ? data.dueAt.toMillis() : null,
          completedCount: completed,
          totalLearners: learners.length,
        };
      })
      : [];

  return {
    classId,
    totalLearners: learners.length,
    summary: {
      totalAttempts,
      activeLearners7d: activeLearners.size,
      averagePercentage: percentageCount > 0
          ? Math.round(percentageSum / percentageCount)
          : null,
      windowDays: WINDOW_DAYS,
    },
    subjectBreakdown: [...subjectBuckets.entries()]
        .map(([subject, b]) => ({
          subject,
          count: b.count,
          averagePercentage: b.count > 0 ? Math.round(b.sum / b.count) : null,
        }))
        .sort((a, b) => b.count - a.count),
    assignments,
    generatedAtMs: now,
  };
});

module.exports = {getClassStats};
