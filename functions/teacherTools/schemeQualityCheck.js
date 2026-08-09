/**
 * schemeQualityCheck — the deterministic quality-control checklist a scheme
 * of work must pass before it is presented to the teacher.
 *
 * Mirrors the studio spec's checklist: header complete, weeks numbered
 * continuously, every column filled per row, class tests / revision / exam
 * weeks present and placed, no filler text. Runs AFTER validateSchemeOfWork
 * has normalised the payload, so every field already has its canonical shape.
 *
 * The result is informational — it never blocks the generation (the teacher
 * can edit any cell), it just tells them exactly what to review. Stored on
 * the aiGenerations doc and rendered as the studio's "Quality checks" panel.
 *
 * Pure + DOM-free + Firestore-free → unit-tested by
 * functions/teacherTools/schemeQualityCheck.test.js.
 */

// Filler a model leaks when it can't source a value. Kept in step with the
// FILLER_CELL regex in src/shared/utils/schemeFormat.js (which blanks cells at
// render time); this one only needs to FLAG, so a substring match is enough.
const FILLER_RE =
  /\b(n\s*\/\s*a|not\s+applicable|tbd|to\s+be\s+(decided|determined|confirmed)|unknown|i\s+(do\s+not|don'?t)\s+know|lorem\s+ipsum)\b/i;

function isObc(scheme) {
  const c = String((scheme && scheme.header && scheme.header.curriculum) || "")
      .toLowerCase();
  return c === "obc";
}

function isRevisionWeek(w) {
  return /\brevision\b/i.test(`${w.topic} ${w.subtopic}`);
}

function isExamWeek(w) {
  return /\bexam/i.test(String(w.topic || ""));
}

function mentionsClassTest(w) {
  const hay = [
    ...(Array.isArray(w.learningActivities) ? w.learningActivities : []),
    w.expectedStandard || "",
  ].join(" ");
  return /class\s*test/i.test(hay);
}

/** Every string that appears in a week's printed cells. */
function weekCellStrings(w, obc) {
  const out = [w.topic, w.subtopic, w.expectedStandard, w.references];
  for (const key of ["specificCompetences", "learningActivities", "methods", "tlAids"]) {
    if (Array.isArray(w[key])) out.push(...w[key]);
  }
  if (obc) {
    // OBC prints no activities/expected-standard cells — don't scan them.
    return [w.topic, w.subtopic, w.references,
      ...(w.specificCompetences || []), ...(w.methods || []), ...(w.tlAids || [])];
  }
  return out;
}

/** The columns a week must fill for its curriculum. Returns missing labels. */
function missingCells(w, obc) {
  const missing = [];
  if (!w.topic) missing.push("topic");
  if (!w.subtopic) missing.push("subtopic");
  if (!(w.specificCompetences || []).length) {
    missing.push(obc ? "specific outcomes" : "specific competences");
  }
  if (!obc) {
    if (!(w.learningActivities || []).length) missing.push("learning activities");
    if (!w.expectedStandard) missing.push("expected standard");
  }
  if (!(w.methods || []).length) missing.push("methods");
  if (!(w.tlAids || []).length) missing.push("T/L aids");
  if (!w.references) missing.push("reference");
  return missing;
}

/** Cap a per-week detail list so a badly broken scheme stays readable. */
function joinWeekDetails(rows, cap = 4) {
  const shown = rows.slice(0, cap).join("; ");
  const more = rows.length > cap ? ` (+${rows.length - cap} more)` : "";
  return shown + more;
}

/**
 * Run the checklist over a validated scheme.
 * @param {object} scheme  validateSchemeOfWork().value (header + weeks)
 * @returns {{checks: Array<{code:string,label:string,ok:boolean,detail:string}>,
 *            passCount:number, failCount:number, ok:boolean}}
 */
function buildSchemeQualityChecks(scheme) {
  const header = (scheme && scheme.header) || {};
  const weeks = Array.isArray(scheme && scheme.weeks) ? scheme.weeks : [];
  const obc = isObc(scheme);
  const checks = [];
  const add = (code, label, ok, detail = "") =>
    checks.push({code, label, ok: Boolean(ok), detail: ok ? "" : detail});

  // 1. Header completeness.
  {
    const missing = [];
    if (!header.grade) missing.push("grade");
    if (!header.subject) missing.push("subject");
    if (!(Number(header.term) >= 1)) missing.push("term");
    if (!header.year) missing.push("year");
    if (!header.periodsPerWeek) missing.push("periods per week");
    add("header_complete", "Header shows subject, grade, term, year and periods per week",
        missing.length === 0, `Missing: ${missing.join(", ")}`);
  }

  // 2. Weeks numbered continuously from 1 with no gaps or duplicates.
  {
    const ok = weeks.length > 0 && weeks.every((w, i) => Number(w.week) === i + 1);
    add("weeks_numbered", "Weeks are numbered continuously with no gaps or duplicates",
        ok, weeks.length === 0 ? "The scheme has no weeks." :
          "Week numbers skip or repeat — renumber the rows.");
  }

  // 3. Total weeks match the term plan.
  {
    const expected = Number(header.numberOfWeeks) || 0;
    const ok = expected > 0 && weeks.length === expected;
    add("weeks_match_term", `Total weeks match the term's ${expected || "planned"} teaching weeks`,
        ok, `The scheme has ${weeks.length} week${weeks.length === 1 ? "" : "s"} but the term plan expects ${expected}.`);
  }

  // 4. Every printed cell filled for every row.
  {
    const broken = [];
    weeks.forEach((w, i) => {
      const missing = missingCells(w, obc);
      if (missing.length) broken.push(`Week ${w.week || i + 1}: ${missing.join(", ")}`);
    });
    add("cells_filled", "Every column is filled for every week",
        broken.length === 0, joinWeekDetails(broken));
  }

  // 5. CBC only: class tests close the subtopic blocks.
  if (!obc) {
    const ok = weeks.some((w) => !isExamWeek(w) && mentionsClassTest(w));
    add("class_tests", "Class tests are scheduled at the end of subtopic blocks",
        ok, "No week notes \"CLASS TEST administered\" — add tests every ~2 weeks.");
  }

  // 6. Revision week(s) present before the exam.
  {
    const ok = weeks.some((w) => isRevisionWeek(w));
    add("revision_present", "At least one revision week is reserved",
        ok, "No REVISION week found — most terms reserve 1–3 before the exam.");
  }

  // 7. The final week is the examination week.
  {
    const last = weeks[weeks.length - 1];
    add("exam_week_last", "The final week is the end-of-term examination",
        Boolean(last && isExamWeek(last)),
        "The last week is not an exam week — terms normally close with END OF TERM EXAM.");
  }

  // 8. CBC only: activities are rich enough (3+ per content week).
  if (!obc) {
    const thin = weeks
        .filter((w) => !isRevisionWeek(w) && !isExamWeek(w))
        .filter((w) => (w.learningActivities || []).length < 3)
        .map((w) => `Week ${w.week}`);
    add("activities_rich", "Each teaching week has at least 3 learning activities",
        thin.length === 0, joinWeekDetails(thin));
  }

  // 9. No filler text anywhere on the printed page.
  {
    const hits = [];
    weeks.forEach((w, i) => {
      if (weekCellStrings(w, obc).some((s) => FILLER_RE.test(String(s || "")))) {
        hits.push(`Week ${w.week || i + 1}`);
      }
    });
    add("no_filler", "No cell contains filler like \"N/A\", \"TBD\" or \"unknown\"",
        hits.length === 0, joinWeekDetails(hits));
  }

  const failCount = checks.filter((c) => !c.ok).length;
  return {
    checks,
    passCount: checks.length - failCount,
    failCount,
    ok: failCount === 0,
  };
}

module.exports = {buildSchemeQualityChecks};
