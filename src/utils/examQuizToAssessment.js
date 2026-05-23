/**
 * Adapter: AI-generated exam_quiz content → assessment-shape used by
 * the existing DOCX exporter (`src/utils/assessmentToDocx.js`) and
 * print-preview pipeline (`src/utils/assessmentToPdf.js`).
 *
 * The teacher-pipeline exporters expect a `{assessment, questions[]}`
 * pair plus optional answer-key + marking-guide data. The v2
 * learner-AI `examQuizContentSchema` shape (see
 * `src/schemas/learnerAi.js` → examQuizContentSchema) is
 * structured differently: header + sections[] (A/B/C) + answerKey[]
 * + markingGuide. This module is a pure projection so both
 * pipelines can share the existing exporters.
 *
 * Pure, no Firestore. Unit-tested by
 * scripts/test-exam-quiz-to-assessment.mjs.
 */

/**
 * Convert one AI exam-quiz artifact's `content` payload into the
 * assessment-shape the existing exporters consume.
 *
 * @param {object} content   the `aiGeneratedContent.content` payload
 *                           for a taskType='exam_quiz' artifact
 * @returns {{assessment: object, questions: object[],
 *           answerKey: object[], markingGuide: string}}
 */
export function examQuizToAssessment(content) {
  if (!content || typeof content !== 'object') {
    return {
      assessment: emptyAssessment(),
      questions: [],
      answerKey: [],
      markingGuide: '',
    }
  }
  const h = content.header || {}
  const assessment = {
    title: composeTitle(content, h),
    schoolName: safeString(h.schoolName),
    grade: safeString(h.grade),
    term: safeString(h.term),
    year: Number.isInteger(h.year) ? h.year : new Date().getUTCFullYear(),
    subject: safeString(h.subject),
    paperName: safeString(h.paperName),
    learnerNameLabel: safeString(h.learnerNameLabel) || 'Learner name:',
    dateLabel: safeString(h.dateLabel) || 'Date:',
    timeLabel: safeString(h.timeLabel) || 'Time:',
    totalMarks: Number.isInteger(h.totalMarks) ? h.totalMarks : 0,
    timeAllowed: safeString(h.timeAllowed) || '',
    instructions: Array.isArray(h.instructions) ?
      h.instructions.filter(s => typeof s === 'string' && s.length).slice(0, 12) :
      [],
  }

  // Flatten sections[] into a single questions[] list, stamping the
  // section meta + a stable numericId so callers can render section
  // headings + question numbers without re-parsing the section tree.
  const questions = []
  let numericId = 0
  for (const sec of Array.isArray(content.sections) ? content.sections : []) {
    if (!sec || typeof sec !== 'object') continue
    const sectionId = safeString(sec.id)
    const sectionTitle = safeString(sec.title)
    const sectionMarks = Number.isInteger(sec.marks) ? sec.marks : 0
    const sectionInstructions = safeString(sec.instructions)
    for (const q of Array.isArray(sec.questions) ? sec.questions : []) {
      if (!q || typeof q !== 'object') continue
      numericId += 1
      questions.push({
        // Identity for the exporter's anchor + the print preview.
        id: `${sectionId || 'X'}-${q.number || numericId}`,
        numericId,
        sectionId,
        sectionTitle,
        sectionMarks,
        sectionInstructions,

        // Question fields the exporter understands.
        number: Number.isInteger(q.number) ? q.number : numericId,
        questionType: safeString(q.questionType),
        prompt: safeString(q.prompt),
        options: Array.isArray(q.options) ?
          q.options.map(o => safeString(o)).filter(Boolean).slice(0, 6) :
          [],
        correctAnswer: safeString(q.correctAnswer),
        structuredParts: Array.isArray(q.structuredParts) ?
          q.structuredParts.map(p => ({
            label: safeString(p.label),
            prompt: safeString(p.prompt),
            marks: Number.isInteger(p.marks) ? p.marks : 0,
            expectedAnswer: safeString(p.expectedAnswer),
            markingPoints: Array.isArray(p.markingPoints) ?
              p.markingPoints.map(m => safeString(m)).filter(Boolean).slice(0, 8) :
              [],
          })) :
          [],
        marks: Number.isInteger(q.marks) ? q.marks : 0,
        difficulty: safeString(q.difficulty),
        bloomsLevel: safeString(q.bloomsLevel),

        // Curriculum echo — the exporter can render these or ignore them.
        grade: safeString(q.grade),
        subject: safeString(q.subject),
        term: safeString(q.term),
        topic: safeString(q.topic),
        subtopic: safeString(q.subtopic),
        competency: safeString(q.competency),
        learningOutcome: safeString(q.learningOutcome),
      })
    }
  }

  const answerKey = Array.isArray(content.answerKey) ?
    content.answerKey.map(k => ({
      sectionId: safeString(k.sectionId),
      questionNumber: Number.isInteger(k.questionNumber) ? k.questionNumber : 0,
      answer: safeString(k.answer),
      marks: Number.isInteger(k.marks) ? k.marks : 0,
      markingNotes: safeString(k.markingNotes),
    })) :
    []

  return {
    assessment,
    questions,
    answerKey,
    markingGuide: safeString(content.markingGuide),
  }
}

/**
 * Suggest a sensible filename for the exported Word / PDF document.
 * Strips characters that some filesystems dislike + lower-cases.
 */
export function suggestExamQuizFilename(content, extension = 'docx') {
  const subject = safeString(content && content.header && content.header.subject) || 'subject'
  const grade = safeString(content && content.header && content.header.grade) || 'grade'
  const paper = safeString(content && content.header && content.header.paperName)
  const stem = [grade ? `g${grade}` : '', subject, paper || 'exam', timestampSuffix()]
      .filter(Boolean).join('-').toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
  return `${stem || 'exam-paper'}.${extension}`
}

// ── Helpers ──────────────────────────────────────────────────────────

function safeString(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function emptyAssessment() {
  return {
    title: '', schoolName: '', grade: '', term: '', year: new Date().getUTCFullYear(),
    subject: '', paperName: '', learnerNameLabel: 'Learner name:',
    dateLabel: 'Date:', timeLabel: 'Time:', totalMarks: 0, timeAllowed: '',
    instructions: [],
  }
}

function composeTitle(content, header) {
  if (typeof content.title === 'string' && content.title.length) return content.title
  const subject = safeString(header.subject) || 'Subject'
  const grade = safeString(header.grade)
  const paper = safeString(header.paperName) || 'Examination'
  return [subject, grade ? `Grade ${grade}` : '', paper].filter(Boolean).join(' — ')
}

function timestampSuffix() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}
