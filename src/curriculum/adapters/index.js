/**
 * Framework adapters — CBC and the 2013 (OBC) syllabus behind ONE interface:
 * one resolver API, two framework datasets (docs/architecture.md §5).
 *
 * **Still empty after Phase 4 closed, and BLOCKED rather than pending** —
 * see the blocker inventory in `../resolvers/index.js`, which applies here
 * unchanged. The framework data this area would converge is reached through
 * `curriculumFramework.js`, and that module is pinned in `src/utils/` by
 * `src/shared/utils/classTimetable.js`: `shared` may not import `curriculum`,
 * so moving it turns a legal import into a build failure at a consumer
 * unrelated to curriculum. Converging the two frameworks is also a data-shape
 * change, so it moves with the resolvers rather than ahead of them — but the
 * resolvers cannot move until the layering question is answered.
 *
 * The two curricula genuinely differ — CBC teaches "regroup" where OBC says
 * "borrow", CBC has no Grade 7, OBC has no ECE bands. An adapter carries those
 * differences as data; it does not normalise them away.
 */

export {}
