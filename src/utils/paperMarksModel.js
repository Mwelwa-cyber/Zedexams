/**
 * Re-export only. The rules live in the shared assessment package.
 *
 * @see functions/shared/assessment/paperMarksCore.js
 *
 * What a question is worth, and whether the paper's declared totals agree with
 * the sum of its questions, is a RULE: the export gate refuses a paper whose
 * cover says 40 marks and whose questions add up to 38, because whichever number
 * the learner is marked against, one of them is wrong. DO NOT ADD A RULE HERE.
 */
export * from '../../functions/shared/assessment/paperMarksCore.js'
