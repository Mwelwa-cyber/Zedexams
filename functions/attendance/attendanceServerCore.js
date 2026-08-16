/**
 * attendanceServerCore — AUTHORITATIVE validation for Class Register
 * attendance mutations. Pure CommonJS (no firebase deps) so
 * functions/attendance/attendanceServer.test.js runs it under plain node.
 *
 * Nothing security-relevant is trusted from the client: the term is resolved
 * server-side from the attendance DATE (never from the submitted termId,
 * which is only cross-checked), the lock state comes from the stored
 * attendanceTerms doc, teacher assignment from the stored register doc,
 * learner eligibility from the stored roster, and daily counts are
 * recomputed here from the merged records. The client's counts, isTeachingDay
 * and lock claims are ignored entirely.
 *
 * The Firestore shim is saveClassAttendance.js; keep all decisions here.
 */

const { MOE_TERM_DATA } = require("./moeTermData");

const VALID_STATUSES = ["present", "absent", "sick", "late", "excused", "not_applicable"];
const NOTE_MAX = 200;
const REASON_MAX = 200;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Grades whose classes follow the ECE calendar (mirror of the ECE band in
// src/shared/schemas/classRegister.js CLASS_REGISTER_GRADE_OPTIONS).
const ECE_GRADES = ["baby", "middle", "reception"];

const ERROR_CODES = {
  TERM_LOCKED: "TERM_LOCKED",
  TERM_MISMATCH: "TERM_MISMATCH",
  DATE_OUTSIDE_TERM: "DATE_OUTSIDE_TERM",
  NON_TEACHING_DAY: "NON_TEACHING_DAY",
  FUTURE_DATE: "FUTURE_DATE",
  TEACHER_NOT_ASSIGNED: "TEACHER_NOT_ASSIGNED",
  INVALID_ATTENDANCE_STATUS: "INVALID_ATTENDANCE_STATUS",
  LEARNER_NOT_IN_CLASS: "LEARNER_NOT_IN_CLASS",
  LEARNER_NOT_ELIGIBLE: "LEARNER_NOT_ELIGIBLE",
  STALE_VERSION: "STALE_VERSION",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
};

function isValidIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function weekdayOf(dateIso) {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay();
}

/** Today's date in Zambia (CAT, UTC+2 — no DST). */
function zambiaTodayIso(nowMs) {
  return new Date(nowMs + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Resolve the term covering `date` from the official MoE windows first, then
 * from teacher-configured custom term dates stored on attendanceTerms docs.
 * The submitted termId plays NO part in resolution.
 * Returns { termId, open, close, holidays, eceMidStart, eceMidEnd, source } | null.
 */
function resolveTermFromDate(date, termDocs) {
  for (const year of Object.keys(MOE_TERM_DATA)) {
    for (const term of MOE_TERM_DATA[year]) {
      if (date >= term.open && date <= term.close) {
        return {
          termId: term.id,
          open: term.open,
          close: term.close,
          holidays: term.holidays,
          eceMidStart: term.eceMidStart,
          eceMidEnd: term.eceMidEnd,
          source: "moe-national",
        };
      }
    }
  }
  for (const doc of termDocs || []) {
    if (
      doc && isValidIsoDate(doc.customStartDate || "") && isValidIsoDate(doc.customEndDate || "") &&
      date >= doc.customStartDate && date <= doc.customEndDate
    ) {
      return {
        termId: doc.termId || doc.id,
        open: doc.customStartDate,
        close: doc.customEndDate,
        holidays: [],
        eceMidStart: null,
        eceMidEnd: null,
        source: "custom",
      };
    }
  }
  return null;
}

/**
 * The mid-term break window that applies to this class, from the term doc's
 * break config ({ mode: 'none'|'general'|'ece'|'custom', customBreakStart,
 * customBreakEnd }) + whether the class is ECE. Mirrors the client resolver.
 */
function resolveBreakWindow({ term, termDoc, isEceClass }) {
  const config = termDoc && termDoc.midTermBreak ? termDoc.midTermBreak : { mode: "none" };
  const mode = config.mode || "none";
  if (mode === "custom" && isValidIsoDate(config.customBreakStart || "") && isValidIsoDate(config.customBreakEnd || "")) {
    return { start: config.customBreakStart, end: config.customBreakEnd };
  }
  if ((mode === "general" || (mode === "ece" && isEceClass)) && term.eceMidStart && term.eceMidEnd) {
    return { start: term.eceMidStart, end: term.eceMidEnd };
  }
  return null;
}

const MARKABLE_CLASSIFICATIONS = new Set(["teaching_day", "half_day", "optional_attendance_day"]);
const VALID_CLASSIFICATIONS = new Set([
  "teaching_day", "non_teaching_day", "half_day", "school_closure", "optional_attendance_day",
]);

/** Server-side classification of one date (same precedence as the client resolver). */
function classifyDate({ date, term, termDoc, isEceClass }) {
  const override = termDoc && termDoc.dayOverrides ? termDoc.dayOverrides[date] : undefined;
  if (override && VALID_CLASSIFICATIONS.has(override)) return override;
  const weekday = weekdayOf(date);
  if (weekday === 0 || weekday === 6) return "non_teaching_day";
  if ((term.holidays || []).some((h) => h.date === date)) return "non_teaching_day";
  const breakWindow = resolveBreakWindow({ term, termDoc, isEceClass });
  if (breakWindow && date >= breakWindow.start && date <= breakWindow.end) return "school_closure";
  return "teaching_day";
}

function fail(code, details) {
  return { ok: false, code, details: details || {} };
}

/**
 * Validate one attendance-day mutation end-to-end.
 *
 * @param {object} input
 *   uid          — authenticated caller
 *   register     — classRegisters/{classId} data (or null)
 *   roster       — [{ id, status, joinedClassOn, leftClassOn, ... }]
 *   termDocs     — attendanceTerms docs for the class ([{ id, termId, state,
 *                  dayOverrides, midTermBreak, customStartDate/EndDate }])
 *   payload      — { classId, date, termId, baseVersion, records, reason }
 *   existingDay  — current attendance/{date} data (or null)
 *   nowMs        — clock (injected for tests)
 *
 * @returns {ok:true, resolvedTermId, classification, sanitizedRecords,
 *           mergedRecords, counts, version, auditEntries} | {ok:false, code, details}
 */
function validateAttendanceMutation({ uid, register, roster, termDocs, payload, existingDay, nowMs }) {
  if (!payload || typeof payload !== "object") return fail(ERROR_CODES.INVALID_ARGUMENT, { field: "payload" });
  const { date, termId, records, reason } = payload;

  // ── teacher assignment (never trusted from the client) ──────────
  if (!register) return fail(ERROR_CODES.TEACHER_NOT_ASSIGNED, { reason: "register_not_found" });
  if (register.teacherUid !== uid) return fail(ERROR_CODES.TEACHER_NOT_ASSIGNED, {});

  // ── shape ────────────────────────────────────────────────────────
  if (!isValidIsoDate(date)) return fail(ERROR_CODES.INVALID_ARGUMENT, { field: "date" });
  if (!records || typeof records !== "object" || Array.isArray(records) || Object.keys(records).length === 0) {
    return fail(ERROR_CODES.INVALID_ARGUMENT, { field: "records" });
  }
  if (Object.keys(records).length > 500) return fail(ERROR_CODES.INVALID_ARGUMENT, { field: "records", reason: "too_many" });
  if (reason != null && typeof reason !== "string") return fail(ERROR_CODES.INVALID_ARGUMENT, { field: "reason" });

  // ── term resolved from the DATE; submitted termId only cross-checked ──
  const term = resolveTermFromDate(date, termDocs);
  if (!term) return fail(ERROR_CODES.DATE_OUTSIDE_TERM, { date });
  if (termId !== term.termId) {
    return fail(ERROR_CODES.TERM_MISMATCH, { submitted: termId ?? null, resolved: term.termId });
  }

  // ── lock state from the stored term doc ─────────────────────────
  const termDoc = (termDocs || []).find((d) => (d.termId || d.id) === term.termId) || null;
  const state = termDoc && termDoc.state ? termDoc.state : "draft";
  if (!["draft", "submitted", "reopened"].includes(state)) {
    return fail(ERROR_CODES.TERM_LOCKED, { state });
  }

  // ── eligible attendance day ──────────────────────────────────────
  const todayIso = zambiaTodayIso(typeof nowMs === "number" ? nowMs : Date.now());
  if (date > todayIso) return fail(ERROR_CODES.FUTURE_DATE, { date, today: todayIso });
  const isEceClass = ECE_GRADES.includes(register.grade);
  const classification = classifyDate({ date, term, termDoc, isEceClass });
  if (!MARKABLE_CLASSIFICATIONS.has(classification)) {
    return fail(ERROR_CODES.NON_TEACHING_DAY, { classification });
  }

  // ── concurrency: strict server-managed version ───────────────────
  const currentVersion = existingDay && Number.isInteger(existingDay.version) ? existingDay.version : 0;
  const baseVersion = Number.isInteger(payload.baseVersion) ? payload.baseVersion : -1;
  if (baseVersion !== currentVersion) {
    return fail(ERROR_CODES.STALE_VERSION, { currentVersion, submitted: payload.baseVersion ?? null });
  }

  // ── per-record validation against the stored roster ─────────────
  const rosterById = new Map((roster || []).map((l) => [l.id, l]));
  const sanitizedRecords = {};
  for (const [learnerId, record] of Object.entries(records)) {
    const learner = rosterById.get(learnerId);
    if (!learner) return fail(ERROR_CODES.LEARNER_NOT_IN_CLASS, { learnerId });
    // Enrolment window: later of term open / joined → earlier of term close /
    // left. Withdrawn/transferred learners stay editable ONLY inside it.
    let windowStart = term.open;
    let windowEnd = term.close;
    if (learner.joinedClassOn && isValidIsoDate(learner.joinedClassOn) && learner.joinedClassOn > windowStart) windowStart = learner.joinedClassOn;
    if (learner.leftClassOn && isValidIsoDate(learner.leftClassOn) && learner.leftClassOn < windowEnd) windowEnd = learner.leftClassOn;
    if (date < windowStart || date > windowEnd) {
      return fail(ERROR_CODES.LEARNER_NOT_ELIGIBLE, { learnerId, windowStart, windowEnd });
    }
    if (!record || typeof record !== "object" || !VALID_STATUSES.includes(record.status)) {
      return fail(ERROR_CODES.INVALID_ATTENDANCE_STATUS, { learnerId, status: record && record.status });
    }
    if (record.note != null && typeof record.note !== "string") {
      return fail(ERROR_CODES.INVALID_ARGUMENT, { learnerId, field: "note" });
    }
    // Unknown fields are stripped; updatedBy/updatedAt are stamped by the
    // server, never accepted from the client.
    sanitizedRecords[learnerId] = {
      status: record.status,
      note: typeof record.note === "string" ? record.note.slice(0, NOTE_MAX) : "",
    };
  }

  // ── merge onto the existing day + recompute counts server-side ──
  const existingPlain = {};
  for (const [learnerId, record] of Object.entries((existingDay && existingDay.records) || {})) {
    if (record && VALID_STATUSES.includes(record.status)) {
      existingPlain[learnerId] = { status: record.status, note: typeof record.note === "string" ? record.note.slice(0, NOTE_MAX) : "" };
    }
  }
  const mergedRecords = { ...existingPlain, ...sanitizedRecords };

  const counts = { present: 0, absent: 0, sick: 0, late: 0, excused: 0, not_applicable: 0, marked: 0, unmarked: 0, eligible: 0 };
  for (const record of Object.values(mergedRecords)) {
    counts[record.status] += 1;
    counts.marked += 1;
  }
  // Eligible learners ON THIS DATE, from the stored roster — client totals
  // are never trusted (any counts in the payload are simply ignored).
  for (const learner of roster || []) {
    let ws = term.open;
    let we = term.close;
    if (learner.joinedClassOn && isValidIsoDate(learner.joinedClassOn) && learner.joinedClassOn > ws) ws = learner.joinedClassOn;
    if (learner.leftClassOn && isValidIsoDate(learner.leftClassOn) && learner.leftClassOn < we) we = learner.leftClassOn;
    if (date >= ws && date <= we) counts.eligible += 1;
  }
  counts.unmarked = Math.max(0, counts.eligible - counts.marked);

  // ── audit entries for exactly what changed ───────────────────────
  const auditEntries = [];
  for (const learnerId of Object.keys(sanitizedRecords)) {
    const prev = existingPlain[learnerId] || null;
    const next = sanitizedRecords[learnerId];
    if (prev && prev.status === next.status && prev.note === next.note) continue;
    auditEntries.push({
      learnerId,
      prevStatus: prev ? prev.status : null,
      newStatus: next.status,
      prevNote: prev ? prev.note : "",
      newNote: next.note,
    });
  }

  return {
    ok: true,
    resolvedTermId: term.termId,
    termSource: term.source,
    classification,
    isCorrection: date < todayIso,
    reason: typeof reason === "string" ? reason.slice(0, REASON_MAX) : "",
    sanitizedRecords,
    mergedRecords,
    counts,
    version: currentVersion + 1,
    auditEntries,
  };
}

module.exports = {
  ERROR_CODES,
  VALID_STATUSES,
  NOTE_MAX,
  ECE_GRADES,
  isValidIsoDate,
  zambiaTodayIso,
  resolveTermFromDate,
  resolveBreakWindow,
  classifyDate,
  validateAttendanceMutation,
};
