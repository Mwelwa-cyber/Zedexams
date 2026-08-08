/**
 * Re-export only. The diagram catalogue lives in the shared assessment package.
 *
 * @see functions/shared/assessment/diagramCatalogCore.js
 * @see functions/shared/assessment/curriculumDiagramsCore.js
 *
 * This file exists so the Notes Studio's call sites keep a short import path,
 * and so the boundary is visible at the point of crossing rather than buried in
 * a relative path with four dot-dots in it. DO NOT ADD A RULE HERE — there is
 * one diagram catalogue, and a figure defined in this file is a figure the
 * Cloud Functions export path cannot draw.
 */
export {
  DIAGRAM_CATALOG,
  getDiagram,
  renderDiagramSvg,
} from '../../functions/shared/assessment/diagramCatalogCore.js'

export {
  CURRICULUM_DIAGRAMS,
  diagramAnswerKey,
  diagramLabelAnchors,
  diagramWordBank,
  matchCurriculumDiagram,
  renderCurriculumDiagram,
} from '../../functions/shared/assessment/curriculumDiagramsCore.js'
