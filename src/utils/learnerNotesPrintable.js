/**
 * The learner handout, as blocks (§4, §6).
 *
 * ONE builder, three consumers: the paged preview, the browser print/PDF route
 * and the page measurement that decides where the pages break. That is the
 * whole point of building blocks rather than a string — the preview does not
 * re-implement the sheet, it renders the same blocks the printer gets, in the
 * same stylesheet, at the same width. When the preview says the exercise starts
 * on page 2, it starts on page 2 because that is where the measurement of THESE
 * blocks put it.
 *
 * ## What is deliberately not here
 *
 * The answer page is a separate document with its own builder. Not a section
 * with `display: none`, not a block the exporter filters out later: the two
 * leave the studio as two files, and the only way to be sure the learner's copy
 * has no answers on it is for the learner's copy never to have contained them.
 * `validateLearnerNotes` already moved them; this keeps them moved.
 *
 * ## Why this sits in `src/utils/` and not in the feature
 *
 * Three consumers, in two layers: the studio's preview (a feature), and the
 * Word and PDF exporters (utilities). A feature may not be imported by a
 * utility — `no-restricted-imports` and `test:import-boundaries` both say so,
 * and the rule is right: an exporter reaching into a feature's internals
 * couples it to something the feature is free to change. So the builder lives
 * on the layer both can reach, beside the exporters that already live there.
 *
 * ## Board notes look different on screen and print plain
 *
 * A board sheet is what a teacher copies onto a chalkboard, so the PREVIEW
 * draws it the way a board looks — heavy headings, high contrast, wide lines —
 * to show them what the class will be copying. The printed sheet is ordinary
 * black on white, because a chalkboard aesthetic on a photocopier is just more
 * toner. `boardPreview` is the only thing that separates them, and it is off in
 * every export path.
 */

import { renderDiagramSvg } from './curriculumDiagrams.js'

/** Escape for interpolation into HTML. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The generator marks new terms with **double asterisks** — the one piece of
 * inline formatting the contract asks for, because bolding a term the first
 * time it appears is how a learner finds it again. Everything else is escaped
 * first, so this cannot become a hole for markup.
 */
export function inlineText(value) {
  return esc(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

const INK = '#111111'
const MUTED = '#333333'
const RULE = '#888888'

/* ── Page geometry ─────────────────────────────────────────────────────── */

/**
 * The two sheets a Zambian school prints on.
 *
 * A4 is what they buy. A5 is the same content on a half sheet — the economy
 * option when a class is large and the notes are short; print two-up and one
 * A4 carries two learners' copies.
 */
export const PAPER_SIZES = Object.freeze({
  a4: { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297, marginMm: 14, fontPt: 11 },
  a5: { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210, marginMm: 10, fontPt: 9.5 },
})

export const paperSize = (id) => PAPER_SIZES[id] || PAPER_SIZES.a4

/* ── Blocks ────────────────────────────────────────────────────────────── */

const block = (kind, html, extra = {}) => ({ kind, html, keepWithNext: false, ...extra })

/** `integrated_science` → `Integrated Science`. The sheet is not a database. */
function subjectLabel(subject) {
  return String(subject || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function headerBlock(notes) {
  const h = notes.header || {}
  const meta = [h.grade, subjectLabel(h.subject), h.date].filter(Boolean)

  return block('header', `
    ${h.school ? `<p class="ln-school">${esc(h.school)}</p>` : ''}
    <h1 class="ln-title">${esc(h.title || h.topic || 'Study notes')}</h1>
    ${meta.length ? `<p class="ln-meta">${meta.map(esc).join(' · ')}</p>` : ''}
    <p class="ln-nameline"><span>Name: </span><span class="ln-rule"></span></p>
  `, { keepWithNext: true })
}

function outcomesBlock(notes) {
  const items = notes.learningOutcomes || []
  if (!items.length) return null
  return block('outcomes', `
    <section class="ln-outcomes">
      <h2>What you will learn</h2>
      <ul>${items.map((o) => `<li>${inlineText(o)}</li>`).join('')}</ul>
    </section>
  `)
}

function definitionsHtml(definitions = []) {
  if (!definitions.length) return ''
  return `<div class="ln-defs">${definitions.map((d) => `
    <p class="ln-def"><strong>${inlineText(d.term)}</strong> — ${inlineText(d.meaning)}</p>
  `).join('')}</div>`
}

function diagramHtml(diagram) {
  if (!diagram) return ''
  const svg = renderDiagramSvg(diagram.libraryKey, diagram.params || {})
  if (!svg) {
    // A figure that was asked for and did not draw is shown as a gap, never
    // silently skipped — the same rule the assessment exporters follow.
    return `<figure class="ln-figure ln-figure-missing"><p>Figure could not be drawn: ${esc(diagram.caption)}</p></figure>`
  }
  const bank = Array.isArray(diagram.wordBank) && diagram.wordBank.length
    ? `<p class="ln-wordbank"><span>Word bank:</span> ${diagram.wordBank.map(esc).join(' · ')}</p>`
    : ''
  return `<figure class="ln-figure">${svg}<figcaption>${esc(diagram.caption)}</figcaption>${bank}</figure>`
}

function sectionBlocks(notes, diagramsByIndex) {
  const out = []
  ;(notes.sections || []).forEach((section, index) => {
    out.push(block(`section-${index}`, `
      <section class="ln-section">
        <h2><span class="ln-num">${index + 1}</span>${esc(section.heading)}</h2>
        ${(section.body || []).map((p) => `<p>${inlineText(p)}</p>`).join('')}
        ${definitionsHtml(section.definitions)}
        ${section.recap ? `<p class="ln-recap">${inlineText(section.recap)}</p>` : ''}
      </section>
    `))
    const figure = diagramsByIndex.get(index)
    if (figure) out.push(block(`section-${index}-figure`, diagramHtml(figure)))
  })
  return out
}

function workedExampleBlocks(notes) {
  const items = notes.workedExamples || []
  if (!items.length) return []
  const blocks = [block('worked-heading', '<h2 class="ln-h2">Let\'s work one out together</h2>', { keepWithNext: true })]
  items.forEach((w, i) => {
    blocks.push(block(`worked-${i}`, `
      <section class="ln-example">
        ${w.title ? `<p class="ln-example-title">${inlineText(w.title)}</p>` : ''}
        <p class="ln-example-problem">${inlineText(w.problem)}</p>
        ${(w.steps || []).length ? `<ol>${w.steps.map((s) => `<li>${inlineText(s)}</li>`).join('')}</ol>` : ''}
        ${w.answer ? `<p class="ln-example-answer"><strong>Answer:</strong> ${inlineText(w.answer)}</p>` : ''}
      </section>
    `))
  })
  return blocks
}

function dontMixBlocks(notes) {
  const items = notes.dontMixThese || []
  return items.map((m, i) => block(`dontmix-${i}`, `
    <aside class="ln-dontmix">
      <p class="ln-dontmix-title">Don't mix these up!${m.confusedPair ? ` <span>${esc(m.confusedPair)}</span>` : ''}</p>
      <p>${inlineText(m.warning)}</p>
      ${m.clarification ? `<p>${inlineText(m.clarification)}</p>` : ''}
    </aside>
  `))
}

function faqBlocks(notes) {
  const items = notes.learnerQuestions || []
  if (!items.length) return []
  const blocks = [block('faq-heading', '<h2 class="ln-h2">Questions learners ask</h2>', { keepWithNext: true })]
  items.forEach((q, i) => {
    blocks.push(block(`faq-${i}`, `
      <section class="ln-faq">
        <p class="ln-faq-q">${inlineText(q.question)}</p>
        <p>${inlineText(q.answer)}</p>
      </section>
    `))
  })
  return blocks
}

function rememberBlock(notes) {
  const items = notes.rememberBox || []
  if (!items.length) return null
  return block('remember', `
    <aside class="ln-remember">
      <p class="ln-remember-title">Remember!</p>
      <ul>${items.map((r) => `<li>${inlineText(r)}</li>`).join('')}</ul>
    </aside>
  `)
}

function exerciseBlocks(notes, exerciseDiagram) {
  const exercise = notes.exercise || {}
  const questions = exercise.questions || []
  if (!questions.length) return []
  const blocks = [block('exercise-heading', `
    <section class="ln-exercise-head">
      <h2 class="ln-h2">Exercise</h2>
      ${exercise.instructions ? `<p class="ln-instructions">${inlineText(exercise.instructions)}</p>` : ''}
    </section>
  `, { keepWithNext: true })]

  if (exerciseDiagram) blocks.push(block('exercise-figure', diagramHtml(exerciseDiagram)))

  questions.forEach((q) => {
    blocks.push(block(`exercise-q-${q.number}`, `
      <section class="ln-question">
        <p><span class="ln-qnum">${q.number}.</span> ${inlineText(q.prompt)}
          ${q.marks ? `<span class="ln-marks">[${q.marks}]</span>` : ''}</p>
        <span class="ln-answer-line"></span>
      </section>
    `))
  })
  return blocks
}

/**
 * Every block on the learner's pages, in print order.
 *
 * Board format reorders nothing and drops nothing beyond what the generator
 * already left out — a board sheet is the same document written shorter, so a
 * learner who copied it off the board holds the same structure as one handed a
 * photocopy.
 */
export function buildLearnerNotesBlocks(notes) {
  if (!notes) return []
  const diagrams = notes.diagrams || []
  const bodyFigures = new Map()
  let exerciseFigure = null
  for (const d of diagrams) {
    if (d.placement === 'exercise') exerciseFigure = d
    else bodyFigures.set(Number(d.sectionIndex) || 0, d)
  }

  return [
    headerBlock(notes),
    outcomesBlock(notes),
    ...sectionBlocks(notes, bodyFigures),
    ...workedExampleBlocks(notes),
    ...dontMixBlocks(notes),
    ...faqBlocks(notes),
    rememberBlock(notes),
    ...exerciseBlocks(notes, exerciseFigure),
  ].filter(Boolean).map((b, i) => ({ ...b, id: `${b.kind}`, index: i }))
}

/** The teacher's answer page — a separate document, always (§3.7). */
export function buildAnswerPageBlocks(notes) {
  if (!notes) return []
  const key = notes.answerKey || {}
  const h = notes.header || {}
  const blocks = [block('answer-header', `
    <p class="ln-answer-badge">Teacher's copy — do not photocopy for learners</p>
    <h1 class="ln-title">${esc(h.title || h.topic || 'Study notes')} — Answers</h1>
    ${h.grade ? `<p class="ln-meta">${esc(h.grade)}</p>` : ''}
  `, { keepWithNext: true })]

  if ((key.answers || []).length) {
    blocks.push(block('answer-list', `
      <section class="ln-answers">
        <h2 class="ln-h2">Exercise</h2>
        <ol>${key.answers.map((a) => `
          <li><span class="ln-answer-text">${inlineText(a.answer)}</span>
          ${a.note ? `<span class="ln-answer-note">${inlineText(a.note)}</span>` : ''}</li>
        `).join('')}</ol>
      </section>
    `))
  }

  if ((key.diagramLabels || []).length) {
    // The marking copy of the figure: the learner's numbers with the names
    // against them, so the teacher marks without re-deriving the numbering.
    const figure = (notes.diagrams || []).find((d) => d.placement === 'exercise')
    const svg = figure
      ? renderDiagramSvg(figure.libraryKey, { ...(figure.params || {}), labels: 'answer' })
      : null
    blocks.push(block('answer-diagram', `
      <section class="ln-answers">
        <h2 class="ln-h2">${esc(key.diagramCaption || 'Diagram')} — labels</h2>
        ${svg ? `<figure class="ln-figure">${svg}</figure>` : ''}
        <ol>${key.diagramLabels.map((l) => `<li>${esc(l.name)}</li>`).join('')}</ol>
      </section>
    `))
  }

  return blocks.map((b, i) => ({ ...b, id: b.kind, index: i }))
}

/* ── Stylesheet ────────────────────────────────────────────────────────── */

/**
 * The one stylesheet.
 *
 * Every colour in here is declared in `monochrome.test.js` with its role, so
 * "will a Zambian school's photocopier still show this" is a question CI
 * answers rather than one a reviewer squints at.
 */
export function learnerNotesCss({ paper = 'a4', boardPreview = false } = {}) {
  const size = paperSize(paper)
  return `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman",Georgia,serif;color:${INK};background:#ffffff;
    font-size:${size.fontPt}pt;line-height:1.45}
  .ln-page{width:${size.widthMm}mm;padding:${size.marginMm}mm;background:#ffffff}

  .ln-school{text-align:center;font-weight:700;font-size:1.15em;margin-bottom:2px}
  .ln-title{text-align:center;font-size:1.35em;font-weight:700;letter-spacing:.02em;
    border-bottom:2px solid ${INK};padding-bottom:4px;margin-bottom:5px}
  .ln-meta{text-align:center;font-size:.85em;color:${MUTED};margin-bottom:6px}
  .ln-nameline{display:flex;align-items:baseline;gap:6px;font-size:.9em;margin-bottom:10px}
  .ln-rule{flex:1;border-bottom:1px solid ${RULE};height:1px}

  h2,.ln-h2{font-size:1.05em;font-weight:700;margin:10px 0 5px}
  .ln-num{display:inline-block;min-width:1.4em;font-weight:700}
  p{margin:0 0 5px}
  ul,ol{margin:0 0 6px 20px}
  li{margin:0 0 3px}

  .ln-outcomes{border:1.5px solid ${INK};padding:7px 9px;margin-bottom:10px}
  .ln-outcomes h2{margin-top:0}

  .ln-section{margin-bottom:9px}
  .ln-defs{border-left:3px solid ${INK};background:#fafafa;padding:5px 8px;margin:5px 0}
  .ln-def{margin:0 0 3px}
  .ln-recap{font-style:italic;color:${MUTED}}

  .ln-example{border:1px solid ${RULE};padding:6px 8px;margin-bottom:7px}
  .ln-example-title{font-weight:700}
  .ln-example-problem{font-weight:700}

  .ln-dontmix{border:2px solid ${INK};padding:6px 9px;margin:8px 0}
  .ln-dontmix-title{font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:.9em}
  .ln-dontmix-title span{font-weight:400;text-transform:none;letter-spacing:0}

  .ln-faq{margin-bottom:6px}
  .ln-faq-q{font-weight:700}

  .ln-remember{border:2px solid ${INK};padding:7px 9px;margin:9px 0}
  .ln-remember-title{font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}

  .ln-instructions{font-style:italic;color:${MUTED}}
  .ln-question{margin-bottom:7px}
  .ln-qnum{font-weight:700}
  .ln-marks{float:right;font-weight:700}
  .ln-answer-line{display:block;border-bottom:1px solid ${RULE};height:16px;margin-top:3px}

  .ln-figure{text-align:center;margin:7px 0}
  /* A figure earns its space on a sheet a school pays to copy: wide enough for
     a child to write in the label boxes, capped so one diagram cannot take the
     page the notes were budgeted for. */
  .ln-figure svg{max-width:62%;max-height:98mm;height:auto}
  .ln-figure figcaption{font-size:.85em;color:${MUTED};margin-top:2px}
  .ln-figure-missing{border:1.5px dashed ${RULE};padding:8px;color:${MUTED}}
  .ln-wordbank{border:1px solid ${RULE};padding:4px 7px;margin-top:5px;font-size:.9em;text-align:left}
  .ln-wordbank span{font-weight:700}

  .ln-answer-badge{border:1.5px solid ${INK};display:inline-block;padding:2px 7px;
    font-weight:700;font-size:.8em;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
  .ln-answers ol{margin-left:22px}
  .ln-answer-note{display:block;font-size:.85em;color:${MUTED}}

  /* A question, its figure and a heading with what follows it never split. */
  .ln-section,.ln-example,.ln-dontmix,.ln-remember,.ln-question,.ln-figure,.ln-outcomes,.ln-faq{
    page-break-inside:avoid;break-inside:avoid}
  .ln-h2,.ln-exercise-head{page-break-after:avoid;break-after:avoid}
${boardPreview ? boardPreviewCss() : ''}
  @media print{
    @page{size:${size.label} portrait;margin:${size.marginMm}mm}
    .ln-page{width:auto;padding:0}
  }`
}

/**
 * The board look, PREVIEW ONLY.
 *
 * Shows the teacher what the class will be copying down. Never reached by an
 * export: a chalkboard aesthetic on a photocopier is toner, not legibility.
 */
function boardPreviewCss() {
  return `
  .ln-board .ln-page{background:#111111;color:#ffffff}
  .ln-board h1,.ln-board h2,.ln-board .ln-h2{color:#ffffff;letter-spacing:.04em}
  .ln-board .ln-title{border-bottom-color:#ffffff}
  .ln-board .ln-outcomes,.ln-board .ln-dontmix,.ln-board .ln-remember,
  .ln-board .ln-example,.ln-board .ln-wordbank{border-color:#ffffff}
  .ln-board .ln-defs{background:transparent;border-left-color:#ffffff}
  .ln-board .ln-meta,.ln-board .ln-recap,.ln-board .ln-instructions{color:#ffffff}
  .ln-board .ln-figure svg{filter:invert(1)}
`
}

/** The whole learner document, as a standalone printable page. */
export function buildLearnerNotesHtml(notes, { paper } = {}) {
  const size = paperSize(paper || (notes && notes.paperSize))
  const blocks = buildLearnerNotesBlocks(notes)
  const title = (notes && notes.header && notes.header.title) || 'Study notes'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>${learnerNotesCss({ paper: size.id })}</style>
</head>
<body><div class="ln-page">${blocks.map((b) => b.html).join('\n')}</div></body>
</html>`
}

/** The teacher's answer page, as its own standalone printable page. */
export function buildAnswerPageHtml(notes, { paper } = {}) {
  const size = paperSize(paper || (notes && notes.paperSize))
  const blocks = buildAnswerPageBlocks(notes)
  const title = (notes && notes.header && notes.header.title) || 'Study notes'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)} — Answers</title>
<style>${learnerNotesCss({ paper: size.id })}</style>
</head>
<body><div class="ln-page">${blocks.map((b) => b.html).join('\n')}</div></body>
</html>`
}
