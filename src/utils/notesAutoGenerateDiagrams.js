// Client-side diagram generation for the Notes Studio.
//
// After notes are generated, the teacher can add AI-illustrated diagrams to
// key concepts. This module collects the pending jobs, builds prompts from
// concept names and the lesson header, and calls the same `generateDiagram`
// callable used by AssessmentStudio / LessonPlanStudio.

import { generateDiagram } from './generateDiagram'

// Max concepts to illustrate in one automatic pass — prevents burning the
// teacher's monthly diagram allowance on a single notes doc.
export const NOTES_DIAGRAM_CAP = 3

/**
 * Collect key concepts that don't yet have a diagram, up to the cap.
 * @param {object} notes  — the notes output object
 * @returns {Array<{index: number, name: string}>}
 */
export function collectNotesDiagramJobs(notes) {
  const concepts = Array.isArray(notes?.keyConcepts) ? notes.keyConcepts : []
  return concepts
    .map((c, i) => ({ index: i, name: c.name }))
    .filter((j) => j.name && !concepts[j.index]?.diagramUrl)
    .slice(0, NOTES_DIAGRAM_CAP)
}

/**
 * Build a diagram prompt for a single key concept.
 * Keeps the prompt specific enough for Recraft to produce a labelled B&W
 * line-art illustration that matches the lesson context.
 */
export function buildConceptDiagramPrompt(concept, header) {
  const subject = header?.subject || ''
  const grade = header?.grade || ''
  const topic = header?.topic || ''

  const parts = [concept.name]
  if (subject) parts.push(`${subject} diagram`)
  if (topic && topic !== concept.name) parts.push(`for lesson: ${topic}`)
  if (grade) parts.push(grade)
  parts.push('labelled black-and-white line art for classroom teaching')

  return parts.join(' — ')
}

/**
 * Generate diagrams for key concepts that still need one.
 *
 * @param {object} notes
 * @param {{ onAttach: (conceptIndex, url) => void, provider?: string }} opts
 * @returns {Promise<{ error: string|null }>}
 */
export async function autoGenerateNotesDiagrams(notes, { onAttach, provider = 'recraft' } = {}) {
  const jobs = collectNotesDiagramJobs(notes)
  let error = null

  for (const job of jobs) {
    const prompt = buildConceptDiagramPrompt(notes.keyConcepts[job.index], notes.header)
    try {
      const { url } = await generateDiagram({ prompt, provider })
      if (url) onAttach?.(job.index, url)
    } catch (err) {
      error = err?.message || 'Diagram generation failed.'
      break
    }
  }

  return { error }
}
