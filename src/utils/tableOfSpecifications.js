/**
 * Table of Specifications (TOS), the teacher filing copy of an assessment
 * blueprint.
 *
 * The assessment generator already plans every question by topic, cognitive
 * level and marks. This module presents that same plan using either the
 * traditional Bloom labels or the revised Bloom labels selected by the teacher.
 * No second source of truth is introduced: both formats are derived from the
 * blueprint the model was constrained by.
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

export function resolveTableOfSpecificationsTaxonomy(value) {
  const id = clean(value).toLowerCase()
  return TOS_TAXONOMY_OPTIONS.find((option) => option.id === id) || TOS_TAXONOMY_OPTIONS[0]
}

function cognitiveKey(level, columns) {
  const normal = clean(level).toLowerCase()
  return columns.find((column) => column.bloom.includes(normal))?.key || null
}

function blankCounts(columns) {
  return Object.fromEntries(columns.map((column) => [column.key, 0]))
}

export function tableOfSpecificationsRows(blueprint, taxonomy = 'traditional') {
  const columns = resolveTableOfSpecificationsTaxonomy(taxonomy).columns
  const rows = new Map()
  for (const item of itemsFrom(blueprint)) {
    const topic = clean(item.topic) || 'General coverage'
    const row = rows.get(topic) || {
      topic,
      ...blankCounts(columns),
      questions: 0,
      marks: 0,
    }
    const key = cognitiveKey(item.bloomLevel, columns)
    if (key) row[key] += 1
    row.questions += 1
    row.marks += Number(item.marks) || 0
    rows.set(topic, row)
  }
  return [...rows.values()]
}

export function buildTableOfSpecificationsModel(blueprint, meta = {}) {
  const taxonomy = resolveTableOfSpecificationsTaxonomy(
    meta.bloomTaxonomy ?? meta.taxonomy ?? blueprint?.bloomTaxonomy,
  )
  const columns = taxonomy.columns
  const rows = tableOfSpecificationsRows(blueprint, taxonomy.id)
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

  const currentYear = new Date().getFullYear()
  const subject = clean(meta.subject) || titleCase(blueprint?.subject) || 'Subject'
  const grade = clean(meta.gradeLabel) || clean(blueprint?.gradeLabel) ||
    clean(meta.grade) || titleCase(blueprint?.grade) || 'Grade / Form'
  const assessmentType = clean(meta.assessmentType) || titleCase(blueprint?.assessmentType) || 'Assessment'
  const framework = clean(meta.framework) || (
    clean(blueprint?.framework) === '2013' ? '2013 Outcome-Based Curriculum' : '2023 Competence-Based Curriculum'
  )

  return {
    schoolName: clean(meta.schoolName),
    schoolLogoUrl: clean(meta.schoolLogoUrl),
    title: clean(meta.title) || assessmentType,
    assessmentType,
    grade,
    subject,
    term: clean(meta.term),
    year: clean(meta.year) || String(currentYear),
    durationMinutes: Number(meta.durationMinutes ?? blueprint?.durationMinutes) || 0,
    framework,
    teacherName: clean(meta.teacherName),
    preparedDate: clean(meta.preparedDate),
    taxonomyId: taxonomy.id,
    taxonomyLabel: taxonomy.documentLabel,
    taxonomyFilenameLabel: taxonomy.filenameLabel,
    taxonomyDescription: taxonomy.description,
    rows,
    totals,
    columns,
    valid: rows.length > 0 && totals.questions === itemsFrom(blueprint).length &&
      totals.marks === (Number(blueprint?.totalMarks) || totals.marks),
  }
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

export function buildTableOfSpecificationsHtml(blueprint, meta = {}) {
  const model = buildTableOfSpecificationsModel(blueprint, meta)
  const columnHeadings = model.columns.map((column) => (
    `<th title="${escapeHtml(column.label)}"><strong>${column.short}</strong><small>${escapeHtml(column.label)}</small></th>`
  )).join('')
  const bodyRows = model.rows.map((row) => (
    `<tr><td class="topic">${escapeHtml(row.topic)}</td>` +
      model.columns.map((column) => `<td>${row[column.key]}</td>`).join('') +
      `<td class="total">${row.questions}</td><td class="total">${row.marks}</td></tr>`
  )).join('')
  const totalCells = model.columns.map((column) => `<td>${model.totals[column.key]}</td>`).join('')
  const schoolHeading = model.schoolName || 'SCHOOL NAME'

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
  .brand { border-bottom: 3px solid #c65a24; padding-bottom: 9px; margin-bottom: 12px; text-align: center; }
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
  .tos .topic { width: 24%; text-align: left; font-weight: 700; }
  .tos .total { font-weight: 800; background: #f8fafc; }
  .tos tfoot td { font-weight: 800; background: #fff4ed; }
  .legend { margin-top: 8px; color: #4b5563; line-height: 1.5; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 22px; margin-top: 27px; }
  .signature { border-top: 1px solid #111827; padding-top: 5px; text-align: center; }
  .filing { margin-top: 10px; text-align: right; color: #9a3412; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; }
</style>
</head>
<body>
<div class="page">
  <header class="brand">
    <div class="school">${escapeHtml(schoolHeading)}</div>
    <h1>TABLE OF SPECIFICATIONS</h1>
    <div class="subtitle">${escapeHtml(model.taxonomyLabel)} · Assessment Blueprint · Teacher Filing Copy</div>
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
      <td><strong>Total Questions</strong>${model.totals.questions}</td>
      <td><strong>Total Marks</strong>${model.totals.marks}</td>
    </tr>
  </table>
  <table class="tos">
    <thead><tr><th class="topic">Topic / Syllabus Area</th>${columnHeadings}<th>Questions</th><th>Marks</th></tr></thead>
    <tbody>${bodyRows}</tbody>
    <tfoot><tr><td class="topic">TOTAL</td>${totalCells}<td>${model.totals.questions}</td><td>${model.totals.marks}</td></tr></tfoot>
  </table>
  <div class="legend">${model.columns.map((column) => `<strong>${column.short}</strong> = ${escapeHtml(column.label)}`).join(' &nbsp; · &nbsp; ')}</div>
  <div class="signatures">
    <div class="signature">Prepared by: ${escapeHtml(model.teacherName || '')}</div>
    <div class="signature">Checked by</div>
    <div class="signature">Date: ${escapeHtml(model.preparedDate || '')}</div>
  </div>
  <div class="filing">Keep in the teacher's assessment file</div>
</div>
</body>
</html>`
}

export function openTableOfSpecificationsPrintWindow(blueprint, meta = {}) {
  if (typeof window === 'undefined') throw new Error('Printing is only available in the browser.')
  const printWindow = window.open('', '_blank')
  if (!printWindow) throw new Error('Your browser blocked the print window. Allow pop-ups and try again.')
  printWindow.document.open()
  printWindow.document.write(buildTableOfSpecificationsHtml(blueprint, meta))
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => printWindow.print(), 250)
  return printWindow
}

export async function downloadTableOfSpecificationsDocx(blueprint, meta = {}) {
  const model = buildTableOfSpecificationsModel(blueprint, meta)
  if (!model.rows.length) throw new Error('There is no assessment blueprint to download yet.')

  const {
    AlignmentType, BorderStyle, Document, Packer, PageOrientation, Paragraph, Table, TableCell,
    TableRow, TextRun, WidthType,
  } = await import('docx')
  const { saveBlob } = await import('./saveBlob.js')

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

  const infoRows = [
    ['Assessment', model.title, 'Grade / Form', model.grade],
    ['Subject', model.subject, 'Term / Year', [model.term && `Term ${model.term}`, model.year].filter(Boolean).join(' · ')],
    ['Curriculum', model.framework, "Bloom's Format", model.taxonomyLabel],
    ['Total Questions', String(model.totals.questions), 'Total Marks', String(model.totals.marks)],
  ].map(([a, b, c, d]) => new TableRow({ children: [
    cell(a, { bold: true, shading: 'FFF4ED', width: 18 }),
    cell(b, { align: AlignmentType.LEFT, width: 32 }),
    cell(c, { bold: true, shading: 'FFF4ED', width: 18 }),
    cell(d, { align: AlignmentType.LEFT, width: 32 }),
  ] }))

  const header = new TableRow({
    tableHeader: true,
    children: [
      cell('Topic / Syllabus Area', { bold: true, shading: 'FFF4ED', width: 24, align: AlignmentType.LEFT }),
      ...model.columns.map((column) => cell(column.short, { bold: true, shading: 'FFF4ED' })),
      cell('Questions', { bold: true, shading: 'FFF4ED' }),
      cell('Marks', { bold: true, shading: 'FFF4ED' }),
    ],
  })
  const dataRows = model.rows.map((row) => new TableRow({ children: [
    cell(row.topic, { bold: true, align: AlignmentType.LEFT, width: 24 }),
    ...model.columns.map((column) => cell(String(row[column.key]))),
    cell(String(row.questions), { bold: true }),
    cell(String(row.marks), { bold: true }),
  ] }))
  const totalRow = new TableRow({ children: [
    cell('TOTAL', { bold: true, shading: 'FFF4ED', align: AlignmentType.LEFT, width: 24 }),
    ...model.columns.map((column) => cell(String(model.totals[column.key]), { bold: true, shading: 'FFF4ED' })),
    cell(String(model.totals.questions), { bold: true, shading: 'FFF4ED' }),
    cell(String(model.totals.marks), { bold: true, shading: 'FFF4ED' }),
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
          children: [text(`${model.taxonomyLabel} · Assessment Blueprint · Teacher Filing Copy`, { italics: true, size: 18 })],
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
            cell(`Prepared by: ${model.teacherName}`, { align: AlignmentType.LEFT, width: 34 }),
            cell('Checked by: ____________________', { align: AlignmentType.LEFT, width: 33 }),
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
