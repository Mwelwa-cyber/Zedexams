// Recognising a PHANTOM assessment paper — one the studio filed without a
// teacher ever authoring it.
//
// How they were produced: the Assessment Paper Studio seeds a new paper with one
// blank starter question in local state and used to answer "has the teacher
// edited this?" from paper CONTENT, a test its own School-Profile seeding
// defeated. So loading /teacher/assessment-papers/new and doing nothing filed a
// paper — one blank question, the default generated title, no marks — into the
// teacher's library and onto the dashboard's Recent Documents feed, every visit.
// The trigger condition is fixed (see isUntouchedPaper in assessmentAutosave.js);
// this module identifies the papers already filed, so they can be removed.
//
// The bar is deliberately high and every check is a REASON: a paper is deleted
// only when there is nothing in it that a teacher could have put there. Anything
// unrecognised keeps the paper. Pure module — no React, no Firebase — imported
// by scripts/cleanup-phantom-assessments.mjs and tested under plain `node`.

import { isGeneratedAssessmentTitle } from './assessmentTitle.js'

/**
 * Is this stored rich-text field empty?
 *
 * Stored paper text arrives in three shapes: a plain/HTML string, a STRINGIFIED
 * Tiptap document (what serializeQuizSections writes), or a Tiptap object. A
 * stringified empty document is not the empty string, so a naive check reads
 * every blank question as written — the exact mistake that would make this
 * script delete nothing and look like it had found nothing to delete.
 */
export function storedRichTextEmpty(value) {
  if (value == null) return true
  if (typeof value === 'object') return tiptapDocEmpty(value)
  const text = String(value).trim()
  if (!text) return true
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') return tiptapDocEmpty(parsed)
    } catch { /* not JSON — fall through to the HTML path */ }
  }
  // HTML (or plain text): strip tags and the entities an "empty" editor leaves.
  // Tags are stripped to a fixpoint so removals can't reassemble a tag
  // (e.g. "<p<x>>" losing its inner tag would otherwise re-form "<p>").
  let stripped = text
  let prev
  do {
    prev = stripped
    stripped = stripped.replace(/<[^>]*>/g, '')
  } while (stripped !== prev)
  stripped = stripped
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim()
  return stripped.length === 0
}

function tiptapDocEmpty(node) {
  if (!node || typeof node !== 'object') return true
  if (typeof node.text === 'string' && node.text.trim()) return false
  // A node that draws something without carrying text is content too: a figure,
  // a fraction, a vertical sum.
  if (node.type && node.type !== 'doc' && node.type !== 'paragraph'
    && node.type !== 'text' && node.type !== 'hardBreak') {
    return false
  }
  const children = Array.isArray(node.content) ? node.content : []
  return children.every(tiptapDocEmpty)
}

/**
 * Is this STORED question doc blank — nothing in it a teacher put there?
 *
 * Mirrors isQuestionBlank in quizSections.js, but reads the stored shape
 * (serialised text, `marks` as written) and additionally refuses to call a
 * question blank when the studio has recorded a human touching it
 * (`teacherEdited`, `locked`).
 */
export function storedQuestionIsBlank(question = {}) {
  const q = question || {}
  if (q.teacherEdited === true || q.locked === true) return false
  if (!storedRichTextEmpty(q.text)) return false
  if (!storedRichTextEmpty(q.sharedInstruction)) return false
  if (!storedRichTextEmpty(q.explanation)) return false
  const options = Array.isArray(q.options) ? q.options : []
  if (options.some(option => !storedRichTextEmpty(option))) return false
  const statements = Array.isArray(q.statements) ? q.statements : []
  if (statements.some(statement => !storedRichTextEmpty(statement?.text))) return false
  const subParts = Array.isArray(q.subParts) ? q.subParts : []
  if (subParts.length) return false
  for (const key of ['topic', 'subtopic', 'diagramText', 'imageUrl', 'imageAlt', 'competency',
    'specificOutcome', 'sourceQuestionNumber', 'answerLines']) {
    if (String(q[key] ?? '').trim()) return false
  }
  if (q.imageDiagram) return false
  if (Array.isArray(q.tableData) ? q.tableData.length : q.tableData) return false
  // A correct answer that is not the default first option is an authoring act.
  const answer = typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : q.correctAnswer
  if (!(answer === '' || answer === 0 || answer == null)) return false
  // Marks beyond the default single mark mean someone weighted the question.
  if (Number(q.marks ?? 1) > 1) return false
  return true
}

/**
 * Decide whether `assessment` (with its `questions` docs) is a phantom.
 *
 * @param {{assessment: object, questions: Array<object>, fallbackYear?: number}} input
 * @returns {{phantom: boolean, evidence: string[], keptBecause: string[]}}
 *   `evidence` reads as the case FOR deleting; `keptBecause` lists every reason
 *   the paper is being kept. A paper with a single entry in keptBecause is kept.
 */
export function inspectAssessmentForPhantom({ assessment = {}, questions = [], fallbackYear } = {}) {
  const a = assessment || {}
  const docs = Array.isArray(questions) ? questions : []
  const evidence = []
  const keptBecause = []

  if (docs.length > 1) keptBecause.push(`${docs.length} questions`)
  else if (docs.length === 1 && !storedQuestionIsBlank(docs[0])) keptBecause.push('its question has content')
  else evidence.push(docs.length === 1 ? 'one blank question' : 'no questions')

  // The recorded counts, independently of the subcollection: a paper claiming
  // more than it holds is a partial/failed read, never a phantom to delete.
  if (Number(a.questionCount ?? 0) > 1) keptBecause.push(`questionCount ${a.questionCount}`)
  if (Number(a.totalMarks ?? 0) > 1) keptBecause.push(`totalMarks ${a.totalMarks}`)
  if (Number(a.passageCount ?? 0) > 0) keptBecause.push('has a passage')
  for (const [key, label] of [['passages', 'passages'], ['parts', 'parts'], ['pagebreaks', 'page breaks']]) {
    if (Array.isArray(a[key]) && a[key].length) keptBecause.push(`has ${label}`)
  }

  // Anything the teacher typed into the paper itself. School branding
  // (schoolName / motto / address / emisNumber / footerText), the duration and
  // the cover instructions are deliberately NOT in this list: the studio seeds
  // them from the saved School Profile, so their presence says nothing about
  // whether a human was here — which is what made them useless as a signal and
  // caused the bug in the first place.
  for (const key of ['topic', 'className', 'paperName', 'assessmentDate']) {
    if (String(a[key] ?? '').trim()) keptBecause.push(`${key} is set`)
  }
  if (a.blueprint) keptBecause.push('was generated against a blueprint')
  if (String(a.mode ?? '').trim()) keptBecause.push(`mode "${a.mode}"`)
  if (String(a.sourceFileName ?? '').trim()) keptBecause.push('came from an import')

  if (a.titleSource === 'manual') keptBecause.push('the teacher named it')
  else if (!isGeneratedAssessmentTitle(a.title, a, { fallbackYear })) {
    keptBecause.push('its title is not one we generated')
  } else {
    evidence.push(`auto title "${String(a.title ?? '').trim() || '(blank)'}"`)
  }

  return { phantom: keptBecause.length === 0, evidence, keptBecause }
}

/**
 * Split a list of `{ id, assessment, questions }` entries into what would be
 * deleted and what would be kept, with the reasons for each.
 */
export function planPhantomCleanup(entries = [], { fallbackYear } = {}) {
  const remove = []
  const keep = []
  for (const entry of entries) {
    const verdict = inspectAssessmentForPhantom({ ...entry, fallbackYear })
    const row = { ...entry, ...verdict }
    if (verdict.phantom) remove.push(row)
    else keep.push(row)
  }
  return { remove, keep }
}
