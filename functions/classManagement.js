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
 *
 * Pure decision logic (invite codes, roster shaping, eligibility,
 * assignment payload validation) lives in classManagementCore.js —
 * this file keeps only the Firestore/auth I/O and maps each Core
 * `{code, message}` error onto the same HttpsError as before.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const core = require("./classManagementCore");

const REGION = "us-central1";

// Re-throw a Core-returned {code, message} decision as the callable error.
function throwIfError(error) {
  if (error) throw new HttpsError(error.code, error.message);
}

async function mintUniqueCode(db) {
  // Up to ~10 attempts. With a 31-char alphabet over 8 chars
  // (~852 trillion combinations) and a sub-thousand active code
  // population, collision probability is vanishingly small.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = core.randomCode();
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
  throwIfError(core.classOwnershipError(data, requireOwnerUid));
  return {ref, data};
}

const generateClassInvite = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const db = admin.firestore();
  const {ref: classRef, data: classData} = await loadClassOrThrow(
      db, request.data?.classId, uid,
  );

  // Mint a new code first so we can rotate atomically; the previous
  // code (if any) is left in place to be cleaned up after the update
  // succeeds. If cleanup fails, the orphan invite expires naturally.
  const newCode = await mintUniqueCode(db);
  const expiresAt = admin.firestore.Timestamp.fromMillis(
      core.inviteExpiryMs(Date.now()),
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
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const parsedCode = core.parseInviteCode(request.data?.code);
  throwIfError(parsedCode.error);
  const code = parsedCode.code;

  const db = admin.firestore();
  const inviteRef = db.collection("classInvites").doc(code);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "That invite code isn't valid. Check with your teacher.");
  }
  const invite = inviteSnap.data() || {};
  const now = admin.firestore.Timestamp.now();
  if (core.isInviteExpired(invite.expiresAt ? invite.expiresAt.toMillis() : null, now.toMillis())) {
    throw new HttpsError("failed-precondition", "This invite code has expired. Ask your teacher for a new one.");
  }

  const classRef = db.collection("classes").doc(invite.classId);
  const classSnap = await classRef.get();
  if (!classSnap.exists) {
    throw new HttpsError("not-found", "The class behind this code no longer exists.");
  }
  const classData = classSnap.data() || {};

  const decision = core.decideJoinRequest({classData, uid});
  throwIfError(decision.error);

  // Best-effort lookup of the teacher's display name to surface in
  // the success toast. Falls back gracefully if the read fails.
  let teacherDisplayName = "your teacher";
  try {
    const teacherSnap = await db.collection("users").doc(classData.teacherUid).get();
    teacherDisplayName = teacherSnap.data()?.displayName || teacherDisplayName;
  } catch (err) {
    console.warn("[classManagement] teacher displayName lookup failed", err);
  }

  if (decision.outcome === "already-approved") {
    return {
      classId: classRef.id,
      name: classData.name || "Class",
      teacherDisplayName,
      status: "approved",
      alreadyMember: true,
    };
  }
  if (decision.outcome === "already-pending") {
    return {
      classId: classRef.id,
      name: classData.name || "Class",
      teacherDisplayName,
      status: "pending",
      alreadyMember: true,
    };
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
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const args = core.parseClassLearnerArgs(request.data);
  throwIfError(args.error);
  const {classId, learnerUid} = args;

  const db = admin.firestore();
  const {ref: classRef, data: classData} = await loadClassOrThrow(db, classId, uid);

  const decision = core.decideApproval({classData, learnerUid});
  throwIfError(decision.error);

  await classRef.update({
    pendingLearners: admin.firestore.FieldValue.arrayRemove(learnerUid),
    learners: admin.firestore.FieldValue.arrayUnion(learnerUid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Tell the learner they're in (best-effort).
  try {
    const {createNotification} = require("./notifications/createNotification");
    await createNotification({
      uid: learnerUid,
      category: "learning",
      type: "class_approved",
      title: "You've joined a class",
      body: `${String(classData.name || "Your class").slice(0, 120)} approved you. Your assigned work will show up here.`,
      priority: "medium",
      icon: "academic-cap",
      action: {label: "View dashboard", url: "/dashboard"},
      dedupeKey: `class-approved-${classId}`,
      source: "class-management",
    });
  } catch (err) {
    console.warn("[classManagement] approve notification failed", (err && err.message) || err);
  }

  return {ok: true};
});

const declineLearner = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const args = core.parseClassLearnerArgs(request.data);
  throwIfError(args.error);
  const {classId, learnerUid} = args;

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
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const args = core.parseClassLearnerArgs(request.data);
  throwIfError(args.error);
  const {classId, learnerUid} = args;

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
 * Validation (in classManagementCore.parseAssignmentRequest):
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
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  // New optional fields introduced with the redesigned assignment wizard.
  // Stored on the assignment doc so learner-side rendering can honour the
  // teacher's settings (timer, retakes, schedule, etc.) without a second
  // collection. Unknown values fall back to safe defaults.
  const parsed = core.parseAssignmentRequest(request.data, Date.now());
  throwIfError(parsed.error);
  const {classId, resourceType, resourceId, dueAtMs, openAtMs, notifyLearners, learnerUids} = parsed;

  // Idempotency: the wizard mints one key per "Assign" press and resends it on
  // every retry. A double-tap, a callable retry after a dropped response, or a
  // second tab all carry the SAME key, so they resolve one deterministic
  // assignment doc instead of creating N duplicates that fan out N times to
  // every learner. Malformed/absent keys fall back to the legacy random-id
  // path (older clients) — never trust the raw key as a doc id.
  const {deriveIdempotentId} = require("./idempotency");
  const idempotentId = deriveIdempotentId(`assignment:${uid}`, request.data?.idempotencyKey, "a_");

  const db = admin.firestore();

  // Fast idempotent replay: a retry of an already-committed assign returns the
  // existing doc without re-fetching the resource or re-notifying learners.
  if (idempotentId) {
    const prior = await db.collection("assignments").doc(idempotentId).get();
    if (prior.exists) {
      const p = prior.data() || {};
      return {assignmentId: idempotentId, classId: p.classId || classId, resourceTitle: p.resourceTitle || "Assigned work", idempotentReplay: true};
    }
  }

  const {data: classData} = await loadClassOrThrow(db, classId, uid);
  if (classData.active === false) {
    throw new HttpsError("failed-precondition", "Cannot assign work to an archived class.");
  }

  // Resource fetch + permission gate (decision in the Core module).
  let resource;
  let callerIsAdmin = false;
  if (resourceType === "quiz") {
    const quizSnap = await db.collection("quizzes").doc(resourceId).get();
    if (!quizSnap.exists) throw new HttpsError("not-found", "Quiz not found.");
    resource = quizSnap.data() || {};
    callerIsAdmin = (await db.collection("users").doc(uid).get()).data()?.role === "admin";
  } else {
    const examSnap = await db.collection("quizzes").doc(resourceId).get();
    if (!examSnap.exists) throw new HttpsError("not-found", "Exam not found.");
    resource = examSnap.data() || {};
  }
  const resolved = core.resolveAssignmentResource({resourceType, resource, uid, callerIsAdmin, classData});
  throwIfError(resolved.error);
  const resourceTitle = resolved.resourceTitle;

  const dueAt = dueAtMs ? admin.firestore.Timestamp.fromMillis(dueAtMs) : null;
  const openAt = openAtMs ? admin.firestore.Timestamp.fromMillis(openAtMs) : null;
  const isScheduled = core.isScheduledAssignment(openAtMs, Date.now());

  const assignmentDoc = core.buildAssignmentDoc({
    parsed,
    resolved,
    uid,
    dueAt,
    openAt,
    isScheduled,
    assignedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let ref;
  let alreadyExisted = false;
  if (idempotentId) {
    // Deterministic id + transactional create-if-absent closes the window
    // where two concurrent double-taps both passed the fast replay check
    // above: exactly one transaction creates the doc; the other reads it and
    // returns the same assignment without a second create or notification.
    ref = db.collection("assignments").doc(idempotentId);
    alreadyExisted = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return true;
      tx.set(ref, assignmentDoc);
      return false;
    });
  } else {
    ref = await db.collection("assignments").add(assignmentDoc);
  }

  if (alreadyExisted) {
    const p = (await ref.get()).data() || {};
    return {assignmentId: ref.id, classId: p.classId || classId, resourceTitle: p.resourceTitle || resourceTitle, idempotentReplay: true};
  }

  // Notify the targeted learners (best-effort — never block the assignment).
  if (notifyLearners && !isScheduled) {
    const recipients = core.assignmentNotificationRecipients({learnerUids, classData});
    const {createNotification} = require("./notifications/createNotification");
    const label = resourceType === "exam" ? "Open exam" : "Open quiz";
    await Promise.all(
        recipients.map((learnerUid) =>
          createNotification({
            uid: learnerUid,
            category: "assessments",
            type: "assignment_assigned",
            title: "New work from your teacher",
            body: `${String(resourceTitle).slice(0, 120)} has been assigned to you.`,
            priority: "medium",
            icon: "clipboard-check",
            action: {label, url: "/dashboard"},
            dedupeKey: `assignment-${ref.id}`,
            source: "class-assignment",
          }).catch(() => null),
        ),
    );
  }

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
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const assignmentId = String(request.data?.assignmentId || "").trim();
  if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");

  const db = admin.firestore();
  const ref = db.collection("assignments").doc(assignmentId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Assignment not found.");
  const data = snap.data() || {};
  throwIfError(core.assignmentOwnershipError(data, uid));

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
  const uid = await assertVerifiedAuth(request, "Sign in required.");

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
  throwIfError(core.membershipError(data, uid));
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
