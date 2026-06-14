/**
 * AI suggestion assistant for the Weekly Focus studio's Teacher's / Learner's
 * resources. Given the grade, subject, topic and (optional) sub-topic, asks
 * Gemini (via Firebase AI Logic) for a short list of practical, locally
 * realistic teaching/learning materials a Zambian CBC classroom can use —
 * charts, flashcards, textbooks, worksheets, diagrams, pictures, real
 * objects, classroom activities and learner exercises.
 *
 * Returns { teacherResources: string[], learnerResources: string[] }. The
 * teacher accepts / edits / removes individual items in the studio, so this
 * only proposes — it never writes anything. Degrades to empty lists on any
 * failure (offline, App Check, bad JSON) so the studio keeps working.
 */

import { generateJSON } from './aiLogic'

const MAX_ITEMS = 8

function cleanList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    const s = String(item ?? '').trim().replace(/^\s*(?:[-*–]|\d+[.)])\s*/, '')
    const key = s.toLowerCase()
    if (s && s.length <= 140 && !seen.has(key)) { seen.add(key); out.push(s) }
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

/**
 * @param {object} ctx
 *   grade   e.g. 'G4' or '4'
 *   subject display label, e.g. 'Mathematics'
 *   topic   e.g. 'Fractions'
 *   subtopic (optional)
 *   competence (optional) the specific competence, for sharper suggestions
 * @returns {Promise<{teacherResources: string[], learnerResources: string[]}>}
 */
export async function suggestForecastResources({ grade, subject, topic, subtopic, competence } = {}) {
  if (!topic || !subject) return { teacherResources: [], learnerResources: [] }

  const gradeLabel = String(grade || '').replace(/^G/i, '') || '(upper primary)'
  const prompt = [
    'You are a Zambian Competence-Based Curriculum (CBC) teaching assistant for upper-primary teachers.',
    `Suggest practical teaching and learning resources for this lesson:`,
    `- Grade: ${gradeLabel}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : '',
    competence ? `- Specific competence: ${competence}` : '',
    '',
    'Resources should be realistic for a typical Zambian classroom (low-cost, locally available where possible) and may include charts, flashcards, textbooks/modules, worksheets, diagrams, pictures, real objects, classroom activities and learner exercises.',
    'Return ONLY valid JSON of this exact shape, with each item a short phrase (no numbering, no extra commentary):',
    '{ "teacherResources": ["..."], "learnerResources": ["..."] }',
    `Give at most ${MAX_ITEMS} items per list. teacherResources = what the teacher prepares/uses; learnerResources = what learners use or do.`,
  ].filter(Boolean).join('\n')

  try {
    const data = await generateJSON(prompt, { timeoutMs: 20000 })
    return {
      teacherResources: cleanList(data?.teacherResources),
      learnerResources: cleanList(data?.learnerResources),
    }
  } catch (err) {
    console.warn('[forecastResourceSuggest] suggestion failed', err)
    return { teacherResources: [], learnerResources: [] }
  }
}
