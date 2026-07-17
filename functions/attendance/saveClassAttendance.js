/**
 * saveClassAttendance — the ONE server mutation endpoint for Class Register
 * attendance days. Every official write (single mark, mark-all-present,
 * bulk/grid edits, notes, past-date corrections, reopened-register
 * corrections, offline outbox replays) goes through here; Firestore rules
 * deny direct client writes to classRegisters/{classId}/attendance/*.
 *
 * All decisions live in the pure attendanceServerCore (term resolved from
 * the DATE, lock state, teacher assignment, per-record validation,
 * server-recomputed counts, strict version check); this shim only does
 * Firestore I/O inside a transaction and maps failures to HttpsError with a
 * structured { code, ... } details payload the client can render.
 */

const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { assertVerifiedAuth } = require("../authGuard");
const { validateAttendanceMutation, ERROR_CODES } = require("./attendanceServerCore");

const REGION = "us-central1";

// failed-precondition for state problems, invalid-argument for shape problems
// — but the client keys off details.code, not the gRPC status.
const HTTPS_CODE_FOR = {
  [ERROR_CODES.TEACHER_NOT_ASSIGNED]: "permission-denied",
  [ERROR_CODES.INVALID_ARGUMENT]: "invalid-argument",
  [ERROR_CODES.INVALID_ATTENDANCE_STATUS]: "invalid-argument",
  [ERROR_CODES.LEARNER_NOT_IN_CLASS]: "invalid-argument",
};

const saveClassAttendance = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in to mark attendance.");
  const payload = request.data || {};
  const classId = typeof payload.classId === "string" ? payload.classId : "";
  if (!classId || classId.length > 200) {
    throw new HttpsError("invalid-argument", ERROR_CODES.INVALID_ARGUMENT, { code: ERROR_CODES.INVALID_ARGUMENT, field: "classId" });
  }
  if (typeof payload.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    throw new HttpsError("invalid-argument", ERROR_CODES.INVALID_ARGUMENT, { code: ERROR_CODES.INVALID_ARGUMENT, field: "date" });
  }

  const db = admin.firestore();
  const classRef = db.collection("classRegisters").doc(classId);
  const dayRef = classRef.collection("attendance").doc(payload.date);

  // Register / roster / term docs change rarely — read outside the
  // transaction; the day doc (version counter) is re-read inside it.
  const [registerSnap, rosterSnap, termsSnap] = await Promise.all([
    classRef.get(),
    classRef.collection("roster").get(),
    classRef.collection("attendanceTerms").get(),
  ]);
  const register = registerSnap.exists ? registerSnap.data() : null;
  const roster = rosterSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const termDocs = termsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const result = await db.runTransaction(async (tx) => {
    const daySnap = await tx.get(dayRef);
    const existingDay = daySnap.exists ? daySnap.data() : null;

    const verdict = validateAttendanceMutation({
      uid, register, roster, termDocs, payload, existingDay, nowMs: Date.now(),
    });
    if (!verdict.ok) {
      const err = new HttpsError(
          HTTPS_CODE_FOR[verdict.code] || "failed-precondition",
          verdict.code,
          { code: verdict.code, ...verdict.details },
      );
      err._attendanceReject = true;
      throw err;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const records = {};
    for (const [learnerId, record] of Object.entries(verdict.mergedRecords)) {
      const prior = existingDay && existingDay.records ? existingDay.records[learnerId] : null;
      const touched = Object.prototype.hasOwnProperty.call(verdict.sanitizedRecords, learnerId);
      records[learnerId] = {
        status: record.status,
        note: record.note,
        updatedBy: touched || !(prior && prior.updatedBy) ? uid : prior.updatedBy,
        updatedAt: touched || !(prior && prior.updatedAt) ? now : prior.updatedAt,
      };
    }

    tx.set(dayRef, {
      classId,
      teacherUid: register.teacherUid,
      date: payload.date,
      term: (termDocs.find((d) => (d.termId || d.id) === verdict.resolvedTermId) || {}).term || existingDay?.term || "",
      year: (termDocs.find((d) => (d.termId || d.id) === verdict.resolvedTermId) || {}).year || existingDay?.year || Number(verdict.resolvedTermId.slice(0, 4)) || null,
      termId: verdict.resolvedTermId,
      classification: verdict.classification,
      records,
      counts: verdict.counts,
      markedBy: (existingDay && existingDay.markedBy) || uid,
      markedAt: (existingDay && existingDay.markedAt) || now,
      updatedBy: uid,
      updatedAt: now,
      version: verdict.version,
    });

    // Audit entries in the same transaction — a saved change can never miss
    // its trail entry.
    for (const entry of verdict.auditEntries) {
      tx.set(classRef.collection("attendanceAudit").doc(), {
        classId,
        teacherUid: register.teacherUid,
        termId: verdict.resolvedTermId,
        date: payload.date,
        action: verdict.isCorrection ? "correction" : "mark",
        reason: verdict.isCorrection ? verdict.reason : "",
        source: typeof payload.source === "string" ? payload.source.slice(0, 40) : "web",
        learnerId: entry.learnerId,
        prevStatus: entry.prevStatus,
        newStatus: entry.newStatus,
        prevNote: entry.prevNote,
        newNote: entry.newNote,
        uid,
        at: now,
      });
    }

    return { version: verdict.version, counts: verdict.counts, termId: verdict.resolvedTermId, changed: verdict.auditEntries.length };
  });

  return { ok: true, ...result };
});

module.exports = { saveClassAttendance };
