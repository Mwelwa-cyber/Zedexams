/**
 * Grade + subject whitelists for the assessment generator. Split out of
 * generateAssessment.js so dependency-free consumers (the seed tests in
 * CI's root-deps-only test job, the format-profile tooling) can require
 * the canonical lists without pulling in firebase-functions/firebase-admin.
 */

const ALLOWED_GRADES = new Set([
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
  "F1", "F2", "F3", "F4",
]);

const ALLOWED_SUBJECTS = new Set([
  "mathematics", "english", "integrated_science", "social_studies",
  "literacy", "numeracy", "cinyanja", "zambian_language",
  "creative_and_technology_studies",
  "physical_education", "religious_education", "civic_education",
  "biology", "chemistry", "physics", "geography", "history",
  "environmental_science", "technology_studies", "home_economics",
  "expressive_arts", "accounts",
  // CBC 2023 Forms 1-4 subjects the Syllabus Studio exposes as their own
  // canonical keys (the paper modal sends these verbatim).
  "agricultural_science", "art_and_design",
  "commerce_and_principles_of_accounts",
  "design_and_technology_studies", "music_and_creative_arts",
  // ── The 2026-07 subject split ──────────────────────────────────────────
  // Canonical keys carved out of shared ones, each its own examinable subject
  // with its own numbering (see src/utils/subjectSplitClassifier.js). The
  // pre-split spellings above are kept so a saved pick still passes.
  "commerce", "principles_of_accounts",
  "food_and_nutrition", "fashion_and_fabrics", "mathematics_ii",
  "literature_in_english",
  // Not previously listed here, so this generator rejected the pick outright.
  "hospitality_management",
]);

module.exports = {ALLOWED_GRADES, ALLOWED_SUBJECTS};
