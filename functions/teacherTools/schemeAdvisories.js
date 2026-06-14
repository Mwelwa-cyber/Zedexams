/**
 * Scheme-of-Work advisories.
 *
 * The studio acts as a smart assistant: it generates the scheme, but it also
 * tells the teacher when the inputs don't line up with the curriculum. This
 * module derives those advisories deterministically from the curriculum
 * outline, the teacher's timetable, and the chosen week/term shape — so the
 * teacher stays in control and just sees clear guidance.
 *
 * Pure + DOM-free + Firestore-free → unit-tested by
 * functions/teacherTools/schemeAdvisories.test.js.
 */

const {recommendedPeriodsPerWeek} = require("./schemeTimetable");

const LEVEL_WARNING = "warning";
const LEVEL_INFO = "info";

function gradeLabelOf(grade) {
  return String(grade || "").replace(/^G/i, "").trim();
}

/**
 * @param {object} args
 *   grade, subject, subjectLabel, term, numberOfWeeks
 *   classification        — 'in_syllabus' | 'not_in_grade' | 'unknown'
 *   officialSubjects      — string[]|null (the grade's official subject list)
 *   outline               — {topicCount, subtopicCount} from the curriculum outline
 *   timetableSummary      — {found, periods, days}|null (null = no timetable attached)
 * @returns {Array<{level:string, code:string, message:string}>}
 */
function buildSchemeAdvisories(args = {}) {
  const {
    grade, subject, subjectLabel, numberOfWeeks,
    classification = "unknown",
    officialSubjects = null,
    outline = {topicCount: 0, subtopicCount: 0},
    timetableSummary = null,
  } = args;

  const subj = subjectLabel || subject || "This subject";
  const gradeLabel = gradeLabelOf(grade);
  const out = [];
  const rec = recommendedPeriodsPerWeek(subject, subjectLabel);

  // 1. Is the subject part of this grade's official syllabus?
  if (classification === "not_in_grade") {
    const official = Array.isArray(officialSubjects) && officialSubjects.length ?
      ` Official subjects for Grade ${gradeLabel}: ${officialSubjects.join(", ")}.` :
      "";
    out.push({
      level: LEVEL_WARNING,
      code: "subject_not_in_grade",
      message:
        `"${subj}" isn't one of the official subjects for Grade ${gradeLabel} ` +
        `in the 2023 CBC framework.${official} The scheme uses the closest ` +
        "age-appropriate material — double-check it fits your school's plan.",
    });
  }

  // 2. Timetable vs curriculum period allocation.
  if (timetableSummary) {
    if (!timetableSummary.found) {
      out.push({
        level: LEVEL_WARNING,
        code: "subject_missing_timetable",
        message:
          `${subj} doesn't appear in the class timetable you attached. The ` +
          `curriculum expects about ${rec} periods per week — add it to your ` +
          "timetable so the pacing matches your real week.",
      });
    } else {
      const p = timetableSummary.periods;
      const dayNote = timetableSummary.days.length ?
        ` (${timetableSummary.days.join(", ")})` : "";
      if (p > 0 && p < rec) {
        out.push({
          level: LEVEL_WARNING,
          code: "too_few_periods",
          message:
            `Your timetable gives ${subj} ${p} period${p === 1 ? "" : "s"}/week` +
            `${dayNote}, but the curriculum expects about ${rec}. At this pace ` +
            "the term's topics may run over — consider adding a period or " +
            "trimming the topic load.",
        });
      } else if (p > rec + 2) {
        out.push({
          level: LEVEL_INFO,
          code: "too_many_periods",
          message:
            `Your timetable gives ${subj} ${p} periods/week${dayNote} — more ` +
            `than the usual ${rec}. There's room for extra practice, ` +
            "revision, or project work in the scheme.",
        });
      }
    }
  }

  // 3. Does the curriculum content fit the available teaching time?
  const topicCount = Number(outline.topicCount) || 0;
  const subtopicCount = Number(outline.subtopicCount) || 0;
  const weeks = Number(numberOfWeeks) || 0;

  if (topicCount === 0) {
    out.push({
      level: LEVEL_INFO,
      code: "no_curriculum_data",
      message:
        `No Syllabi Studio topics were found for Grade ${gradeLabel} ${subj}. ` +
        "The scheme falls back to general CBC knowledge — upload a module for " +
        "this grade and subject to ground it on official content.",
    });
  } else if (weeks > 0 && topicCount > weeks) {
    out.push({
      level: LEVEL_WARNING,
      code: "too_many_topics",
      message:
        `The syllabus lists ${topicCount} topics for Grade ${gradeLabel} ${subj}, ` +
        `but you've set ${weeks} teaching weeks. Some weeks combine topics, or ` +
        "coverage may spill into the next term — review the pacing.",
    });
  }

  // 4. Term heaviness: sub-topics vs the periods actually available.
  if (subtopicCount > 0 && weeks > 0 && timetableSummary &&
      timetableSummary.found && timetableSummary.periods > 0) {
    const capacity = timetableSummary.periods * weeks;
    // Leave headroom for class tests + the revision/exam week.
    if (subtopicCount > capacity) {
      out.push({
        level: LEVEL_WARNING,
        code: "scheme_heavy",
        message:
          `This scheme has ${subtopicCount} sub-topics but only about ` +
          `${capacity} periods across ${weeks} weeks at ${timetableSummary.periods}` +
          "/week. That's heavy once you allow for tests and revision — spread " +
          "the load or add teaching time.",
      });
    }
  }

  return out;
}

module.exports = {
  LEVEL_WARNING,
  LEVEL_INFO,
  buildSchemeAdvisories,
};
