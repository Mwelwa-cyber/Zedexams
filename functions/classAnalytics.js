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

/**
 * Per-assignment drill-down for teachers (audit A10 PR 5).
 *
 * Returns a roster of every class member with their completion
 * status for one specific assignment + their best score so far.
 * Teachers use this to see "who hasn't started" before a due date
 * and to congratulate the early finishers.
 *
 * Why a Cloud Function:
 *   - results reads are gated to (a) row owner, (b) admins, (c)
 *     the teacher who CREATED the underlying quiz. A teacher who
 *     assigns a published quiz they didn't create can't read
 *     class member results directly.
 *   - users/{uid} reads are self+admin only. Display names need
 *     admin SDK to be visible to a teacher viewing their own class.
 *   - Bundling everything server-side is one round trip vs. 200+
 *     parallel reads from the client.
 *
 * Bounded reads:
 *   - 200-learner cap (= the per-class cap from PR 1).
 *   - For each learner: results.where(userId == uid, quizId == X)
 *     in chunks of 30 (Firestore `in` cap).
 *   - 30-day completedAt window so re-running on a long-lived
 *     class doesn't grow read cost over time.
 */
const getAssignmentCompletion = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const assignmentId = String(request.data?.assignmentId || "").trim();
  if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");

  const db = admin.firestore();
  const callerProfile = await getCallerProfile(db, uid);
  const isAdmin = callerProfile?.role === "admin";

  const assignmentSnap = await db.collection("assignments").doc(assignmentId).get();
  if (!assignmentSnap.exists) throw new HttpsError("not-found", "Assignment not found.");
  const assignment = assignmentSnap.data() || {};
  if (!isAdmin && assignment.teacherUid !== uid) {
    throw new HttpsError("permission-denied", "Only the assigning teacher can read this.");
  }

  const classSnap = await db.collection("classes").doc(assignment.classId).get();
  if (!classSnap.exists) throw new HttpsError("not-found", "Class not found.");
  const classData = classSnap.data() || {};
  const learners = (Array.isArray(classData.learners) ? classData.learners : [])
      .slice(0, MAX_LEARNERS_TO_SCAN);

  // results filtered to (a) any of these learners, (b) this quizId,
  // (c) inside the 30-day window. Chunk the `in` clause through 30
  // uids at a time and collect the first-pass shape: { uid → best }.
  const sinceWindowMs = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sinceWindowTs = admin.firestore.Timestamp.fromMillis(sinceWindowMs);
  const bestByUid = new Map(); // uid → { percentage, score, attempts, lastAttemptAtMs }

  for (let i = 0; i < learners.length; i += 30) {
    const chunk = learners.slice(i, i + 30);
    if (chunk.length === 0) continue;
    try {
      const snap = await db.collection("results")
          .where("userId", "in", chunk)
          .where("quizId", "==", assignment.resourceId)
          .where("completedAt", ">=", sinceWindowTs)
          .get();
      for (const doc of snap.docs) {
        const r = doc.data() || {};
        const learnerUid = r.userId;
        if (!learnerUid) continue;
        const completedMs = r.completedAt?.toMillis ? r.completedAt.toMillis() : 0;
        const cur = bestByUid.get(learnerUid) || {
          percentage: null, score: null, attempts: 0, lastAttemptAtMs: 0,
        };
        cur.attempts += 1;
        if (typeof r.percentage === "number" && (cur.percentage == null || r.percentage > cur.percentage)) {
          cur.percentage = r.percentage;
          cur.score = typeof r.score === "number" ? r.score : null;
        }
        if (completedMs > cur.lastAttemptAtMs) {
          cur.lastAttemptAtMs = completedMs;
        }
        bestByUid.set(learnerUid, cur);
      }
    } catch (err) {
      console.warn("[classAnalytics] results in-clause failed; falling back", err);
      for (const learnerUid of chunk) {
        try {
          const snap = await db.collection("results")
              .where("userId", "==", learnerUid)
              .where("quizId", "==", assignment.resourceId)
              .where("completedAt", ">=", sinceWindowTs)
              .get();
          for (const doc of snap.docs) {
            const r = doc.data() || {};
            const completedMs = r.completedAt?.toMillis ? r.completedAt.toMillis() : 0;
            const cur = bestByUid.get(learnerUid) || {
              percentage: null, score: null, attempts: 0, lastAttemptAtMs: 0,
            };
            cur.attempts += 1;
            if (typeof r.percentage === "number" && (cur.percentage == null || r.percentage > cur.percentage)) {
              cur.percentage = r.percentage;
              cur.score = typeof r.score === "number" ? r.score : null;
            }
            if (completedMs > cur.lastAttemptAtMs) {
              cur.lastAttemptAtMs = completedMs;
            }
            bestByUid.set(learnerUid, cur);
          }
        } catch (innerErr) {
          console.warn(`[classAnalytics] result fan-out for ${learnerUid} failed`, innerErr);
        }
      }
    }
  }

  // Resolve display names + emails for each learner. Admin SDK
  // bypasses the self-only user read rule.
  const profileByUid = new Map();
  for (let i = 0; i < learners.length; i += 10) {
    const chunk = learners.slice(i, i + 10);
    if (chunk.length === 0) continue;
    try {
      const snap = await db.collection("users")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
      for (const doc of snap.docs) {
        const data = doc.data() || {};
        profileByUid.set(doc.id, {
          displayName: data.displayName || "",
          email: data.email || "",
        });
      }
    } catch (err) {
      console.warn("[classAnalytics] user fan-in failed", err);
    }
  }

  const learnerRows = learners.map((learnerUid) => {
    const profile = profileByUid.get(learnerUid) || {displayName: "", email: ""};
    const best = bestByUid.get(learnerUid);
    return {
      uid: learnerUid,
      displayName: profile.displayName,
      email: profile.email,
      status: best ? "completed" : "not_started",
      bestPercentage: best?.percentage ?? null,
      bestScore: best?.score ?? null,
      attempts: best?.attempts ?? 0,
      lastAttemptAtMs: best?.lastAttemptAtMs || null,
    };
  });

  // Sort: completed first (highest percentage), then not-started
  // (alphabetised by display name so the teacher can scan).
  learnerRows.sort((a, b) => {
    if (a.status === b.status) {
      if (a.status === "completed") {
        return (b.bestPercentage ?? -1) - (a.bestPercentage ?? -1);
      }
      return (a.displayName || a.uid).localeCompare(b.displayName || b.uid);
    }
    return a.status === "completed" ? -1 : 1;
  });

  return {
    assignment: {
      id: assignmentId,
      resourceId: assignment.resourceId || null,
      resourceTitle: assignment.resourceTitle || "Assigned work",
      resourceType: assignment.resourceType || "quiz",
      classId: assignment.classId || null,
      dueAtMs: assignment.dueAt?.toMillis ? assignment.dueAt.toMillis() : null,
      assignedAtMs: assignment.assignedAt?.toMillis ? assignment.assignedAt.toMillis() : null,
    },
    totalLearners: learners.length,
    completedCount: learnerRows.filter((r) => r.status === "completed").length,
    learners: learnerRows,
  };
});

module.exports = {getClassStats, getAssignmentCompletion};
