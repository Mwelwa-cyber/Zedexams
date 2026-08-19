// ─────────────────────────────────────────────────────────────────────────────
// moeCalendar.js
// Shared MoE Zambia School Calendar 2026–2030
// Used by: TeacherCalendar, LearnerCalendar,
//          SchemeOfWork, WeeklyForecast, ZedStudyAssistant
// ─────────────────────────────────────────────────────────────────────────────

export const MOE_CALENDAR = {
  2026: {
    terms: [
      {
        id: "2026-T1",
        name: "First Term",
        number: 1,
        open: "2026-01-12",
        close: "2026-04-10",
        eceMidStart: "2026-02-23",
        eceMidEnd: "2026-02-27",
        workingDays: 61,
        residentDays: 89,
        holidayLength: 30,
        holidays: [
          { name: "New Year's Day",     date: "2026-01-01" },
          { name: "Women's Day",        date: "2026-03-08" },
          { name: "Youth Day",          date: "2026-03-12" },
          { name: "Good Friday",        date: "2026-04-03" },
          { name: "Holy Saturday",      date: "2026-04-04" },
          { name: "Easter Monday",      date: "2026-04-06" },
          { name: "Kenneth Kaunda Day", date: "2026-04-28" },
          { name: "Labour Day",         date: "2026-05-01" },
        ],
      },
      {
        id: "2026-T2",
        name: "Second Term",
        number: 2,
        open: "2026-05-11",
        close: "2026-08-07",
        eceMidStart: "2026-06-22",
        eceMidEnd: "2026-06-26",
        workingDays: 61,
        residentDays: 89,
        holidayLength: 30,
        holidays: [
          { name: "Africa Freedom Day", date: "2026-05-25" },
          { name: "Heroes Day",         date: "2026-07-06" },
          { name: "Unity Day",          date: "2026-07-07" },
          { name: "Farmers' Day",       date: "2026-08-03" },
        ],
      },
      {
        id: "2026-T3",
        name: "Third Term",
        number: 3,
        open: "2026-09-07",
        close: "2026-12-04",
        eceMidStart: "2026-10-19",
        eceMidEnd: "2026-10-23",
        workingDays: 63,
        residentDays: 89,
        holidayLength: 37,
        holidays: [
          { name: "Teachers' Day",       date: "2026-10-05" },
          { name: "National Prayers Day",date: "2026-10-18" },
          { name: "Independence Day",    date: "2026-10-24" },
          { name: "Christmas Day",       date: "2026-12-25" },
        ],
      },
    ],
  },
  2027: {
    terms: [
      {
        id: "2027-T1", name: "First Term", number: 1,
        open: "2027-01-11", close: "2027-04-09",
        eceMidStart: "2027-02-22", eceMidEnd: "2027-02-26",
        workingDays: 61, residentDays: 89, holidayLength: 30,
        holidays: [
          { name: "New Year's Day",     date: "2027-01-01" },
          { name: "Women's Day",        date: "2027-03-08" },
          { name: "Good Friday",        date: "2027-03-26" },
          { name: "Holy Saturday",      date: "2027-03-27" },
          { name: "Easter Monday",      date: "2027-03-29" },
          { name: "Kenneth Kaunda Day", date: "2027-04-28" },
          { name: "Labour Day",         date: "2027-05-01" },
        ],
      },
      {
        id: "2027-T2", name: "Second Term", number: 2,
        open: "2027-05-10", close: "2027-08-06",
        eceMidStart: "2027-06-21", eceMidEnd: "2027-06-25",
        workingDays: 61, residentDays: 89, holidayLength: 30,
        holidays: [
          { name: "Africa Freedom Day", date: "2027-05-25" },
          { name: "Heroes Day",         date: "2027-07-05" },
          { name: "Unity Day",          date: "2027-07-06" },
          { name: "Farmers' Day",       date: "2027-08-02" },
        ],
      },
      {
        id: "2027-T3", name: "Third Term", number: 3,
        open: "2027-09-06", close: "2027-12-03",
        eceMidStart: "2027-10-18", eceMidEnd: "2027-10-22",
        workingDays: 62, residentDays: 89, holidayLength: 37,
        holidays: [
          { name: "Teachers' Day",        date: "2027-10-05" },
          { name: "National Prayers Day", date: "2027-10-18" },
          { name: "Independence Day",     date: "2027-10-24" },
          { name: "Christmas Day",        date: "2027-12-25" },
        ],
      },
    ],
  },
  2028: {
    terms: [
      {
        id: "2028-T1", name: "First Term", number: 1,
        open: "2028-01-10", close: "2028-04-07",
        eceMidStart: "2028-02-21", eceMidEnd: "2028-02-25",
        workingDays: 63, residentDays: 89, holidayLength: 30,
        holidays: [
          { name: "New Year's Day",     date: "2028-01-01" },
          { name: "Women's Day",        date: "2028-03-08" },
          { name: "Good Friday",        date: "2028-04-14" },
          { name: "Holy Saturday",      date: "2028-04-15" },
          { name: "Easter Monday",      date: "2028-04-17" },
          { name: "Kenneth Kaunda Day", date: "2028-04-28" },
          { name: "Labour Day",         date: "2028-05-01" },
        ],
      },
      {
        id: "2028-T2", name: "Second Term", number: 2,
        open: "2028-05-08", close: "2028-08-04",
        eceMidStart: "2028-06-19", eceMidEnd: "2028-06-23",
        workingDays: 62, residentDays: 89, holidayLength: 30,
        holidays: [
          { name: "Africa Freedom Day", date: "2028-05-25" },
          { name: "Heroes Day",         date: "2028-07-03" },
          { name: "Unity Day",          date: "2028-07-04" },
          { name: "Farmers' Day",       date: "2028-08-07" },
        ],
      },
      {
        id: "2028-T3", name: "Third Term", number: 3,
        open: "2028-09-04", close: "2028-12-01",
        eceMidStart: "2028-10-16", eceMidEnd: "2028-10-20",
        workingDays: 62, residentDays: 89, holidayLength: 37,
        holidays: [
          { name: "Teachers' Day",        date: "2028-10-05" },
          { name: "National Prayers Day", date: "2028-10-18" },
          { name: "Independence Day",     date: "2028-10-24" },
          { name: "Christmas Day",        date: "2028-12-25" },
        ],
      },
    ],
  },
  2029: {
    terms: [
      {
        id: "2029-T1", name: "First Term", number: 1,
        open: "2029-01-08", close: "2029-04-06",
        eceMidStart: "2029-02-19", eceMidEnd: "2029-02-23",
        workingDays: 61, residentDays: 89, holidayLength: 30,
        holidays: [
          { name: "New Year's Day",     date: "2029-01-01" },
          { name: "Women's Day",        date: "2029-03-08" },
          { name: "Good Friday",        date: "2029-03-30" },
          { name: "Holy Saturday",      date: "2029-03-31" },
          { name: "Easter Monday",      date: "2029-04-02" },
          { name: "Kenneth Kaunda Day", date: "2029-04-28" },
          { name: "Labour Day",         date: "2029-05-01" },
        ],
      },
      {
        id: "2029-T2", name: "Second Term", number: 2,
        open: "2029-05-07", close: "2029-08-03",
        eceMidStart: "2029-06-18", eceMidEnd: "2029-06-22",
        workingDays: 62, residentDays: 89, holidayLength: 30,
        holidays: [
          { name: "Africa Freedom Day", date: "2029-05-25" },
          { name: "Heroes Day",         date: "2029-07-02" },
          { name: "Unity Day",          date: "2029-07-03" },
          { name: "Farmers' Day",       date: "2029-08-06" },
        ],
      },
      {
        id: "2029-T3", name: "Third Term", number: 3,
        open: "2029-09-03", close: "2029-11-30",
        eceMidStart: "2029-10-15", eceMidEnd: "2029-10-19",
        workingDays: 62, residentDays: 89, holidayLength: 44,
        holidays: [
          { name: "Teachers' Day",        date: "2029-10-05" },
          { name: "National Prayers Day", date: "2029-10-18" },
          { name: "Independence Day",     date: "2029-10-24" },
          { name: "Christmas Day",        date: "2029-12-25" },
        ],
      },
    ],
  },
  2030: {
    terms: [
      {
        id: "2030-T1", name: "First Term", number: 1,
        open: "2030-01-14", close: "2030-04-12",
        eceMidStart: "2030-02-18", eceMidEnd: "2030-02-22",
        workingDays: 63, residentDays: 89, holidayLength: 30,
        holidays: [
          { name: "New Year's Day",     date: "2030-01-01" },
          { name: "Women's Day",        date: "2030-03-08" },
          { name: "Good Friday",        date: "2030-04-19" },
          { name: "Holy Saturday",      date: "2030-04-20" },
          { name: "Easter Monday",      date: "2030-04-22" },
          { name: "Kenneth Kaunda Day", date: "2030-04-28" },
          { name: "Labour Day",         date: "2030-05-01" },
        ],
      },
      {
        id: "2030-T2", name: "Second Term", number: 2,
        open: "2030-05-13", close: "2030-08-09",
        eceMidStart: "2030-06-17", eceMidEnd: "2030-06-21",
        workingDays: 62, residentDays: 89, holidayLength: 30,
        holidays: [
          { name: "Africa Freedom Day", date: "2030-05-25" },
          { name: "Heroes Day",         date: "2030-07-01" },
          { name: "Unity Day",          date: "2030-07-02" },
          { name: "Farmers' Day",       date: "2030-08-05" },
        ],
      },
      {
        id: "2030-T3", name: "Third Term", number: 3,
        open: "2030-09-09", close: "2030-12-06",
        eceMidStart: "2030-10-14", eceMidEnd: "2030-10-28",
        workingDays: 63, residentDays: 89, holidayLength: 37,
        holidays: [
          { name: "Teachers' Day",        date: "2030-10-05" },
          { name: "National Prayers Day", date: "2030-10-18" },
          { name: "Independence Day",     date: "2030-10-24" },
          { name: "Christmas Day",        date: "2030-12-25" },
        ],
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

const _parse = (s) => {
  const d = new Date(s + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  return d;
};

const _today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Get the active term for a given date (defaults to today).
 * Returns { year, term, termIndex } or null if between terms.
 */
export function getActiveTerm(date = _today()) {
  for (const year of Object.keys(MOE_CALENDAR).map(Number)) {
    for (let i = 0; i < MOE_CALENDAR[year].terms.length; i++) {
      const t = MOE_CALENDAR[year].terms[i];
      if (date >= _parse(t.open) && date <= _parse(t.close)) {
        return { year, term: t, termIndex: i };
      }
    }
  }
  return null;
}

/**
 * Get the next upcoming term from a given date (defaults to today).
 * Returns { year, term, termIndex } or null if none found.
 */
export function getNextTerm(date = _today()) {
  for (const year of Object.keys(MOE_CALENDAR).map(Number)) {
    for (let i = 0; i < MOE_CALENDAR[year].terms.length; i++) {
      const t = MOE_CALENDAR[year].terms[i];
      if (_parse(t.open) > date) {
        return { year, term: t, termIndex: i };
      }
    }
  }
  return null;
}

/**
 * The term whose material a learner is currently working with.
 *
 * `getActiveTerm` answers "is school in session", and returns null on every
 * day BETWEEN terms — which is correct for the teacher surfaces that ask it
 * (a register cannot be marked during a holiday) and wrong for a revision
 * app, where the holiday is when a learner most wants last term's topics.
 * The 2026 gap between Term 2 closing (7 Aug) and Term 3 opening (7 Sep) is
 * a month of that, and every day of it used to resolve to Term 1.
 *
 * So this is a SEPARATE function rather than a change to `getActiveTerm`:
 * the two questions have different right answers, and the attendance path
 * mirrors that one server-side.
 *
 * In a term it reports that term. Between terms it reports the term that
 * just CLOSED — the material the learner has actually been taught and can
 * revise, rather than the one about to open, which they have not seen.
 * Before the calendar's first term it reports null, and the caller's own
 * fallback (Term 1) is then the right answer anyway.
 *
 * @param {Date} [date]
 * @return {{year:number, term:object, termIndex:number, phase:'in-term'|'holiday'}|null}
 */
export function getMostRecentTerm(date = _today()) {
  const active = getActiveTerm(date);
  if (active) return { ...active, phase: "in-term" };
  let best = null;
  for (const year of Object.keys(MOE_CALENDAR).map(Number)) {
    for (let i = 0; i < MOE_CALENDAR[year].terms.length; i++) {
      const t = MOE_CALENDAR[year].terms[i];
      if (_parse(t.close) >= date) continue;
      if (!best || _parse(t.close) > _parse(best.term.close)) {
        best = { year, term: t, termIndex: i };
      }
    }
  }
  return best ? { ...best, phase: "holiday" } : null;
}

/**
 * Get term status for a term object.
 * Returns "active" | "upcoming" | "past"
 */
export function getTermStatus(term, date = _today()) {
  const open = _parse(term.open);
  const close = _parse(term.close);
  if (date < open) return "upcoming";
  if (date > close) return "past";
  return "active";
}

/**
 * How many calendar days until a date string from today.
 * Negative = in the past.
 */
export function daysUntil(dateStr, from = _today()) {
  return Math.ceil((_parse(dateStr) - from) / 86400000);
}

/**
 * Get current week number within the active term (1-based).
 * Returns null if not currently in a term.
 */
export function getCurrentWeekInTerm() {
  const active = getActiveTerm();
  if (!active) return null;
  const daysSinceOpen = Math.floor((_today() - _parse(active.term.open)) / 86400000);
  return Math.floor(daysSinceOpen / 7) + 1;
}

/**
 * Get total weeks in a term (based on resident days ÷ 5).
 */
export function getTotalWeeksInTerm(term) {
  return Math.ceil(term.residentDays / 5);
}

/**
 * Get all holidays across the entire school year (all 3 terms).
 */
export function getAllHolidaysForYear(year) {
  return (MOE_CALENDAR[year]?.terms ?? [])
    .flatMap(t => t.holidays.map(h => ({ ...h, term: t.name, termNumber: t.number })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get upcoming public holidays within the next N days.
 * Useful for lesson plan alerts.
 */
export function getUpcomingHolidays(withinDays = 14, from = _today()) {
  const results = [];
  for (const year of Object.keys(MOE_CALENDAR).map(Number)) {
    for (const term of MOE_CALENDAR[year].terms) {
      for (const h of term.holidays) {
        const delta = daysUntil(h.date, from);
        if (delta >= 0 && delta <= withinDays) {
          results.push({ ...h, daysAway: delta, term: term.name, year });
        }
      }
    }
  }
  return results.sort((a, b) => a.daysAway - b.daysAway);
}

/**
 * Context object for lesson plan / scheme of work generation.
 * Pass this into your AI prompt builder.
 *
 * Returns:
 * {
 *   year, termNumber, termName, termId,
 *   weekNumber, totalWeeks,
 *   termOpen, termClose,
 *   workingDays, residentDays,
 *   upcomingHolidays,       // next 14 days
 *   isActiveTermNow,
 * }
 */
export function getCalendarContextForAI(date = _today()) {
  const active = getActiveTerm(date);
  if (!active) {
    const next = getNextTerm(date);
    if (!next) return null;
    return {
      year: next.year,
      termNumber: next.term.number,
      termName: next.term.name,
      termId: next.term.id,
      weekNumber: null,
      totalWeeks: getTotalWeeksInTerm(next.term),
      termOpen: next.term.open,
      termClose: next.term.close,
      workingDays: next.term.workingDays,
      residentDays: next.term.residentDays,
      upcomingHolidays: getUpcomingHolidays(14, date),
      isActiveTermNow: false,
    };
  }
  return {
    year: active.year,
    termNumber: active.term.number,
    termName: active.term.name,
    termId: active.term.id,
    weekNumber: getCurrentWeekInTerm(),
    totalWeeks: getTotalWeeksInTerm(active.term),
    termOpen: active.term.open,
    termClose: active.term.close,
    workingDays: active.term.workingDays,
    residentDays: active.term.residentDays,
    upcomingHolidays: getUpcomingHolidays(14, date),
    isActiveTermNow: true,
  };
}

/**
 * The MoE calendar years we hold data for, ascending. Handy for a
 * year dropdown so it never offers a year we can't price weeks for.
 */
export function getCalendarYears() {
  return Object.keys(MOE_CALENDAR).map(Number).sort((a, b) => a - b);
}

/** Look up one term by year + 1-based term number. Returns null if absent. */
export function getTermByNumber(year, termNumber) {
  const terms = MOE_CALENDAR[year]?.terms ?? [];
  return terms.find((t) => t.number === Number(termNumber)) ?? null;
}

/** Add `n` whole days to a "YYYY-MM-DD" string, returning the same shape. */
function _addDaysISO(iso, n) {
  const d = _parse(iso);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * How many Monday–Friday teaching weeks a term spans, counted from its
 * opening date to its closing date. Distinct from getTotalWeeksInTerm()
 * (which divides resident days and overshoots) — this matches the
 * week-by-week pacing teachers actually plan against (~10–14 weeks).
 */
export function getTotalTeachingWeeks(term) {
  if (!term) return 0;
  const span = Math.floor((_parse(term.close) - _parse(term.open)) / 86400000);
  return Math.floor(span / 7) + 1;
}

/**
 * The week-by-week skeleton for a term: one entry per teaching week with
 * its Monday "week beginning" and Friday "week ending" (term open dates in
 * the MoE calendar are Mondays). Labels are short-formatted ("12 Jan 2026")
 * to drop straight into the forecast header. Returns [] for unknown years.
 */
export function getTermWeeks(year, termNumber) {
  const term = getTermByNumber(year, termNumber);
  if (!term) return [];
  const total = getTotalTeachingWeeks(term);
  return Array.from({ length: total }, (_, i) => {
    const beginning = _addDaysISO(term.open, i * 7);
    const ending = _addDaysISO(beginning, 4); // Mon → Fri
    return {
      weekNumber: i + 1,
      beginning,
      ending,
      beginningLabel: fmtDate(beginning, "short"),
      endingLabel: fmtDate(ending, "short"),
    };
  });
}

/**
 * The calendar week to default a weekly forecast to: the live week of the
 * active term, or week 1 of the next term during the holidays. Returns the
 * pieces the forecast header needs, or null when no term data covers today.
 */
export function getCurrentForecastWeek(date = _today()) {
  const active = getActiveTerm(date);
  const ref = active ?? getNextTerm(date);
  if (!ref) return null;
  const weeks = getTermWeeks(ref.year, ref.term.number);
  if (!weeks.length) return null;
  let weekNumber = 1;
  if (active) {
    const daysSinceOpen = Math.floor((date - _parse(ref.term.open)) / 86400000);
    weekNumber = Math.min(weeks.length, Math.max(1, Math.floor(daysSinceOpen / 7) + 1));
  }
  const wk = weeks[weekNumber - 1];
  return {
    year: ref.year,
    termNumber: ref.term.number,
    weekNumber,
    beginning: wk.beginning,
    ending: wk.ending,
    beginningLabel: wk.beginningLabel,
    endingLabel: wk.endingLabel,
  };
}

/**
 * Format a date string for display.
 * mode: "full" | "short" | "day"
 */
export function fmtDate(dateStr, mode = "full") {
  const d = _parse(dateStr);
  if (mode === "full")  return d.toLocaleDateString("en-ZM", { day: "numeric", month: "long", year: "numeric" });
  if (mode === "short") return d.toLocaleDateString("en-ZM", { day: "numeric", month: "short", year: "numeric" });
  if (mode === "day")   return d.toLocaleDateString("en-ZM", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en-ZM");
}
