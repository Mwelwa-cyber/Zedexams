// Convert an AI-generated assessment (the JSON produced by the
// generateAssessment Cloud Function — header/sections/questions/marking
// guide, assessmentSchema v1.1) into Assessment Studio editor blocks:
// a parts[] entry per AI section and a standalone section per question,
// fully editable before saving. Pure module so the mapping rules are
// node-testable.

import {
  createPartGroup,
  createPassageSection,
  createStandaloneSection,
} from './quizSections.js'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

/**
 * Find the correct option index for an AI multiple-choice answer. The
 * model is told to return the full option text, but real outputs also
 * arrive as "B", "B.", or "B. lungs" — accept all of those before
 * falling back to 0 + a review flag.
 */
export function matchAnswerIndex(answer, options) {
  const ans = String(answer || '').trim()
  if (!ans || !Array.isArray(options) || options.length === 0) return -1
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const target = norm(ans)
  const exact = options.findIndex((o) => norm(o) === target)
  if (exact >= 0) return exact
  // Letter answers: "B", "B.", "(b)", "B. lungs"
  const m = /^\(?([a-f])\)?[).\s]/i.exec(ans + ' ')
  if (m) {
    const idx = LETTERS.indexOf(m[1].toUpperCase())
    if (idx >= 0 && idx < options.length) return idx
  }
  // Answer text contained in exactly one option (or vice versa).
  const containing = options
    .map((o, i) => ({ o: norm(o), i }))
    .filter(({ o }) => o && (o.includes(target) || target.includes(o)))
  if (containing.length === 1) return containing[0].i
  return -1
}

function mapType(aiType) {
  switch (aiType) {
    case 'multiple_choice': return 'mcq'
    case 'true_false': return 'mcq' // True/False renders as a 2-option MCQ
    case 'essay': return 'essay'
    case 'short_answer':
    case 'calculation':
    case 'structured':
    default:
      return 'short_answer'
  }
}

/**
 * Map one AI question into the studio's editor question shape (the
 * overrides handed to createStandaloneSection). Returns
 * { overrides, warnings }.
 */
export function mapAiQuestion(q, { partId = null } = {}) {
  const warnings = []
  const aiType = String(q?.type || 'short_answer')
  const type = mapType(aiType)
  const text = String(q?.prompt || '').trim()
  const marks = Number.isFinite(Number(q?.marks)) && Number(q.marks) > 0 ?
    Math.round(Number(q.marks)) : 1
  const answer = String(q?.answer || '').trim()
  const explanation = String(q?.markingGuide || '').trim()
  const reviewNotes = []

  const overrides = {
    type,
    detectedType: type,
    text,
    marks,
    explanation,
    partId,
  }

  if (type === 'mcq') {
    const options = aiType === 'true_false' && !(Array.isArray(q?.options) && q.options.length >= 2) ?
      ['True', 'False'] :
      (Array.isArray(q?.options) ? q.options.map((o) => String(o ?? '').trim()).filter(Boolean) : [])
    overrides.options = options.length >= 2 ? options : ['', '', '', '']
    const idx = matchAnswerIndex(answer, overrides.options)
    if (idx >= 0) {
      overrides.correctAnswer = idx
    } else {
      overrides.correctAnswer = 0
      reviewNotes.push(answer ?
        `AI answer "${answer.slice(0, 80)}" did not match an option — check the correct answer.` :
        'AI did not give an answer — set the correct option.')
    }
    if (options.length < 2) {
      reviewNotes.push('AI returned fewer than 2 options — complete them.')
    }
  } else {
    // Text-answer types carry the model answer as the correctAnswer string.
    overrides.correctAnswer = answer
    if (!answer) reviewNotes.push('AI did not give a model answer.')
  }

  const diagram = String(q?.diagram || '').trim()
  if (diagram) {
    // Carried as a first-class field so the DiagramFixupPanel can find the
    // question and auto-match/generate the figure; the review note is the
    // human-readable fallback on the question card.
    overrides.diagramBrief = diagram
    reviewNotes.push(`Diagram needed: ${diagram} — attach it from the picture bank or generate one.`)
  }

  if (reviewNotes.length > 0) {
    overrides.requiresReview = true
    overrides.reviewNotes = reviewNotes
    warnings.push(...reviewNotes)
  }

  return { overrides, warnings }
}

/**
 * Convert a whole AI assessment into studio blocks.
 * Returns { sections, parts, questionCount, totalMarks, warnings }.
 *
 * Sections WITHOUT a passage become a Part (numbered group heading) of
 * standalone questions. Sections WITH a passage (schema v1.2 comprehension)
 * become the studio's native passage block — story on top, questions
 * attached — which already prints/exports in the Zambian comprehension
 * layout, so no Part wrapper is added (the passage carries its own title
 * and instructions).
 *
 * Never throws on malformed input — skips junk and reports it.
 */
export function aiAssessmentToStudioBlocks(assessment) {
  const out = { sections: [], parts: [], questionCount: 0, totalMarks: 0, warnings: [] }
  const aiSections = Array.isArray(assessment?.sections) ? assessment.sections : []
  aiSections.forEach((sec, sIdx) => {
    const questions = Array.isArray(sec?.questions) ? sec.questions : []
    if (questions.length === 0) return

    const passageText = String(sec?.passage?.text || '').trim()
    if (passageText) {
      const mapped = []
      for (const q of questions) {
        if (!q || typeof q !== 'object' || !String(q.prompt || '').trim()) {
          out.warnings.push('Skipped an empty AI question.')
          continue
        }
        const { overrides, warnings } = mapAiQuestion(q)
        mapped.push(overrides)
        out.questionCount += 1
        out.totalMarks += overrides.marks
        out.warnings.push(...warnings)
      }
      if (mapped.length === 0) return
      out.sections.push(createPassageSection({
        title: String(sec?.passage?.title || sec?.title || `Section ${sIdx + 1}`).trim(),
        instructions: String(sec?.instructions || '').trim(),
        passageText,
        passageKind: 'comprehension',
        questions: mapped,
      }))
      return
    }

    const part = createPartGroup({
      title: String(sec?.title || `Section ${sIdx + 1}`).trim(),
      instructions: String(sec?.instructions || '').trim(),
      order: out.parts.length,
    })
    out.parts.push(part)
    for (const q of questions) {
      if (!q || typeof q !== 'object' || !String(q.prompt || '').trim()) {
        out.warnings.push('Skipped an empty AI question.')
        continue
      }
      const { overrides, warnings } = mapAiQuestion(q, { partId: part.id })
      out.sections.push(createStandaloneSection(overrides))
      out.questionCount += 1
      out.totalMarks += overrides.marks
      out.warnings.push(...warnings)
    }
  })
  return out
}
