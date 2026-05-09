/**
 * Teacher classroom roster — server-side flows (audit A10).
 *
 * Three callables:
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
 *       the learner's uid into classes/{classId}.learners via admin
 *       SDK so a tampered client can't add someone else.
 *     - Returns { classId, name, teacherDisplayName }.
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
  if (learners.includes(uid)) {
    return {
      classId: classRef.id,
      name: classData.name || "Class",
      alreadyMember: true,
    };
  }
  if (learners.length >= MAX_LEARNERS_PER_CLASS) {
    throw new HttpsError("resource-exhausted", "This class is full. Ask your teacher for help.");
  }

  await classRef.update({
    learners: admin.firestore.FieldValue.arrayUnion(uid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Best-effort lookup of the teacher's display name to surface in
  // the success toast. Falls back gracefully if the read fails.
  let teacherDisplayName = "your teacher";
  try {
    const teacherSnap = await db.collection("users").doc(classData.teacherUid).get();
    teacherDisplayName = teacherSnap.data()?.displayName || teacherDisplayName;
  } catch (err) {
    console.warn("[classManagement] teacher displayName lookup failed", err);
  }

  return {
    classId: classRef.id,
    name: classData.name || "Class",
    teacherDisplayName,
    alreadyMember: false,
  };
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
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {ok: true};
});

module.exports = {
  generateClassInvite,
  joinClassByCode,
  removeLearnerFromClass,
};
