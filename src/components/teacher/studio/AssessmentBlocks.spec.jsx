/**
 * Vitest spec for AssessmentBlocks.jsx — focused on the F1 import-summary
 * banner behaviour in HeaderBlock.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HeaderBlock } from './AssessmentBlocks.jsx'

// Stub heavy sub-imports so only HeaderBlock's own logic is under test.
vi.mock('../AssessmentQuestionEditors', () => ({
  toEditableText: (v) => (typeof v === 'string' ? v : ''),
  CardQuestionText: () => null,
  McqOptions: () => null,
  ShortAnswerInputs: () => null,
  AnswerSpaceControl: () => null,
}))
vi.mock('../assessmentQuestionTypes', () => ({
  STUDIO_QUESTION_TYPE_OPTIONS: [],
  typeSelectValue: (t) => t || 'mcq',
}))
vi.mock('../AssessmentStudio', () => ({
  ASSESSMENT_TYPE_LABELS: {
    topic: 'Topic Test',
    weekly: 'Weekly Test',
    mid_term: 'Mid-Term Test',
    end_of_term: 'End-of-Term Test',
  },
  GRADES: ['1', '2', '3', '4'],
  SUBJECTS: ['English', 'Mathematics'],
  TERMS: ['1', '2', '3'],
  INSTRUCTION_PRESETS: [],
  buildTitleFromForm: () => 'GRADE 4 TOPIC TEST - 2026',
}))
vi.mock('../../documentQuizImporter', () => ({ QUIZ_DOCUMENT_ACCEPT: '.doc,.pdf' }), { virtual: true })
vi.mock('../../quiz/documentQuizImporter', () => ({ QUIZ_DOCUMENT_ACCEPT: '.doc,.pdf' }))
vi.mock('./studioIcons', () => ({ default: () => null }))
// AssessmentBlocks.jsx imports QuestionBlock from AssessmentQuestionBlock,
// which transitively imports suggestAnswer → firebase/config. Stub it out so
// the spec stays firebase-free.
vi.mock('../AssessmentQuestionBlock', () => ({ QuestionBlock: () => null }))
vi.mock('../assessmentStudioMeta', () => ({
  ASSESSMENT_TYPE_LABELS: {
    topic: 'Topic Test', weekly: 'Weekly Test',
    mid_term: 'Mid-Term Test', end_of_term: 'End-of-Term Test',
  },
  STUDIO_SUBJECTS: ['English', 'Mathematics'],
  STUDIO_GRADES: ['1', '2', '3', '4'],
  SECTION_LETTERS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
}))

const baseForm = {
  schoolName: 'Test School',
  className: '',
  grade: '4',
  assessmentType: 'topic',
  term: '1',
  year: 2026,
  subject: 'Mathematics',
  paperName: '',
  duration: 60,
  assessmentDate: '',
  showNameField: true,
  showDateField: true,
  showMarksField: true,
  showClassField: false,
  mcqOptionLayout: 'vertical',
  mcqAnswerChoiceCount: 4,
  coverInstructions: '',
  endOfPaperText: '— END OF PAPER —',
  title: '',
}

function renderHeader(props = {}) {
  return render(
    <MemoryRouter>
      <HeaderBlock
        form={baseForm}
        setF={vi.fn()}
        importing={false}
        onImportDocument={vi.fn()}
        onScan={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('HeaderBlock — import summary banner', () => {
  it('renders no banner when importSummary is null', () => {
    renderHeader({ importSummary: null })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders no banner when importSummary is undefined', () => {
    renderHeader()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the file name when importSummary is provided', () => {
    renderHeader({
      importSummary: {
        fileName: 'Grade4Maths.pdf',
        totalQuestions: 10,
        reviewCount: 2,
        smartApplied: false,
        warnings: [],
      },
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/Grade4Maths\.pdf/)).toBeInTheDocument()
    expect(screen.getByText(/10 questions extracted/)).toBeInTheDocument()
  })

  it('renders the Smart import tag when smartApplied is true', () => {
    renderHeader({
      importSummary: {
        fileName: 'paper.docx',
        totalQuestions: 5,
        reviewCount: 0,
        smartApplied: true,
        warnings: [],
      },
    })
    expect(screen.getByText(/Smart import/i)).toBeInTheDocument()
  })

  it('renders a needs-review count when reviewCount > 0', () => {
    renderHeader({
      importSummary: {
        fileName: 'scan.pdf',
        totalQuestions: 8,
        reviewCount: 3,
        smartApplied: false,
        warnings: [],
      },
    })
    expect(screen.getByText(/3 need review/)).toBeInTheDocument()
  })

  it('renders inline warning items when warnings.length <= 3', () => {
    renderHeader({
      importSummary: {
        fileName: 'test.pdf',
        totalQuestions: 4,
        reviewCount: 0,
        smartApplied: false,
        warnings: ['Skipped image on page 2', 'Answer key missing for Q3'],
      },
    })
    expect(screen.getByText(/Skipped image on page 2/)).toBeInTheDocument()
    expect(screen.getByText(/Answer key missing for Q3/)).toBeInTheDocument()
  })

  it('wraps warnings in <details> when warnings.length > 3', () => {
    const { container } = renderHeader({
      importSummary: {
        fileName: 'big.pdf',
        totalQuestions: 20,
        reviewCount: 0,
        smartApplied: false,
        warnings: ['W1', 'W2', 'W3', 'W4'],
      },
    })
    expect(container.querySelector('details')).not.toBeNull()
  })

  it('calls onDismissImportSummary when dismiss button is clicked', () => {
    const onDismiss = vi.fn()
    renderHeader({
      importSummary: {
        fileName: 'paper.pdf',
        totalQuestions: 3,
        reviewCount: 0,
        smartApplied: false,
        warnings: [],
      },
      onDismissImportSummary: onDismiss,
    })
    const btn = screen.getByRole('button', { name: /Dismiss import summary/i })
    fireEvent.click(btn)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
