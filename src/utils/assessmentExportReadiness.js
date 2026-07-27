/**
 * One export-readiness decision, for every surface that exports a paper.
 *
 * ## Why this exists
 *
 * The Assessment Studio assembled the gate itself: serialize the sections,
 * build the question-number map, spot the untouched starter, collect the
 * blocking issues, resolve the required diagrams, then call
 * `describeExportBlock`. Six steps in one component, and the two other places a
 * teacher can export a paper — the library list and the library item detail —
 * had none of them. They checked `questions.length === 0` and nothing else.
 *
 * So every blocking rule the studio enforced could be sidestepped by exporting
 * the same paper from the list instead. A rule with a normal workflow around it
 * is not a rule. Copying the six steps into three components would have made
 * that worse rather than better: three assemblies drift, and the one that drifts
 * is the one nobody is looking at.
 *
 * ## What it does NOT own
 *
 * No rules of its own — same discipline as `assessmentExportGate.js`. Issues
 * come from `collectQuizIssues`, the figure check from
 * `unresolvedRequiredFigures`, the verdict from `describeExportBlock`. This is
 * the assembly, and the assembly is the thing that was duplicated.
 *
 * ## The `localId` trap
 *
 * `collectQuizIssues` keys every issue on a question's `localId`, and
 * `describeExportBlock` needs those keys to name the questions a teacher must
 * fix. `localId` is an in-memory identifier that is NEVER persisted, so a paper
 * loaded from Firestore does not have one — feeding those documents straight in
 * produces issue ids like `question-text-undefined`, a `numbers` array that
 * comes back empty, and a blocked paper whose message names no question at all.
 *
 * That is why the saved-paper entry point below hydrates first rather than
 * passing the documents through. It is the single most likely way to wire this
 * up wrongly and still see something that looks like it works.
 */

import { collectQuizIssues } from './quizValidation.js'
import { hydrateQuizSections, hasOnlyEmptyStarterSection } from './quizSections.js'
import { describeExportBlock } from './assessmentExportGate.js'
import { unresolvedRequiredFigures } from './unresolvedFigures.js'
import { buildQuestionNumberMap } from '../../functions/shared/assessment/questionNumberingCore.js'

/**
 * localId → the number printed on the paper.
 *
 * Re-exported, not defined: the numbering moved into the shared assessment
 * package because every blocking message names questions by number, and a
 * server that numbered differently would tell a teacher to go and fix a
 * question that is not the broken one.
 */
export { buildQuestionNumberMap }

/**
 * Decide whether this paper may be exported, from editor sections.
 *
 * @param {object} input
 * @param {Array}  input.sections          editor sections (the shape collectQuizIssues reads)
 * @param {Array}  input.parts             section/part definitions
 * @param {object} input.paperDetails      {title, subject, grade} as the checker sees them
 * @param {object} input.serialized        serializeQuizSections() output, when the caller
 *                                         already has it — recomputing would risk a second
 *                                         answer to "what is on this paper"
 * @param {Array}  input.validationIssues  collectQuizIssues().issues, when the caller already
 *                                         computed it (the studio shows the same issues as
 *                                         badges, and computing twice invites divergence)
 * @param {Function} input.diagramResolver the catalog call the EXPORTERS make
 * @returns {{questions, passages, questionCount, totalMarks, questionNumbers, issues, gate}}
 */
export function buildAssessmentExportReadiness({
  sections = [],
  parts = [],
  paperDetails = {},
  serialized = null,
  validationIssues = null,
  diagramResolver,
} = {}) {
  if (typeof diagramResolver !== 'function') {
    // The same refusal `unresolvedRequiredFigures` makes, one level up, so the
    // caller that forgets it fails here rather than silently gating on
    // everything except figures.
    throw new TypeError('buildAssessmentExportReadiness needs the resolver the exporters use')
  }
  const paper = serialized || { questions: [], passages: [] }
  const questions = paper.questions || []
  const questionNumbers = buildQuestionNumberMap(questions)
  const issues = validationIssues || collectQuizIssues({
    form: paperDetails, sections, parts, questionNumbers,
  }).issues
  const unresolvedFigures = unresolvedRequiredFigures(paper, diagramResolver)

  return {
    questions,
    passages: paper.passages || [],
    questionCount: Number.isFinite(Number(paper.questionCount))
      ? Number(paper.questionCount)
      : questions.length,
    totalMarks: paper.totalMarks ?? 0,
    questionNumbers,
    issues,
    unresolvedFigures,
    gate: describeExportBlock({
      issues,
      questionNumbers,
      questionCount: Number.isFinite(Number(paper.questionCount))
        ? Number(paper.questionCount)
        : questions.length,
      // Only meaningful for live editor state: it recognises the untouched
      // starter block a fresh studio session creates, which counts as one
      // question but reads as an empty page. A saved paper reaches
      // `questionCount === 0` on its own, and a saved paper carrying a single
      // blank question genuinely IS one broken question.
      emptyStarter: hasOnlyEmptyStarterSection(sections),
      unresolvedFigures,
    }),
  }
}

/**
 * The same decision for a paper loaded from Firestore.
 *
 * Hydrates first, and that is the whole point of this entry point existing.
 * `hydrateQuizSections` restores each question's `localId` from its document id,
 * which is what lets `collectQuizIssues` key its issues and the gate name the
 * questions to fix. Passing the raw documents would produce a blocked paper with
 * a message that names nothing — the failure that looks most like success.
 *
 * @param {object} assessment  the assessment document (carries passages/parts/pagebreaks)
 * @param {Array}  questions   the questions subcollection, as stored
 * @param {Function} diagramResolver the catalog call the EXPORTERS make
 */
export function buildSavedAssessmentExportReadiness(assessment = {}, questions = [], diagramResolver) {
  const { sections, parts } = hydrateQuizSections(
    Array.isArray(questions) ? questions : [],
    assessment.passages || [],
    assessment.parts || [],
    assessment.pagebreaks || [],
  )
  // Serialized from the HYDRATED sections rather than from the documents, so the
  // questions the gate reasons about are the ones the number map is keyed on.
  const hydratedQuestions = sections.flatMap((section) => (
    section?.kind === 'passage'
      ? (section.passage?.questions || [])
      : (section?.question ? [section.question] : [])
  ))
  return buildAssessmentExportReadiness({
    sections,
    parts,
    paperDetails: {
      title: assessment.title || '',
      subject: assessment.subject || '',
      grade: assessment.grade || '',
    },
    serialized: {
      questions: hydratedQuestions,
      passages: assessment.passages || [],
      questionCount: hydratedQuestions.length,
      totalMarks: assessment.totalMarks ?? 0,
    },
    diagramResolver,
  })
}
