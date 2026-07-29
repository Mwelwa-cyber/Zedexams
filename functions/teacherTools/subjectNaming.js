/**
 * subjectNaming — how a subject KEY is written when a human (or the model
 * writing for one) will read it.
 *
 * Every generator normalises the teacher's subject to a storage slug before it
 * validates it (`str(raw.subject).toLowerCase().replace(/[^a-z_]/g, "_")`), and
 * then hands that slug straight to the model as `- Subject: ...`. For most
 * subjects the slug and the name are the same word, so nobody noticed. For the
 * combined CBC maths/science area they are not:
 *
 *   slug           `numeracy`
 *   Nursery/Recept "Pre-Mathematics and Science"
 *   Grade 1 up     "Mathematics and Science"
 *
 * "Numeracy" is a CBC key competence and this area's storage code. It is not a
 * subject on the 2023 syllabus, so it must never be handed to a generator as
 * the subject's name — a model told the subject is "numeracy" writes "Numeracy"
 * across the header and instructions of a Grade 1 paper.
 *
 * The client half of this rule is src/config/mathsScienceArea.js; keep the two
 * labels in step. Pure — no firebase, no I/O.
 */

const MATHS_SCIENCE_SUBJECT_KEY = "numeracy";
const MATHS_SCIENCE_LABEL = "Mathematics and Science";
const PRE_MATHS_SCIENCE_LABEL = "Pre-Mathematics and Science";

// Every ECE grade code the generators accept, including the legacy spellings
// that predate the age bands (see gradeLabelFor in assessmentLabels.js).
const ECE_LEVELS = new Set(["ECE", "ECE_N", "ECE_R", "ECE_B", "ECE_M"]);

/** True for the Nursery / Reception bands. */
function isEceGrade(grade) {
  return ECE_LEVELS.has(String(grade || "").trim().toUpperCase());
}

/**
 * The name a subject is written under for `grade`.
 *
 * Only the combined maths/science area is rewritten; every other subject is
 * returned exactly as given, so a caller can apply this unconditionally.
 * With no grade the pre-formal stage cannot be told from the formal one, so the
 * Lower-Primary name is used — never the slug.
 *
 * @param {string} subject canonical subject slug
 * @param {string} [grade] grade code (ECE_N, G1, G8 …)
 * @returns {string} the subject's human name
 */
function subjectNameForGrade(subject, grade) {
  const key = String(subject || "").trim().toLowerCase();
  if (key !== MATHS_SCIENCE_SUBJECT_KEY) return subject;
  return isEceGrade(grade) ? PRE_MATHS_SCIENCE_LABEL : MATHS_SCIENCE_LABEL;
}

module.exports = {
  MATHS_SCIENCE_SUBJECT_KEY,
  MATHS_SCIENCE_LABEL,
  PRE_MATHS_SCIENCE_LABEL,
  isEceGrade,
  subjectNameForGrade,
};
