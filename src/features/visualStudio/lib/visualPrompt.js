/**
 * Visual Studio — automatic prompt improvement.
 *
 * Turns the teacher's structured choices (grade / subject / topic / subtopic /
 * use-case / style) into a single descriptive prompt for the `generateDiagram`
 * Cloud Function. The server then wraps THIS string with its provider-specific
 * "clean B&W line art, no text labels…" guard (see buildFinalPrompt in
 * functions/teacherTools/generateDiagram.js), so we deliberately do NOT repeat
 * those rules here — we only add the educational specificity the model needs.
 *
 * Pure + dependency-free so it can be unit-tested with plain `node`.
 */

import { VISUAL_STYLE_MAP, USE_CASE_MAP } from './visualStudioMeta.js'

function clean(value, max = 120) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

// Per-style descriptive lead-ins. Kept short — the server guard handles the
// "no colour / no text" mechanics; this just sets the subject framing.
const STYLE_LEAD = {
  bw_test_diagram: 'A clear, simple labelled-ready diagram',
  labelled_diagram: 'A clear diagram with distinct parts that can be labelled',
  unlabelled_diagram: 'A clear, plain diagram with distinct parts',
  line_drawing: 'A simple line drawing',
  photocopy_friendly: 'A bold, high-contrast diagram',
  colouring_page: 'A bold outline drawing suitable for colouring in',
  colour_illustration: 'A bright, friendly classroom illustration',
  realistic_science: 'A realistic, accurate reference illustration',
}

/**
 * Compose the improved diagram prompt.
 * @param {object} input
 * @param {string|number} input.grade
 * @param {string} input.subject
 * @param {string} input.topic
 * @param {string} [input.subtopic]
 * @param {string} [input.useCase]   — USE_CASES id
 * @param {string} [input.styleId]   — VISUAL_STYLES id
 * @param {string} [input.extra]     — teacher's free-text additions
 * @returns {string}
 */
export function composeVisualPrompt({
  grade,
  subject,
  topic,
  subtopic,
  useCase,
  styleId,
  extra,
} = {}) {
  const style = VISUAL_STYLE_MAP[styleId] || VISUAL_STYLE_MAP.bw_test_diagram
  const lead = STYLE_LEAD[style.id] || STYLE_LEAD.bw_test_diagram

  const topicText = clean(topic)
  const subtopicText = clean(subtopic)
  const subjectText = clean(subject, 60)
  const gradeText = clean(grade, 12)

  // The visual subject: most specific available (subtopic, else topic).
  const focus = subtopicText && topicText
    ? `${topicText} — ${subtopicText}`
    : (subtopicText || topicText || subjectText || 'an educational topic')

  const parts = [`${lead} of ${focus}.`]

  const ctxBits = []
  if (subjectText) ctxBits.push(subjectText)
  if (gradeText) ctxBits.push(`Grade ${gradeText}`)
  if (ctxBits.length) {
    parts.push(`For ${ctxBits.join(' ')} learners in the Zambian CBC curriculum.`)
  }

  const uc = USE_CASE_MAP[useCase]
  if (uc) parts.push(`Intended for ${uc.promptHint}.`)

  // Universal quality nudges for school diagrams. Age-appropriate + accurate
  // are the two failure modes the safety reviewer (item 11) most often flags.
  parts.push(
    'Show the important parts clearly and separated so each can be pointed to. ' +
    'Keep it accurate, age-appropriate and uncluttered.',
  )

  const extraText = clean(extra, 300)
  if (extraText) parts.push(extraText)

  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 800)
}

/**
 * Build a default human title for a generated visual, e.g.
 * "Human respiratory system — Grade 5 Integrated Science".
 */
export function buildVisualTitle({ topic, subtopic, grade, subject } = {}) {
  const focus = clean(subtopic) || clean(topic) || clean(subject) || 'Untitled visual'
  const tail = []
  if (grade) tail.push(`Grade ${clean(grade, 12)}`)
  if (subject) tail.push(clean(subject, 40))
  return tail.length ? `${focus} — ${tail.join(' ')}` : focus
}

/**
 * Derive search keywords for the picture bank from the structured inputs.
 * @returns {string[]}
 */
export function deriveKeywords({ topic, subtopic, subject, grade } = {}) {
  const tokens = new Set()
  for (const src of [topic, subtopic, subject]) {
    for (const t of clean(src, 120).toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 2) tokens.add(t)
    }
  }
  if (grade) tokens.add(`grade${clean(grade, 6).toLowerCase()}`)
  return Array.from(tokens).slice(0, 20)
}
