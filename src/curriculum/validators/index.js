/**
 * Selection validators — is this curriculum + level + subject + term + topic
 * combination one the syllabus actually defines? (docs/architecture.md §5.1.)
 *
 * **Still empty after Phase 4 closed.** No validator moved in because the
 * modules that carry this logic — `syllabusMapping`, `syllabusSubjectSplit`,
 * `curriculum2013Parser` — are all pinned in `src/utils/` by consumers in
 * `src/shared/`, which may not import this layer. The blocker inventory is in
 * `../resolvers/index.js`. Two behaviours it inherits from the code it will absorb:
 * a grade + subject with no approved syllabus is REFUSED rather than generated
 * against invented content, and a read FAILURE is never reported as an empty
 * catalogue — those are different answers and the teacher is told which.
 */

export {}
