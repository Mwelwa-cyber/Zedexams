/**
 * Node tests for the authoritative attendance mutation validator.
 * Run: npm run test:attendance-server  (also via npm run test:all)
 */

const assert = require("node:assert/strict");
const {
  ERROR_CODES,
  resolveTermFromDate,
  resolveBreakWindow,
  classifyDate,
  validateAttendanceMutation,
  zambiaTodayIso,
} = require("./attendanceServerCore");

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// Fixed clock: 2026-06-15 10:00 CAT (08:00 UTC) — a Monday in Term 2 2026.
const NOW = Date.parse("2026-06-15T08:00:00Z");
const uid = "teacher-1";
const register = { teacherUid: uid, grade: "4", className: "Grade 4 Blue" };
const roster = [
  { id: "a", status: "active" },
  { id: "b", status: "active", joinedClassOn: "2026-07-01" },
  { id: "gone", status: "inactive", leftClassOn: "2026-05-20" },
];
const termDocs = [{ id: "2026-T2", termId: "2026-T2", state: "draft", term: "Term 2", year: 2026 }];

function mutate(overrides = {}) {
  return validateAttendanceMutation({
    uid,
    register,
    roster,
    termDocs,
    payload: {
      classId: "c1",
      date: "2026-06-15",
      termId: "2026-T2",
      baseVersion: 0,
      records: { a: { status: "present", note: "" } },
      ...overrides.payload,
    },
    existingDay: overrides.existingDay ?? null,
    nowMs: NOW,
    ...overrides.top,
  });
}

console.log("attendanceServerCore");

ok("zambiaTodayIso uses CAT (UTC+2), not UTC", () => {
  // 23:30 UTC = 01:30 next day in Zambia.
  assert.equal(zambiaTodayIso(Date.parse("2026-06-15T23:30:00Z")), "2026-06-16");
  assert.equal(zambiaTodayIso(Date.parse("2026-06-15T08:00:00Z")), "2026-06-15");
});

ok("date-to-term resolution comes from the calendar, never the client", () => {
  assert.equal(resolveTermFromDate("2026-06-15", []).termId, "2026-T2");
  assert.equal(resolveTermFromDate("2026-01-15", []).termId, "2026-T1");
  assert.equal(resolveTermFromDate("2027-10-01", []).termId, "2027-T3");
  // Between terms → null
  assert.equal(resolveTermFromDate("2026-08-20", []), null);
  // Beyond the bundled calendar → custom term dates on the term doc resolve
  const custom = [{ id: "2031-T1", termId: "2031-T1", customStartDate: "2031-01-13", customEndDate: "2031-04-11" }];
  assert.equal(resolveTermFromDate("2031-02-10", custom).termId, "2031-T1");
  assert.equal(resolveTermFromDate("2031-02-10", custom).source, "custom");
  assert.equal(resolveTermFromDate("2031-05-01", custom), null);
});

ok("a valid mutation passes and returns server-derived data", () => {
  const v = mutate();
  assert.equal(v.ok, true);
  assert.equal(v.resolvedTermId, "2026-T2");
  assert.equal(v.classification, "teaching_day");
  assert.equal(v.version, 1);
  assert.deepEqual(v.sanitizedRecords, { a: { status: "present", note: "" } });
  assert.deepEqual(v.auditEntries, [{ learnerId: "a", prevStatus: null, newStatus: "present", prevNote: "", newNote: "" }]);
});

ok("forged termId is rejected with TERM_MISMATCH", () => {
  const v = mutate({ payload: { termId: "2026-T1" } });
  assert.equal(v.ok, false);
  assert.equal(v.code, ERROR_CODES.TERM_MISMATCH);
  assert.equal(v.details.resolved, "2026-T2");
});

ok("locked term rejects writes even with a matching termId", () => {
  const locked = [{ id: "2026-T2", termId: "2026-T2", state: "locked" }];
  const v = validateAttendanceMutation({
    uid, register, roster, termDocs: locked, existingDay: null, nowMs: NOW,
    payload: { classId: "c1", date: "2026-06-15", termId: "2026-T2", baseVersion: 0, records: { a: { status: "present" } } },
  });
  assert.equal(v.code, ERROR_CODES.TERM_LOCKED);
  // …and a reopened term accepts them again.
  const reopened = [{ id: "2026-T2", termId: "2026-T2", state: "reopened" }];
  const v2 = validateAttendanceMutation({
    uid, register, roster, termDocs: reopened, existingDay: null, nowMs: NOW,
    payload: { classId: "c1", date: "2026-06-15", termId: "2026-T2", baseVersion: 0, records: { a: { status: "present" } } },
  });
  assert.equal(v2.ok, true);
});

ok("date outside every term is rejected", () => {
  const v = mutate({ payload: { date: "2026-08-20", termId: "2026-T2" } });
  assert.equal(v.code, ERROR_CODES.DATE_OUTSIDE_TERM);
});

ok("non-teaching days are rejected (weekend, holiday, override closure)", () => {
  assert.equal(mutate({ payload: { date: "2026-06-13" } }).code, ERROR_CODES.NON_TEACHING_DAY); // Saturday
  assert.equal(mutate({ payload: { date: "2026-05-25" } }).code, ERROR_CODES.NON_TEACHING_DAY); // Africa Freedom Day
  const closed = [{ id: "2026-T2", termId: "2026-T2", state: "draft", dayOverrides: { "2026-06-15": "school_closure" } }];
  const v = validateAttendanceMutation({
    uid, register, roster, termDocs: closed, existingDay: null, nowMs: NOW,
    payload: { classId: "c1", date: "2026-06-15", termId: "2026-T2", baseVersion: 0, records: { a: { status: "present" } } },
  });
  assert.equal(v.code, ERROR_CODES.NON_TEACHING_DAY);
});

ok("future dates are rejected", () => {
  const v = mutate({ payload: { date: "2026-06-16" } });
  assert.equal(v.code, ERROR_CODES.FUTURE_DATE);
});

ok("teacher assignment is checked against the stored register", () => {
  const v = validateAttendanceMutation({
    uid: "someone-else", register, roster, termDocs, existingDay: null, nowMs: NOW,
    payload: { classId: "c1", date: "2026-06-15", termId: "2026-T2", baseVersion: 0, records: { a: { status: "present" } } },
  });
  assert.equal(v.code, ERROR_CODES.TEACHER_NOT_ASSIGNED);
  const v2 = mutate({ top: { register: null } });
  assert.equal(v2.code, ERROR_CODES.TEACHER_NOT_ASSIGNED);
});

ok("invalid status inside the records map is rejected", () => {
  const v = mutate({ payload: { records: { a: { status: "holiday" } } } });
  assert.equal(v.code, ERROR_CODES.INVALID_ATTENDANCE_STATUS);
  assert.equal(v.details.learnerId, "a");
});

ok("a learner not on the roster is rejected", () => {
  const v = mutate({ payload: { records: { intruder: { status: "present" } } } });
  assert.equal(v.code, ERROR_CODES.LEARNER_NOT_IN_CLASS);
});

ok("a learner outside their enrolment window is rejected", () => {
  // b joins 1 July — 15 June is before joining.
  assert.equal(mutate({ payload: { records: { b: { status: "present" } } } }).code, ERROR_CODES.LEARNER_NOT_ELIGIBLE);
  // withdrawn learner: rejected after leaving…
  assert.equal(mutate({ payload: { records: { gone: { status: "present" } } } }).code, ERROR_CODES.LEARNER_NOT_ELIGIBLE);
  // …but their history window (12 May ≤ 20 May) stays editable.
  const v = mutate({ payload: { date: "2026-05-12", records: { gone: { status: "absent" } } } });
  assert.equal(v.ok, true);
  assert.equal(v.isCorrection, true);
});

ok("stale versions are rejected with the current version in details", () => {
  const existingDay = { version: 3, records: { a: { status: "present", note: "" } } };
  const v = mutate({ existingDay, payload: { baseVersion: 2 } });
  assert.equal(v.code, ERROR_CODES.STALE_VERSION);
  assert.equal(v.details.currentVersion, 3);
  const v2 = mutate({ existingDay, payload: { baseVersion: 3 } });
  assert.equal(v2.ok, true);
  assert.equal(v2.version, 4);
});

ok("client-supplied counts/metadata are ignored; totals recomputed server-side", () => {
  const existingDay = {
    version: 1,
    counts: { present: 999 }, // forged — must be ignored
    records: { a: { status: "absent", note: "", updatedBy: "x" } },
  };
  const v = mutate({
    existingDay,
    payload: {
      baseVersion: 1,
      counts: { present: 999, absent: 0 }, // forged client totals
      records: { a: { status: "present", note: "", updatedBy: "forged-uid", isTeachingDay: false, extra: 1 } },
    },
  });
  assert.equal(v.ok, true);
  // Unknown/forged fields stripped from the stored record
  assert.deepEqual(v.sanitizedRecords.a, { status: "present", note: "" });
  // Counts derived from merged records + roster eligibility (a eligible, b not yet, gone left)
  assert.equal(v.counts.present, 1);
  assert.equal(v.counts.eligible, 1);
  assert.equal(v.counts.unmarked, 0);
  assert.deepEqual(v.auditEntries, [{ learnerId: "a", prevStatus: "absent", newStatus: "present", prevNote: "", newNote: "" }]);
});

ok("notes are length-capped and non-string notes rejected", () => {
  const long = mutate({ payload: { records: { a: { status: "sick", note: "x".repeat(999) } } } });
  assert.equal(long.ok, true);
  assert.equal(long.sanitizedRecords.a.note.length, 200);
  const bad = mutate({ payload: { records: { a: { status: "sick", note: 42 } } } });
  assert.equal(bad.code, ERROR_CODES.INVALID_ARGUMENT);
});

ok("ECE mid-term break applies only to ECE classes when mode is 'ece'", () => {
  const term = resolveTermFromDate("2026-06-23", []); // inside 2026-T2 ECE mid break (22–26 June)
  const eceDoc = { midTermBreak: { mode: "ece" } };
  assert.deepEqual(resolveBreakWindow({ term, termDoc: eceDoc, isEceClass: true }), { start: "2026-06-22", end: "2026-06-26" });
  assert.equal(resolveBreakWindow({ term, termDoc: eceDoc, isEceClass: false }), null);
  assert.equal(classifyDate({ date: "2026-06-23", term, termDoc: eceDoc, isEceClass: true }), "school_closure");
  assert.equal(classifyDate({ date: "2026-06-23", term, termDoc: eceDoc, isEceClass: false }), "teaching_day");
  // 'general' applies to everyone; 'none'/absent config applies to no one
  assert.equal(classifyDate({ date: "2026-06-23", term, termDoc: { midTermBreak: { mode: "general" } }, isEceClass: false }), "school_closure");
  assert.equal(classifyDate({ date: "2026-06-23", term, termDoc: null, isEceClass: true }), "teaching_day");
  // custom break dates
  const customDoc = { midTermBreak: { mode: "custom", customBreakStart: "2026-06-15", customBreakEnd: "2026-06-16" } };
  assert.equal(classifyDate({ date: "2026-06-15", term, termDoc: customDoc, isEceClass: false }), "school_closure");
});

ok("an ECE-class write inside an enabled ECE break is rejected", () => {
  const eceRegister = { teacherUid: uid, grade: "reception" };
  const docs = [{ id: "2026-T2", termId: "2026-T2", state: "draft", midTermBreak: { mode: "ece" } }];
  const nowInBreak = Date.parse("2026-06-23T08:00:00Z");
  const v = validateAttendanceMutation({
    uid, register: eceRegister, roster, termDocs: docs, existingDay: null, nowMs: nowInBreak,
    payload: { classId: "c1", date: "2026-06-23", termId: "2026-T2", baseVersion: 0, records: { a: { status: "present" } } },
  });
  assert.equal(v.code, ERROR_CODES.NON_TEACHING_DAY);
  // Same date, non-ECE class → allowed.
  const v2 = validateAttendanceMutation({
    uid, register, roster, termDocs: docs, existingDay: null, nowMs: nowInBreak,
    payload: { classId: "c1", date: "2026-06-23", termId: "2026-T2", baseVersion: 0, records: { a: { status: "present" } } },
  });
  assert.equal(v2.ok, true);
});

console.log(`\n${passed} passed, 0 failed`);
