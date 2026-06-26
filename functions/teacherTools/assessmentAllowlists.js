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
]);

module.exports = {ALLOWED_GRADES, ALLOWED_SUBJECTS};
