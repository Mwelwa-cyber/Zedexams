/**
 * Scheme-of-Work timetable awareness.
 *
 * A teacher can attach one of their saved Class Timetables (the artifact the
 * Class Timetable Studio writes to aiGenerations with tool="class_timetable").
 * We use it to make pacing realistic: how many periods/week the subject
 * actually gets, and which days it lands on. The client sends a trimmed copy;
 * this module sanitises it and summarises it for the chosen subject.
 *
 * Pure + DOM-free + Firestore-free → unit-tested by
 * functions/teacherTools/schemeTimetable.test.js.
 */

/** Recommended weekly periods for a subject, mirroring the Class Timetable
 * Studio's defaultPeriodsPerWeek() (src/shared/utils/classTimetable.js). Keyed on
 * either the canonical subject slug or a human label so either side resolves
 * to the same number. Core subjects carry the heaviest load. */
function recommendedPeriodsPerWeek(subject, label = "") {
  const s = `${String(subject || "")} ${String(label || "")}`.toLowerCase();
  if (/math|numeracy/.test(s)) return 6;
  if (/english|literacy|language/.test(s)) return 6;
  if (/science/.test(s)) return 5;
  if (/social|history|geograph|civic|religious/.test(s)) return 4;
  return 3;
}

/** Slugify a subject label the way the canonical subject keys read. */
function slugSubject(value) {
  return String(value || "").toLowerCase().replace(/[^a-z]/g, "_")
      .replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/** Do a timetable subject label and a scheme subject slug refer to the same
 * subject? Tolerant: exact slug match, or shared significant token
 * ("Integrated Science" ↔ "integrated_science", "Science" ↔ "science"). */
function subjectMatches(timetableLabel, schemeSubject) {
  const a = slugSubject(timetableLabel);
  const b = slugSubject(schemeSubject);
  if (!a || !b) return false;
  if (a === b) return true;
  const at = new Set(a.split("_").filter(Boolean));
  const bt = b.split("_").filter(Boolean);
  // Match when every token of the shorter side is present in the longer.
  const [shortTokens, longSet] = bt.length <= at.size ?
    [bt, at] : [Array.from(at), new Set(b.split("_"))];
  return shortTokens.length > 0 && shortTokens.every((t) => longSet.has(t));
}

const MAX_DAYS = 7;
const MAX_SUBJECTS = 40;
const MAX_PERIODS = 16;

/**
 * Reduce a (possibly client-supplied) timetable artifact down to the fields we
 * trust: subjects (label + periodsPerWeek), teaching days, and the slot grid.
 * Returns null for anything unusable so callers can treat "no timetable" and
 * "junk timetable" identically.
 */
function sanitizeTimetableInput(raw) {
  if (!raw || typeof raw !== "object") return null;
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/^@/g, "").trim().slice(0, max) : "");
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const days = (Array.isArray(raw.days) ? raw.days : [])
      .map((d) => str(d, 16)).filter(Boolean).slice(0, MAX_DAYS);

  const subjects = (Array.isArray(raw.subjects) ? raw.subjects : [])
      .map((s) => ({
        label: str(s && s.label, 60),
        periodsPerWeek: Math.min(MAX_PERIODS * MAX_DAYS,
            Math.max(0, Math.round(num(s && s.periodsPerWeek)))),
      }))
      .filter((s) => s.label)
      .slice(0, MAX_SUBJECTS);

  const slots = {};
  const rawSlots = (raw.slots && typeof raw.slots === "object") ? raw.slots : {};
  let pidCount = 0;
  for (const [pid, row] of Object.entries(rawSlots)) {
    if (pidCount >= MAX_PERIODS) break;
    if (!row || typeof row !== "object") continue;
    const cleanPid = str(pid, 16);
    if (!cleanPid) continue;
    const cleanRow = {};
    for (const [day, cell] of Object.entries(row)) {
      const d = str(day, 16);
      // A cell may be a plain label string or a {subjectLabel} object.
      const label = typeof cell === "string" ?
        str(cell, 60) :
        (cell && typeof cell === "object" ?
          str(cell.subjectLabel || cell.label, 60) : "");
      if (d && label) cleanRow[d] = label;
    }
    if (Object.keys(cleanRow).length) {
      slots[cleanPid] = cleanRow;
      pidCount += 1;
    }
  }

  if (subjects.length === 0 && Object.keys(slots).length === 0) return null;

  const header = raw.header && typeof raw.header === "object" ? {
    grade: str(raw.header.grade, 10),
    className: str(raw.header.className, 60),
    term: str(raw.header.term != null ? String(raw.header.term) : "", 8),
  } : {};

  return {header, days, subjects, slots};
}

/**
 * Summarise what a sanitised timetable says about ONE subject.
 *
 * @returns {{found:boolean, periods:number, days:string[]}}
 *   found   — the subject appears in the timetable at all
 *   periods — periods/week (counted from the slot grid, falling back to the
 *             subjects[] allocation)
 *   days    — distinct teaching days the subject lands on, in grid order
 */
function summarizeTimetableForSubject(timetable, schemeSubject) {
  if (!timetable) return {found: false, periods: 0, days: []};

  // Count placed cells in the grid (the real picture of the week).
  const daySet = [];
  let placed = 0;
  for (const row of Object.values(timetable.slots || {})) {
    for (const [day, label] of Object.entries(row || {})) {
      if (subjectMatches(label, schemeSubject)) {
        placed += 1;
        if (!daySet.includes(day)) daySet.push(day);
      }
    }
  }

  // Fall back to the declared allocation when the grid is empty/unfilled.
  let allocated = 0;
  for (const s of timetable.subjects || []) {
    if (subjectMatches(s.label, schemeSubject)) {
      allocated += Number(s.periodsPerWeek) || 0;
    }
  }

  const periods = placed > 0 ? placed : allocated;
  const found = placed > 0 || allocated > 0;
  // Order the days like the school week when the grid order is incomplete.
  const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
    "Saturday", "Sunday"];
  const days = daySet.slice().sort((a, b) => WEEK.indexOf(a) - WEEK.indexOf(b));
  return {found, periods, days};
}

module.exports = {
  recommendedPeriodsPerWeek,
  slugSubject,
  subjectMatches,
  sanitizeTimetableInput,
  summarizeTimetableForSubject,
};
