/**
 * The document title bar — the reported phone bug.
 *
 * "GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026" was one string with
 * a CSS ellipsis, so a phone cut it to "GRADE 4 INTEGRATED SCIEN…" and the two
 * facts that identify the paper — the type and the year — were the first things
 * thrown away. These tests assert the replacement never loses a fact, at any
 * width, and that the phone route to the full details exists.
 *
 * Width is passed in rather than faked through layout: jsdom has no layout, so
 * a test that relied on measurement would be measuring nothing.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocTitle, PaperDetailsSheet } from './DocTitle.jsx'

const paper = {
  grade: '4',
  subject: 'Integrated Science',
  assessmentType: 'end_of_term',
  term: '1',
  year: 2026,
  duration: 60,
}

const shownText = (container) => container.textContent

describe('DocTitle — nothing distinguishing is ever cut', () => {
  it('at 1200px it reads as one full line', () => {
    const { container } = render(<DocTitle paper={paper} width={1200} status="Draft" />)
    expect(shownText(container)).toContain('Grade 4 Integrated Science — End of Term 1 Test · 2026')
  })

  it('at 380px it compresses but keeps grade, subject, term and year', () => {
    const { container } = render(<DocTitle paper={paper} width={380} status="Draft" />)
    const text = shownText(container)
    expect(text).toContain('Grade 4 Integrated Science')
    expect(text).toContain('EOT 1')
    expect(text).toContain('2026')
  })

  it('at a phone-sized container every fact survives, across two lines', () => {
    const { container } = render(<DocTitle paper={paper} width={200} status="Draft" />)
    const text = shownText(container)
    for (const fact of ['Integrated Science', 'Grade 4', 'End of Term', '1', '2026', 'Draft']) {
      expect(text).toContain(fact)
    }
  })

  it('the phone title is a control that opens the details sheet', () => {
    const onOpenDetails = vi.fn()
    render(<DocTitle paper={paper} width={200} status="Draft" onOpenDetails={onOpenDetails} />)
    fireEvent.click(screen.getByRole('button', { name: /paper details/i }))
    expect(onOpenDetails).toHaveBeenCalled()
  })

  it('a wide title is not a button — there is nothing hidden to reveal', () => {
    render(<DocTitle paper={paper} width={1200} onOpenDetails={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a paper the teacher named leads with that name and keeps the facts beneath', () => {
    const { container } = render(
      <DocTitle paper={{ ...paper, title: 'Holiday revision' }} width={200} status="Draft" />,
    )
    const text = shownText(container)
    expect(text).toContain('Holiday revision')
    expect(text).toContain('Grade 4 Integrated Science')
    expect(text).toContain('2026')
  })
})

describe('PaperDetailsSheet', () => {
  const open = (props = {}) => {
    const onChange = vi.fn()
    const onEditAll = vi.fn()
    const onClose = vi.fn()
    render(
      <PaperDetailsSheet
        open
        paper={paper}
        assessmentTypes={['topic_test', 'end_of_term', 'mock_exam', 'examination']}
        onChange={onChange}
        onClose={onClose}
        onEditAll={onEditAll}
        {...props}
      />,
    )
    return { onChange, onEditAll, onClose }
  }

  it('shows the full, uncut name — the thing the bar could not', () => {
    open()
    expect(screen.getByRole('heading', { name: /Grade 4 Integrated Science — End of Term 1 Test · 2026/ }))
      .toBeInTheDocument()
  })

  it('quick-edits the paper-level fields in place', () => {
    const { onChange } = open()
    fireEvent.change(screen.getByLabelText('Term'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith('term', '3')
  })

  it('does NOT offer a second grade or subject picker', () => {
    // Those two are scoped to each other through the live syllabus; a second
    // copy here is how a teacher gets offered a subject their grade is not
    // taught. "Edit all paper details" opens the form that knows the rules.
    open()
    expect(screen.queryByLabelText('Grade / level')).toBeNull()
    expect(screen.queryByLabelText('Subject')).toBeNull()
  })

  it('routes to the full header form and closes itself on the way', () => {
    const { onEditAll, onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: /edit all paper details/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onEditAll).toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<PaperDetailsSheet open={false} paper={paper} />)
    expect(container).toBeEmptyDOMElement()
  })
})
