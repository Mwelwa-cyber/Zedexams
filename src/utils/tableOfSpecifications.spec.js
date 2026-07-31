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
  TOS_TAXONOMY_OPTIONS,
  buildTableOfSpecificationsHtml,
  buildTableOfSpecificationsModel,
  downloadTableOfSpecificationsDocx,
  openTableOfSpecificationsPrintWindow,
  resolveTableOfSpecificationsTaxonomy,
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
    term: 2,
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
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps the traditional six-column format as the backwards-compatible default', () => {
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

  it('builds the revised format in Remember, Understand, Apply, Analyse, Evaluate, Create order', () => {
    const model = buildTableOfSpecificationsModel(blueprint(), { bloomTaxonomy: 'revised' })

    expect(model.taxonomyId).toBe('revised')
    expect(model.columns.map((column) => column.label))
      .toEqual(['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'])
    expect(model.rows[0]).toMatchObject({ remember: 1, understand: 1, apply: 1 })
    expect(model.rows[1]).toMatchObject({ analyse: 1, evaluate: 1, create: 1 })
  })

  it('exposes both teacher choices and safely falls back to traditional', () => {
    expect(TOS_TAXONOMY_OPTIONS.map((option) => option.id))
      .toEqual(['traditional', 'revised'])
    expect(resolveTableOfSpecificationsTaxonomy('REVISED').id).toBe('revised')
    expect(resolveTableOfSpecificationsTaxonomy('not-a-taxonomy').id).toBe('traditional')
  })

  it('handles empty, untagged and American-spelling blueprint data honestly', () => {
    expect(tableOfSpecificationsRows(null)).toEqual([])
    const rows = tableOfSpecificationsRows(blueprint({
      totalMarks: 3,
      sections: [{ items: [
        { topic: '', bloomLevel: 'analyze', marks: 2 },
        { topic: '   ', bloomLevel: 'unknown', marks: 1 },
      ] }],
    }), 'revised')
    expect(rows).toHaveLength(1)
    // The Total column is the sum of the cognitive-level cells, so the row adds
    // up across the way the handwritten table it replaces does. The item with an
    // unrecognised level is NOT folded into that total — it is carried as
    // `untagged` and reported to the teacher, because a row that does not
    // reconcile on a sheet a head teacher signs reads as an export that broke.
    expect(rows[0]).toMatchObject({
      topic: 'General coverage', analyse: 1, questions: 1, untagged: 1, marks: 3,
    })
  })

  it('builds reconciled teacher metadata and taxonomy-specific filenames', () => {
    const model = buildTableOfSpecificationsModel(blueprint(), {
      schoolName: 'Jemareen Academy',
      grade: '4',
      gradeLabel: 'Grade 4 Blue',
      subject: 'Mathematics',
      assessmentType: 'End-of-Term Test',
      year: '2026',
      teacherName: 'Mr Mwelwa',
      bloomTaxonomy: 'revised',
    })

    expect(model).toMatchObject({
      schoolName: 'Jemareen Academy',
      grade: 'Grade 4 Blue',
      subject: 'Mathematics',
      term: '2',
      year: '2026',
      durationMinutes: 40,
      taxonomyId: 'revised',
      valid: true,
    })
    expect(model.totals).toMatchObject({ questions: 6, marks: 10 })
    expect(tableOfSpecificationsFilename(model))
      .toBe('Grade-4-Blue-Mathematics-End-of-Term-Test-Revised-Blooms-Table-of-Specifications.docx')
  })

  it('allows explicit filing metadata to override the blueprint metadata', () => {
    const model = buildTableOfSpecificationsModel(blueprint(), {
      term: '3',
      durationMinutes: 60,
    })
    expect(model.term).toBe('3')
    expect(model.durationMinutes).toBe(60)
  })

  it('marks a model invalid when the blueprint total does not reconcile', () => {
    const model = buildTableOfSpecificationsModel(blueprint({ totalMarks: 99 }))
    expect(model.valid).toBe(false)
  })

  it('renders the selected revised taxonomy with term, duration and paper total', () => {
    const html = buildTableOfSpecificationsHtml(blueprint(), {
      schoolName: 'Jemareen <Academy>',
      year: '2026',
      teacherName: 'Mr Mwelwa',
      bloomTaxonomy: 'revised',
    })

    expect(html).toContain('@page { size: A4 landscape')
    expect(html).toContain('Jemareen &lt;Academy&gt;')
    expect(html).toContain('TABLE OF SPECIFICATIONS')
    expect(html).toContain('Revised Bloom&#039;s Taxonomy')
    expect(html).toContain('Term 2 · 2026')
    expect(html).toContain('40 minutes')
    expect(html).toContain('6 questions · 10 marks')
    expect(html).toContain('Remember')
    expect(html).toContain('Understand')
    expect(html.indexOf('Evaluate')).toBeLessThan(html.indexOf('Create'))
    expect(html).toMatch(/keep in the teacher's assessment file/i)
  })

  it('opens the chosen print copy synchronously and triggers printing', () => {
    vi.useFakeTimers()
    const printWindow = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(printWindow)

    const result = openTableOfSpecificationsPrintWindow(blueprint(), { bloomTaxonomy: 'revised' })
    expect(result).toBe(printWindow)
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(printWindow.document.write).toHaveBeenCalledWith(
      expect.stringContaining('Revised Bloom&#039;s Taxonomy'),
    )
    vi.runAllTimers()
    expect(printWindow.print).toHaveBeenCalledTimes(1)
  })

  it('reports a blocked print window instead of pretending the copy opened', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    expect(() => openTableOfSpecificationsPrintWindow(blueprint()))
      .toThrow(/blocked the print window/i)
  })

  it('creates and saves an editable revised Bloom Word filing copy', async () => {
    const result = await downloadTableOfSpecificationsDocx(blueprint(), {
      schoolName: 'Jemareen Academy',
      subject: 'Mathematics',
      assessmentType: 'End-of-Term Test',
      bloomTaxonomy: 'revised',
    })

    expect(mocks.toBlob).toHaveBeenCalledTimes(1)
    expect(mocks.saveBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'Grade-4-Mathematics-End-of-Term-Test-Revised-Blooms-Table-of-Specifications.docx',
    )
    expect(result.model.taxonomyId).toBe('revised')
    expect(result.model.term).toBe('2')
    expect(result.model.durationMinutes).toBe(40)
    expect(result.model.totals.questions).toBe(6)
  })

  it('refuses a Word download when no blueprint exists', async () => {
    await expect(downloadTableOfSpecificationsDocx(null))
      .rejects.toThrow(/no assessment blueprint/i)
    expect(mocks.saveBlob).not.toHaveBeenCalled()
  })
})
