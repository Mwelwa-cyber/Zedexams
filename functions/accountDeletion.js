"use strict";

// Account-deletion data purge.
//
// Powers the `deleteMyAccount` callable (see functions/index.js). When a
// learner / teacher / parent asks to delete their account, Google Play's
// "Data deletion" policy requires that we remove their personal data — not
// just disable sign-in. This module owns the Firestore side of that purge;
// the callable deletes the Firebase Auth user afterwards.
//
// The three shapes of user-owned data (mapped against firestore.rules):
//
//   1. UID_DOC_COLLECTIONS       — the document id IS the user's uid.
//      Deleted with recursiveDelete so any subcollections go too.
//
//   2. FIELD_QUERY_COLLECTIONS   — a field on the doc holds the uid.
//      Queried and deleted. Entries flagged `recursive` have their own
//      subcollections (e.g. quizzes/{id}/questions) and are removed with
//      recursiveDelete per match.
//
//   3. ARRAY_MEMBERSHIP_COLLECTIONS — the uid appears inside an array on a
//      doc that belongs to someone else (a teacher's class / assignment).
//      We arrayRemove the uid rather than deleting the whole doc.
//
// Design notes:
//   • Best-effort per collection: one failing collection is recorded in
//     summary.errors and does not abort the rest of the purge. The account
//     owner's PII home (users/{uid}) and the Auth user are the two things
//     that MUST go for compliance; both are attempted regardless.
//   • The lists are the single source of truth. Keep them in sync with
//     firestore.rules when a new user-scoped collection is added.

// Document-id === uid. recursiveDelete removes the doc and all
// subcollections under it (e.g. teacherLibraries/{uid}/items).
const UID_DOC_COLLECTIONS = [
  "users", // profile + all PII (email, name, phone, fcmTokens)
  "teacherLibraries", // + items, folders subcollections
  "lessonSeries", // + nested progress subcollections
  "assessmentDrafts",
  "schoolProfiles",
  "usageMeters", // + periods subcollection
  "notifications", // + feed subcollection
  "questionBankFavourites", // + items subcollection
  "badges",
  "dailyStreaks",
  "learner_profiles",
  "learnerStats",
  "studyPlanProgress",
];

// A field on the doc holds the uid. `recursive: true` for collections whose
// docs own subcollections that must be cascaded.
const FIELD_QUERY_COLLECTIONS = [
  {collection: "exam_attempts", field: "userId"},
  {collection: "daily_exam_locks", field: "userId"},
  {collection: "results", field: "userId"},
  {collection: "payments", field: "userId"},
  {collection: "invoices", field: "userId"},
  {collection: "paperAttempts", field: "userId"},
  {collection: "subscriptionEvents", field: "uid"},
  {collection: "feedback", field: "uid"},
  {collection: "noteProgress", field: "uid"},
  {collection: "flashcardProgress", field: "uid"},
  {collection: "referralCodes", field: "uid"},
  {collection: "referralRedemptions", field: "refereeUid"},
  {collection: "progressShares", field: "learnerUid"},
  {collection: "parentDigestEvents", field: "learnerUid"},
  {collection: "learnerProgress", field: "learnerUid"},
  {collection: "learnerWeaknessProfiles", field: "learnerId"},
  {collection: "aiAgentTasks", field: "learnerId"},
  {collection: "lessonPlans", field: "teacherId"},
  {collection: "lessonProgress", field: "teacherId"},
  {collection: "questionBank", field: "ownerId"},
  {collection: "shares", field: "ownerUid"},
  {collection: "generatedContent", field: "ownerUid"},
  {collection: "aiGenerations", field: "ownerUid"},
  {collection: "agentJobs", field: "createdBy"},
  {collection: "assessments", field: "createdBy", recursive: true}, // + questions
  {collection: "quizzes", field: "createdBy", recursive: true}, // + questions
  {collection: "lessons", field: "createdBy"},
  {collection: "classes", field: "teacherUid"},
  {collection: "classRegisters", field: "teacherUid", recursive: true}, // + roster, records
  {collection: "assignments", field: "teacherUid"},
];

// uid lives inside an array on a doc owned by another user.
const ARRAY_MEMBERSHIP_COLLECTIONS = [
  {collection: "classes", field: "learners"},
  {collection: "classes", field: "pendingLearners"},
  {collection: "assignments", field: "learnerUids"},
];

// Delete every doc matching a query, paging so we never hold an unbounded
// result set in memory. Returns the number of docs deleted.
async function deleteByQuery(db, baseQuery, {recursive = false, pageSize = 300} = {}) {
  let total = 0;
  for (;;) {
    const snap = await baseQuery.limit(pageSize).get();
    if (snap.empty) break;
    if (recursive) {
      // Cascade subcollections — one recursiveDelete per matched doc.
      for (const d of snap.docs) {
        await db.recursiveDelete(d.ref);
      }
    } else {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    total += snap.size;
    if (snap.size < pageSize) break;
  }
  return total;
}

/**
 * Purge every trace of `uid` from Firestore.
 *
 * @param {FirebaseFirestore.Firestore} db  Admin Firestore instance.
 * @param {string} uid                      The user being deleted.
 * @param {object} deps
 * @param {object} deps.FieldValue          admin.firestore.FieldValue.
 * @return {Promise<{uidDocs:number, fieldDocs:number, arrayMemberships:number, errors:string[]}>}
 */
async function purgeUserData(db, uid, {FieldValue} = {}) {
  if (!uid) throw new Error("uid is required");
  if (!FieldValue) throw new Error("FieldValue dependency is required");

  const summary = {uidDocs: 0, fieldDocs: 0, arrayMemberships: 0, errors: []};

  // 1. Docs keyed by uid (+ their subcollections).
  for (const col of UID_DOC_COLLECTIONS) {
    try {
      await db.recursiveDelete(db.collection(col).doc(uid));
      summary.uidDocs += 1;
    } catch (err) {
      summary.errors.push(`${col}/${uid}: ${err.message}`);
    }
  }

  // 2. Docs referencing uid via a field.
  for (const {collection, field, recursive} of FIELD_QUERY_COLLECTIONS) {
    try {
      const q = db.collection(collection).where(field, "==", uid);
      summary.fieldDocs += await deleteByQuery(db, q, {recursive: !!recursive});
    } catch (err) {
      summary.errors.push(`${collection}.${field}: ${err.message}`);
    }
  }

  // 3. Array memberships on other users' docs.
  for (const {collection, field} of ARRAY_MEMBERSHIP_COLLECTIONS) {
    try {
      const snap = await db
        .collection(collection)
        .where(field, "array-contains", uid)
        .get();
      for (const d of snap.docs) {
        await d.ref.update({[field]: FieldValue.arrayRemove(uid)});
        summary.arrayMemberships += 1;
      }
    } catch (err) {
      summary.errors.push(`${collection}.${field}[]: ${err.message}`);
    }
  }

  return summary;
}

module.exports = {
  UID_DOC_COLLECTIONS,
  FIELD_QUERY_COLLECTIONS,
  ARRAY_MEMBERSHIP_COLLECTIONS,
  deleteByQuery,
  purgeUserData,
};
