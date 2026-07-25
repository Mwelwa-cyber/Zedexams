/**
 * kbLookupCandidates — pure (grade, subject) candidate expansion for CBC KB
 * lookups, plus the studio-subject → KB-subject tables it derives from.
 *
 * WHY: the KB stores Forms-syllabus topics under grade codes G8–G12
 * (FORM_TO_GRADE below) and folds some syllabi into core subject
 * keys (Travel & Tourism → social_studies,
 * Literature in English → english, …). The standardized studio curriculum
 * selector, however, sends the teacher's literal pick: grade "F1"–"F4" and
 * subject slugs like "fashion_fabrics". Exact-equality matching in
 * cbcKnowledge.lookupTopic / suggestTopics therefore missed every Forms
 * selection and fell through to the ungrounded "general CBC knowledge"
 * fallback. gradeCandidates() / subjectCandidates() expand a requested
 * value into the ordered list of KB codes it may be stored under — the
 * requested value FIRST, so an exact match always outranks a folded one.
 *
 * The FORM_TO_GRADE / STUDIO_SUBJECT_TO_KB / STUDIO_SUBJECT_TO_KB_2013
 * tables moved here from syllabiCurriculumData.js (which requires
 * firebase-admin at module load) so this module has NO firebase deps and
 * tests under plain `node` (cbcGradeSubjectCandidates.test.js).
 * syllabiCurriculumData.js re-exports them, so existing consumers are
 * unaffected. Mirrors the client maps in src/utils/syllabusMapping.js and
 * src/utils/syllabus2013Topics.js — keep them in lock-step.
 */

const STUDIO_SUBJECT_TO_KB = {
  "Agricultural Science Syllabus (Forms 1-4)": "agricultural_science",
  "Art & Design Syllabus (Forms 1-4)": "art_and_design",
  "Biology Syllabus (Forms 1-4)": "biology",
  "English Syllabus (Forms 1-4)": "english",
  // Fallback only: this ONE document carries two independently-numbered
  // syllabi, split per row into commerce / principles_of_accounts by
  // syllabusSubjectSplit.js. Reached only when a sheet's sections don't resolve.
  "Commerce & Principles of Accounts Syllabus (Forms 1-4)":
    "commerce_and_principles_of_accounts",
  "Design & Technology Studies Syllabus (Forms 1-4)":
    "design_and_technology_studies",
  "Early Childhood Education Syllabi (3-5 Years)": "expressive_arts",
  "Lower Primary Syllabi (Grades 1-3)": "english",
  "English Language Syllabus (Grades 4-6)": "english",
  "Mathematics Syllabus (Grades 4-6)": "mathematics",
  "Science Syllabus (Grades 4-6)": "integrated_science",
  "Social Studies Syllabus (Grades 4-6)": "social_studies",
  "Home Economics & Hospitality Syllabus (Grades 4-6)": "home_economics",
  "Technology Studies Syllabus (Grades 4-6)": "technology_studies",
  "Mathematics Syllabus (Forms 1-4)": "mathematics",
  // Own Forms 1-4 syllabus, numbered from 1.1 like Mathematics is — see
  // src/utils/syllabusMapping.js.
  "Mathematics II Syllabus (Forms 1-4)": "mathematics_ii",
  "Physics Syllabus (Forms 1-4)": "physics",
  "History Syllabus (Forms 1-4)": "history",
  "Geography Syllabus (Forms 1-4)": "geography",
  "ICT Syllabus (Forms 1-4)": "technology_studies",
  "Literature in English Syllabus (Forms 1-4)": "english",
  "Religious Education Syllabus (Forms 1-4)": "religious_education",
  "Physical Education Syllabus (Forms 1-4)": "physical_education",
  // Three separate examinable subjects, three documents, each numbered from 1.1
  // — see src/utils/syllabusMapping.js. home_economics stays the key only for
  // the "(Grades 4-6)" document, where it genuinely is one subject.
  "Food & Nutrition Syllabus (Forms 1-4)": "food_and_nutrition",
  "Fashion & Fabrics Syllabus (Forms 1-4)": "fashion_and_fabrics",
  "Hospitality Management Syllabus (Forms 1-4)": "hospitality_management",
  "Music & Creative Arts Syllabus (Forms 1-4)": "music_and_creative_arts",
  "Travel & Tourism Syllabus (Forms 1-4)": "social_studies",
  "Zambian Languages Syllabus (Forms 1-4)": "zambian_language",
};

// Legacy 2013-curriculum subject → KB key map. Names mirror exactly the
// top-level keys in /public/syllabi/curriculum-data-2013.json, so a new
// 2013 syllabus shows up in the AI knowledge base as soon as it's added to
// the data file + listed here.
const STUDIO_SUBJECT_TO_KB_2013 = {
  "Integrated Science Syllabus (Grades 1-7, 2013)": "integrated_science",
  "Mathematics Syllabus (Grades 1-7, 2013)": "mathematics",
  "Social Studies Syllabus (Grades 1-7, 2013)": "social_studies",
  "English Language Syllabus (Grades 2-7, 2013)": "english",
  "Creative & Technology Studies Syllabus (2013)": "creative_and_technology_studies",
  "Home Economics Syllabus (Grades 5-7, 2013)": "home_economics",
  "Technology Studies Syllabus (Grades 5-7, 2013)": "technology_studies",
  "Expressive Arts Syllabus (Grades 5-7, 2013)": "expressive_arts",
  "Zambian Language Syllabus (Grades 5-7, 2013)": "zambian_language",
  "Physical Education Syllabus (Grades 8-9, 2013)": "physical_education",
  "Agricultural Science Syllabus (Grades 10-12, 2013)": "agricultural_science",
  "Art & Design Syllabus (Grades 10-12, 2013)": "art_and_design",
  "Biology Syllabus (Grades 10-12, 2013)": "biology",
  "Chemistry Syllabus (Grades 10-12, 2013)": "chemistry",
  "Civic Education Syllabus (Grades 10-12, 2013)": "civic_education",
  "Food & Nutrition Syllabus (Grades 10-12, 2013)": "food_and_nutrition",
  "Geography Syllabus (Grades 10-12, 2013)": "geography",
  "History Syllabus (Senior Secondary, 2013)": "history",
  "Home Management Syllabus (Grades 10-12, 2013)": "home_management",
  "Mathematics Syllabus (Grades 10-12, 2013)": "mathematics",
  "Physical Education Syllabus (Grades 10-12, 2013)": "physical_education",
  "Religious Education 2044 Syllabus (Grades 10-12, 2013)": "religious_education",
  "Religious Education 2046 Syllabus (Grades 10-12, 2013)": "religious_education",
};

// Sheet-name prefix ("form 1") → KB grade code. Used by
// syllabiCurriculumData.sheetNameToGrade; "form 3 - 4" is a combined-sheet
// bucket, not a form code.
const FORM_TO_GRADE = {
  "form 1": "G8",
  "form 2": "G9",
  "form 3": "G10",
  "form 4": "G11",
  "form 3 - 4": "G10",
  "form 5": "G12",
};

// Derived: form CODE ("F1") → KB grade code ("G8"). Built from FORM_TO_GRADE
// so the two can never drift; the combined "form 3 - 4" bucket is skipped.
const FORM_CODE_TO_GRADE = (() => {
  const out = {};
  for (const [name, grade] of Object.entries(FORM_TO_GRADE)) {
    const m = name.match(/^form\s*(\d+)$/);
    if (m) out[`F${m[1]}`] = grade;
  }
  return Object.freeze(out);
})();

/** Canonical subject slug: lowercase, non-alphanumeric runs collapsed to _. */
function slugifySubject(subject) {
  return String(subject == null ? "" : subject)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
}

// The two bundle syllabi cover several strands each; their derived slugs
// ("early_childhood_education", "lower_primary") are not subject slugs any
// studio ever sends, so they must not produce fold entries.
const BUNDLE_STUDIO_KEYS = new Set([
  "Early Childhood Education Syllabi (3-5 Years)",
  "Lower Primary Syllabi (Grades 1-3)",
]);

// Derived: selector subject slug → the KB key its topics are stored under.
// Built from the studio tables above (strip the " Syllabus (…)" suffix,
// slugify the subject name, keep only entries where the slug differs from
// the KB key), so a syllabus rename or a new vocational subject updates the
// fold automatically. e.g. travel_tourism → social_studies,
// art_design → art_and_design, fashion_fabrics → fashion_and_fabrics.
// Subject spellings that predate the 2026-07 subject split and fold onto
// exactly one canonical key. Mirrors LEGACY_SUBJECT_ALIASES in
// src/config/teacherTaxonomy.js. A saved 'accounts' pick must still reach the
// Principles of Accounts rows, which now live under their own key.
//
// 'commerce_and_principles_of_accounts' is NOT here: it names two subjects, so
// no single fold is correct. The KB simply no longer stores anything under it.
const LEGACY_SUBJECT_ALIASES = Object.freeze({
  accounts: "principles_of_accounts",
  food_nutrition: "food_and_nutrition",
  fashion_fabrics: "fashion_and_fabrics",
});

const SUBJECT_SLUG_TO_KB = (() => {
  const out = Object.assign({}, LEGACY_SUBJECT_ALIASES);
  for (const table of [STUDIO_SUBJECT_TO_KB, STUDIO_SUBJECT_TO_KB_2013]) {
    for (const [studioKey, kbKey] of Object.entries(table)) {
      if (BUNDLE_STUDIO_KEYS.has(studioKey)) continue;
      const name = String(studioKey)
          .replace(/\s*Syllab(?:us|i)\s*\([^)]*\)\s*$/i, "");
      const slug = slugifySubject(name);
      if (slug && slug !== kbKey) out[slug] = kbKey;
    }
  }
  return Object.freeze(out);
})();

/**
 * Grade codes a requested grade may be stored under in the KB, requested
 * (normalized) code first:
 *   gradeCandidates("F1")  → ["F1", "G8"]      (Forms are stored as G-codes)
 *   gradeCandidates("G8")  → ["G8"]
 *   gradeCandidates("ECE_N") → ["ECE_N"]
 *   gradeCandidates("")    → []
 * Pure; tolerant of case/whitespace and the "FORM1" spelling.
 */
function gradeCandidates(grade) {
  const g = String(grade == null ? "" : grade)
      .trim().toUpperCase().replace(/\s+/g, "");
  if (!g) return [];
  const m = g.match(/^F(?:ORM)?(\d+)$/);
  const folded = m ? FORM_CODE_TO_GRADE[`F${m[1]}`] : undefined;
  return folded && folded !== g ? [g, folded] : [g];
}

/**
 * Subject keys a requested subject may be stored under in the KB, requested
 * (slugified) key first:
 *   subjectCandidates("travel_tourism") → ["travel_tourism", "social_studies"]
 *   subjectCandidates("mathematics")    → ["mathematics"]
 *   subjectCandidates("")                → []
 * Pure; accepts slugs, display labels ("Fashion & Fabrics") and the
 * underscore-heavy normalizeSubject() output ("fashion___fabrics").
 */
function subjectCandidates(subject) {
  const s = slugifySubject(subject);
  if (!s) return [];
  const folded = SUBJECT_SLUG_TO_KB[s];
  return folded && folded !== s ? [s, folded] : [s];
}

module.exports = {
  STUDIO_SUBJECT_TO_KB,
  STUDIO_SUBJECT_TO_KB_2013,
  FORM_TO_GRADE,
  FORM_CODE_TO_GRADE,
  SUBJECT_SLUG_TO_KB,
  LEGACY_SUBJECT_ALIASES,
  slugifySubject,
  gradeCandidates,
  subjectCandidates,
};
