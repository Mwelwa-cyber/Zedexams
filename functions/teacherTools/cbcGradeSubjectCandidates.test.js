/**
 * Plain-node tests for kbLookupCandidates — the pure (grade, subject)
 * candidate expansion cbcKnowledge.lookupTopic / suggestTopics use so the
 * standardized selector's F-codes ("F1"–"F4") and vocational subject slugs
 * ("fashion_fabrics", "home_management", …) still ground against a KB that
 * stores Forms topics under G8–G12 and vocational syllabi under core
 * subject keys. Run directly:
 *
 *   node functions/teacherTools/cbcGradeSubjectCandidates.test.js
 *
 * Throws (exit 1) on the first failed assertion, exits 0 when green.
 */

const assert = require("node:assert");
const {
  STUDIO_SUBJECT_TO_KB,
  STUDIO_SUBJECT_TO_KB_2013,
  FORM_TO_GRADE,
  FORM_CODE_TO_GRADE,
  SUBJECT_SLUG_TO_KB,
  gradeCandidates,
  subjectCandidates,
} = require("./kbLookupCandidates");
const {SPLIT_DOCUMENTS} = require("./syllabusSubjectSplit");

// ── gradeCandidates: F-codes fold to the G-code the KB stores ─────────────
{
  assert.deepStrictEqual(gradeCandidates("F1"), ["F1", "G8"]);
  assert.deepStrictEqual(gradeCandidates("F2"), ["F2", "G9"]);
  assert.deepStrictEqual(gradeCandidates("F3"), ["F3", "G10"]);
  assert.deepStrictEqual(gradeCandidates("F4"), ["F4", "G11"]);
  assert.deepStrictEqual(gradeCandidates("F5"), ["F5", "G12"]);

  // Tolerant of case / whitespace / the "FORM n" spelling.
  assert.deepStrictEqual(gradeCandidates(" f1 "), ["F1", "G8"]);
  assert.deepStrictEqual(gradeCandidates("form 3"), ["FORM3", "G10"]);

  // The requested (normalized) code always comes FIRST so an exact
  // grade match outranks the folded one.
  assert.strictEqual(gradeCandidates("F4")[0], "F4");
}

// ── gradeCandidates: everything else passes through unchanged ────────────
{
  assert.deepStrictEqual(gradeCandidates("G8"), ["G8"]);
  assert.deepStrictEqual(gradeCandidates("G12"), ["G12"]);
  assert.deepStrictEqual(gradeCandidates("G4"), ["G4"]);
  assert.deepStrictEqual(gradeCandidates("ECE_N"), ["ECE_N"]);
  assert.deepStrictEqual(gradeCandidates("ECE_R"), ["ECE_R"]);
  assert.deepStrictEqual(gradeCandidates(""), []);
  assert.deepStrictEqual(gradeCandidates(null), []);
  assert.deepStrictEqual(gradeCandidates(undefined), []);
}

// ── FORM_CODE_TO_GRADE is derived from FORM_TO_GRADE (no drift) ──────────
{
  assert.deepStrictEqual(FORM_CODE_TO_GRADE, {
    F1: "G8",
    F2: "G9",
    F3: "G10",
    F4: "G11",
    F5: "G12",
  });
  // Sanity: the sheet-name source table still carries the entries the
  // derivation reads ("form 3 - 4" is a bucket, not a form code).
  assert.strictEqual(FORM_TO_GRADE["form 1"], "G8");
  assert.strictEqual(FORM_TO_GRADE["form 3 - 4"], "G10");
  assert.ok(!("F3-4" in FORM_CODE_TO_GRADE));
}

// ── subjectCandidates: vocational / legacy slugs fold to their KB key ────
{
  // Forms 1-4 vocational syllabi (2023 data file).
  assert.deepStrictEqual(
    subjectCandidates("fashion_fabrics"),
    ["fashion_fabrics", "home_economics"],
  );
  // Food & Nutrition is its own canonical subject now (it was folded into
  // home_economics, which collided its codes with Fashion & Fabrics). The
  // pre-split slug still folds onto it so a saved pick keeps resolving.
  assert.deepStrictEqual(
    subjectCandidates("food_nutrition"),
    ["food_nutrition", "food_and_nutrition"],
  );
  assert.deepStrictEqual(
    subjectCandidates("food_and_nutrition"),
    ["food_and_nutrition"],
  );
  // Commerce and Principles of Accounts each stand alone; the old 'accounts'
  // spelling reaches the latter.
  assert.deepStrictEqual(subjectCandidates("commerce"), ["commerce"]);
  assert.deepStrictEqual(
      subjectCandidates("accounts"),
      ["accounts", "principles_of_accounts"],
  );
  assert.deepStrictEqual(
      subjectCandidates("home_management"),
      ["home_management"],
  );
  assert.deepStrictEqual(
    subjectCandidates("hospitality_management"),
    ["hospitality_management", "home_economics"],
  );
  assert.deepStrictEqual(
    subjectCandidates("travel_tourism"),
    ["travel_tourism", "social_studies"],
  );
  assert.deepStrictEqual(
    subjectCandidates("literature_in_english"),
    ["literature_in_english", "english"],
  );

  // 2013-framework subjects (Grades 10-12 / 1-4).
  // Home Management is its own canonical key now — its slug IS the KB key, so
  // there is nothing to fold. It is asserted alongside the split block above.
  assert.deepStrictEqual(
    subjectCandidates("art_design"),
    ["art_design", "art_and_design"],
  );
  assert.deepStrictEqual(
    subjectCandidates("creative_technology_studies"),
    ["creative_technology_studies", "creative_and_technology_studies"],
  );

  // CBC 2023 Forms 1-4 additions — the "&" studio names slug without the
  // "and", so the derived fold must recover the canonical keys.
  assert.deepStrictEqual(
    subjectCandidates("commerce_principles_of_accounts"),
    ["commerce_principles_of_accounts", "commerce_and_principles_of_accounts"],
  );
  assert.deepStrictEqual(
    subjectCandidates("design_technology_studies"),
    ["design_technology_studies", "design_and_technology_studies"],
  );
  assert.deepStrictEqual(
    subjectCandidates("music_creative_arts"),
    ["music_creative_arts", "music_and_creative_arts"],
  );
  assert.deepStrictEqual(
    subjectCandidates("zambian_languages"),
    ["zambian_languages", "zambian_language"],
  );

  // Grade 4-6 verbose keys the selector may still surface.
  assert.deepStrictEqual(
    subjectCandidates("english_language"), ["english_language", "english"],
  );
  // Mathematics II is its own KB subject now — its slug IS the key, so there is
  // nothing to fold. Folding it into `mathematics` is what collided their codes.
  assert.deepStrictEqual(
    subjectCandidates("mathematics_ii"), ["mathematics_ii"],
  );
  assert.strictEqual(
    STUDIO_SUBJECT_TO_KB["Mathematics II Syllabus (Forms 1-4)"],
    "mathematics_ii",
  );
  assert.strictEqual(
    STUDIO_SUBJECT_TO_KB["Mathematics Syllabus (Forms 1-4)"],
    "mathematics",
  );
  assert.deepStrictEqual(
    subjectCandidates("ict"), ["ict", "technology_studies"],
  );

  // The requested slug always comes FIRST so an exact subject match
  // outranks the folded one.
  assert.strictEqual(subjectCandidates("fashion_fabrics")[0], "fashion_fabrics");
}

// ── subjectCandidates: canonical KB keys pass through unchanged ──────────
{
  assert.deepStrictEqual(subjectCandidates("mathematics"), ["mathematics"]);
  assert.deepStrictEqual(subjectCandidates("home_economics"), ["home_economics"]);
  assert.deepStrictEqual(
    subjectCandidates("agricultural_science"), ["agricultural_science"],
  );
  assert.deepStrictEqual(
    subjectCandidates("art_and_design"), ["art_and_design"],
  );
  assert.deepStrictEqual(
    subjectCandidates("creative_and_technology_studies"),
    ["creative_and_technology_studies"],
  );
  assert.deepStrictEqual(subjectCandidates(""), []);
  assert.deepStrictEqual(subjectCandidates(null), []);
}

// ── subjectCandidates: tolerant of labels + normalizeSubject output ──────
{
  // Display label.
  assert.deepStrictEqual(
    subjectCandidates("Fashion & Fabrics"),
    ["fashion_fabrics", "home_economics"],
  );
  // cbcKnowledge.normalizeSubject turns every non-letter into "_" without
  // collapsing runs — the candidates helper must still resolve that shape.
  assert.deepStrictEqual(
    subjectCandidates("fashion___fabrics"),
    ["fashion_fabrics", "home_economics"],
  );
  assert.deepStrictEqual(
    subjectCandidates("Travel & Tourism"),
    ["travel_tourism", "social_studies"],
  );
}

// ── SUBJECT_SLUG_TO_KB derivation hygiene ─────────────────────────────────
{
  // The multi-strand bundle syllabi must not leak pseudo-subject folds.
  assert.ok(!("early_childhood_education" in SUBJECT_SLUG_TO_KB));
  assert.ok(!("lower_primary" in SUBJECT_SLUG_TO_KB));
  // No identity entries (they'd be dead weight).
  for (const [slug, kbKey] of Object.entries(SUBJECT_SLUG_TO_KB)) {
    assert.notStrictEqual(slug, kbKey, `identity fold entry: ${slug}`);
  }
  // Every fold target is a real KB subject key: either a value in the source
  // tables, or one of the section subjects a split document produces. The
  // Commerce & Principles of Accounts workbook maps to its combined key in the
  // table and is divided per row, so 'commerce' / 'principles_of_accounts' are
  // real KB keys that the table alone never names.
  const kbKeys = new Set([
    ...Object.values(STUDIO_SUBJECT_TO_KB),
    ...Object.values(STUDIO_SUBJECT_TO_KB_2013),
    ...Object.values(SPLIT_DOCUMENTS).flatMap((spec) => spec.sections),
  ]);
  for (const kbKey of Object.values(SUBJECT_SLUG_TO_KB)) {
    assert.ok(kbKeys.has(kbKey), `fold target not a KB key: ${kbKey}`);
  }
}

// ── The tables the fold derives from are still intact after the move ─────
{
  assert.strictEqual(
    STUDIO_SUBJECT_TO_KB["Fashion & Fabrics Syllabus (Forms 1-4)"],
    "home_economics",
  );
  // Home Management and Food & Nutrition each own their key — filing both under
  // home_economics made every one of their G10-G12 codes collide.
  assert.strictEqual(
    STUDIO_SUBJECT_TO_KB_2013["Home Management Syllabus (Grades 10-12, 2013)"],
    "home_management",
  );
  assert.strictEqual(
    STUDIO_SUBJECT_TO_KB_2013["Food & Nutrition Syllabus (Grades 10-12, 2013)"],
    "food_and_nutrition",
  );
  assert.strictEqual(
    STUDIO_SUBJECT_TO_KB["Food & Nutrition Syllabus (Forms 1-4)"],
    "food_and_nutrition",
  );
  // The G5-7 Home Economics syllabus is a genuinely different subject and keeps
  // the home_economics key.
  assert.strictEqual(
    STUDIO_SUBJECT_TO_KB_2013["Home Economics Syllabus (Grades 5-7, 2013)"],
    "home_economics",
  );
  assert.strictEqual(
    STUDIO_SUBJECT_TO_KB_2013["Art & Design Syllabus (Grades 10-12, 2013)"],
    "art_and_design",
  );
  assert.ok(Object.keys(STUDIO_SUBJECT_TO_KB).length >= 20);
  assert.ok(Object.keys(STUDIO_SUBJECT_TO_KB_2013).length >= 20);
}

console.log("cbcGradeSubjectCandidates.test.js — all assertions passed");
