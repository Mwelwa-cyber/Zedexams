/**
 * assessmentLabels — how a grade code and a subject key are written for a human.
 *
 * Split out of generateAssessment.js so the planning path (which shows the
 * teacher a plan before anything is generated) and the generation path can name
 * a level the same way. Two modules writing "Grade 8" and "Form 1" for the same
 * code would be a bug the teacher sees on screen.
 *
 * Pure — no firebase, no I/O.
 */

/**
 * Human-readable grade label. Mirrors the client level ladder
 * (src/config/educationLevels.js): G1–G7 → "Grade N", G8–G12 → the forms
 * "Form 1"…"Form 5", and the two ECE age bands → Nursery and Reception. A Form
 * is never relabelled a Grade.
 *
 * "Baby Class" and "Middle Class" are NOT levels; their codes are legacy
 * spellings that resolve to Nursery so an old record still opens. A bare "ECE"
 * predates the age bands, covers both years, and resolves to the youngest.
 */
function gradeLabelFor(code) {
  const g = String(code || "").toUpperCase();
  if (g === "ECE_N" || g === "ECE_B" || g === "ECE" || g === "ECE_M") {
    return "Nursery";
  }
  if (g === "ECE_R") return "Reception";
  const m = g.match(/^G(\d{1,2})$/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 8 && n <= 12) return `Form ${n - 7}`;
    return `Grade ${n}`;
  }
  const f = g.match(/^F(\d)$/);
  if (f) return `Form ${f[1]}`;
  return String(code || "");
}

function subjectLabelFor(key) {
  const known = {
    integrated_science: "Integrated Science",
    social_studies: "Social Studies",
    expressive_arts: "Expressive Arts",
    technology_studies: "Technology Studies",
    home_economics: "Home Economics",
    zambian_language: "Zambian Language",
    creative_and_technology_studies: "Creative & Technology Studies",
    religious_education: "Religious Education",
    civic_education: "Civic Education",
    physical_education: "Physical Education",
    environmental_science: "Environmental Science",
  };
  const k = String(key || "").trim();
  return known[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The one wording used when the verified curriculum has no approved topics for a
 * grade + subject (§3.5). Both the plan step and the generator refuse with this
 * exact sentence, so a teacher who plans and then generates is not told two
 * different stories about the same gap.
 */
function curriculumRefusalMessage({grade, subject, framework}) {
  const curriculumName = String(framework) === "2013" ?
    "the previous syllabus" : "CBC";
  return (
    `${subjectLabelFor(subject)} for ${gradeLabelFor(grade)} has no approved ` +
    `${curriculumName} syllabus content yet, so a paper cannot be generated ` +
    "for it. Ask an administrator to add the verified syllabus, or choose " +
    "another curriculum, grade or subject."
  );
}

module.exports = {gradeLabelFor, subjectLabelFor, curriculumRefusalMessage};
