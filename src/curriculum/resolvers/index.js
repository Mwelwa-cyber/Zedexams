/**
 * Curriculum resolvers — the level → subject → term → topic → subtopic →
 * outcome chain (docs/architecture.md §5, §5.1).
 *
 * The selection rule they implement is in §5.1 and is load-bearing: choosing a
 * parent CLEARS invalid children rather than leaving a stale selection that
 * still looks chosen, and topic options are scoped strictly by curriculum AND
 * level — a leak shows a teacher topics from a syllabus they are not teaching.
 *
 * Filled 2026-08-16 with THREE of the ~15 utilities this file spent the phase
 * promising, and the eight that did not come are the more useful half of this
 * note, because the reason is structural and will not clear on its own.
 *
 * What arrived:
 *
 *   • `frameworkSubjectMatch.js` — scheme subject → official weekly allocation,
 *     curriculum-aware. The resolver the Scheme of Work studio auto-fills from.
 *   • `curriculumOptions.js` — grade → the subjects the syllabi actually carry,
 *     which is the subject step of the chain.
 *   • `curriculumTopicIdentity.js` — the four-part topic identity
 *     (curriculum + grade + subject + code). A topic code is not globally
 *     unique, so this is what makes the topic step resolvable at all.
 *
 * **What is BLOCKED, and by what.** Eight further modules named for this area —
 * `curriculumFramework`, `syllabusTopicTree`, `syllabus2013Topics`,
 * `syllabusMapping`, `syllabusSubjectSplit`, `curriculum2013Parser`,
 * `curriculumTopicCell`, `curriculumDiagnostics` — cannot move here, and it is
 * not a sequencing question. Each is imported from a layer that sits BELOW
 * curriculum and may not import it:
 *
 *     src/shared/utils/classTimetable.js        → curriculumFramework
 *     src/shared/utils/syllabusTopicOptions.js  → syllabusTopicTree,
 *                                                 syllabus2013Topics,
 *                                                 syllabusMapping
 *     src/shared/utils/curriculumDataService.js → syllabusMapping,
 *                                                 syllabusSubjectSplit,
 *                                                 curriculum2013Parser,
 *                                                 curriculumTopicCell
 *     src/shared/utils/splitSpecificOutcomes.js → curriculum2013Parser
 *     src/shared/utils/curriculumSelectorConstants.js → curriculumTopicCell
 *     src/shared/components/TopicSubtopicPicker.jsx  → syllabusMapping,
 *                                                      syllabus2013Topics
 *     src/shared/components/StudioCurriculumSelector.jsx → curriculum2013Parser
 *     src/config/curriculumCatalogBootstrap.js  → curriculumDiagnostics
 *
 * `FORBIDDEN_TARGETS.shared` includes `curriculum`, and `config` forbids it
 * too. So moving any of the eight turns a currently-legal import into a
 * build-failing one at a consumer that has nothing to do with this migration.
 *
 * **How it got this way, since the fix depends on it.** The teacher migration
 * of 2026-08-15 sent the shared studio layer — the curriculum selector,
 * `syllabusTopicOptions`, `curriculumDataService`, `curriculumSelectorConstants`
 * — into `src/shared/`. Those modules are curriculum logic by content, but they
 * were placed below the curriculum layer, so the dependency now runs upward
 * from shared into material this area was chartered to own. §12 was written
 * before that happened and does not describe it.
 *
 * Clearing it is a decision, not a chore, and there are only two shapes:
 * promote those shared modules into `src/curriculum/` as well (two of them are
 * React components, which this layer cannot hold — so they would have to split
 * into a curriculum-side resolver and a shared-side view), or amend the
 * layering so `shared` may read `curriculum`, which weakens the rule that keeps
 * this layer free of its own consumers. Neither belongs in a migration commit,
 * and choosing one silently is how a layering rule stops meaning anything.
 *
 * A namespace marker, not a barrel — import the file, not this index.
 */

export {}
