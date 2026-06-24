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
import {
  importMarkupToRichHtml,
  importMarkupToOptionHtml,
} from '../components/quiz/importRichText.js'
import { stimulusDescriptorFromQuestion, splitSubQuestions } from './stimulusQuestion.js'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

/**
 * Map an AI question's `parts` array into the studio's `subParts` shape
 * ({ text, answer, marks, answerFormat }). Drops part-less / empty entries.
 * Labels are positional (the studio derives (a)(b)(c)), so any model label is
 * ignored.
 */
function partsToSubParts(parts) {
  if (!Array.isArray(parts)) return []
  return parts
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      text: String(p.text ?? p.prompt ?? '').trim(),
      answer: String(p.answer ?? p.correctAnswer ?? '').trim(),
      marks: Number.isFinite(Number(p.marks)) && Number(p.marks) >= 0 ? Math.round(Number(p.marks)) : 1,
      answerFormat: ['inline', 'lines', 'none'].includes(p.answerFormat) ? p.answerFormat : 'inline',
    }))
    .filter((p) => p.text)
    .slice(0, 12)
}

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

/**
 * Read a question's structured visual spec, falling back to the legacy
 * `diagram` string (a bare stem figure). The server schema already normalises
 * this, but the converter is also fed hand-built payloads in tests, so we
 * normalise here too.
 */
function readVisual(q) {
  const v = q?.visual
  if (v && typeof v === 'object' && v.kind) return v
  const legacy = String(q?.diagram || '').trim()
  return legacy ? { kind: 'stem_figure', prompt: legacy } : null
}

/**
 * Default placement for a labelled figure's labels. Each label sits in the
 * left/right margin and runs a LEADER LINE inward to a point near the figure
 * (tx/ty) — so a part is labelled with a line pointing at it, the way a real
 * exam diagram is drawn, instead of a marker dumped on top of the part. The
 * teacher drags the line's tip onto the exact part once the figure is in.
 * x/y/tx/ty are 0..1 ratios of the image, matching the diagramLabels schema.
 * Deterministic (index-based ids) so the converter stays node-testable.
 */
function defaultDiagramLabels(labels) {
  const arr = (Array.isArray(labels) ? labels : [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .slice(0, 8)
  const n = arr.length
  return arr.map((text, i) => {
    // Alternate labels between the left and right margins, stacked in rows.
    const onLeft = i % 2 === 0
    const row = Math.floor(i / 2)
    const rows = Math.ceil(n / 2)
    const y = rows > 1 ? 0.15 + (0.7 * row) / (rows - 1) : 0.5
    return {
      id: `lbl-${i}`,
      x: onLeft ? 0.04 : 0.96, // label box hugs the margin
      y,
      tx: onLeft ? 0.4 : 0.6, // leader tip points inward toward the figure
      ty: y,
      text,
    }
  })
}

function mapType(aiType) {
  switch (aiType) {
    case 'multiple_choice': return 'mcq'
    case 'true_false': return 'mcq' // True/False renders as a 2-option MCQ
    case 'essay': return 'essay'
    case 'matching': return 'matching'
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
  const visual = readVisual(q)

  // Convert the lightweight maths markup the generator emits (\frac{a}{b},
  // $…$, [[vmath …]]) into the editor's node-HTML so fractions stack and sums
  // print as columns — the same converter the smart-import and AI-edit paths
  // use. Plain prose passes through untouched (hasImportMarkup gates it).
  const overrides = {
    type,
    detectedType: type,
    text: importMarkupToRichHtml(text),
    marks,
    explanation: importMarkupToRichHtml(explanation),
    partId,
  }

  if (type === 'matching') {
    // assessmentSchema v1.3 guarantees a valid {left, right, pairs} shape
    // (it degrades broken matching to short_answer before we see it), but
    // guard anyway for hand-fed payloads.
    const m = q?.matching
    const valid = m && Array.isArray(m.left) && Array.isArray(m.right) &&
      Array.isArray(m.pairs) && m.pairs.length === m.left.length &&
      m.left.length >= 2
    if (valid) {
      // Matching columns stay PLAIN: the paper layout and answer key render
      // them through richTextToPlainText either way, so HTML here would buy
      // nothing — it matches the document importer, which also leaves them plain.
      overrides.matchingLeft = m.left.map(String)
      overrides.matchingRight = m.right.map(String)
      overrides.matchingAnswer = m.pairs.map(Number)
      overrides.correctAnswer = 0
    } else {
      overrides.type = 'short_answer'
      overrides.detectedType = 'short_answer'
      overrides.correctAnswer = answer
      reviewNotes.push('AI matching columns were incomplete — rebuild the pairs or reword as short answer.')
    }
  } else if (type === 'mcq' && visual?.kind === 'shape_options' &&
    Array.isArray(visual.options) &&
    visual.options.filter((o) => o && o.libraryKey).length >= 2) {
    // Picture MCQ whose options are EXACT library shapes — no generation, they
    // render straight from {libraryKey, params}. Text options stay empty so the
    // layout builder picks the image grid.
    const shapes = visual.options.filter((o) => o && o.libraryKey).slice(0, 6)
    const n = shapes.length
    overrides.options = Array.from({ length: n }, () => '')
    overrides.optionMedia = shapes.map((s) => ({
      diagram: { libraryKey: s.libraryKey, params: s.params || {} },
      // alt from the shape's caption (or key) so the pre-publish alt-text check
      // passes without extra typing.
      alt: String((s.params && s.params.cap) || s.libraryKey),
    }))
    const idx = matchAnswerIndex(answer, LETTERS.slice(0, n))
    overrides.correctAnswer = idx >= 0 ? idx : 0
    if (idx < 0) {
      reviewNotes.push(answer ?
        `AI answer "${answer.slice(0, 80)}" did not match a shape option — set the correct one.` :
        'AI did not mark the correct shape option.')
    }
  } else if (type === 'mcq' && visual?.kind === 'option_images' &&
    Array.isArray(visual.options) && visual.options.length >= 2) {
    // Picture-based MCQ: each option A-D is a drawing. The text options stay
    // empty (the picture IS the option) so the layout builder renders the
    // image grid; the per-option drawing briefs ride on optionMedia until the
    // auto-generator fills imageUrl.
    const briefs = visual.options
      .map((o) => String(o?.prompt ?? o ?? '').trim())
      .filter(Boolean)
      .slice(0, 6)
    const n = briefs.length
    overrides.options = Array.from({ length: n }, () => '')
    // alt seeded from the brief so the generated picture options satisfy the
    // pre-publish alt-text check without extra typing; diagramBrief drives
    // generation and is cleared once the image lands.
    overrides.optionMedia = briefs.map((brief) => ({
      imageUrl: '', alt: brief.slice(0, 120), diagramBrief: brief,
    }))
    // Resolve the correct option. Match against the briefs first: that path
    // already handles both an exact brief-text answer AND a bare option letter
    // (via matchAnswerIndex's letter regex), and crucially avoids mis-reading
    // a phrase like "a metal saucepan" as option "A". Letters are a last
    // resort for the empty-brief edge.
    let idx = matchAnswerIndex(answer, briefs)
    if (idx < 0) idx = matchAnswerIndex(answer, LETTERS.slice(0, n))
    overrides.correctAnswer = idx >= 0 ? idx : 0
    if (idx < 0) {
      reviewNotes.push(answer ?
        `AI answer "${answer.slice(0, 80)}" did not match a picture option — set the correct one.` :
        'AI did not mark the correct picture option.')
    }
    reviewNotes.push(`Picture options needed (${n}) — generate them from the briefs or attach from the picture bank.`)
  } else if (type === 'mcq') {
    const options = aiType === 'true_false' && !(Array.isArray(q?.options) && q.options.length >= 2) ?
      ['True', 'False'] :
      (Array.isArray(q?.options) ? q.options.map((o) => String(o ?? '').trim()).filter(Boolean) : [])
    // Match the answer against the PLAIN option text before converting maths
    // markup, so a `\frac{8}{15}` answer still lines up with its option.
    const plainOptions = options.length >= 2 ? options : ['', '', '', '']
    overrides.options = plainOptions.map(importMarkupToOptionHtml)
    const idx = matchAnswerIndex(answer, plainOptions)
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
    // Short-answer SUB-PARTS: prefer the model's explicit `parts`; otherwise
    // auto-split a crammed "(a)… (b)… (c)…" prompt so it prints as an
    // instruction + lettered blanks instead of one paragraph (the Q18 bug).
    let subParts = partsToSubParts(q?.parts)
    if (!subParts.length && type === 'short_answer') {
      const split = splitSubQuestions(text)
      if (split && Array.isArray(split.parts) && split.parts.length >= 2) {
        // The stem becomes the instruction; each marker becomes a sub-part.
        overrides.text = importMarkupToRichHtml(split.stem || text)
        subParts = split.parts.map((p) => ({
          text: String(p.text || '').trim(),
          answer: '',
          marks: Number.isFinite(p.marks) && p.marks > 0 ? p.marks : 1,
          answerFormat: 'inline',
        })).filter((p) => p.text)
      }
    }
    if (subParts.length >= 2) {
      overrides.subParts = subParts
      // A multi-part question owns no marks of its own — they sum from the parts.
      overrides.marks = subParts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
      overrides.correctAnswer = ''
      if (subParts.every((p) => !p.answer)) {
        reviewNotes.push('AI did not give model answers for the sub-parts — fill them in for the marking key.')
      }
    } else {
      // Plain single-answer question.
      overrides.correctAnswer = answer
      if (!answer) reviewNotes.push('AI did not give a model answer.')
    }
  }

  // Stem visuals (option_images / shape_options were handled in the MCQ branch).
  if (visual && visual.kind === 'shape' && visual.libraryKey) {
    // Exact library figure on the stem — renders straight away, no generation.
    overrides.imageDiagram = { libraryKey: visual.libraryKey, params: visual.params || {} }
  } else if (visual && (visual.kind === 'stem_figure' || visual.kind === 'labelled_figure')) {
    // Drawn figures carry a first-class diagramBrief so the auto-generator +
    // DiagramFixupPanel can find the question and generate/attach the figure;
    // the review note is the human-readable fallback on the question card.
    const brief = String(visual.prompt || '').trim()
    if (brief) {
      overrides.diagramBrief = brief
      if (visual.kind === 'labelled_figure') {
        overrides.diagramMode = visual.mode === 'identify' ? 'identify' : 'labeled'
        const labels = defaultDiagramLabels(visual.labels)
        if (labels.length) overrides.diagramLabels = labels
      }
      reviewNotes.push(`Diagram needed: ${brief} — attach it from the picture bank or generate one.`)
    }
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
 * EVERY AI section becomes a lettered Part (Section A, B, C…) in the order the
 * generator emitted them, so the printed paper shows proper Zambian sectioning
 * with no loose questions floating above the first heading.
 *
 * Sections WITHOUT a passage hold standalone questions under their Part
 * heading. Sections WITH a passage (schema v1.2 comprehension) attach the
 * native passage block — story on top, questions beneath — to that same Part,
 * so a comprehension prints UNDER its own "Section A — Comprehension" heading.
 *
 * (Previously a passage section was emitted with NO Part wrapper, which made it
 * an *ungrouped* block. buildPaperLayout pins the ungrouped block to the very
 * top of the paper [ungroupedOrder defaults to 0], so a paper whose first
 * section was a comprehension printed the story first — unlabelled — and the
 * NEXT section became "SECTION A". That is the "started with a story, then
 * Section A" defect this conversion now prevents.)
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
      // The comprehension section becomes a lettered Part like any other. The
      // Part carries the section heading + its instruction ("Read the story and
      // answer the questions which follow."); the passage block beneath it
      // carries the story's own title + text. Attaching the passage to the Part
      // (partId) is what keeps it under its section heading instead of floating
      // to the top of the paper.
      const part = createPartGroup({
        title: String(sec?.title || `Section ${sIdx + 1}`).trim(),
        instructions: String(sec?.instructions || '').trim(),
        order: out.parts.length,
      })
      out.parts.push(part)
      const passageSection = createPassageSection({
        title: String(sec?.passage?.title || '').trim(),
        passageText,
        passageKind: 'comprehension',
        partId: part.id,
        questions: mapped.map((o) => ({ ...o, partId: part.id })),
      })
      passageSection.partId = part.id
      out.sections.push(passageSection)
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
      // Stimulus / source detection: a single question whose prompt reads
      // "study the diagram below … (a) … (b) … (c) …" is split into a stimulus
      // passage (instruction → diagram/source → follow-up sub-questions) so it
      // prints in the correct layout instead of one paragraph above the figure.
      const stimulus = stimulusDescriptorFromQuestion({
        text: q.prompt,
        marks: q.marks,
        imageDiagram: (q.visual && q.visual.kind === 'shape' && q.visual.libraryKey)
          ? { libraryKey: q.visual.libraryKey, params: q.visual.params || {} }
          : undefined,
      })
      if (stimulus && stimulus.questions.length >= 2) {
        out.sections.push(createPassageSection({
          passageKind: stimulus.passageKind,
          title: stimulus.title,
          imageDiagram: stimulus.imageDiagram,
          partId: part.id,
          questions: stimulus.questions,
        }))
        out.sections[out.sections.length - 1].partId = part.id
        out.questionCount += stimulus.questions.length
        out.totalMarks += stimulus.questions.reduce((s, sq) => s + (Number(sq.marks) || 0), 0)
        out.warnings.push(`Classified Q"${String(q.prompt).slice(0, 40)}…" as a stimulus question with ${stimulus.questions.length} sub-questions.`)
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
