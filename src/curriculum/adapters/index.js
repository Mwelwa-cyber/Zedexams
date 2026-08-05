/**
 * Framework adapters — CBC and the 2013 (OBC) syllabus behind ONE interface:
 * one resolver API, two framework datasets (docs/architecture.md §5).
 *
 * Empty until Phase 4. Today `src/utils/frameworkData.js` (CBC) and
 * `frameworkData2013.js` are parallel files with parallel readers; converging
 * them here is a data-shape change, so it moves with the resolvers rather than
 * ahead of them.
 *
 * The two curricula genuinely differ — CBC teaches "regroup" where OBC says
 * "borrow", CBC has no Grade 7, OBC has no ECE bands. An adapter carries those
 * differences as data; it does not normalise them away.
 */

export {}
