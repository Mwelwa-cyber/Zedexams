// The Table of Specifications, on screen.
//
// The behaviour under test is the one the panel exists for: the document is
// SHOWN (not only downloadable), the figures in it are a suggestion the teacher
// can overrule, and what they see is what gets exported.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  downloadDocx: vi.fn(async () => ({ filename: 'Grade-4-Table-of-Specifications.docx' })),
  print: vi.fn(),
}))

vi.mock('../../utils/tableOfSpecifications', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadTableOfSpecificationsModelDocx: mocks.downloadDocx,
  printTableOfSpecificationsModel: mocks.print,
}))

import TableOfSpecificationPanel from './TableOfSpecificationPanel.jsx'

const blueprint = {
  version: 'blueprint.v1',
  framework: '2023',
  totalMarks: 10,
  sections: [{
    items: [
      { topic: 'Fractions', bloomLevel: 'remember', marks: 1 },
      { topic: 'Fractions', bloomLevel: 'understand', marks: 2 },
      { topic: 'Angles', bloomLevel: 'analyse', marks: 7 },
    ],
  }],
}

/** The grid's data rows, ignoring the header and the TOTAL row. */
function bodyRows() {
  const table = screen.getByRole('table')
  const body = table.querySelector('tbody')
  return within(body).getAllByRole('row')
}

describe('TableOfSpecificationPanel', () => {
  beforeEach(() => {
    mocks.downloadDocx.mockClear()
    mocks.print.mockClear()
  })

  it('shows the table rather than only offering it as a download', () => {
    render(<TableOfSpecificationPanel blueprint={blueprint} meta={{ schoolName: 'Dudzai Primary School' }} />)
    // The document is on screen, headed the way the printed copy is.
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('MINISTRY OF EDUCATION')).toBeInTheDocument()
    expect(screen.getByText('TABLE OF SPECIFICATIONS')).toBeInTheDocument()
    expect(screen.getByText('Dudzai Primary School')).toBeInTheDocument()
    // Filled in from the plan, in the teacher's own vocabulary.
    expect(screen.getByLabelText('Topic for row 1')).toHaveValue('Fractions')
    expect(screen.getByLabelText('Topic for row 2')).toHaveValue('Angles')
    expect(bodyRows()).toHaveLength(2)
  })

  it('is a suggestion the teacher can overrule, and re-totals as they do', () => {
    render(<TableOfSpecificationPanel blueprint={blueprint} />)
    const cell = screen.getByLabelText('Remember questions for row 1')
    expect(cell).toHaveValue(1)

    fireEvent.change(cell, { target: { value: '4' } })
    expect(cell).toHaveValue(4)
    // Row total follows immediately: 4 remember + 1 understand.
    const row = bodyRows()[0]
    expect(within(row).getByLabelText('Total questions for row 1')).toHaveTextContent('5')
    expect(screen.getByText(/the suggestion has been changed/i)).toBeInTheDocument()
  })

  it('gives the corrections back if the teacher asks for the suggestion again', () => {
    render(<TableOfSpecificationPanel blueprint={blueprint} />)
    fireEvent.change(screen.getByLabelText('Remember questions for row 1'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: /Reset to the suggestion/i }))
    expect(screen.getByLabelText('Remember questions for row 1')).toHaveValue(1)
  })

  it('lets the teacher add and remove rows', () => {
    render(<TableOfSpecificationPanel blueprint={blueprint} />)
    fireEvent.click(screen.getByRole('button', { name: /Add a row/i }))
    expect(bodyRows()).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Remove row 3' }))
    expect(bodyRows()).toHaveLength(2)
  })

  it('keeps the teacher’s figures when the Bloom wording is switched', () => {
    render(<TableOfSpecificationPanel blueprint={blueprint} />)
    fireEvent.change(screen.getByLabelText('Remember questions for row 1'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: "Traditional Bloom's" }))
    // Same figure, relabelled — not reset by the change of vocabulary.
    expect(screen.getByLabelText('Knowledge questions for row 1')).toHaveValue(4)
  })

  it('offers a blank frame for a school that fills these in by hand', () => {
    render(<TableOfSpecificationPanel blueprint={blueprint} />)
    fireEvent.click(screen.getByRole('button', { name: /Blank — fill in by hand/i }))
    expect(screen.getByLabelText('Topic for row 1')).toHaveValue('')
    // An empty cell is EMPTY, the way the handwritten table is drawn.
    expect(screen.getByLabelText('Remember questions for row 1')).toHaveValue(null)
    expect(bodyRows()).toHaveLength(6)
  })

  it('downloads and prints exactly what is on screen', async () => {
    render(<TableOfSpecificationPanel blueprint={blueprint} />)
    fireEvent.change(screen.getByLabelText('Remember questions for row 1'), { target: { value: '4' } })

    fireEvent.click(screen.getByRole('button', { name: /Download Word copy/i }))
    expect(mocks.downloadDocx).toHaveBeenCalledTimes(1)
    const model = mocks.downloadDocx.mock.calls[0][0]
    expect(model.rows[0].remember).toBe(4)
    expect(model.totals.questions).toBe(6)
    // The controls stay locked until the export settles, so a second click
    // cannot start a second one on top of it.
    await screen.findByText(/is downloading/i)

    fireEvent.click(screen.getByRole('button', { name: /Print \/ Save PDF/i }))
    expect(mocks.print).toHaveBeenCalledTimes(1)
    expect(mocks.print.mock.calls[0][0].rows[0].remember).toBe(4)
  })

  it('describes the paper as it stands once there are questions', () => {
    render(
      <TableOfSpecificationPanel
        blueprint={blueprint}
        questions={[{ topic: 'Money', bloom: 'apply', marks: 5 }]}
      />,
    )
    // The plan said Fractions and Angles; the paper is now about Money.
    expect(bodyRows()).toHaveLength(1)
    expect(screen.getByLabelText('Topic for row 1')).toHaveValue('Money')
  })

  it('says when a question is not counted rather than quietly absorbing it', () => {
    render(
      <TableOfSpecificationPanel
        blueprint={blueprint}
        questions={[
          { topic: 'Money', bloom: 'apply', marks: 5 },
          { topic: 'Money', marks: 5 },
        ]}
      />,
    )
    expect(screen.getByText(/1 question has no thinking level tagged/i)).toBeInTheDocument()
  })

  it('takes the teacher’s signature block into the document', () => {
    render(<TableOfSpecificationPanel blueprint={blueprint} />)
    fireEvent.change(screen.getByPlaceholderText('School name'), { target: { value: 'Dudzai Primary' } })
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Mrs Banda' } })
    fireEvent.click(screen.getByRole('button', { name: /Download Word copy/i }))
    const model = mocks.downloadDocx.mock.calls[0][0]
    expect(model.schoolName).toBe('Dudzai Primary')
    expect(model.teacherName).toBe('Mrs Banda')
  })
})
