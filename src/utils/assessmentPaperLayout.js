/**
 * Single source of truth for rendering an assessment as a "school paper".
 *
 * Returns a flat array of typed blocks that each renderer (in-app preview,
 * PDF print window, DOCX export) walks to produce its own output. The
 * shape is intentionally rendering-agnostic — no React, no HTML strings,
 * no docx-library objects.
 *
 * This lets the printed paper match the in-studio preview, instead of the
 * two drifting (preview = marble banner, PDF = cover-row table).
 */

import { richTextToPlainText } from './quizRichText.js'

export const ASSESSMENT_TYPE_LABELS = {
  weekly: 'Weekly Test',
  monthly: 'Monthly Test',
  mid_term: 'Mid-term Test',
  end_of_term: 'End-of-term Test',
  topic: 'Topic Test',
  mock: 'Mock Exam',
  diagnostic: 'Diagnostic / Baseline',
  pre_test: 'Pre-test',
  post_test: 'Post-test',
  revision: 'Revision Test',
  continuous: 'Continuous Assessment',
  summative: 'Summative Assessment',
  practical: 'Practical Assessment',
  oral: 'Oral Assessment',
  project: 'Project-based Assessment',
}

const GRADE_WORDS = {
  1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE', 6: 'SIX',
  7: 'SEVEN', 8: 'EIGHT', 9: 'NINE', 10: 'TEN', 11: 'ELEVEN', 12: 'TWELVE',
}

const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export function buildPaperTitle(assessment = {}) {
  const grade = assessment.grade ?? ''
  const gradeWord = GRADE_WORDS[grade] || String(grade).toUpperCase()
  const type = assessment.assessmentType
  const term = assessment.term ?? ''
  const year = assessment.year ?? assessment.assessmentYear ?? (assessment.assessmentDate
    ? new Date(assessment.assessmentDate).getFullYear()
    : new Date().getFullYear())
  let typeBit = (ASSESSMENT_TYPE_LABELS[type] || 'TEST').toUpperCase()
  if (type === 'end_of_term' && term) typeBit = `END OF TERM ${term} TEST`
  else if (type === 'mid_term' && term) typeBit = `MID-TERM ${term} TEST`
  else if (type === 'mock') typeBit = 'MOCK EXAMINATION'
  else if (term) typeBit = `TERM ${term} ${typeBit}`
  return `GRADE ${gradeWord} ${typeBit} - ${year}`
}

export function buildFooterCode(assessment = {}) {
  const year = assessment.year ?? (assessment.assessmentDate
    ? new Date(assessment.assessmentDate).getFullYear()
    : new Date().getFullYear())
  return [
    `G${assessment.grade || ''}`,
    assessment.subject || '',
    `Term ${assessment.term || ''}`,
    String(year),
  ].filter(Boolean).join('/')
}

function plain(value) {
  if (!value) return ''
  const out = richTextToPlainText(String(value))
  return out.replace(/\s+/g, ' ').trim()
}

function groupQuestionsByPart(questions, parts) {
  const partsById = new Map()
  for (const part of parts || []) {
    partsById.set(part.id, { ...part, questions: [] })
  }
  const standalone = { id: null, title: '', questions: [], instructions: '' }
  for (const q of questions || []) {
    const partId = q.partId || null
    if (partId && partsById.has(partId)) {
      partsById.get(partId).questions.push(q)
    } else {
      standalone.questions.push(q)
    }
  }
  const ordered = [...partsById.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  if (standalone.questions.length) return [standalone, ...ordered]
  return ordered
}

function passageMembersByPart(passages, parts) {
  // Group passages by partId for inlining within a section.
  const byPart = new Map()
  byPart.set(null, [])
  for (const part of parts || []) byPart.set(part.id, [])
  for (const passage of passages || []) {
    const partId = passage.partId || null
    if (!byPart.has(partId)) byPart.set(partId, [])
    byPart.get(partId).push(passage)
  }
  return byPart
}

/**
 * Compute the warnings panel content for the studio. Pure function so
 * it can be unit-tested without React.
 */
export function computeSmartWarnings(assessment, questions = []) {
  const warnings = []
  if (!String(assessment?.schoolName || '').trim()) {
    warnings.push({ key: 'school', severity: 'warn', message: 'Missing school name — header will show "YOUR SCHOOL NAME".' })
  }
  if (!String(assessment?.subject || '').trim()) {
    warnings.push({ key: 'subject', severity: 'error', message: 'Subject is required — every paper must show its subject.' })
  }
  const totalMarks = questions.reduce((sum, q) => sum + (q?.marks || 0), 0)
  if (questions.length === 0) {
    warnings.push({ key: 'no-questions', severity: 'error', message: 'No questions added yet.' })
  } else if (totalMarks === 0) {
    warnings.push({ key: 'no-marks', severity: 'warn', message: 'Every question is 0 marks. Set marks on each question.' })
  }
  const missingMarks = questions.filter(q => !q?.marks || q.marks === 0).length
  if (missingMarks > 0 && totalMarks > 0) {
    warnings.push({ key: 'some-missing-marks', severity: 'warn', message: `${missingMarks} question${missingMarks === 1 ? '' : 's'} have 0 marks.` })
  }
  // Unbalanced paper: a single Part holds >70% of marks
  if (assessment?.parts?.length > 1 && totalMarks > 0) {
    const byPart = new Map()
    for (const q of questions) {
      const key = q.partId || '__ungrouped__'
      byPart.set(key, (byPart.get(key) || 0) + (q.marks || 0))
    }
    const topShare = Math.max(...byPart.values()) / totalMarks
    if (topShare > 0.7) {
      warnings.push({ key: 'unbalanced', severity: 'info', message: `One section holds ${Math.round(topShare * 100)}% of the marks — consider balancing.` })
    }
  }
  // Repeated-question heuristic: same first 60 chars
  const prefixes = new Map()
  for (const q of questions) {
    const text = plain(q.text).toLowerCase().slice(0, 60)
    if (!text) continue
    prefixes.set(text, (prefixes.get(text) || 0) + 1)
  }
  const repeats = [...prefixes.values()].filter(count => count > 1).length
  if (repeats > 0) {
    warnings.push({ key: 'repeats', severity: 'info', message: `${repeats} possibly repeated question${repeats === 1 ? '' : 's'} detected.` })
  }
  return warnings
}

/**
 * Build the rendering blocks. This is the single source of truth used by:
 *  - The studio's Preview view (React JSX renderer)
 *  - The PDF export (HTML / window.print)
 *  - The DOCX export (simplified, but structurally identical)
 *
 * `assessment` is the saved-or-in-progress document. `questions` is the
 * flat ordered list from serializeQuizSections.
 */
export function buildPaperLayout(assessment = {}, questions = [], { mode = 'paper' } = {}) {
  const includeAnswers = mode === 'scheme'
  const sortedQs = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const groups = groupQuestionsByPart(sortedQs, assessment.parts || [])

  const blocks = []

  // 1. Header
  blocks.push({
    kind: 'header',
    schoolName: String(assessment.schoolName || '').trim(),
    title: buildPaperTitle(assessment),
    subject: String(assessment.subject || '').trim().toUpperCase(),
    paperName: String(assessment.paperName || '').trim().toUpperCase(),
    logoUrl: assessment.schoolLogoUrl || '',
    logoTransform: assessment.schoolLogoTransform || null,
    mode,
  })

  // 2. Learner info row + marks line
  const nameFieldsConfig = {
    name: assessment.showNameField !== false,
    date: assessment.showDateField !== false,
    classField: Boolean(assessment.showClassField),
    marks: assessment.showMarksField !== false,
    className: assessment.className,
    assessmentDate: assessment.assessmentDate,
    duration: assessment.duration,
    totalMarks: questions.reduce((sum, q) => sum + (q?.marks || 0), 0),
  }
  blocks.push({ kind: 'learnerFields', ...nameFieldsConfig })

  // 3. Instructions
  const instructions = plain(assessment.coverInstructions)
  if (instructions || includeAnswers) {
    blocks.push({
      kind: 'instructions',
      text: instructions,
      isMarkingKey: includeAnswers,
    })
  }

  // 4. Build passage map for inlining
  const passagesByPart = passageMembersByPart(assessment.passages || [], assessment.parts || [])
  const usedPassages = new Set()

  // Page breaks are stored as `{id, order, partId}` items in a separate
  // array on the assessment doc, mirroring how passages are stored. We
  // group them by partId here so they slot into the same merge-by-order
  // iteration as standalone questions + passages below.
  const pagebreaksByPart = new Map()
  pagebreaksByPart.set(null, [])
  for (const part of assessment.parts || []) pagebreaksByPart.set(part.id, [])
  for (const pb of assessment.pagebreaks || []) {
    const key = pb.partId || null
    if (!pagebreaksByPart.has(key)) pagebreaksByPart.set(key, [])
    pagebreaksByPart.get(key).push(pb)
  }

  // 5. Sections (Parts) + their questions + passages
  let runningNumber = 0
  groups.forEach((group, groupIndex) => {
    const isUngrouped = !group.id
    const partIndex = isUngrouped
      ? -1
      : (assessment.parts || []).findIndex(p => p.id === group.id)
    const letter = partIndex >= 0 ? SECTION_LETTERS[partIndex] : ''
    const partMarks = group.questions.reduce((sum, q) => sum + (q.marks || 0), 0)

    if (!isUngrouped) {
      blocks.push({
        kind: 'sectionHeader',
        letter,
        title: plain(group.title),
        marks: partMarks,
        instructions: plain(group.instructions),
      })
    } else if (groupIndex === 0 && groups.length > 1) {
      // First group is ungrouped but more parts follow — emit a friendly heading
      // only if there's enough content. Otherwise skip silently.
    }

    // Emit each part's renderable items (standalone questions + passages
    // + page breaks) in the author-typed order. The serializer writes an
    // `order` field onto all three kinds, so we merge-and-sort by that.
    // Page breaks DO NOT increment the running question number — they're
    // just structural markers between questions.
    const partPassages = passagesByPart.get(group.id || null) || []
    const standaloneQs = group.questions.filter(q => !q.passageId)
    const partPagebreaks = pagebreaksByPart.get(group.id || null) || []
    const items = []
    for (const passage of partPassages) {
      items.push({ kind: 'passage', order: passage.order ?? 0, passage })
    }
    for (const q of standaloneQs) {
      items.push({ kind: 'standalone', order: q.order ?? 0, q })
    }
    for (const pb of partPagebreaks) {
      items.push({ kind: 'pagebreak', order: pb.order ?? 0, pb })
    }
    items.sort((a, b) => a.order - b.order)

    for (const item of items) {
      if (item.kind === 'passage') {
        usedPassages.add(item.passage.id)
        const passageQuestions = group.questions.filter(q => q.passageId === item.passage.id)
        blocks.push({
          kind: 'passage',
          title: plain(item.passage.title),
          text: plain(item.passage.passageText),
          imageUrl: item.passage.imageUrl || '',
          passageKind: item.passage.passageKind || 'comprehension',
        })
        for (const q of passageQuestions) {
          runningNumber += 1
          blocks.push(buildQuestionBlock(q, runningNumber, includeAnswers))
        }
      } else if (item.kind === 'pagebreak') {
        blocks.push({ kind: 'pagebreak' })
      } else {
        runningNumber += 1
        blocks.push(buildQuestionBlock(item.q, runningNumber, includeAnswers))
      }
    }
  })

  // 6. Emit any ungrouped passages we haven't already drawn (shouldn't happen
  // because group.partId === passage.partId covers it, but defensive).
  for (const passage of assessment.passages || []) {
    if (usedPassages.has(passage.id)) continue
    blocks.push({
      kind: 'passage',
      title: plain(passage.title),
      text: plain(passage.passageText),
      imageUrl: passage.imageUrl || '',
      passageKind: passage.passageKind || 'comprehension',
    })
  }

  // 7. End-of-paper + footer code
  if (assessment.endOfPaperText) {
    blocks.push({ kind: 'endOfPaper', text: String(assessment.endOfPaperText) })
  }
  if (assessment.footerCode || (assessment.subject && assessment.grade)) {
    blocks.push({ kind: 'footerCode', code: assessment.footerCode || buildFooterCode(assessment) })
  }

  return blocks
}

function buildQuestionBlock(q, number, includeAnswer) {
  const type = q.type || 'mcq'
  const options = Array.isArray(q.options) ? q.options : []
  const optionMedia = Array.isArray(q.optionMedia) ? q.optionMedia : []
  // optionsMode: 'text', 'image', or 'mixed'. Tells the renderer how to draw.
  let optionsMode = 'text'
  if (type === 'mcq') {
    const hasImage = optionMedia.some(m => m?.imageUrl)
    const hasText = options.some(o => String(o ?? '').trim())
    if (hasImage && hasText) optionsMode = 'mixed'
    else if (hasImage) optionsMode = 'image'
  }
  return {
    kind: 'question',
    number,
    text: plain(q.text),
    marks: q.marks ?? 1,
    type,
    options,
    optionMedia,
    optionsMode,
    correctAnswer: q.correctAnswer,
    explanation: includeAnswer ? plain(q.explanation) : '',
    imageUrl: q.imageUrl || '',
    diagramText: plain(q.diagramText),
    wordBank: Array.isArray(q.wordBank) ? q.wordBank.filter(Boolean) : (q.wordBank ? String(q.wordBank).split('·').map(s => s.trim()).filter(Boolean) : []),
    answerLines: typeof q.answerLines === 'number' ? q.answerLines : null,
    // Numeric-only fields. Defaulted to safe values for every block so
    // renderers can read them unconditionally.
    numericTolerance: Number.isFinite(Number(q.numericTolerance)) ? Number(q.numericTolerance) : 0,
    numericUnit: typeof q.numericUnit === 'string' ? q.numericUnit : '',
    // Matching-only fields. Same defaulting strategy.
    matchingLeft: Array.isArray(q.matchingLeft) ? q.matchingLeft.map(s => plain(s)) : [],
    matchingRight: Array.isArray(q.matchingRight) ? q.matchingRight.map(s => plain(s)) : [],
    matchingAnswer: Array.isArray(q.matchingAnswer)
      ? q.matchingAnswer.map(v => (Number.isInteger(Number(v)) ? Number(v) : -1))
      : [],
    // Sequence-only fields. Same defaulting strategy.
    sequenceItems: Array.isArray(q.sequenceItems) ? q.sequenceItems.map(s => plain(s)) : [],
    sequenceAnswer: Array.isArray(q.sequenceAnswer)
      ? q.sequenceAnswer.map(v => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : 0))
      : [],
    showAnswer: includeAnswer,
  }
}
