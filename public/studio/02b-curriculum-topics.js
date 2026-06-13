// Clean, easily-extensible curriculum topics map for the Lesson Plan Studio's
// Topic + Sub-topic dropdowns. Keyed by grade label exactly as it appears in
// the Class dropdown (e.g. "Grade 4"), then by SUBJECT name exactly as it
// appears in the Subject dropdown (e.g. "Integrated Science"). When a
// (grade, subject) pair is present here, it takes priority over the legacy
// hardcoded syllabi in 02-syllabus-new.js / 03-syllabus-old.js for populating
// the topic + subtopic <select>s.
//
// IMPORTANT — these topics are SUBJECT-SCOPED. Earlier this map was keyed by
// grade only, so a single grade's topics (e.g. Grade 4 Science) leaked into
// every other subject for that grade. That made the generator reject valid
// topics ("Prepositions" in Grade 4 English) because it was told the grade's
// official topics were Human Body + Plants. Always nest topics under the
// subject they belong to so they can never poison a sibling subject.
//
// To add more topics: add the grade key (if new), then the subject key (must
// match the Subject dropdown label), then list its topics with their
// subtopics. No other file needs to change.
//
//   curriculumTopics["Grade 6"] = {
//     "Integrated Science": {
//       "Light": ["Reflection", "Refraction"],
//       ...
//     }
//   };

const curriculumTopics = {
  "Grade 4": {
    "Integrated Science": {
      "The Human Body": [
        "Circulatory system",
        "Digestive system",
        "Sense organs"
      ],
      "Plants": [
        "Parts of a plant",
        "Uses of plants"
      ]
    }
  },
  "Grade 5": {
    "Integrated Science": {
      "Matter": [
        "States of matter",
        "Changes in matter"
      ]
    }
  }
};

// Subject-aware lookup. Returns the { topic: [subtopics] } map for a
// (grade, subject) pair, or {} when there's nothing curated for it.
//
// Matching is exact first, then normalised (case-insensitive, punctuation and
// the "(Learning Area)" suffix stripped) so minor label drift between the
// Subject dropdown and this map still resolves. A grade with no subject match
// returns {} — it must NEVER fall back to "some other subject's topics for
// this grade", which is exactly the cross-subject leak this structure fixes.
function curatedTopicsFor(klass, subject) {
  const byGrade = curriculumTopics[klass];
  if (!byGrade || !subject) return {};
  const block = byGrade[subject];
  // Guard against the legacy flat shape (grade → topic → [subtopics]) where
  // the value would be an array: that data can't be attributed to a subject,
  // so refuse it rather than leak it across subjects.
  if (block && !Array.isArray(block)) return block;
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/\s*\(learning area\)\s*$/, '')
    .replace(/[^a-z0-9]+/g, '');
  const want = norm(subject);
  for (const key of Object.keys(byGrade)) {
    if (norm(key) === want && !Array.isArray(byGrade[key])) return byGrade[key];
  }
  return {};
}

// Expose globally so 04-syllabus-router.js and 06-generate.js (loaded next)
// can read both the raw map and the subject-aware lookup.
window.curriculumTopics = curriculumTopics;
window.curatedTopicsFor = curatedTopicsFor;
