/**
 * Re-export only. The rules live in the shared assessment package.
 *
 * @see functions/shared/assessment/answerChoicesCore.js
 *
 * How many answer choices a question offers, and whether the ones it offers are
 * usable, is a RULE: the export gate blocks a paper whose correct answer fell
 * off the end when the teacher switched from A–D to A–C, and one whose
 * distractors are the same number written two ways. A server that resolved the
 * count differently would refuse papers the studio accepts, or accept papers the
 * studio refuses. DO NOT ADD A RULE HERE.
 */
export * from '../../functions/shared/assessment/answerChoicesCore.js'
