/**
 * Alias resolution — every other spelling that means the same curriculum year,
 * subject or curriculum.
 *
 * Empty until Phase 4, and it will hold RESOLUTION over alias data, never a
 * second copy of it: the aliases themselves are already data on each entry in
 * `canonicalEducation.js` / `educationLevels.js` and are reached through
 * `../catalog`.
 *
 * A school that calls Form 3 "Grade 10" is naming the same year, so both must
 * resolve to one level and one syllabus — never to two, and never to a
 * duplicated copy of the content.
 */

export {}
