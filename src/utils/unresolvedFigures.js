/**
 * Re-export only. The rules live in the shared assessment package.
 *
 * @see functions/shared/assessment/unresolvedFiguresCore.js
 *
 * This file exists so the ~4 call sites in src/ keep their import path, and so
 * the boundary is visible at the point of crossing rather than buried in a
 * relative path with four dot-dots in it. DO NOT ADD A RULE HERE. Anything
 * defined in this file is a rule the server does not enforce, which is the
 * situation the shared package was created to end.
 */
export {
  FIGURE_STAGES,
  STATIC_STAGE,
  unresolvedFigure,
  listNumbers,
  unresolvedFigureMessage,
  affectedQuestionNumbers,
  unresolvedFiguresMessage,
  unresolvedRequiredFigures,
  UnresolvedFigureError,
} from '../../functions/shared/assessment/unresolvedFiguresCore.js'
