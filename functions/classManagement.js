/**
 * Teacher classroom roster — server-side flows (audit A10).
 *
 * Callables:
 *
 *   generateClassInvite({ classId })
 *     - Owner-only. Rotates the previous code (if any), mints a fresh
 *       code unique across active classInvites/*, persists it both
 *       inline on the class doc and as a classInvites/{code} doc with
 *       a 30-day TTL.
 *     - Returns { inviteCode, classId, expiresAt }.
 *
 *   joinClassByCode({ code })
 *     - Any signed-in learner. Resolves the code, validates that the
 *       class is active and under the 200-learner cap, then writes
 *       the learner's uid into classes/{classId}.pendingLearners via
 *       admin SDK so a tampered client can't add someone else. The
 *       teacher must then approve via approveLearner before the
 *       learner is moved into the live `learners` roster.
 *     - Returns { classId, name, teacherDisplayName, status }.
 *
 *   approveLearner({ classId, learnerUid })
 *     - Owner-only. Moves a learner uid from pendingLearners → learners.
 *
 *   declineLearner({ classId, learnerUid })
 *     - Owner-only. Removes a learner uid from pendingLearners (no
 *       move to learners). The learner can re-join later if the
 *       teacher shares the code again.
 *
 *   removeLearnerFromClass({ classId, learnerUid })
 *     - Owner-only. Removes a learner from the roster. Mostly a
 *       convenience wrapper — direct arrayRemove from the client is
 *       allowed by the Firestore rules, but the callable centralises
 *       audit logging if/when we add it.
 *
 * Rules-side invariants:
 *   - classes.update is teacher-owner-only. The join flow MUST go
 *     through this function (admin SDK bypasses the rule). Same for
 *     mints — mints would otherwise need a "the teacher is rotating
 *     their own code" rule that's annoying to express.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const REGION = "us-central1";
const INVITE_CODE_LENGTH = 8;
const MAX_LEARNERS_PER_CLASS = 200;
const INVITE_TTL_DAYS = 30;

// Avoid 0/O and 1/I/L ambiguity — codes get spoken aloud / written
// on whiteboards during onboarding sessions.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode() {
  const bytes = require("node:crypto").randomBytes(INVITE_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

async function mintUniqueCode(db) {
  // Up to ~10 attempts. With a 31-char alphabet over 8 chars
  // (~852 trillion combinations) and a sub-thousand active code
  // population, collision probability is vanishingly small.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomCode();
    const snap = await db.collection("classInvites").doc(code).get();
    if (!snap.exists) return code;
  }
  throw new HttpsError("internal", "Could not mint a unique invite code. Please try again.");
}

async function loadClassOrThrow(db, classId, requireOwnerUid) {
  if (!classId) throw new HttpsError("invalid-argument", "classId is required.");
  const ref = db.collection("classes").doc(classId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Class not found.");
  const data = snap.data() || {};
  if (requireOwnerUid && data.teacherUid !== requireOwnerUid) {
    throw new HttpsError("permission-denied", "Only the class owner can do that.");
  }
  return {ref, data};
}

const generateClassInvite = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const db = admin.firestore();
  const {ref: classRef, data: classData} = await loadClassOrThrow(
      db, request.data?.classId, uid,
  );

  // Mint a new code first so we can rotate atomically; the previous
  // code (if any) is left in place to be cleaned up after the update
  // succeeds. If cleanup fails, the orphan invite expires naturally.
  const newCode = await mintUniqueCode(db);
  const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const previousCode = classData.inviteCode || null;

  await db.collection("classInvites").doc(newCode).set({
    code: newCode,
    classId: classRef.id,
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });
  await classRef.update({
    inviteCode: newCode,
    inviteExpiresAt: expiresAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  if (previousCode && previousCode !== newCode) {
    await db.collection("classInvites").doc(previousCode).delete()
        .catch((err) => console.warn("[classManagement] cleanup of previous invite failed", err));
  }

  return {
    inviteCode: newCode,
    classId: classRef.id,
    expiresAt: expiresAt.toMillis(),
  };
});

const joinClassByCode = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const code = String(request.data?.code || "").trim().toUpperCase();
  if (!code || code.length < 6 || code.length > 16) {
    throw new HttpsError("invalid-argument", "Enter a valid invite code.");
  }

  const db = admin.firestore();
  const inviteRef = db.collection("classInvites").doc(code);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "That invite code isn't valid. Check with your teacher.");
  }
  const invite = inviteSnap.data() || {};
  const now = admin.firestore.Timestamp.now();
  if (invite.expiresAt && invite.expiresAt.toMillis() < now.toMillis()) {
    throw new HttpsError("failed-precondition", "This invite code has expired. Ask your teacher for a new one.");
  }

  const classRef = db.collection("classes").doc(invite.classId);
  const classSnap = await classRef.get();
  if (!classSnap.exists) {
    throw new HttpsError("not-found", "The class behind this code no longer exists.");
  }
  const classData = classSnap.data() || {};
  if (classData.active === false) {
    throw new HttpsError("failed-precondition", "This class is no longer active.");
  }

  const learners = Array.isArray(classData.learners) ? classData.learners : [];
  const pendingLearners = Array.isArray(classData.pendingLearners) ? classData.pendingLearners : [];

  // Best-effort lookup of the teacher's display name to surface in
  // the success toast. Falls back gracefully if the read fails.
  let teacherDisplayName = "your teacher";
  try {
    const teacherSnap = await db.collection("users").doc(classData.teacherUid).get();
    teacherDisplayName = teacherSnap.data()?.displayName || teacherDisplayName;
  } catch (err) {
    console.warn("[classManagement] teacher displayName lookup failed", err);
  }

  if (learners.includes(uid)) {
    return {
      classId: classRef.id,
      name: classData.name || "Class",
      teacherDisplayName,
      status: "approved",
      alreadyMember: true,
    };
  }
  if (pendingLearners.includes(uid)) {
    return {
      classId: classRef.id,
      name: classData.name || "Class",
      teacherDisplayName,
      status: "pending",
      alreadyMember: true,
    };
  }
  if (learners.length + pendingLearners.length >= MAX_LEARNERS_PER_CLASS) {
    throw new HttpsError("resource-exhausted", "This class is full. Ask your teacher for help.");
  }

  await classRef.update({
    pendingLearners: admin.firestore.FieldValue.arrayUnion(uid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    classId: classRef.id,
    name: classData.name || "Class",
    teacherDisplayName,
    status: "pending",
    alreadyMember: false,
  };
});

const approveLearner = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const classId = String(request.data?.classId || "").trim();
  const learnerUid = String(request.data?.learnerUid || "").trim();
  if (!classId || !learnerUid) {
    throw new HttpsError("invalid-argument", "classId and learnerUid are required.");
  }

  const db = admin.firestore();
  const {ref: classRef, data: classData} = await loadClassOrThrow(db, classId, uid);
  const pendingLearners = Array.isArray(classData.pendingLearners) ? classData.pendingLearners : [];
  const learners = Array.isArray(classData.learners) ? classData.learners : [];

  if (!pendingLearners.includes(learnerUid)) {
    throw new HttpsError("failed-precondition", "That learner is not awaiting approval.");
  }
  if (learners.length >= MAX_LEARNERS_PER_CLASS) {
    throw new HttpsError("resource-exhausted", "This class is full. Remove an inactive learner before approving another.");
  }

  await classRef.update({
    pendingLearners: admin.firestore.FieldValue.arrayRemove(learnerUid),
    learners: admin.firestore.FieldValue.arrayUnion(learnerUid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {ok: true};
});

const declineLearner = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const classId = String(request.data?.classId || "").trim();
  const learnerUid = String(request.data?.learnerUid || "").trim();
  if (!classId || !learnerUid) {
    throw new HttpsError("invalid-argument", "classId and learnerUid are required.");
  }

  const db = admin.firestore();
  const {ref: classRef} = await loadClassOrThrow(db, classId, uid);
  await classRef.update({
    pendingLearners: admin.firestore.FieldValue.arrayRemove(learnerUid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {ok: true};
});

const removeLearnerFromClass = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const classId = String(request.data?.classId || "").trim();
  const learnerUid = String(request.data?.learnerUid || "").trim();
  if (!classId || !learnerUid) {
    throw new HttpsError("invalid-argument", "classId and learnerUid are required.");
  }

  const db = admin.firestore();
  const {ref: classRef} = await loadClassOrThrow(db, classId, uid);
  await classRef.update({
    learners: admin.firestore.FieldValue.arrayRemove(learnerUid),
    pendingLearners: admin.firestore.FieldValue.arrayRemove(learnerUid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {ok: true};
});

/**
 * Teacher creates an assignment that points one resource (quiz or
 * daily exam) at one of their classes.
 *
 * Why a Cloud Function instead of a direct client write:
 *   - We need to verify the caller actually owns the class before
 *     letting them mint an assignment under that classId. Doing that
 *     in Firestore rules would require a `get()` per write — slow.
 *   - We denormalise the resource title / subject / grade onto the
 *     assignment doc so the learner side can render the card without
 *     a second Firestore read per row. The function does that fetch
 *     once.
 *
 * Validation:
 *   - classId required; class must exist, be active, and be owned by
 *     the caller.
 *   - resourceType ∈ {'quiz', 'exam'}; resourceId required.
 *   - For quizzes: must be published OR the caller must be admin /
 *     the quiz creator (drafts can be assigned by their author).
 *   - dueAt optional; must be in the future if present.
 */
const createClassAssignment = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const classId = String(request.data?.classId || "").trim();
  const resourceType = String(request.data?.resourceType || "").trim();
  const resourceId = String(request.data?.resourceId || "").trim();
  const dueAtMs = Number(request.data?.dueAtMs || 0) || null;
  const openAtMs = Number(request.data?.openAtMs || 0) || null;

  // New optional fields introduced with the redesigned assignment wizard.
  // Stored on the assignment doc so learner-side rendering can honour the
  // teacher's settings (timer, retakes, schedule, etc.) without a second
  // collection. Unknown values fall back to safe defaults.
  const ALLOWED_MODES = ["automatic", "manual"];
  const assignmentMode = ALLOWED_MODES.includes(request.data?.assignmentMode)
    ? request.data.assignmentMode
    : "manual";
  const timed = Boolean(request.data?.timed);
  const allowRetakes = Boolean(request.data?.allowRetakes);
  const shuffleQuestions = Boolean(request.data?.shuffleQuestions);
  const lockAfterSubmission = Boolean(request.data?.lockAfterSubmission);
  const notifyLearners = request.data?.notifyLearners === false ? false : true;
  const addToDailyChallenge = Boolean(request.data?.addToDailyChallenge);
  const template = typeof request.data?.template === "string"
    ? request.data.template.slice(0, 40)
    : null;
  const learnerUidsRaw = Array.isArray(request.data?.learnerUids)
    ? request.data.learnerUids
    : null;
  const learnerUids = learnerUidsRaw
    ? learnerUidsRaw
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter((u) => u && u.length <= 200)
        .slice(0, 200)
    : null;

  if (!classId) throw new HttpsError("invalid-argument", "classId is required.");
  if (!["quiz", "exam"].includes(resourceType)) {
    throw new HttpsError("invalid-argument", "resourceType must be 'quiz' or 'exam'.");
  }
  if (!resourceId) throw new HttpsError("invalid-argument", "resourceId is required.");
  if (dueAtMs && dueAtMs < Date.now() - 60000) {
    throw new HttpsError("invalid-argument", "Due date must be in the future.");
  }
  if (openAtMs && dueAtMs && openAtMs > dueAtMs) {
    throw new HttpsError("invalid-argument", "Open date must be before the due date.");
  }

  const db = admin.firestore();
  const {data: classData} = await loadClassOrThrow(db, classId, uid);
  if (classData.active === false) {
    throw new HttpsError("failed-precondition", "Cannot assign work to an archived class.");
  }

  // Resource fetch + permission gate
  let resourceTitle = "Assigned work";
  let resourceSubject = classData.subject || null;
  let resourceGrade = classData.grade || null;
  if (resourceType === "quiz") {
    const quizSnap = await db.collection("quizzes").doc(resourceId).get();
    if (!quizSnap.exists) throw new HttpsError("not-found", "Quiz not found.");
    const quiz = quizSnap.data() || {};
    const callerIsCreator = quiz.createdBy === uid;
    const callerIsAdmin = (await db.collection("users").doc(uid).get()).data()?.role === "admin";
    if (!quiz.isPublished && !callerIsCreator && !callerIsAdmin) {
      throw new HttpsError("permission-denied", "You can only assign published quizzes or your own drafts.");
    }
    resourceTitle = quiz.title || resourceTitle;
    if (quiz.subject) resourceSubject = quiz.subject;
    if (quiz.grade) resourceGrade = String(quiz.grade);
  } else {
    // 'exam' — daily exam quiz docs share the quizzes collection but
    // are flagged with quizType == 'daily_exam'. Treat the same.
    const examSnap = await db.collection("quizzes").doc(resourceId).get();
    if (!examSnap.exists) throw new HttpsError("not-found", "Exam not found.");
    const exam = examSnap.data() || {};
    if (exam.quizType !== "daily_exam") {
      throw new HttpsError("invalid-argument", "That is not a daily exam.");
    }
    resourceTitle = exam.title || resourceTitle;
    if (exam.subject) resourceSubject = exam.subject;
    if (exam.grade) resourceGrade = String(exam.grade);
  }

  const dueAt = dueAtMs ? admin.firestore.Timestamp.fromMillis(dueAtMs) : null;
  const openAt = openAtMs ? admin.firestore.Timestamp.fromMillis(openAtMs) : null;
  // Treat a future openAt as a "scheduled" assignment for status badges;
  // learner-side rendering hides locked assignments until openAt passes.
  const isScheduled = openAt && openAt.toMillis() > Date.now() + 60000;

  const ref = await db.collection("assignments").add({
    classId,
    teacherUid: uid,
    resourceType,
    resourceId,
    resourceTitle: String(resourceTitle).slice(0, 200),
    subject: resourceSubject,
    grade: resourceGrade,
    dueAt,
    openAt,
    active: true,
    status: isScheduled ? "scheduled" : "active",
    assignmentMode,
    template,
    settings: {
      timed,
      allowRetakes,
      shuffleQuestions,
      lockAfterSubmission,
      notifyLearners,
      addToDailyChallenge,
    },
    learnerUids: learnerUids && learnerUids.length > 0 ? learnerUids : null,
    assignedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    assignmentId: ref.id,
    classId,
    resourceTitle,
  };
});

/**
 * Teacher unassigns work — soft-delete via active=false. Hard delete
 * is reserved for admin (mirror of how class archive vs. delete works).
 */
const removeClassAssignment = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const assignmentId = String(request.data?.assignmentId || "").trim();
  if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");

  const db = admin.firestore();
  const ref = db.collection("assignments").doc(assignmentId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Assignment not found.");
  const data = snap.data() || {};
  if (data.teacherUid !== uid) {
    throw new HttpsError("permission-denied", "Only the assigning teacher can remove it.");
  }

  await ref.update({
    active: false,
    deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {ok: true};
});

const leaveClass = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const classId = String(request.data?.classId || "").trim();
  if (!classId) throw new HttpsError("invalid-argument", "classId is required.");

  // No owner check — a learner self-removing is the whole point. We
  // do require they actually be a member, otherwise the call is a
  // no-op-but-counted abuse vector against the daily quota.
  const db = admin.firestore();
  const classRef = db.collection("classes").doc(classId);
  const snap = await classRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Class not found.");
  const data = snap.data() || {};
  const learners = Array.isArray(data.learners) ? data.learners : [];
  const pendingLearners = Array.isArray(data.pendingLearners) ? data.pendingLearners : [];
  if (!learners.includes(uid) && !pendingLearners.includes(uid)) {
    throw new HttpsError("failed-precondition", "You are not a member of this class.");
  }
  await classRef.update({
    learners: admin.firestore.FieldValue.arrayRemove(uid),
    pendingLearners: admin.firestore.FieldValue.arrayRemove(uid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {ok: true};
});

module.exports = {
  generateClassInvite,
  joinClassByCode,
  approveLearner,
  declineLearner,
  removeLearnerFromClass,
  leaveClass,
  createClassAssignment,
  removeClassAssignment,
};
