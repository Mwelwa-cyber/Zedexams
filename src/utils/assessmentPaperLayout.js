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
import { richTextToPaperHtml } from '../editor/utils/safeRender.js'
import { analyzeTiming } from './assessmentTiming.js'
import { canonicalizeQuestionType } from '../editor/schema/question.js'
import { normalizeSubParts, sumSubPartMarks } from './questionParts.js'
import { hydrateTableData } from './tableData.js'
import { orderPaperGroups } from './quizSections.js'

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

/**
 * Default number of ruled answer lines per written-answer type, shared by the
 * preview (PaperBlocks.jsx), the PDF (window.print of the preview) and the
 * DOCX export (assessmentToDocx.js). Keeping the counts here — instead of three
 * literals scattered across the renderers — is what stops the Word download
 * drifting from the on-screen paper (e.g. essays printing 10 lines in Word but
 * showing 8 in the preview).
 */
export const DEFAULT_ANSWER_LINES = {
  short: 2,
  diagram: 4,
  essay: 8,
}

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

/**
 * Drop an option-letter prefix the author (or the AI generator) baked into
 * the option text, e.g. "A. digestive system" stored at index 0. Every
 * renderer prepends its own A/B/C/D label, so without this the paper shows
 * "A. A. digestive system". Only strips when the leading letter matches the
 * expected label for that slot and is followed by a real delimiter, so legit
 * content like "Arteries" or "A car is faster" is never touched.
 */
function stripOptionLabel(value, index) {
  if (typeof value !== 'string') return value
  const expected = SECTION_LETTERS[index]
  if (!expected) return value
  const m = value.match(/^\s*([A-Za-z])\s*[.):\-–—]\s+/)
  if (m && m[1].toUpperCase() === expected) return value.slice(m[0].length)
  return value
}

/**
 * Strip a leading "SECTION A:" / "PART 1 —" label the author or generator put
 * in the part title. The renderers always render "Section <letter> — <title>",
 * so a baked-in label produced "Section A — SECTION A: Multiple choice".
 * Requires a clear delimiter (or the label standing alone) so a real title
 * such as "Sections of a plant" survives.
 */
function stripSectionLabel(title) {
  const t = String(title || '').trim()
  if (!t) return ''
  // "SECTION A: Foo" | "PART 1 - Foo" | "SECTION A. Foo" | "SECTION A — Foo"
  const labelled = t.match(/^(?:section|part)\b\s*(?:[a-z]|[ivx]{1,4}|\d{1,3})?\s*[:.)\-–—]+\s*(.*)$/i)
  if (labelled) return labelled[1].trim()
  // Bare label with no title after it ("SECTION A", "PART 1").
  if (/^(?:section|part)\b\s*(?:[a-z]|[ivx]{1,4}|\d{1,3})?\s*$/i.test(t)) return ''
  return t
}

/**
 * Some generated papers stuffed a full name/date/marks header into the cover
 * instructions ("NAME: ___ DATE: ___ TOTAL MARKS: ___ INSTRUCTIONS: Answer
 * ALL questions."), which then printed twice because the learner-fields block
 * already draws those lines. When the text before an "Instructions:" marker is
 * just field labels, drop it and keep the real instruction prose.
 */
function cleanCoverInstructions(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  const m = t.match(/^(.*?)\binstructions?\b\s*[:\-–—]\s*(.+)$/is)
  if (m) {
    const preamble = m[1]
    const rest = m[2].trim()
    if (rest && /\b(?:pupil'?s?\s*name|name|date|class|total\s*marks|marks)\b\s*[:_]/i.test(preamble)) {
      return rest
    }
  }
  return t
}

/**
 * Build paper-ready HTML for a rich-text value (Tiptap JSON, JSON string,
 * or legacy HTML). Returns '' when the value has no content. The result is
 * pre-hydrated for Grade-7 math blocks so the PDF print window — which
 * doesn't execute JavaScript — can render vertical sums, fractions, and
 * number bases identically to the editor preview.
 */
function richHtml(value) {
  if (value == null || value === '') return ''
  try {
    return richTextToPaperHtml(value) || ''
  } catch {
    return ''
  }
}

// Bounded memo for option-level rich + plain conversions. `buildPaperLayout`
// runs inside an editor `useMemo` whose deps churn on every keystroke —
// before this cache, a 50-question quiz re-parsed 200 (4×50) option
// strings per keystroke. Most of those parses are wasted: only the one
// option the teacher is editing changes; the rest are bit-identical.
//
// Key is the option string itself (plain text OR serialised Tiptap JSON),
// so cache hits work as long as the stored shape is stable. Cap at 1 000
// entries to avoid unbounded growth in long sessions; FIFO eviction is
// fine because the working set on a single quiz is small (~200 entries
// for a 50-question paper).
const RICH_HTML_OPTION_CACHE = new Map()
const PLAIN_OPTION_CACHE = new Map()
const OPTION_CACHE_LIMIT = 1000

function cachedOptionRichHtml(value) {
  if (value == null || value === '') return ''
  if (typeof value !== 'string') return richHtml(value)
  const hit = RICH_HTML_OPTION_CACHE.get(value)
  if (hit !== undefined) return hit
  const out = richHtml(value)
  if (RICH_HTML_OPTION_CACHE.size >= OPTION_CACHE_LIMIT) {
    const firstKey = RICH_HTML_OPTION_CACHE.keys().next().value
    RICH_HTML_OPTION_CACHE.delete(firstKey)
  }
  RICH_HTML_OPTION_CACHE.set(value, out)
  return out
}

function cachedOptionPlain(value) {
  if (value == null || value === '') return ''
  if (typeof value !== 'string') return plain(value)
  const hit = PLAIN_OPTION_CACHE.get(value)
  if (hit !== undefined) return hit
  const out = plain(value)
  if (PLAIN_OPTION_CACHE.size >= OPTION_CACHE_LIMIT) {
    const firstKey = PLAIN_OPTION_CACHE.keys().next().value
    PLAIN_OPTION_CACHE.delete(firstKey)
  }
  PLAIN_OPTION_CACHE.set(value, out)
  return out
}

function groupQuestionsByPart(questions, parts, ungroupedOrder = 0) {
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
  // The loose-questions block is positioned relative to the sections by
  // `ungroupedOrder` (default 0 = lead the paper) rather than being pinned to
  // the top, so a teacher can place a section header above questions that
  // aren't in any section yet.
  return orderPaperGroups(parts || [], ungroupedOrder, standalone.questions.length > 0)
    .map(group => (group.type === 'ungrouped' ? standalone : partsById.get(group.part.id)))
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
  // MCQ option quality: duplicate options, or option images with no alt text.
  // The save-time validator already blocks these, but surfacing them as soft
  // warnings while editing means the teacher fixes them before they hit a
  // wall at export. We count questions (not options) so the badge stays calm.
  let dupOptionQs = 0
  let missingAltQs = 0
  for (const q of questions) {
    if ((q?.type || 'mcq') !== 'mcq') continue
    const opts = Array.isArray(q.options) ? q.options : []
    const media = Array.isArray(q.optionMedia) ? q.optionMedia : []
    const seen = new Map()
    let hasDup = false
    opts.forEach((opt, i) => {
      const key = plain(opt).toLowerCase()
      if (!key) return
      if (seen.has(key)) hasDup = true
      else seen.set(key, i)
    })
    if (hasDup) dupOptionQs += 1
    const altMissing = media.some((m) => {
      const hasMedia = Boolean(m?.imageUrl) || Boolean(m?.diagram && m.diagram.libraryKey)
      const hasAlt = String(m?.alt || '').trim().length > 0
      return hasMedia && !hasAlt
    })
    if (altMissing) missingAltQs += 1
  }
  if (dupOptionQs > 0) {
    warnings.push({ key: 'dup-options', severity: 'warn', message: `${dupOptionQs} question${dupOptionQs === 1 ? ' has' : 's have'} duplicate answer options.` })
  }
  if (missingAltQs > 0) {
    warnings.push({ key: 'option-alt', severity: 'warn', message: `${missingAltQs} question${missingAltQs === 1 ? ' has an' : 's have'} image option${missingAltQs === 1 ? '' : 's'} missing alt text — add a description so it can be saved.` })
  }
  // Timing budget: compare the estimated completion time to the duration set
  // on the paper. Only fires when a duration is set and questions exist.
  if (questions.length > 0) {
    const timing = analyzeTiming(assessment, questions)
    if (timing.verdict === 'over') {
      warnings.push({ key: 'timing-over', severity: 'warn', message: `Estimated ~${timing.estimatedMinutes} min to complete, but the paper allows ${timing.duration} min — it may be too long.` })
    } else if (timing.verdict === 'under') {
      warnings.push({ key: 'timing-under', severity: 'info', message: `Estimated ~${timing.estimatedMinutes} min — well under the ${timing.duration} min allowed; there's room for more.` })
    }
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
  const groups = groupQuestionsByPart(sortedQs, assessment.parts || [], assessment.ungroupedOrder)

  // Paper-level MCQ presentation. Both are optional; when unset the
  // renderers keep their legacy auto behaviour (4-up grid, auto-stack on
  // long options, render every stored option).
  //   mcqOptionLayout      — 'vertical' | 'horizontal' (text options only)
  //   mcqAnswerChoiceCount — 2 | 3 | 4: cap every MCQ to the first N options
  const mcqOpts = {
    mcqLayout: (assessment.mcqOptionLayout === 'vertical' || assessment.mcqOptionLayout === 'horizontal')
      ? assessment.mcqOptionLayout
      : null,
    mcqCount: [2, 3, 4].includes(Number(assessment.mcqAnswerChoiceCount))
      ? Number(assessment.mcqAnswerChoiceCount)
      : null,
  }

  const blocks = []

  // 1. Header — school identity from Teacher Settings → My School rides on
  // the saved paper (applySchoolProfileDefaults seeds it onto fresh papers).
  // All optional: blank fields simply don't render a line.
  blocks.push({
    kind: 'header',
    schoolName: String(assessment.schoolName || '').trim(),
    schoolLogoUrl: String(assessment.schoolLogoUrl || '').trim(),
    motto: String(assessment.motto || '').trim(),
    address: String(assessment.address || '').trim(),
    emisNumber: String(assessment.emisNumber || '').trim(),
    title: buildPaperTitle(assessment),
    subject: String(assessment.subject || '').trim().toUpperCase(),
    paperName: String(assessment.paperName || '').trim().toUpperCase(),
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
  const instructions = cleanCoverInstructions(plain(assessment.coverInstructions))
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
        title: stripSectionLabel(plain(group.title)),
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
          imageAlt: plain(item.passage.imageAlt) || plain(item.passage.title) || '',
          // Catalog shape diagram on the passage stimulus (e.g. a geometry
          // figure the sub-questions refer to). Passed through from the
          // stored passage doc so all three renderers (preview, PDF, DOCX)
          // can draw it without the layout layer swallowing the field.
          imageDiagram: item.passage.imageDiagram && item.passage.imageDiagram.libraryKey
            ? { libraryKey: item.passage.imageDiagram.libraryKey, params: item.passage.imageDiagram.params || {} }
            : null,
          passageKind: item.passage.passageKind || 'comprehension',
          ...passageMarksFields(item.passage, passageQuestions),
        })
        for (const q of passageQuestions) {
          runningNumber += 1
          blocks.push(buildQuestionBlock(q, runningNumber, includeAnswers, mcqOpts))
        }
        const footer = passageTotalFooter(item.passage, passageQuestions)
        if (footer) blocks.push(footer)
      } else if (item.kind === 'pagebreak') {
        blocks.push({ kind: 'pagebreak' })
      } else {
        runningNumber += 1
        blocks.push(buildQuestionBlock(item.q, runningNumber, includeAnswers, mcqOpts))
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
      imageAlt: plain(passage.imageAlt) || plain(passage.title) || '',
      imageDiagram: passage.imageDiagram && passage.imageDiagram.libraryKey
        ? { libraryKey: passage.imageDiagram.libraryKey, params: passage.imageDiagram.params || {} }
        : null,
      passageKind: passage.passageKind || 'comprehension',
      ...passageMarksFields(passage, []),
    })
  }

  // 7. End-of-paper + footer code
  if (assessment.endOfPaperText) {
    blocks.push({ kind: 'endOfPaper', text: String(assessment.endOfPaperText) })
  }
  if (assessment.footerCode || (assessment.subject && assessment.grade)) {
    blocks.push({ kind: 'footerCode', code: assessment.footerCode || buildFooterCode(assessment) })
  }
  // School footer line (Teacher Settings → My School → Branding) — printed
  // last, under the paper code.
  if (String(assessment.footerText || '').trim()) {
    blocks.push({ kind: 'schoolFooter', text: String(assessment.footerText).trim() })
  }

  return blocks
}

// Stimulus passages (diagram / source / map) auto-total the marks of their
// sub-questions and print "Total: N marks" beneath them. A teacher can pin an
// explicit total via passage.manualMarks. Comprehension passages keep their
// historical behaviour (no total line) to avoid changing existing papers.
const STIMULUS_PASSAGE_KINDS = new Set(['diagram', 'source', 'map'])

function sumQuestionMarks(questions = []) {
  return (questions || []).reduce((sum, q) => sum + (Number(q?.marks) || 0), 0)
}

function passageMarksFields(passage, questions) {
  const auto = sumQuestionMarks(questions)
  const manual = Number.isFinite(Number(passage?.manualMarks)) && passage?.manualMarks != null
    ? Math.max(0, Math.round(Number(passage.manualMarks)))
    : null
  return { autoMarks: auto, manualMarks: manual, totalMarks: manual != null ? manual : auto }
}

function passageTotalFooter(passage, questions) {
  const kind = passage?.passageKind || 'comprehension'
  const { totalMarks, manualMarks } = passageMarksFields(passage, questions)
  // Show the total for stimulus-style passages, or whenever a manual total was
  // pinned. Skip when there's nothing to count.
  const show = STIMULUS_PASSAGE_KINDS.has(kind) || manualMarks != null
  if (!show || totalMarks <= 0) return null
  return { kind: 'passageTotal', totalMarks }
}

function buildQuestionBlock(q, number, includeAnswer, mcqOpts = {}) {
  // Fold any authoring alias ('truefalse' → 'tf', 'fill_in_blank' →
  // 'fill_blanks') onto the canonical type so every downstream renderer (the
  // preview, the PDF print window, the DOCX export, the answer sheet) switches
  // on one spelling. Without this a legacy 'truefalse' doc slipped past every
  // `=== 'tf'` check and printed a true/false question with no options.
  const type = canonicalizeQuestionType(q.type) || 'mcq'
  const { mcqLayout = null, mcqCount = null } = mcqOpts
  // True/False is a 2-choice MCQ — same options/correctAnswer model — so it
  // flows through the MCQ option pipeline below.
  const isChoice = type === 'mcq' || type === 'tf'
  let options = Array.isArray(q.options) ? q.options : []
  // A true/false question authored without an explicit options array (or saved
  // by a surface that only set correctAnswer) still prints "A. True / B. False".
  if (type === 'tf' && options.filter(o => String(o ?? '').trim()).length < 2) {
    options = ['True', 'False']
  }
  let optionMedia = Array.isArray(q.optionMedia) ? q.optionMedia : []
  // Paper-level "answer choices" cap. When the teacher fixes the whole
  // paper to 2/3/4 choices we render only the first N — non-destructive,
  // the stored question keeps every option so switching back restores them.
  // True/False is always exactly two choices, so the cap never applies to it.
  if (type === 'mcq' && mcqCount && options.length > mcqCount) {
    options = options.slice(0, mcqCount)
    optionMedia = optionMedia.slice(0, mcqCount)
  }
  // Drop any letter prefix baked into the option text ("A. digestive system")
  // so the renderers' own A/B/C/D labels don't double up ("A. A. …").
  if (isChoice) {
    options = options.map((o, i) => stripOptionLabel(o, i))
  }
  // optionsMode: 'text', 'image', or 'mixed'. Tells the renderer how to draw.
  let optionsMode = 'text'
  if (isChoice) {
    const hasImage = optionMedia.some(m => m?.imageUrl || m?.diagram)
    const hasText = options.some(o => String(o ?? '').trim())
    if (hasImage && hasText) optionsMode = 'mixed'
    else if (hasImage) optionsMode = 'image'
  }
  // Per-option rich + plain pair. Each option could be authored as plain
  // text (legacy) or a Tiptap JSON document (post Grade-7 upgrade); we
  // expose:
  //   optionsHtml  — pre-hydrated rich HTML for the PDF / DOCX exports
  //   optionsPlain — readable plain text for legacy code paths
  //
  // Both go through the bounded option-string memo so a 50-question
  // editor re-render doesn't re-parse 200 unchanged options. Skip the
  // map entirely for non-MCQ question types where `options` is [].
  const optionsHtml = options.length ? options.map(cachedOptionRichHtml) : []
  const optionsPlain = options.length ? options.map(cachedOptionPlain) : []

  // Short-answer sub-parts: "(a) … (b) … (c) …" under the question's instruction
  // stem. When present the question owns no marks of its own — the total is the
  // sum of the parts' marks. Text + answer are flattened to plain (sub-parts are
  // short sentences, not rich-math blocks).
  const subParts = normalizeSubParts(q.subParts).map(p => ({
    text: plain(p.text),
    answer: plain(p.answer),
    marks: p.marks,
    answerFormat: p.answerFormat,
    answerLines: p.answerLines,
  }))

  return {
    kind: 'question',
    number,
    text: plain(q.text),
    subParts,
    // Rich-text HTML for the question body. The editor preview, PDF
    // print window, and DOCX export all prefer this when present so
    // Grade-7 math blocks (vertical sums, fractions, number bases)
    // come out exactly as they appear in the editor.
    textHtml: richHtml(q.text),
    optionsHtml,
    optionsPlain,
    marks: subParts.length ? sumSubPartMarks(subParts) : (q.marks ?? 1),
    type,
    options,
    optionMedia,
    optionsMode,
    // Paper-level layout hint for text MCQ options ('vertical' | 'horizontal'
    // | null). Null means "use the renderer's auto behaviour".
    mcqLayout: type === 'mcq' ? mcqLayout : null,
    correctAnswer: q.correctAnswer,
    explanation: includeAnswer ? plain(q.explanation) : '',
    imageUrl: q.imageUrl || '',
    // Exact library figure on the stem ({libraryKey, params}); preview/PDF
    // render it via the diagram catalog, DOCX rasterises it.
    imageDiagram: q.imageDiagram && q.imageDiagram.libraryKey
      ? { libraryKey: q.imageDiagram.libraryKey, params: q.imageDiagram.params || {} }
      : null,
    imageAlt: plain(q.imageAlt) || '',
    imageWidth: q.imageWidth || 'full',
    // Additional figures, rendered stacked below the primary by the preview,
    // PDF and DOCX renderers (multi-figure scanned questions).
    images: Array.isArray(q.images)
      ? q.images
          .filter(img => img && img.url)
          .map(img => ({ url: img.url, alt: plain(img.alt) || '', width: img.width || 'full' }))
      : [],
    diagramText: plain(q.diagramText),
    wordBank: Array.isArray(q.wordBank) ? q.wordBank.filter(Boolean) : (q.wordBank ? String(q.wordBank).split('·').map(s => s.trim()).filter(Boolean) : []),
    // Whether word-bank words may be reused across blanks (fill_blanks only).
    wordBankReuse: Boolean(q.wordBankReuse),
    // Fill-in-the-Blanks statements — each prints "A. … ____ …" on its own
    // line. Keep the raw text (underscore runs intact) so the renderers can
    // turn each blank into a long ruled gap or an interactive input. `plain`
    // strips any stray markup without disturbing the underscores.
    statements: Array.isArray(q.statements)
      ? q.statements.map(s => ({
        text: plain(s?.text),
        answers: Array.isArray(s?.answers) ? s.answers.map(a => plain(a)) : [],
      }))
      : [],
    answerLines: typeof q.answerLines === 'number' ? q.answerLines : null,
    // Answer-space format: 'lines' (default), 'none', or 'labelled_blanks'.
    // 'labelled_blanks' prints one "Label: ____" row per blankLabels entry.
    answerFormat: q.answerFormat === 'none' || q.answerFormat === 'labelled_blanks' ? q.answerFormat : 'lines',
    blankLabels: Array.isArray(q.blankLabels)
      ? q.blankLabels.map(l => plain(l)).map(l => l.trim()).filter(Boolean)
      : [],
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
    // Diagram label overlays (x/y are 0..1 ratios of image dimensions; tx/ty,
    // when present, are the part the label's leader line points at).
    diagramLabels: Array.isArray(q.diagramLabels)
      ? q.diagramLabels
        .map(l => {
          const out = {
            x: Math.max(0, Math.min(1, Number(l?.x) || 0)),
            y: Math.max(0, Math.min(1, Number(l?.y) || 0)),
            text: plain(l?.text),
          }
          if (Number.isFinite(Number(l?.tx)) && Number.isFinite(Number(l?.ty))) {
            out.tx = Math.max(0, Math.min(1, Number(l.tx)))
            out.ty = Math.max(0, Math.min(1, Number(l.ty)))
          }
          return out
        })
        // In identify mode the label TEXT is the expected answer — which a
        // teacher legitimately leaves blank (hand-marked, or the answer is
        // obvious from the part) — while the on-image marker is just its
        // NUMBER. So a blank-text identify hotspot is still a real, numbered
        // hotspot and must be kept; dropping it silently deletes a marker and
        // renumbers the rest. In labeled mode an empty pill is just noise.
        .filter(l => q.diagramMode === 'identify' || l.text.length > 0)
      : [],
    diagramMode: q.diagramMode === 'identify' ? 'identify' : 'labeled',
    // Inline data table (null when the question has no attached table).
    // hydrateTableData unfolds the persisted { cells } row shape when the
    // question came straight from a Firestore doc (the AssessmentList export
    // path passes raw docs); in-memory string[][] rows pass through unchanged.
    tableData: (() => {
      const table = hydrateTableData(q.tableData)
      return table
        ? { headers: table.headers.map(h => plain(h)), rows: table.rows.map(row => row.map(c => plain(c))) }
        : null
    })(),
    // Draw & Label canvas height in points (null = no canvas).
    drawingHeight: Number.isFinite(Number(q.drawingHeight)) && Number(q.drawingHeight) > 0
      ? Math.max(80, Math.min(500, Math.round(Number(q.drawingHeight))))
      : null,
    showAnswer: includeAnswer,
  }
}
