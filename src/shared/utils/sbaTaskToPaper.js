/**
 * Adapt a generated SBA (School Based Assessment) task into the same typed
 * "paper layout" blocks the Assessment Studio renders, so an SBA task sheet
 * looks like a real school exam paper (marble banner → NAME/DATE → instructions
 * → numbered tasks with ruled answer space → END OF PAPER → footer code) rather
 * than a metadata card.
 *
 * The blocks produced here match the shapes consumed by `PaperBlock`
 * (src/components/teacher/views/PaperBlocks.jsx) — the same renderer the
 * Assessment Studio walks. The marking scheme (answers, mark allocations,
 * rubric criteria) is intentionally NOT part of the paper: it is the teacher's
 * copy and is rendered separately by SbaTaskView when answers are shown.
 *
 * Pure / side-effect free so it can be unit-tested with plain `node`.
 */

import { SBA_GRADES, SBA_SUBJECTS } from '../../config/sba.js'

const GRADE_WORDS = {
  1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX',
  7: 'SEVEN', 8: 'EIGHT', 9: 'NINE', 10: 'TEN', 11: 'ELEVEN', 12: 'TWELVE',
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

// 'G5' / 'Grade 5' / '5' → 5
function gradeNumber(grade) {
  const m = String(grade || '').match(/\d+/)
  return m ? Number(m[0]) : null
}

function gradeWord(grade) {
  const n = gradeNumber(grade)
  return n != null ? (GRADE_WORDS[n] || String(n)) : String(grade || '').toUpperCase()
}

// The stored subject can be the taxonomy value ('english'), the label
// ('English Language'), or a free-text string the model returned. Resolve to a
// clean human label, falling back to the raw string.
function subjectLabel(subject) {
  const raw = String(subject || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  const hit = SBA_SUBJECTS.find(
    (s) => s.value === lower || s.label.toLowerCase() === lower,
  )
  return hit ? hit.label : raw
}

function gradeLabel(grade) {
  const n = gradeNumber(grade)
  const hit = SBA_GRADES.find((g) => g.value === `G${n}`)
  return hit ? hit.value : `G${n ?? ''}`
}

function paperTitle(header, year) {
  const word = gradeWord(header.grade)
  const term = String(header.term || '').trim()
  const termBit = term ? ` ${term.toUpperCase()}` : ''
  return `GRADE ${word}${termBit} SCHOOL BASED ASSESSMENT - ${year}`
}

function footerCode(header, year) {
  return [
    gradeLabel(header.grade),
    subjectLabel(header.subject),
    String(header.term || '').trim(),
    String(year),
  ].filter(Boolean).join('/')
}

// A written task is rendered as a question with ruled answer space. Longer
// tasks (compositions, extended responses) get an essay-sized block; short
// responses get lines scaled to the marks on offer.
function questionBlock(q, number) {
  const marks = Number(q.marks) || 0
  const isEssay = marks >= 8
  const answerLines = isEssay ? clamp(marks, 8, 16) : clamp(marks || 2, 2, 8)
  const block = {
    kind: 'question',
    number,
    text: String(q.prompt || ''),
    marks,
    type: isEssay ? 'essay' : 'short_answer',
    answerFormat: 'lines',
    answerLines,
    blankLabels: [],
    showAnswer: false,
  }
  // An exact library figure printed beside the question (a maths shape, a
  // science apparatus, a graph to read off). Rendered by PaperQuestionBlock /
  // renderPaperBlocksToDocx, which both already understand `imageDiagram`.
  if (q.diagram && q.diagram.libraryKey) {
    block.imageDiagram = { libraryKey: q.diagram.libraryKey, params: q.diagram.params || {} }
  }
  return block
}

/**
 * Build the printable-paper blocks for an SBA task.
 *
 * @param {object} task   The validated SBA task ({ header, instructions, stimulus, questions, markingScheme }).
 * @param {object} [opts]
 * @param {number} [opts.year]       Year shown in the banner/footer (defaults to the current year).
 * @param {string} [opts.schoolName] School name for the banner (defaults to the placeholder).
 * @returns {Array} layout blocks consumable by PaperBlock / PaperDocument.
 */
export function buildSbaPaperBlocks(task = {}, opts = {}) {
  const header = task.header || {}
  const year = opts.year || new Date().getFullYear()
  const blocks = []

  // 1. Banner — the school name comes from the caller (the studio's editable
  // field / the teacher's profile) or, failing that, what was saved on the task
  // header. PaperHeaderBlock shows the "YOUR SCHOOL NAME" placeholder when blank.
  blocks.push({
    kind: 'header',
    schoolName: String(opts.schoolName || header.schoolName || '').trim(),
    title: paperTitle(header, year),
    subject: subjectLabel(header.subject).toUpperCase(),
    paperName: String(header.title || '').trim().toUpperCase(),
  })

  // 2. Learner fields + total marks
  blocks.push({
    kind: 'learnerFields',
    name: true,
    date: true,
    classField: true,
    marks: true,
    totalMarks: header.totalMarks != null ? header.totalMarks : null,
  })

  // 3. Instructions (prepend a time line when a duration is set)
  const instrLines = []
  if (String(header.duration || '').trim()) instrLines.push(`Time allowed: ${String(header.duration).trim()}.`)
  if (String(task.instructions || '').trim()) instrLines.push(String(task.instructions).trim())
  if (instrLines.length === 0) instrLines.push('Answer all the tasks in the spaces provided.')
  blocks.push({ kind: 'instructions', text: instrLines.join('\n\n'), isMarkingKey: false })

  // 4. Stimulus → a passage block the learner reads/studies, optionally with a
  // library figure (e.g. the apparatus for a science experiment).
  const stimulusDiagram = task.stimulusDiagram && task.stimulusDiagram.libraryKey
    ? { libraryKey: task.stimulusDiagram.libraryKey, params: task.stimulusDiagram.params || {} }
    : null
  if (String(task.stimulus || '').trim() || stimulusDiagram) {
    blocks.push({
      kind: 'passage',
      title: 'Read / study the following carefully',
      text: String(task.stimulus || '').trim(),
      imageUrl: '',
      imageAlt: '',
      imageDiagram: stimulusDiagram,
    })
  }

  // 5. Tasks
  const questions = Array.isArray(task.questions) ? task.questions : []
  questions.forEach((q, i) => {
    if (!String(q?.prompt || '').trim()) return
    blocks.push(questionBlock(q, q.number || i + 1))
  })

  // 6. End-of-paper + footer code
  blocks.push({ kind: 'endOfPaper', text: '— END OF PAPER —' })
  blocks.push({ kind: 'footerCode', code: footerCode(header, year) })

  return blocks
}
