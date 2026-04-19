/**
 * Export a rubric as a landscape Word document with a criterion × level
 * matrix table — the standard format Zambian head teachers sign off on.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '888888' },
}

const LEVEL_FILL = {
  'Excellent':         'ECFDF5',
  'Good':              'F0F9FF',
  'Satisfactory':      'FFFBEB',
  'Needs Improvement': 'FFF1F2',
}

function text(str, opts = {}) {
  return new TextRun({ text: str == null ? '' : String(str), ...opts })
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 60 },
    ...opts,
  })
}

function h1(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 32 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  })
}

function cell(content, {width, shading, bold, size = 18} = {}) {
  const paras = Array.isArray(content) ? content :
    [para(text(content, { size, bold }))]
  return new TableCell({
    children: paras,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: CELL_BORDER,
    ...(shading ? { shading: { fill: shading } } : {}),
  })
}

function metadataTable(header) {
  const rows = [
    ['Task', header.taskDescription || header.taskType],
    ['Grade', header.grade],
    ['Subject', header.subject],
    ['Task type', header.taskType],
    ['Total marks', String(header.totalMarks)],
    ['Assessment', header.assessmentType],
  ].filter(([, v]) => v)
  return new Table({
    width: { size: 60, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({
      children: [
        cell(para(text(k, { bold: true, size: 18 })), { width: 30, shading: 'F3F4F6' }),
        cell(para(text(v, { size: 18 })), { width: 70 }),
      ],
    })),
  })
}

function criteriaTable(criteria) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell(para(text('Criterion', { bold: true, size: 18 })), { width: 18, shading: 'E2E8F0' }),
      cell(para(text('Marks', { bold: true, size: 18 })), { width: 7, shading: 'E2E8F0' }),
      cell(para(text('Excellent', { bold: true, size: 18 })), { width: 19, shading: 'ECFDF5' }),
      cell(para(text('Good', { bold: true, size: 18 })), { width: 19, shading: 'F0F9FF' }),
      cell(para(text('Satisfactory', { bold: true, size: 18 })), { width: 19, shading: 'FFFBEB' }),
      cell(para(text('Needs Improvement', { bold: true, size: 18 })), { width: 18, shading: 'FFF1F2' }),
    ],
  })

  const rows = criteria.map((c) => {
    const nameCell = [
      para(text(c.name, { bold: true, size: 18 })),
    ]
    if (c.keyCompetencies?.length) {
      nameCell.push(para(text(c.keyCompetencies.join(' · '), { size: 14, color: '6b7280', italics: true })))
    }

    const levelCell = (levelName) => {
      const lvl = (c.levels || []).find((l) => l.levelName === levelName) || {}
      return cell([
        para(text(`${lvl.marks ?? '—'} marks`, { bold: true, size: 16 })),
        para(text(lvl.descriptor || '—', { size: 16 })),
      ], { shading: LEVEL_FILL[levelName] })
    }

    return new TableRow({
      children: [
        cell(nameCell),
        cell(para(text(String(c.maxMarks), { bold: true, size: 20, alignment: 'center' }))),
        levelCell('Excellent'),
        levelCell('Good'),
        levelCell('Satisfactory'),
        levelCell('Needs Improvement'),
      ],
    })
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...rows],
  })
}

function gradeBandsTable(bands = []) {
  if (!bands.length) return null
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: bands.map((b) =>
          cell(para(text(b.symbol || b.name, { bold: true, size: 22 })), { shading: 'F3F4F6' }),
        ),
      }),
      new TableRow({
        children: bands.map((b) => cell([
          para(text(b.name, { bold: true, size: 16 })),
          para(text(b.range, { size: 16, color: '6b7280' })),
        ])),
      }),
    ],
  })
}

export function buildRubricDocument(rubric) {
  const children = []

  children.push(h1(rubric.header?.title || 'Assessment Rubric'))
  children.push(metadataTable(rubric.header || {}))
  children.push(para(text(' ', { size: 14 })))

  if (rubric.markingNotes) {
    children.push(new Paragraph({
      children: [
        text('Marking Notes: ', { bold: true, size: 18 }),
        text(rubric.markingNotes, { size: 18 }),
      ],
      spacing: { after: 160 },
    }))
  }

  children.push(para(text('Criteria', { bold: true, size: 22 })))
  children.push(criteriaTable(rubric.criteria || []))

  if (rubric.header?.gradeBands?.length) {
    children.push(para(text(' ', { size: 14 })))
    children.push(para(text('Overall Grade Bands', { bold: true, size: 22 })))
    const gb = gradeBandsTable(rubric.header.gradeBands)
    if (gb) children.push(gb)
  }

  return new Document({
    creator: 'zedexams.com',
    title: rubric.header?.title || 'Rubric',
    description: 'Generated by ZedExams Teacher Tools',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 20 } } },
    },
    sections: [{
      properties: {
        page: { size: { orientation: PageOrientation.LANDSCAPE } },
      },
      children,
    }],
  })
}

export async function downloadRubricDocx(rubric, filename = 'rubric.docx') {
  const doc = buildRubricDocument(rubric)
  const blob = await Packer.toBlob(doc)
  try {
    const { saveAs } = await import('file-saver')
    saveAs(blob, filename)
    return
  } catch { /* fall through */ }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
