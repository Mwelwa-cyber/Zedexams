import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveBlob: vi.fn(),
  toBlob: vi.fn(async () => new Blob(['docx'], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })),
}))

vi.mock('./saveBlob.js', () => ({ saveBlob: mocks.saveBlob }))

vi.mock('docx', () => {
  class DocxNode {
    constructor(options = {}) { this.options = options }
  }
  return {
    AlignmentType: { CENTER: 'center', LEFT: 'left', RIGHT: 'right' },
    BorderStyle: { SINGLE: 'single' },
    Document: DocxNode,
    Packer: { toBlob: mocks.toBlob },
    PageOrientation: { LANDSCAPE: 'landscape' },
    Paragraph: DocxNode,
    Table: DocxNode,
    TableCell: DocxNode,
    TableRow: DocxNode,
    TextRun: DocxNode,
    WidthType: { PERCENTAGE: 'pct' },
  }
})

import {
  TOS_COLUMNS,
  buildTableOfSpecificationsHtml,
  buildTableOfSpecificationsModel,
  downloadTableOfSpecificationsDocx,
  openTableOfSpecificationsPrintWindow,
  tableOfSpecificationsFilename,
  tableOfSpecificationsRows,
} from './tableOfSpecifications.js'

function blueprint(overrides = {}) {
  return {
    version: 'blueprint.v1',
    grade: 'G4',
    gradeLabel: 'Grade 4',
    subject: 'mathematics',
    framework: '2023',
    assessmentType: 'end_of_term',
    totalMarks: 10,
    durationMinutes: 40,
    sections: [{
      items: [
        { topic: 'Fractions', bloomLevel: 'remember', marks: 1 },
        { topic: 'Fractions', bloomLevel: 'understand', marks: 2 },
        { topic: 'Fractions', bloomLevel: 'apply', marks: 2 },
        { topic: 'Angles', bloomLevel: 'analyse', marks: 2 },
        { topic: 'Angles', bloomLevel: 'create', marks: 1 },
        { topic: 'Angles', bloomLevel: 'evaluate', marks: 2 },
      ],
    }],
    ...overrides,
  }
}

describe('Table of Specifications', () => {
  beforeEach(() => {
    mocks.saveBlob.mockReset()
    mocks.toBlob.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps revised Bloom tags into the traditional six-column filing table', () => {
    const rows = tableOfSpecificationsRows(blueprint())

    expect(TOS_COLUMNS.map((column) => column.short))
      .toEqual(['K', 'C', 'AP', 'ANA', 'SYN', 'EVA'])
    expect(rows.map((row) => row.topic)).toEqual(['Fractions', 'Angles'])
    expect(rows[0]).toMatchObject({
      knowledge: 1,
      comprehension: 1,
      application: 1,
      questions: 3,
      marks: 5,
    })
    expect(rows[1]).toMatchObject({
      analysis: 1,
      synthesis: 1,
      evaluation: 1,
      questions: 3,
      marks: 5,
    })
  })

  it('handles empty, untagged and American-spelling blueprint data honestly', () => {
    expect(tableOfSpecificationsRows(null)).toEqual([])
    const rows = tableOfSpecificationsRows(blueprint({
      totalMarks: 3,
      sections: [{ items: [
        { topic: '', bloomLevel: 'analyze', marks: 2 },
        { topic: '   ', bloomLevel: 'unknown', marks: 1 },
      ] }],
    }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      topic: 'General coverage', analysis: 1, questions: 2, marks: 3,
    })
  })

  it('builds reconciled teacher metadata and readable filenames', () => {
    const model = buildTableOfSpecificationsModel(blueprint(), {
      schoolName: 'Jemareen Academy',
      grade: '4',
      gradeLabel: 'Grade 4 Blue',
      subject: 'Mathematics',
      assessmentType: 'End-of-Term Test',
      term: '2',
      year: '2026',
      teacherName: 'Mr Mwelwa',
    })

    expect(model).toMatchObject({
      schoolName: 'Jemareen Academy',
      grade: 'Grade 4 Blue',
      subject: 'Mathematics',
      term: '2',
      year: '2026',
      valid: true,
    })
    expect(model.totals).toMatchObject({ questions: 6, marks: 10 })
    expect(tableOfSpecificationsFilename(model))
      .toBe('Grade-4-Blue-Mathematics-End-of-Term-Test-Table-of-Specifications.docx')
  })

  it('marks a model invalid when the blueprint total does not reconcile', () => {
    const model = buildTableOfSpecificationsModel(blueprint({ totalMarks: 99 }))
    expect(model.valid).toBe(false)
  })

  it('renders an A4 landscape filing copy with escaped school data', () => {
    const html = buildTableOfSpecificationsHtml(blueprint(), {
      schoolName: 'Jemareen <Academy>',
      term: '2',
      year: '2026',
      teacherName: 'Mr Mwelwa',
    })

    expect(html).toContain('@page { size: A4 landscape')
    expect(html).toContain('Jemareen &lt;Academy&gt;')
    expect(html).toContain('TABLE OF SPECIFICATIONS')
    expect(html).toContain('Fractions')
    expect(html).toMatch(/keep in the teacher's assessment file/i)
  })

  it('opens the print copy synchronously and triggers printing', () => {
    vi.useFakeTimers()
    const printWindow = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(printWindow)

    const result = openTableOfSpecificationsPrintWindow(blueprint())
    expect(result).toBe(printWindow)
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(printWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('TABLE OF SPECIFICATIONS'))
    vi.runAllTimers()
    expect(printWindow.print).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('reports a blocked print window instead of pretending the copy opened', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    expect(() => openTableOfSpecificationsPrintWindow(blueprint()))
      .toThrow(/blocked the print window/i)
  })

  it('creates and saves an editable Word filing copy', async () => {
    const result = await downloadTableOfSpecificationsDocx(blueprint(), {
      schoolName: 'Jemareen Academy',
      subject: 'Mathematics',
      assessmentType: 'End-of-Term Test',
    })

    expect(mocks.toBlob).toHaveBeenCalledTimes(1)
    expect(mocks.saveBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'Grade-4-Mathematics-End-of-Term-Test-Table-of-Specifications.docx',
    )
    expect(result.model.totals.questions).toBe(6)
  })

  it('refuses a Word download when no blueprint exists', async () => {
    await expect(downloadTableOfSpecificationsDocx(null))
      .rejects.toThrow(/no assessment blueprint/i)
    expect(mocks.saveBlob).not.toHaveBeenCalled()
  })
})
