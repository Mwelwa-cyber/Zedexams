/**
 * Table of Specifications (TOS), the teacher filing copy of an assessment
 * blueprint.
 *
 * The assessment generator already plans every question by topic, cognitive
 * level and marks. This module presents that same plan using either the
 * traditional Bloom labels or the revised Bloom labels selected by the teacher.
 * No second source of truth is introduced: both formats are derived from the
 * blueprint the model was constrained by, or — once the paper exists and the
 * teacher has edited it — from the paper's own questions, which are by then the
 * truth about what is being assessed.
 *
 * Three things a Zambian teacher's file actually needs, and why they are here:
 *
 *  • The table is SHOWN, not only downloaded. `buildTableOfSpecificationsModel`
 *    returns a rendering-agnostic model that the on-screen grid, the print
 *    window and the Word export all walk, so what a teacher sees is what lands
 *    in the file. A download-only document is one nobody checks before it is
 *    filed.
 *  • The suggestion is EDITABLE. Every mutation goes through the pure helpers
 *    below (`setTableOfSpecificationsCell`, `addTableOfSpecificationsRow`, …)
 *    which re-total the grid, so a teacher's correction can never leave a row
 *    that does not add up on a document a head teacher signs.
 *  • A BLANK grid is a first-class mode. Plenty of schools want the printed
 *    frame and fill it in by hand; `blankTableOfSpecificationsRows` produces
 *    one with the same header, so it comes out of the same pipeline rather than
 *    being photocopied from somebody's exercise book.
 *
 * An empty cell prints EMPTY, never "0" — that is how the handwritten tables
 * these replace are drawn, and a grid of zeroes reads as a broken export.
 *
 * Pure: no React, no DOM at module scope, no Firebase. The two browser-only
 * entry points (`openTableOfSpecificationsPrintWindow`, the docx download)
 * import their dependencies lazily inside the call.
 */

const TRADITIONAL_COLUMNS = [
  { key: 'knowledge', short: 'K', label: 'Knowledge', bloom: ['remember'] },
  { key: 'comprehension', short: 'C', label: 'Comprehension', bloom: ['understand'] },
  { key: 'application', short: 'AP', label: 'Application', bloom: ['apply'] },
  { key: 'analysis', short: 'ANA', label: 'Analysis', bloom: ['analyse', 'analyze'] },
  { key: 'synthesis', short: 'SYN', label: 'Synthesis', bloom: ['create'] },
  { key: 'evaluation', short: 'EVA', label: 'Evaluation', bloom: ['evaluate'] },
]

const REVISED_COLUMNS = [
  { key: 'remember', short: 'R', label: 'Remember', bloom: ['remember'] },
  { key: 'understand', short: 'U', label: 'Understand', bloom: ['understand'] },
  { key: 'apply', short: 'AP', label: 'Apply', bloom: ['apply'] },
  { key: 'analyse', short: 'AN', label: 'Analyse', bloom: ['analyse', 'analyze'] },
  { key: 'evaluate', short: 'E', label: 'Evaluate', bloom: ['evaluate'] },
  { key: 'create', short: 'C', label: 'Create', bloom: ['create'] },
]

export const TOS_TAXONOMY_OPTIONS = [
  {
    id: 'traditional',
    label: "Traditional Bloom's",
    documentLabel: "Traditional Bloom's Taxonomy",
    filenameLabel: 'Traditional-Blooms',
    description: 'Knowledge · Comprehension · Application · Analysis · Synthesis · Evaluation',
    columns: TRADITIONAL_COLUMNS,
  },
  {
    id: 'revised',
    label: "Revised Bloom's",
    documentLabel: "Revised Bloom's Taxonomy",
    filenameLabel: 'Revised-Blooms',
    description: 'Remember · Understand · Apply · Analyse · Evaluate · Create',
    columns: REVISED_COLUMNS,
  },
]

// Backwards-compatible export for code that previously used the traditional
// table directly.
export const TOS_COLUMNS = TRADITIONAL_COLUMNS

/**
 * How the grid was filled. `suggested` is the one the studio derives; `blank`
 * is the printed frame a teacher completes by hand. The distinction is carried
 * on the model because it changes what the document SAYS about itself — a blank
 * frame that claimed to be this paper's specification would be a lie in a file.
 */
export const TOS_MODES = [
  {
    id: 'suggested',
    label: 'Suggested from this paper',
    description: 'Filled in from the topics, thinking levels and marks this paper actually uses. Change any figure you disagree with.',
  },
  {
    id: 'blank',
    label: 'Blank — fill in by hand',
    description: 'An empty grid with the same headings, ready to print and complete in your own handwriting.',
  },
]

export const DEFAULT_BLANK_ROW_COUNT = 6
const MAX_ROWS = 40

const DEFAULT_MINISTRY = 'MINISTRY OF EDUCATION'

function itemsFrom(blueprint) {
  if (!blueprint || !Array.isArray(blueprint.sections)) return []
  return blueprint.sections.flatMap((section) => (
    Array.isArray(section?.items) ? section.items : []
  ))
}

function clean(value) {
  return String(value ?? '').trim()
}

function titleCase(value) {
  return clean(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/** A non-negative whole number, or 0 for anything that is not one. */
function count(value) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function resolveTableOfSpecificationsTaxonomy(value) {
  const id = clean(value).toLowerCase()
  return TOS_TAXONOMY_OPTIONS.find((option) => option.id === id) || TOS_TAXONOMY_OPTIONS[0]
}

export function resolveTableOfSpecificationsMode(value) {
  const id = clean(value).toLowerCase()
  return TOS_MODES.find((mode) => mode.id === id) || TOS_MODES[0]
}

/** The canonical Bloom key a taxonomy column stands for. */
function bloomKeyOf(column) {
  return column.bloom[0]
}

function cognitiveKey(level, columns) {
  const normal = clean(level).toLowerCase()
  return columns.find((column) => column.bloom.includes(normal))?.key || null
}

function blankCounts(columns) {
  return Object.fromEntries(columns.map((column) => [column.key, 0]))
}

function emptyRow(columns, topic = '') {
  return { topic: clean(topic), ...blankCounts(columns), questions: 0, marks: 0 }
}

/**
 * Clamp every figure and re-derive each row's total.
 *
 * The Total column is the sum of the cognitive-level cells, exactly as a
 * handwritten table adds up across. Nothing else may write `questions`, so a
 * teacher's edit cannot leave a row whose numbers do not reconcile on a
 * document that gets signed and filed.
 */
export function normalizeTableOfSpecificationsRows(rows, taxonomy = 'traditional') {
  const columns = resolveTableOfSpecificationsTaxonomy(taxonomy).columns
  return (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).map((row) => {
    const next = { topic: clean(row?.topic) }
    let questions = 0
    for (const column of columns) {
      const n = count(row?.[column.key])
      next[column.key] = n
      questions += n
    }
    next.questions = questions
    next.marks = count(row?.marks)
    return next
  })
}

/** Every row's per-column figures, keyed by the taxonomy's own column keys. */
function rowsFrom(items, columns) {
  const rows = new Map()
  for (const item of items) {
    const topic = clean(item.topic) || 'General coverage'
    const row = rows.get(topic) || emptyRow(columns, topic)
    const key = cognitiveKey(item.bloomLevel, columns)
    if (key) row[key] += 1
    else row.untagged = (row.untagged || 0) + 1
    row.questions += 1
    row.marks += Number(item.marks) || 0
    rows.set(topic, row)
  }
  // `questions` counted every item above, including any the paper has not
  // tagged with a thinking level. The Total column must add up across, so it
  // reports only what is in the grid; the untagged remainder is carried on the
  // model and reported to the teacher instead of being quietly folded in.
  return [...rows.values()].map((row) => {
    const inGrid = columns.reduce((sum, column) => sum + row[column.key], 0)
    return { ...row, questions: inGrid, untagged: row.questions - inGrid }
  })
}

export function tableOfSpecificationsRows(blueprint, taxonomy = 'traditional') {
  const columns = resolveTableOfSpecificationsTaxonomy(taxonomy).columns
  return rowsFrom(itemsFrom(blueprint), columns)
}

/**
 * The same grid derived from the paper's OWN questions rather than the plan it
 * was generated from.
 *
 * Once a teacher has added, removed or rewritten questions, the blueprint is
 * what the paper was going to be and the questions are what it is. A document
 * filed as this paper's specification has to describe the paper.
 */
export function tableOfSpecificationsRowsFromQuestions(questions, taxonomy = 'traditional') {
  const columns = resolveTableOfSpecificationsTaxonomy(taxonomy).columns
  const items = (Array.isArray(questions) ? questions : []).map((question) => ({
    topic: question?.topic,
    // The studio persists `bloom`; the generator emits `bloomLevel`. Both
    // spellings of the analyse level are handled by the column definitions.
    bloomLevel: clean(question?.bloom) || clean(question?.bloomLevel),
    marks: question?.marks,
  }))
  return rowsFrom(items, columns)
}

/** An empty printable frame: `rowCount` topic rows with no figures in them. */
export function blankTableOfSpecificationsRows(rowCount = DEFAULT_BLANK_ROW_COUNT, taxonomy = 'traditional') {
  const columns = resolveTableOfSpecificationsTaxonomy(taxonomy).columns
  const n = Math.max(1, Math.min(MAX_ROWS, count(rowCount) || DEFAULT_BLANK_ROW_COUNT))
  return Array.from({ length: n }, () => emptyRow(columns))
}

/**
 * The rows a paper actually yields: its own questions when it has any, else the
 * blueprint it was planned from. Empty when there is neither — a document that
 * described nothing would still have to be refused by whoever asked for it.
 */
export function derivedTableOfSpecificationsRows({ blueprint = null, questions = [] } = {}, taxonomy = 'traditional') {
  const fromQuestions = tableOfSpecificationsRowsFromQuestions(questions, taxonomy)
  if (fromQuestions.length > 0) return fromQuestions
  return tableOfSpecificationsRows(blueprint, taxonomy)
}

/**
 * The rows to START a teacher off with in the editor: the derived ones, or a
 * blank frame when there is nothing to derive from. Never returns nothing,
 * because "there is no table" is not a useful answer to a teacher who needs one
 * for their file today — they can type it in.
 *
 * This fallback is the EDITOR's, not the document's: `buildTableOfSpecifications
 * Model` still produces no rows for an empty paper in `suggested` mode, so an
 * export asked for with nothing to describe is refused rather than quietly
 * handed a blank sheet claiming to be a specification.
 */
export function suggestTableOfSpecificationsRows(source = {}, taxonomy = 'traditional') {
  const derived = derivedTableOfSpecificationsRows(source, taxonomy)
  if (derived.length > 0) return derived
  return blankTableOfSpecificationsRows(DEFAULT_BLANK_ROW_COUNT, taxonomy)
}

/**
 * Move edited rows from one Bloom vocabulary to the other.
 *
 * Both taxonomies carry exactly one column per cognitive level, so the mapping
 * is lossless — which is the point: a teacher who has corrected six rows and
 * then decides their school files the traditional wording must not lose the
 * corrections to a relabelling.
 */
export function convertTableOfSpecificationsRows(rows, fromTaxonomy, toTaxonomy) {
  const from = resolveTableOfSpecificationsTaxonomy(fromTaxonomy)
  const to = resolveTableOfSpecificationsTaxonomy(toTaxonomy)
  if (from.id === to.id) return normalizeTableOfSpecificationsRows(rows, to.id)
  const byBloom = new Map(from.columns.map((column) => [bloomKeyOf(column), column.key]))
  const converted = (Array.isArray(rows) ? rows : []).map((row) => {
    const next = { topic: row?.topic, marks: row?.marks, untagged: row?.untagged }
    for (const column of to.columns) {
      next[column.key] = row?.[byBloom.get(bloomKeyOf(column))]
    }
    return next
  })
  const normalized = normalizeTableOfSpecificationsRows(converted, to.id)
  // `untagged` is not a column, so it survives the conversion by hand.
  return normalized.map((row, index) => (
    converted[index]?.untagged ? { ...row, untagged: count(converted[index].untagged) } : row
  ))
}

/* ── editing ─────────────────────────────────────────────────────────────
 * Pure row transforms. The panel holds `rows` in state and every control calls
 * one of these, so the re-totalling lives in one tested place rather than in
 * an onChange handler.
 * ──────────────────────────────────────────────────────────────────────── */

export function setTableOfSpecificationsCell(rows, index, key, value, taxonomy = 'traditional') {
  const next = (Array.isArray(rows) ? rows : []).map((row, i) => (
    i === index ? { ...row, [key]: value } : row
  ))
  return normalizeTableOfSpecificationsRows(next, taxonomy)
}

export function setTableOfSpecificationsTopic(rows, index, topic) {
  return (Array.isArray(rows) ? rows : []).map((row, i) => (
    i === index ? { ...row, topic: String(topic ?? '') } : row
  ))
}

export function addTableOfSpecificationsRow(rows, taxonomy = 'traditional') {
  const columns = resolveTableOfSpecificationsTaxonomy(taxonomy).columns
  const current = Array.isArray(rows) ? rows : []
  if (current.length >= MAX_ROWS) return current
  return [...current, emptyRow(columns)]
}

export function removeTableOfSpecificationsRow(rows, index) {
  const current = Array.isArray(rows) ? rows : []
  if (current.length <= 1) return current
  return current.filter((_row, i) => i !== index)
}

/** Have the teacher's rows moved away from the suggestion? */
export function tableOfSpecificationsEdited(rows, suggested, taxonomy = 'traditional') {
  const columns = resolveTableOfSpecificationsTaxonomy(taxonomy).columns
  const a = normalizeTableOfSpecificationsRows(rows, taxonomy)
  const b = normalizeTableOfSpecificationsRows(suggested, taxonomy)
  if (a.length !== b.length) return true
  return a.some((row, i) => (
    row.topic !== b[i].topic ||
    row.marks !== b[i].marks ||
    columns.some((column) => row[column.key] !== b[i][column.key])
  ))
}

/* ── the model every renderer walks ──────────────────────────────────── */

export function buildTableOfSpecificationsModel(source, meta = {}) {
  // `source` is a blueprint (the historical call), or {blueprint, questions}
  // once a paper exists to describe.
  const looksLikeBlueprint = Boolean(source?.sections || source?.version)
  const blueprint = looksLikeBlueprint ? source : (source?.blueprint || null)
  const questions = Array.isArray(source?.questions) ? source.questions : []

  const taxonomy = resolveTableOfSpecificationsTaxonomy(
    meta.bloomTaxonomy ?? meta.taxonomy ?? blueprint?.bloomTaxonomy,
  )
  const mode = resolveTableOfSpecificationsMode(meta.mode)
  const columns = taxonomy.columns

  const sourceRows = Array.isArray(meta.rows) && meta.rows.length > 0
    ? meta.rows
    : mode.id === 'blank'
      ? blankTableOfSpecificationsRows(meta.blankRowCount, taxonomy.id)
      : derivedTableOfSpecificationsRows({ blueprint, questions }, taxonomy.id)
  const rows = normalizeTableOfSpecificationsRows(sourceRows, taxonomy.id)
  // Untagged questions never reach a cell (the Total column has to add up), so
  // they are counted here and reported to the teacher instead of being
  // silently absorbed into a figure that would then not reconcile.
  const untagged = sourceRows.reduce((sum, row) => sum + count(row?.untagged), 0)

  const totals = {
    topic: 'TOTAL',
    ...blankCounts(columns),
    questions: 0,
    marks: 0,
  }
  for (const row of rows) {
    for (const column of columns) totals[column.key] += row[column.key]
    totals.questions += row.questions
    totals.marks += row.marks
  }
  totals.untagged = untagged

  const currentYear = new Date().getFullYear()
  const subject = clean(meta.subject) || titleCase(blueprint?.subject) || 'Subject'
  const grade = clean(meta.gradeLabel) || clean(blueprint?.gradeLabel) ||
    clean(meta.grade) || titleCase(blueprint?.grade) || 'Grade / Form'
  const assessmentType = clean(meta.assessmentType) || titleCase(blueprint?.assessmentType) || 'Assessment'
  const framework = clean(meta.framework) || (
    clean(blueprint?.framework) === '2013' ? '2013 Outcome-Based Curriculum' : '2023 Competence-Based Curriculum'
  )

  const plannedCount = itemsFrom(blueprint).length
  const plannedMarks = Number(blueprint?.totalMarks) || 0

  return {
    ministry: meta.ministry === '' ? '' : (clean(meta.ministry) || DEFAULT_MINISTRY),
    schoolName: clean(meta.schoolName),
    schoolLogoUrl: clean(meta.schoolLogoUrl),
    title: clean(meta.title) || assessmentType,
    assessmentType,
    grade,
    subject,
    term: clean(meta.term) || clean(blueprint?.term),
    year: clean(meta.year) || String(currentYear),
    durationMinutes: Number(meta.durationMinutes ?? blueprint?.durationMinutes) || 0,
    framework,
    teacherName: clean(meta.teacherName),
    checkedBy: clean(meta.checkedBy),
    preparedDate: clean(meta.preparedDate),
    modeId: mode.id,
    blank: mode.id === 'blank',
    taxonomyId: taxonomy.id,
    taxonomyLabel: taxonomy.documentLabel,
    taxonomyFilenameLabel: taxonomy.filenameLabel,
    taxonomyDescription: taxonomy.description,
    rows,
    totals,
    columns,
    valid: mode.id !== 'blank' && rows.length > 0 &&
      (plannedCount === 0 || totals.questions === plannedCount) &&
      (plannedMarks === 0 || totals.marks === plannedMarks),
  }
}

/**
 * What a cell prints. An empty cell stays empty — a handwritten Table of
 * Specifications leaves the box blank, and a grid of zeroes reads as an export
 * that went wrong.
 */
export function tableOfSpecificationsCellText(value) {
  return count(value) > 0 ? String(count(value)) : ''
}

function safeFilenamePart(value) {
  return clean(value)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
}

export function tableOfSpecificationsFilename(model, extension = 'docx') {
  const parts = [
    model.grade,
    model.subject,
    model.assessmentType,
    model.taxonomyFilenameLabel,
    model.blank ? 'Blank' : '',
    'Table-of-Specifications',
  ].map(safeFilenamePart).filter(Boolean)
  return `${parts.join('-') || 'Table-of-Specifications'}.${extension}`
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function infoValue(value, fallback = '____________________________') {
  return escapeHtml(value || fallback)
}

/** The printable document for an already-built (possibly teacher-edited) model. */
export function renderTableOfSpecificationsHtml(model) {
  const columnHeadings = model.columns.map((column) => (
    `<th title="${escapeHtml(column.label)}"><strong>${column.short}</strong><small>${escapeHtml(column.label)}</small></th>`
  )).join('')
  const cellText = tableOfSpecificationsCellText
  const bodyRows = model.rows.map((row, index) => (
    `<tr><td class="sn">${index + 1}</td><td class="topic">${escapeHtml(row.topic)}</td>` +
      model.columns.map((column) => `<td>${cellText(row[column.key])}</td>`).join('') +
      `<td class="total">${cellText(row.questions)}</td><td class="total">${cellText(row.marks)}</td></tr>`
  )).join('')
  const totalCells = model.columns.map((column) => `<td>${cellText(model.totals[column.key])}</td>`).join('')
  const schoolHeading = model.schoolName || 'SCHOOL NAME'
  const paperTotal = model.blank
    ? ''
    : `${model.totals.questions} questions · ${model.totals.marks} marks`
  const subtitle = model.blank
    ? 'Blank filing copy · complete by hand'
    : `${model.taxonomyLabel} · Assessment Blueprint · Teacher Filing Copy`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(tableOfSpecificationsFilename(model, 'pdf').replace(/\.pdf$/, ''))}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
  .page { width: 100%; }
  .brand { border-bottom: 3px solid #aa5943; padding-bottom: 9px; margin-bottom: 12px; text-align: center; }
  .ministry { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #4b5563; }
  .school { font-size: 18px; font-weight: 800; letter-spacing: .35px; text-transform: uppercase; }
  h1 { margin: 5px 0 2px; font-size: 16px; letter-spacing: .2px; }
  .subtitle { color: #4b5563; font-size: 10px; }
  .info { width: 100%; border-collapse: collapse; margin: 0 0 11px; }
  .info td { border: 1px solid #cbd5e1; padding: 6px 8px; width: 25%; }
  .info strong { display: block; color: #6b7280; font-size: 8px; letter-spacing: .5px; text-transform: uppercase; margin-bottom: 2px; }
  .tos { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .tos th, .tos td { border: 1px solid #111827; text-align: center; padding: 7px 4px; }
  .tos th { background: #fff4ed; font-size: 10px; }
  .tos th small { display: block; margin-top: 2px; font-size: 7px; font-weight: 500; line-height: 1.1; }
  .tos .sn { width: 6%; }
  .tos .topic { width: 24%; text-align: left; font-weight: 700; }
  .tos tbody .topic { height: 22px; }
  .tos .total { font-weight: 800; background: #f8fafc; }
  .tos tfoot td { font-weight: 800; background: #fff4ed; }
  .legend { margin-top: 8px; color: #4b5563; line-height: 1.5; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 22px; margin-top: 27px; }
  .signature { border-top: 1px solid #111827; padding-top: 5px; text-align: center; }
  .filing { margin-top: 10px; text-align: right; color: #83372c; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; }
</style>
</head>
<body>
<div class="page">
  <header class="brand">
    ${model.ministry ? `<div class="ministry">${escapeHtml(model.ministry)}</div>` : ''}
    <div class="school">${escapeHtml(schoolHeading)}</div>
    <h1>TABLE OF SPECIFICATIONS</h1>
    <div class="subtitle">${escapeHtml(subtitle)}</div>
  </header>
  <table class="info">
    <tr>
      <td><strong>Assessment</strong>${infoValue(model.title)}</td>
      <td><strong>Grade / Form</strong>${infoValue(model.grade)}</td>
      <td><strong>Subject</strong>${infoValue(model.subject)}</td>
      <td><strong>Term / Year</strong>${infoValue([model.term && `Term ${model.term}`, model.year].filter(Boolean).join(' · '))}</td>
    </tr>
    <tr>
      <td><strong>Curriculum</strong>${infoValue(model.framework)}</td>
      <td><strong>Bloom's Format</strong>${infoValue(model.taxonomyLabel)}</td>
      <td><strong>Duration</strong>${model.durationMinutes ? `${model.durationMinutes} minutes` : '____________________________'}</td>
      <td><strong>Paper Total</strong>${infoValue(paperTotal)}</td>
    </tr>
  </table>
  <table class="tos">
    <thead><tr><th class="sn">S/N</th><th class="topic">Topic / Syllabus Area</th>${columnHeadings}<th>Total</th><th>Marks</th></tr></thead>
    <tbody>${bodyRows}</tbody>
    <tfoot><tr><td class="sn"></td><td class="topic">TOTAL</td>${totalCells}<td>${cellText(model.totals.questions)}</td><td>${cellText(model.totals.marks)}</td></tr></tfoot>
  </table>
  <div class="legend">${model.columns.map((column) => `<strong>${column.short}</strong> = ${escapeHtml(column.label)}`).join(' &nbsp; · &nbsp; ')}</div>
  <div class="signatures">
    <div class="signature">Prepared by: ${escapeHtml(model.teacherName || '')}</div>
    <div class="signature">Checked by: ${escapeHtml(model.checkedBy || '')}</div>
    <div class="signature">Date: ${escapeHtml(model.preparedDate || '')}</div>
  </div>
  <div class="filing">Keep in the teacher's assessment file</div>
</div>
</body>
</html>`
}

export function buildTableOfSpecificationsHtml(source, meta = {}) {
  return renderTableOfSpecificationsHtml(buildTableOfSpecificationsModel(source, meta))
}

export function printTableOfSpecificationsModel(model) {
  if (typeof window === 'undefined') throw new Error('Printing is only available in the browser.')
  const printWindow = window.open('', '_blank')
  if (!printWindow) throw new Error('Your browser blocked the print window. Allow pop-ups and try again.')
  printWindow.document.open()
  printWindow.document.write(renderTableOfSpecificationsHtml(model))
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => printWindow.print(), 250)
  return printWindow
}

export function openTableOfSpecificationsPrintWindow(source, meta = {}) {
  return printTableOfSpecificationsModel(buildTableOfSpecificationsModel(source, meta))
}

/** Word copy of an already-built (possibly teacher-edited) model. */
export async function downloadTableOfSpecificationsModelDocx(model) {
  if (!model?.rows?.length) throw new Error('There is no Table of Specifications to download yet.')

  const {
    AlignmentType, BorderStyle, Document, Packer, PageOrientation, Paragraph, Table, TableCell,
    TableRow, TextRun, WidthType,
  } = await import('docx')
  const { saveBlob } = await import('../../../utils/saveBlob.js')

  const border = { style: BorderStyle.SINGLE, size: 4, color: '4B5563' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const text = (value, options = {}) => new TextRun({ text: clean(value), size: 19, ...options })
  const cell = (value, options = {}) => new TableCell({
    borders,
    margins: { top: 90, bottom: 90, left: 90, right: 90 },
    children: [new Paragraph({
      alignment: options.align || AlignmentType.CENTER,
      children: [text(value, { bold: options.bold })],
      spacing: { after: 0 },
    })],
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.shading ? { fill: options.shading } : undefined,
  })
  const cellText = tableOfSpecificationsCellText

  const paperTotal = model.blank
    ? ''
    : `${model.totals.questions} questions · ${model.totals.marks} marks`
  const infoRows = [
    ['Assessment', model.title, 'Grade / Form', model.grade],
    ['Subject', model.subject, 'Term / Year', [model.term && `Term ${model.term}`, model.year].filter(Boolean).join(' · ')],
    ['Curriculum', model.framework, "Bloom's Format", model.taxonomyLabel],
    ['Duration', model.durationMinutes ? `${model.durationMinutes} minutes` : '', 'Paper Total', paperTotal],
  ].map(([a, b, c, d]) => new TableRow({ children: [
    cell(a, { bold: true, shading: 'FFF4ED', width: 18 }),
    cell(b, { align: AlignmentType.LEFT, width: 32 }),
    cell(c, { bold: true, shading: 'FFF4ED', width: 18 }),
    cell(d, { align: AlignmentType.LEFT, width: 32 }),
  ] }))

  const header = new TableRow({
    tableHeader: true,
    children: [
      cell('S/N', { bold: true, shading: 'FFF4ED', width: 6 }),
      cell('Topic / Syllabus Area', { bold: true, shading: 'FFF4ED', width: 24, align: AlignmentType.LEFT }),
      ...model.columns.map((column) => cell(column.short, { bold: true, shading: 'FFF4ED' })),
      cell('Total', { bold: true, shading: 'FFF4ED' }),
      cell('Marks', { bold: true, shading: 'FFF4ED' }),
    ],
  })
  const dataRows = model.rows.map((row, index) => new TableRow({ children: [
    cell(String(index + 1), { width: 6 }),
    cell(row.topic, { bold: true, align: AlignmentType.LEFT, width: 24 }),
    ...model.columns.map((column) => cell(cellText(row[column.key]))),
    cell(cellText(row.questions), { bold: true }),
    cell(cellText(row.marks), { bold: true }),
  ] }))
  const totalRow = new TableRow({ children: [
    cell('', { shading: 'FFF4ED', width: 6 }),
    cell('TOTAL', { bold: true, shading: 'FFF4ED', align: AlignmentType.LEFT, width: 24 }),
    ...model.columns.map((column) => cell(cellText(model.totals[column.key]), { bold: true, shading: 'FFF4ED' })),
    cell(cellText(model.totals.questions), { bold: true, shading: 'FFF4ED' }),
    cell(cellText(model.totals.marks), { bold: true, shading: 'FFF4ED' }),
  ] })

  const document = new Document({
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: 620, right: 620, bottom: 620, left: 620 },
        },
      },
      children: [
        ...(model.ministry ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [text(model.ministry, { bold: true, size: 18 })],
          spacing: { after: 40 },
        })] : []),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [text(model.schoolName || 'SCHOOL NAME', { bold: true, size: 30 })],
          spacing: { after: 80 },
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [text('TABLE OF SPECIFICATIONS', { bold: true, size: 28 })],
          spacing: { after: 30 },
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [text(
            model.blank
              ? 'Blank filing copy · complete by hand'
              : `${model.taxonomyLabel} · Assessment Blueprint · Teacher Filing Copy`,
            { italics: true, size: 18 },
          )],
          spacing: { after: 180 },
        }),
        new Table({ rows: infoRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
        new Paragraph({ children: [], spacing: { after: 100 } }),
        new Table({ rows: [header, ...dataRows, totalRow], width: { size: 100, type: WidthType.PERCENTAGE } }),
        new Paragraph({
          children: [text(model.columns.map((column) => `${column.short} = ${column.label}`).join('  ·  '), { size: 16 })],
          spacing: { before: 100, after: 360 },
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ children: [
            cell(`Prepared by: ${model.teacherName || '____________________'}`, { align: AlignmentType.LEFT, width: 34 }),
            cell(`Checked by: ${model.checkedBy || '____________________'}`, { align: AlignmentType.LEFT, width: 33 }),
            cell(`Date: ${model.preparedDate || '____________________'}`, { align: AlignmentType.LEFT, width: 33 }),
          ] })],
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [text("KEEP IN THE TEACHER'S ASSESSMENT FILE", { bold: true, size: 16, color: '9A3412' })],
          spacing: { before: 120 },
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(document)
  const filename = tableOfSpecificationsFilename(model, 'docx')
  await saveBlob(blob, filename)
  return { filename, model }
}

export async function downloadTableOfSpecificationsDocx(source, meta = {}) {
  const model = buildTableOfSpecificationsModel(source, meta)
  if (!model.rows.length) throw new Error('There is no assessment blueprint to download yet.')
  return downloadTableOfSpecificationsModelDocx(model)
}
