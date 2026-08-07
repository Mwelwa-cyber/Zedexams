/**
 * Vitest spec for AssessmentBlocks.jsx — focused on the F1 import-summary
 * banner behaviour in HeaderBlock.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HeaderBlock, PassageBlock } from './AssessmentBlocks.jsx'

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
  // Two different titles, and the card previews the HEADER one (no subject —
  // the header prints the subject on its own line right below it).
  buildTitleFromForm: () => 'GRADE 4 ENGLISH - TOPIC TEST - 2026',
  buildHeaderTitleFromForm: () => 'GRADE 4 TOPIC TEST - 2026',
}))
vi.mock('../../documentQuizImporter', () => ({ QUIZ_DOCUMENT_ACCEPT: '.doc,.pdf' }), { virtual: true })
vi.mock('../../quiz/documentQuizImporter', () => ({ QUIZ_DOCUMENT_ACCEPT: '.doc,.pdf' }))
vi.mock('./studioIcons', () => ({ default: () => null }))
// AssessmentBlocks.jsx imports QuestionBlock from AssessmentQuestionBlock,
// which transitively imports suggestAnswer → firebase/config. Stub it out so
// the spec stays firebase-free.
vi.mock('../AssessmentQuestionBlock', () => ({ QuestionBlock: () => null }))
// HeaderBlock's syllabus-driven subject choices pull the merged-syllabi
// services (→ firebase) transitively; stub the hook module so the spec stays
// firebase-free and deterministic.
vi.mock('../syllabusTopicOptions', () => ({
  useStudioSubjectChoices: () => ({ options: ['English', 'Mathematics'], loading: false }),
  useSyllabusSubjectOptions: () => ({
    subjects: [
      { key: 'english', label: 'English' },
      { key: 'mathematics', label: 'Mathematics' },
    ],
    loading: false,
  }),
  useSyllabusLevelOptions: () => ({
    levels: [
      { value: 'ECE_N', label: 'Nursery', group: 'Early Childhood' },
      { value: '4', label: 'Grade 4', group: 'Primary' },
      { value: 'G8', label: 'Form 1', group: 'Secondary' },
    ],
    loading: false,
  }),
  normalizeStudioFramework: (v) => (String(v || '') === '2013' ? '2013' : '2023'),
  CURRICULUM_FRAMEWORKS: [
    { value: '2023', label: 'New CBC (2023)' },
    { value: '2013', label: 'Previous syllabus (2013)' },
  ],
}))
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

/*
 * A paper has two names, and the card must show each in its own place. Putting
 * the subject-bearing LIBRARY name in the header preview would print the subject
 * twice on every paper (the header renders it on its own line right below the
 * title), and showing only the header name leaves the teacher with no idea what
 * their paper is called in the library — which is where the seven identically
 * named papers were indistinguishable.
 */
describe('HeaderBlock — the header title and the library name are shown separately', () => {
  it('previews the subject-less header title, and names the library copy below it', () => {
    const { container } = renderHeader()
    expect(container.querySelector('.sv-title-auto')).toHaveTextContent('GRADE 4 TOPIC TEST - 2026')
    expect(container.querySelector('.sv-title-auto'))
      .not.toHaveTextContent(baseForm.subject.toUpperCase())
    // The subject still prints on its own line, as it does on the paper.
    expect(container.querySelector('.sv-subject-auto'))
      .toHaveTextContent(baseForm.subject.toUpperCase())
    expect(screen.getByText(/Saved in your library as/)).toBeInTheDocument()
    expect(screen.getByText('GRADE 4 ENGLISH - TOPIC TEST - 2026')).toBeInTheDocument()
  })
})

/*
 * The header is thirteen controls a teacher answers once and then scrolls past
 * on every visit. Collapsed, it is the sentence of those answers. The rule that
 * makes that safe: an INCOMPLETE header never collapses, because a summary
 * reading "· · 2026 · 60 min" hides the fields that still need answering.
 */
describe('HeaderBlock — collapse to a one-line summary', () => {
  it('collapsed, states every decision the form holds, with one Edit affordance', () => {
    const onToggleOpen = vi.fn()
    renderHeader({ open: false, onToggleOpen })
    expect(screen.getByText(/Test School/)).toBeInTheDocument()
    expect(screen.getByText(/Grade 4/)).toBeInTheDocument()
    expect(screen.getByText(/Mathematics/)).toBeInTheDocument()
    expect(screen.getByText(/60 min/)).toBeInTheDocument()
    expect(screen.getByText(/MCQ A–D vertical/)).toBeInTheDocument()
    // The form itself is gone — that is the point.
    expect(screen.queryByLabelText(/School name/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onToggleOpen).toHaveBeenCalled()
  })

  it('an incomplete header stays OPEN even when the parent asks it to collapse', () => {
    // Fail-open: the summary's whole job is to state the answers, so it must
    // never stand in for a field that has no answer yet.
    renderHeader({ open: false, form: { ...baseForm, subject: '' }, onToggleOpen: vi.fn() })
    expect(screen.getByText('Paper Header')).toBeInTheDocument()
  })

  it('the estimated-time chip rides on the summary card, not the warnings list', () => {
    renderHeader({
      open: false,
      onToggleOpen: vi.fn(),
      timingWarning: { key: 'timing-under', severity: 'info', message: 'Estimated ~1 min — well under the 60 min allowed.' },
    })
    expect(screen.getByText(/Estimated ~1 min/)).toBeInTheDocument()
  })

  it('an import summary is still shown while the header is collapsed', () => {
    renderHeader({
      open: false,
      onToggleOpen: vi.fn(),
      importSummary: { fileName: 'paper.docx', totalQuestions: 12 },
    })
    expect(screen.getByRole('status')).toHaveTextContent('paper.docx')
  })

  it('reopened as a drawer, the summary stays on the page behind it', () => {
    const { container } = renderHeader({ open: true, variant: 'drawer', onToggleOpen: vi.fn() })
    expect(container.querySelector('.sv-header-drawer')).toBeInTheDocument()
    expect(container.querySelector('.sv-header-summary')).toBeInTheDocument()
    expect(screen.getByText('Paper Header')).toBeInTheDocument()
  })

  it('the drawer has a visible way out, and Escape is one of them', () => {
    // The scrim is a way out only if you know it is one. A drawer whose only
    // close affordance is "click the dimmed area" is a drawer a teacher gets
    // stuck in.
    const onToggleOpen = vi.fn()
    renderHeader({ open: true, variant: 'drawer', onToggleOpen })
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onToggleOpen).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onToggleOpen).toHaveBeenCalledTimes(2)
  })

  it('an inline header — a paper still being set up — has no Escape-to-close', () => {
    // Inline is not an overlay; Escape there would collapse a form the teacher
    // is filling in, from a key they pressed to dismiss something else.
    const onToggleOpen = vi.fn()
    renderHeader({ open: true, variant: 'inline', onToggleOpen })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onToggleOpen).not.toHaveBeenCalled()
  })
})

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

/* =========================================================
 * F7 regression — Year and Duration inputs must not clamp
 * on every keystroke; clamping happens only on blur.
 * ========================================================= */
describe('HeaderBlock — Year and Duration inputs do not clamp mid-typing (F7)', () => {
  // In HeaderBlock the spinbuttons appear in DOM order: Year first, Duration second.
  it('Year: partial input "2" is stored raw (not snapped to 2020)', () => {
    const setF = vi.fn()
    renderHeader({ setF })
    const [yearInput] = screen.getAllByRole('spinbutton')
    fireEvent.change(yearInput, { target: { value: '2' } })
    // onChange must forward the raw string, never clampInt
    expect(setF).toHaveBeenCalledWith('year', '2')
  })

  it('Year: onBlur commits the clamped year ("2" → 2020)', () => {
    const setF = vi.fn()
    renderHeader({ setF })
    const [yearInput] = screen.getAllByRole('spinbutton')
    fireEvent.blur(yearInput, { target: { value: '2' } })
    expect(setF).toHaveBeenCalledWith('year', 2020)
  })

  it('Year: clearing the field (blur with "") commits the fallback year', () => {
    const setF = vi.fn()
    renderHeader({ setF })
    const [yearInput] = screen.getAllByRole('spinbutton')
    fireEvent.blur(yearInput, { target: { value: '' } })
    // clampInt('', 2020, 2099, currentYear) returns currentYear
    const committed = setF.mock.calls.find(([k]) => k === 'year')?.[1]
    expect(typeof committed).toBe('number')
    expect(committed).toBeGreaterThanOrEqual(2020)
    expect(committed).toBeLessThanOrEqual(2099)
  })

  it('Duration: partial input "4" is stored raw (not clamped to 5)', () => {
    const setF = vi.fn()
    renderHeader({ setF })
    const [, durationInput] = screen.getAllByRole('spinbutton')
    fireEvent.change(durationInput, { target: { value: '4' } })
    expect(setF).toHaveBeenCalledWith('duration', '4')
  })

  it('Duration: "45" stays 45 after blur — not clamped to 55', () => {
    const setF = vi.fn()
    renderHeader({ setF })
    const [, durationInput] = screen.getAllByRole('spinbutton')
    fireEvent.blur(durationInput, { target: { value: '45' } })
    expect(setF).toHaveBeenCalledWith('duration', 45)
  })
})

/* =========================================================
 * F23 regression — passage sub-question marks input must
 * never store 0 while displaying 1.
 * ========================================================= */

function renderPassage({ marks = 2 } = {}) {
  const onUpdatePassageQuestion = vi.fn()
  const section = {
    id: 'sec-1',
    kind: 'passage',
    passage: {
      passageKind: 'comprehension',
      title: 'Reading Passage',
      passageText: 'Some passage text.',
      questions: [{
        localId: 'q-1',
        type: 'mcq',
        marks,
        text: 'Q1 stem',
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 0,
      }],
    },
  }
  render(
    <PassageBlock
      section={section}
      sectionIndex={0}
      parts={[]}
      questionNumbers={{ 'q-1': 1 }}
      paperMeta={{}}
      onEditQuestion={vi.fn()}
      onMoveSection={vi.fn()}
      onRemoveSection={vi.fn()}
      onUpdateSection={vi.fn()}
      onUploadPassageImage={vi.fn()}
      onRemovePassageImage={vi.fn()}
      onUpdatePassageQuestion={onUpdatePassageQuestion}
      onAddPassageQuestion={vi.fn()}
      onRemovePassageQuestion={vi.fn()}
      onAssignSectionToPart={vi.fn()}
    />,
  )
  return { onUpdatePassageQuestion }
}

describe('PassageBlock — marks input never stores 0 while displaying 1 (F23)', () => {
  it('clearing the marks field stores 1 (min 1), not 0', () => {
    const { onUpdatePassageQuestion } = renderPassage({ marks: 2 })
    // The sub-question marks input is wrapped in <label>marks<input /></label>
    const marksInput = screen.getByLabelText('marks')
    fireEvent.change(marksInput, { target: { value: '' } })
    // clampInt('', 1, 100, 1) must return 1 — previously returned 0
    expect(onUpdatePassageQuestion).toHaveBeenCalledWith(0, 0, 'marks', 1)
  })

  it('stored 0 is displayed as 0 (not silently shown as 1)', () => {
    // With ?? 1, question.marks=0 renders as 0 (truthful), not 1 (old || 1 behaviour)
    renderPassage({ marks: 0 })
    const marksInput = screen.getByLabelText('marks')
    expect(marksInput).toHaveValue(0)
  })

  it('onChange payload matches display for any non-empty value', () => {
    const { onUpdatePassageQuestion } = renderPassage({ marks: 3 })
    const marksInput = screen.getByLabelText('marks')
    fireEvent.change(marksInput, { target: { value: '5' } })
    expect(onUpdatePassageQuestion).toHaveBeenCalledWith(0, 0, 'marks', 5)
  })
})
