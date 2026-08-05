/**
 * Curriculum resolvers — the level → subject → term → topic → subtopic →
 * outcome chain (docs/architecture.md §5, §5.1).
 *
 * Empty until Phase 4. It consolidates the ~15 resolution utilities scattered
 * through `src/utils/` (`curriculumFramework.js`, `curriculumOptions.js`,
 * `syllabusTopicTree.js`, `frameworkSubjectMatch.js`, …), which stay live and
 * canonical until each is moved.
 *
 * The selection rule they implement is in §5.1 and is load-bearing: choosing a
 * parent CLEARS invalid children rather than leaving a stale selection that
 * still looks chosen, and topic options are scoped strictly by curriculum AND
 * level — a leak shows a teacher topics from a syllabus they are not teaching.
 */

export {}
