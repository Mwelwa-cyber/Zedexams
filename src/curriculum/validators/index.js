/**
 * Selection validators — is this curriculum + level + subject + term + topic
 * combination one the syllabus actually defines? (docs/architecture.md §5.1.)
 *
 * Empty until Phase 4. Two behaviours it inherits from the code it will absorb:
 * a grade + subject with no approved syllabus is REFUSED rather than generated
 * against invented content, and a read FAILURE is never reported as an empty
 * catalogue — those are different answers and the teacher is told which.
 */

export {}
