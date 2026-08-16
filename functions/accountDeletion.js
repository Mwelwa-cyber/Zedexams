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
//      doc that belongs to someone else (e.g. a shared school licence).
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
  "teacherProfiles", // Teaching Profile (school level, calendar) + teachingAssignments subcollection (LEGAL-004)
  "lessonSeries", // + nested progress subcollections
  "assessmentDrafts",
  "drafts", // Universal Draft Manager — drafts/{uid}/items private in-progress docs (LEGAL-004)
  "schoolProfiles",
  "usageMeters", // + periods subcollection
  "notifications", // + feed subcollection
  "questionBankFavourites", // + items subcollection
  "badges",
  "dailyStreaks",
  "learner_profiles",
  "learnerStats",
  "studyPlanProgress",
  "passkeyUserHandles", // opaque WebAuthn user handle (server-only)
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
  {collection: "teacherLibraryItems", field: "ownerUid"},
  {collection: "agentJobs", field: "createdBy"},
  {collection: "assessments", field: "createdBy", recursive: true}, // + questions
  {collection: "quizzes", field: "createdBy", recursive: true}, // + questions
  {collection: "lessons", field: "createdBy"},
  {collection: "classRegisters", field: "teacherUid", recursive: true}, // + roster, records
  // Passkey (WebAuthn) sign-in: credentials stop authenticating the moment
  // their doc is gone, and the uid-bearing audit rows go with them.
  {collection: "passkeyCredentials", field: "uid"},
  {collection: "passkeyAuditLog", field: "uid"},
  // Teacher-authored / user-owned records the earlier lists missed (LEGAL-004
  // purge-completeness audit). All are server-only-write, so the admin-SDK
  // delete here is the only path that clears them.
  {collection: "visualProjects", field: "ownerId"}, // Visual Studio editable canvas projects
  {collection: "assessmentExports", field: "ownerUid"}, // export cache for the teacher's assessments (also purged)
  {collection: "familyInviteCodes", field: "learnerUid"}, // parent-invite codes minted by the learner
  // Guardian consent links. A row holds the learner's uid AND their guardian's
  // email or phone number, plus the IP/user-agent evidence of the approving
  // click — third-party PII collected because of this account, so it goes when
  // the account goes. Deleting the row also kills any live approval link.
  {collection: "consentRequests", field: "uid"},
  // Guardian-unlock requests. Same shape and the same reason as consentRequests
  // above: the row holds this learner's uid, their guardian's email or phone
  // number, and the evidence (score, weak topic) that was sent to a third party
  // because of this account. Deleting it also kills any live pay link, which is
  // a bearer credential — an expired-in-7-days one, but not one to leave behind
  // for an account that no longer exists.
  {collection: "guardianRequests", field: "uid"},
  // AI content reports filed BY this user. The report carries their uid and a
  // snapshot of what they were shown, so it goes with the account. A report
  // about content someone else saw is not keyed to this uid and is unaffected.
  {collection: "aiContentReports", field: "reporterUid"},
  // Parent↔child link doc (id `${parentUid}_${learnerUid}`): either party's
  // deletion must clear it, so BOTH owner fields are queried.
  {collection: "parentLinks", field: "parentUid"},
  {collection: "parentLinks", field: "learnerUid"},
];

// uid lives inside an array on a doc owned by another user.
const ARRAY_MEMBERSHIP_COLLECTIONS = [
  // Shared school licence roster: remove the departing user's uid rather than
  // deleting the licence, which belongs to the school (LEGAL-004).
  {collection: "schoolLicences", field: "memberUids"},
];

// ── Re-authentication (step-up) gate for the destructive delete ──────────
//
// LEGAL-003: purging an account is IRREVERSIBLE, yet `deleteMyAccount` used
// to accept any live session — a stolen or long-persisted ID token could wipe
// an account with one call. Firebase stamps `auth_time` (seconds since epoch)
// on the ID token with the moment the first factor completed for the current
// session; a client re-authenticates immediately before deleting and
// force-refreshes its token, so a genuine request carries a FRESH auth_time
// while a stale hijacked session does not. This mirrors the recent-login
// step-up already used by the admin MFA reset (resetAdminMfaCore).
//
// The window is deliberately short (default 5 min) and env-tunable. Kept in
// this domain module — with its own decision + tests — rather than shared with
// the admin-MFA window (30 min) because the two have independent semantics.

// How recently the caller must have authenticated to delete their account.
function reauthMaxAgeSeconds() {
  const raw = parseInt(process.env.ACCOUNT_DELETE_REAUTH_MAX_AGE_SECONDS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60;
}

// Seconds since the token's first-factor auth completed. Infinity when the
// claim is absent or malformed, so a token with no auth_time FAILS CLOSED
// (treated as ancient → re-auth required) rather than slipping through.
function authTimeAgeSeconds(token, now = Date.now()) {
  const authTime = token && Number(token.auth_time);
  if (!Number.isFinite(authTime) || authTime <= 0) return Infinity;
  return Math.max(0, Math.floor(now / 1000) - authTime);
}

/**
 * Decide whether a caller's token proves a recent enough sign-in to delete
 * their account. Pure (no I/O) so it unit-tests under plain `node`.
 *
 * @param {object} token  Decoded ID token (request.auth.token).
 * @param {object} [opts]
 * @param {number} [opts.maxAgeSeconds]  Override the freshness window.
 * @param {number} [opts.now]            Injected clock (ms) for tests.
 * @return {{ok: boolean, reason?: string, ageSeconds: number, maxAgeSeconds: number}}
 */
function evaluateDeletionAuth(token, {maxAgeSeconds, now = Date.now()} = {}) {
  const maxAge = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ?
    maxAgeSeconds :
    reauthMaxAgeSeconds();
  if (!token || typeof token !== "object") {
    return {ok: false, reason: "no-auth", ageSeconds: Infinity, maxAgeSeconds: maxAge};
  }
  const ageSeconds = authTimeAgeSeconds(token, now);
  if (ageSeconds > maxAge) {
    return {ok: false, reason: "requires-recent-login", ageSeconds, maxAgeSeconds: maxAge};
  }
  return {ok: true, ageSeconds, maxAgeSeconds: maxAge};
}

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
 * @return {Promise<{uidDocs:number, fieldDocs:number, arrayMemberships:number,
 *   errors:string[], resurrected:boolean, verified:boolean}>}
 */
async function purgeUserData(db, uid, {FieldValue} = {}) {
  if (!uid) throw new Error("uid is required");
  if (!FieldValue) throw new Error("FieldValue dependency is required");

  const summary = {
    uidDocs: 0,
    fieldDocs: 0,
    arrayMemberships: 0,
    errors: [],
    resurrected: false,
    verified: false,
  };

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

  // 4. Verify the one document that carries the PII, instead of assuming the
  //    deletes above stuck.
  //
  //    They demonstrably did not, three times in production: for the 21–25 s
  //    this purge takes, the caller's session was still live, its profile
  //    listener saw users/{uid} vanish, read that as damage, and had
  //    `bootstrapUserProfile` write a fresh profile back — while the purge was
  //    still walking the field queries. The purge had already enumerated its
  //    targets, so it never looked again, and returned `errors: []` over a
  //    document that had been recreated seconds earlier.
  //
  //    The deletion order now closes that window (accountDeletionFlow.js
  //    revokes and deletes the Auth user first), so `resurrected` should stay
  //    false. It is recorded rather than assumed because a resurrection is
  //    exactly the kind of failure that reports success. `verified` is a
  //    SECOND read after the re-delete: it is the only claim the handler is
  //    allowed to return success on, and a read that throws leaves it false —
  //    an unverifiable purge is not a verified one.
  try {
    const userRef = db.collection("users").doc(uid);
    const beforeSnap = await userRef.get();
    if (beforeSnap.exists) {
      summary.resurrected = true;
      await db.recursiveDelete(userRef);
    }
    const afterSnap = await userRef.get();
    summary.verified = !afterSnap.exists;
  } catch (err) {
    summary.errors.push(`verify users/${uid}: ${err.message}`);
    summary.verified = false;
  }

  return summary;
}

module.exports = {
  UID_DOC_COLLECTIONS,
  FIELD_QUERY_COLLECTIONS,
  ARRAY_MEMBERSHIP_COLLECTIONS,
  deleteByQuery,
  purgeUserData,
  reauthMaxAgeSeconds,
  authTimeAgeSeconds,
  evaluateDeletionAuth,
};
