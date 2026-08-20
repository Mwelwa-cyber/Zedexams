/**
 * Shared constants.
 *
 * Deliberately narrow: curriculum, grade and subject
 * vocabularies do NOT come here. They have one home — `src/config/
 * canonicalEducation.js`, reached through `src/curriculum/catalog/` — and a
 * second registry is the specific failure §14.4 forbids.
 *
 * `learnerTabs` IS a fit: it is the learner navigation IA, it has three
 * consumers across two design systems, and the copies it replaced had
 * already drifted in labels, icons and active-state. Read its header
 * before adding a fifth tab.
 */

export { LEARNER_TABS, activeLearnerTab } from './learnerTabs.js'
