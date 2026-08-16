/**
 * Alias resolution — every other spelling that means the same curriculum year,
 * subject or curriculum.
 *
 * **Still empty after Phase 4 closed — and unlike its three siblings, this one
 * is empty because there was nothing to move, not because it is blocked.** No
 * module in the tree does alias resolution as its own job today; the aliases
 * are already data on each entry in `canonicalEducation.js` /
 * `educationLevels.js`, read in place by whoever needs them. When this area is
 * filled it will hold RESOLUTION over that data, never a second copy of it,
 * reached through `../catalog`.
 *
 * A school that calls Form 3 "Grade 10" is naming the same year, so both must
 * resolve to one level and one syllabus — never to two, and never to a
 * duplicated copy of the content.
 */

export {}
