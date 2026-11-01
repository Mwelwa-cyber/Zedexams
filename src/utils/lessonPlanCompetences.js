/**
 * Re-export only. The rule that a CBC lesson plan's general competences must
 * show in its lesson goal or rationale lives in the shared lessonPlan package,
 * which the generateLessonPlan Cloud Function reads too.
 *
 * @see functions/shared/lessonPlan/competenceLinkCore.js
 *
 * DO NOT ADD A RULE HERE. A rule written in this file is one the server
 * generator never applies, so the studio and the server would stop agreeing
 * on which plans are complete.
 */
export {
  COMPETENCE_LINK_DIRECTIVE,
  competenceShown,
  missingCompetences,
  competenceSentence,
  ensureCompetenceLink,
} from '../../functions/shared/lessonPlan/competenceLinkCore.js'
