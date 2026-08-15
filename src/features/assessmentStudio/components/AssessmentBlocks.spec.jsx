/**
 * Vitest spec for AssessmentBlocks.jsx — focused on the F1 import-summary
 * banner behaviour in HeaderBlock.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HeaderBlock, PassageBlock } from './AssessmentBlocks.jsx'

// Stub heavy sub-imports so only HeaderBlock's own logic is under test.
vi.mock('./AssessmentQuestionEditors', () => ({
  toEditableText: (v) => (typeof v === 'string' ? v : ''),
  CardQuestionText: () => null,
  McqOptions: () => null,
  ShortAnswerInputs: () => null,
  AnswerSpaceControl: () => null,
}))
vi.mock('../lib/assessmentQuestionTypes', () => ({
  STUDIO_QUESTION_TYPE_OPTIONS: [],
  typeSelectValue: (t) => t || 'mcq',
}))
vi.mock('../pages/AssessmentStudio', () => ({
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
vi.mock('../../../services/quizImport/documentQuizImporter', () => ({ QUIZ_DOCUMENT_ACCEPT: '.doc,.pdf' }))
vi.mock('./studioIcons', () => ({ default: () => null }))
// AssessmentBlocks.jsx imports QuestionBlock from AssessmentQuestionBlock,
// which transitively imports suggestAnswer → firebase/config. Stub it out so
// the spec stays firebase-free.
vi.mock('./AssessmentQuestionBlock', () => ({ QuestionBlock: () => null }))
// HeaderBlock's syllabus-driven subject choices pull the merged-syllabi
// services (→ firebase) transitively; stub the hook module so the spec stays
// firebase-free and deterministic.
vi.mock('../../../components/teacher/syllabusTopicOptions', () => ({
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
vi.mock('../lib/assessmentStudioMeta', () => ({
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

/*
 * The collapsed header.
 *
 * The form asks for eighteen things. All of them matter once; none of them
 * matter on the tenth question, and while they were on screen the builder page
 * was mostly settings. The rule for WHEN it collapses is tested under plain
 * node (scripts/test-assessment-header-summary.mjs); these cover what the
 * teacher can see and reach in each of the three modes.
 */
describe('HeaderBlock — collapse-when-valid', () => {
  it('mode "form" renders the full form, as a new paper should', () => {
    renderHeader({ mode: 'form' })
    expect(screen.getByPlaceholderText('e.g. Jemareen Academy')).toBeInTheDocument()
  })

  it('mode "summary" states the paper on one line, with an Edit route back', () => {
    const onOpenHeader = vi.fn()
    renderHeader({ mode: 'summary', onOpenHeader })
    // Every fact the form was holding, in the order the header states them.
    for (const fact of ['Test School', 'Grade 4', 'Mathematics', '2026', '60 min', 'A4 portrait', 'MCQ A–D vertical']) {
      expect(screen.getByText(fact)).toBeInTheDocument()
    }
    // …and none of the form itself.
    expect(screen.queryByPlaceholderText('e.g. Jemareen Academy')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onOpenHeader).toHaveBeenCalled()
  })

  it('the estimated-time note stays visible on the collapsed card', () => {
    // It is the one header fact that keeps changing as questions are added, so
    // collapsing the form must not take it away.
    renderHeader({
      mode: 'summary',
      timingNote: 'Estimated ~1 min — well under the 60 min allowed; there’s room for more.',
    })
    expect(screen.getByText(/Estimated ~1 min/)).toBeInTheDocument()
  })

  it('mode "drawer" keeps the summary in place and opens the form over it', () => {
    const onCloseHeader = vi.fn()
    renderHeader({ mode: 'drawer', onCloseHeader })
    expect(screen.getByText('Test School')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /paper details/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. Jemareen Academy')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close paper details/i }))
    expect(onCloseHeader).toHaveBeenCalled()
  })

  it('Escape closes the drawer', () => {
    // It is aria-modal; Escape is the one dismissal a keyboard user expects
    // without being shown it. The scrim needs a pointer and the two buttons
    // need finding.
    const onCloseHeader = vi.fn()
    renderHeader({ mode: 'drawer', onCloseHeader })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCloseHeader).toHaveBeenCalledTimes(1)
  })

  it('Escape does NOT collapse the inline form', () => {
    // Inline is not an overlay. Collapsing a form the teacher is filling in,
    // from a key they pressed to dismiss something else, is a different bug
    // from the one Escape is here to fix.
    const onCloseHeader = vi.fn()
    renderHeader({ mode: 'form', onCloseHeader })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCloseHeader).not.toHaveBeenCalled()
  })

  it('the drawer stops listening once it is closed', () => {
    // A listener left on the document would fire for every Escape anywhere in
    // the studio, closing a header that is not open.
    const onCloseHeader = vi.fn()
    const { unmount } = renderHeader({ mode: 'drawer', onCloseHeader })
    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCloseHeader).not.toHaveBeenCalled()
  })

  it('marks the FORM, not the summary card, as the focus-deferral target', () => {
    // The collapse defers while the cursor is in the header form. Both the form
    // and the summary card carry `.b-header`, so the hook keys off this
    // attribute instead — otherwise tabbing onto the summary's "Edit" button
    // would read as "still typing" and re-expand the form.
    const { container, unmount } = renderHeader({ mode: 'form' })
    expect(container.querySelector('[data-paper-header-form]')).toBeInTheDocument()
    unmount()
    const summary = renderHeader({ mode: 'summary' })
    expect(summary.container.querySelector('[data-paper-header-form]')).toBeNull()
  })
})
