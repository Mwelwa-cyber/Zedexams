/**
 * Re-export only. The rules live in the shared assessment package.
 *
 * @see functions/shared/assessment/questionTypeCore.js
 *
 * Question-type canonicalisation is a RULE, not a display concern: the export
 * gate blocks on an unrecognised type, and a server that canonicalised
 * differently would refuse papers the studio accepts (or worse, accept papers
 * the studio refuses). DO NOT ADD A RULE HERE.
 */
export * from '../../functions/shared/assessment/questionTypeCore.js'
