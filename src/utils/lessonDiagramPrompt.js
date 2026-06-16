/**
 * Build the auto-suggested prompt for a lesson-plan illustration.
 *
 * The Lesson Plan Studio derives this from the lesson's topic (and sub-topic,
 * subject, grade) so a teacher gets a relevant black-and-white drawing without
 * having to write a prompt. The server-side `generateDiagram` callable wraps
 * whatever we send with its own "clean B&W line art, no text labels" guard, so
 * this stays a plain description of WHAT to draw — never how (no "line art" /
 * "black and white" wording needed here; the server enforces that).
 *
 * Pure + dependency-free so it can be unit-tested under plain `node`.
 */

function humanizeGrade(grade) {
  const g = String(grade || '').trim()
  if (!g) return ''
  const m = /^G(\d+)$/i.exec(g)
  if (m) return `Grade ${m[1]}`
  return g // ECE, etc. — leave as-is
}

function humanizeSubject(subject) {
  const s = String(subject || '').trim()
  if (!s) return ''
  return s
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * @param {{topic?:string, subtopic?:string, subject?:string, grade?:string}} fields
 * @returns {string} a description of the drawing, or '' when there's no topic.
 */
export function buildLessonDiagramPrompt({ topic = '', subtopic = '', subject = '', grade = '' } = {}) {
  const t = String(topic || '').trim()
  const st = String(subtopic || '').trim()
  if (!t && !st) return ''

  const focus = t && st ? `${t}: ${st}` : t || st
  const audience = [humanizeGrade(grade), humanizeSubject(subject)].filter(Boolean).join(' ')

  return audience
    ? `A clear, simple educational illustration of ${focus} for a ${audience} lesson.`
    : `A clear, simple educational illustration of ${focus}.`
}

export default buildLessonDiagramPrompt
