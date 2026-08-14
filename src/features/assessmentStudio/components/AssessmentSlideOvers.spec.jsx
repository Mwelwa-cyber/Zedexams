import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockPickerSlide, EditorSlide, PaperRenderView } from './AssessmentSlideOvers.jsx'

// The block picker is a static tile grid — mount it directly with an onPick
// spy and assert every tile fires the key handleBlockPick expects. Guards the
// "Diagram-based" mis-wire (it used to fire 'structured', identical to the
// Structured tile, so picking it silently produced a figure-less block).

// Keep the live Firebase app (pulled transitively via the syllabus-topic
// hook → KB services) out of this jsdom run — same stubs as
// AssessmentStudio.spec.jsx.
vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {}, app: {} }))
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => vi.fn() }))
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
  addDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  serverTimestamp: vi.fn(), writeBatch: vi.fn(), onSnapshot: vi.fn(),
}))

// Heavy sub-imports that EditorSlide pulls in transitively.
vi.mock('../../../editor/components/RichEditor.jsx', () => ({
  default: ({ label, placeholder, onChange }) => (
    <textarea
      aria-label={label || 'Rich editor'}
      placeholder={placeholder}
      onChange={e => onChange?.(e.target.value)}
    />
  ),
}))
vi.mock('../../../shared/components/AiGenerationProgress', () => ({ default: () => null }))
vi.mock('../../../components/teacher/syllabusTopicOptions', () => ({
  useSyllabusTopicOptions: () => ({ options: [], loading: false }),
  useStudioSubjectChoices: () => ({ options: ['English', 'Mathematics'], loading: false }),
  normalizeStudioFramework: (v) => (String(v || '') === '2013' ? '2013' : '2023'),
}))
vi.mock('../../../components/teacher/views/PaperBlocks', () => ({ PaperBlock: () => null }))
vi.mock('../lib/assessmentBloom', () => ({
  bloomLevel: () => '',
  BLOOM_LABELS: {},
  BLOOM_LEVELS: [],
}))
vi.mock('./AssessmentAnalysisActions', () => ({
  BalanceDifficultyAction: () => null,
  BloomBalanceAction: () => null,
  MapCompetenciesAction: () => null,
  DetectDuplicatesAction: () => null,
}))
vi.mock('./AiReviewPanel', () => ({ default: () => null }))
vi.mock('../../../components/teacher/studio/sections/CurriculumPicker', () => ({ CurriculumPicker: () => null }))
vi.mock('../lib/pasteQuestionParser.js', () => ({ parsePastedQuestions: vi.fn() }))
vi.mock('../../../components/diagrams/DiagramSvg', () => ({ default: () => null }))
vi.mock('./studioIcons', () => ({ default: () => null }))

function pickFromTile(title) {
  const onPick = vi.fn()
  render(<BlockPickerSlide open onClose={() => {}} onPick={onPick} />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }))
  expect(onPick).toHaveBeenCalledTimes(1)
  return onPick.mock.calls[0][0]
}

describe('BlockPickerSlide — tile → block key mapping', () => {
  it('"Diagram-based" inserts a diagram question, NOT a structured one', () => {
    expect(pickFromTile('Label or describe an image')).toBe('diagram_image')
  })

  it('"Structured" keeps its own key', () => {
    expect(pickFromTile('Multi-part with marks')).toBe('structured')
  })

  it('"Diagram-Based Question" (stimulus) keeps its own key', () => {
    expect(pickFromTile('Instruction → diagram → follow-up sub-questions')).toBe('diagram_stimulus')
  })

  it('no two tiles fire the same key', () => {
    const onPick = vi.fn()
    render(<BlockPickerSlide open onClose={() => {}} onPick={onPick} />)
    const tiles = screen.getAllByRole('button').filter(b => b.className.includes('sv-bp-item'))
    tiles.forEach(tile => fireEvent.click(tile))
    const keys = onPick.mock.calls.map(c => c[0])
    expect(keys.length).toBe(tiles.length)
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes).toEqual([])
  })
})

/* =========================================================
 * EditorSlide — type select & editors (F2 + F4 regression)
 * =========================================================
 * Guards that:
 *  1. All 8 canonical question types appear in the EditorSlide type select.
 *  2. A numeric question renders the NumericInputs editor (not a generic textarea).
 *  3. Switching type via the select calls the update handler for every patch
 *     field that patchForTypeChange seeds for that type.
 */

/** Build a minimal standalone section for EditorSlide to find. */
function makeStandaloneSection(type = 'mcq', extras = {}) {
  return {
    kind: 'standalone',
    question: {
      localId: 'q-test',
      type,
      options: type === 'mcq' ? ['A opt', 'B opt', 'C opt', 'D opt'] : undefined,
      correctAnswer: type === 'mcq' ? 0 : '',
      ...extras,
    },
  }
}

function renderEditor(sectionType = 'mcq', extras = {}) {
  const onUpdateStandalone = vi.fn()
  const sections = [makeStandaloneSection(sectionType, extras)]
  render(
    <EditorSlide
      open
      onClose={vi.fn()}
      targetKey="q-test"
      sections={sections}
      onUpdateStandaloneQuestion={onUpdateStandalone}
      onUpdatePassageQuestion={vi.fn()}
      questionNumbers={{ 'q-test': 1 }}
    />,
  )
  return { onUpdateStandalone }
}

describe('EditorSlide — type select & editors (F2+F4)', () => {
  it('lists all 8 question types in the type <select>', () => {
    renderEditor('mcq')
    // The type select is the first combobox; Bloom level is the second.
    const selects = screen.getAllByRole('combobox')
    const typeSelect = selects[0]
    const optionValues = Array.from(typeSelect.querySelectorAll('option')).map(o => o.value)
    expect(optionValues).toContain('mcq')
    expect(optionValues).toContain('short_answer')
    expect(optionValues).toContain('diagram')
    expect(optionValues).toContain('essay')
    expect(optionValues).toContain('numeric')
    expect(optionValues).toContain('matching')
    expect(optionValues).toContain('sequence')
    expect(optionValues).toContain('fill_blanks')
    expect(optionValues).toHaveLength(8)
  })

  it('renders the NumericInputs editor (not a generic textarea) for a numeric question', () => {
    renderEditor('numeric', { correctAnswer: '42', numericTolerance: 0, numericUnit: 'kg' })
    // NumericInputs renders an "Expected value" label — unique to that editor.
    expect(screen.getByText(/Expected value/i)).toBeInTheDocument()
    // "Tolerance ±" is the exact label text in NumericInputs.
    // Use the exact string to avoid matching the hint paragraph "Leave tolerance at…".
    expect(screen.getByText('Tolerance ±')).toBeInTheDocument()
  })

  it('switching type to fill_blanks calls the update handler for all seeded fields', () => {
    const { onUpdateStandalone } = renderEditor('mcq')
    const selects = screen.getAllByRole('combobox')
    const typeSelect = selects[0]

    fireEvent.change(typeSelect, { target: { value: 'fill_blanks' } })

    // patchForTypeChange('mcq' question, 'fill_blanks') returns:
    //   { type, detectedType, statements, wordBank, correctAnswer }
    // Each entry is dispatched as onUpdateStandaloneQuestion(sectionIndex, field, value).
    const updatedFields = onUpdateStandalone.mock.calls.map(([, field]) => field)
    expect(updatedFields).toContain('type')
    expect(updatedFields).toContain('statements')
    expect(updatedFields).toContain('wordBank')
  })

  it('switching type to numeric seeds numericTolerance and numericUnit', () => {
    const { onUpdateStandalone } = renderEditor('mcq')
    const selects = screen.getAllByRole('combobox')
    const typeSelect = selects[0]

    fireEvent.change(typeSelect, { target: { value: 'numeric' } })

    const updatedFields = onUpdateStandalone.mock.calls.map(([, field]) => field)
    expect(updatedFields).toContain('type')
    expect(updatedFields).toContain('numericTolerance')
    expect(updatedFields).toContain('numericUnit')
  })

  it('switching type to matching seeds matchingLeft, matchingRight, matchingAnswer', () => {
    const { onUpdateStandalone } = renderEditor('mcq')
    const selects = screen.getAllByRole('combobox')
    const typeSelect = selects[0]

    fireEvent.change(typeSelect, { target: { value: 'matching' } })

    const updatedFields = onUpdateStandalone.mock.calls.map(([, field]) => field)
    expect(updatedFields).toContain('matchingLeft')
    expect(updatedFields).toContain('matchingRight')
    expect(updatedFields).toContain('matchingAnswer')
  })
})

/* =========================================================
 * F23 regression — EditorSlide marks input must never
 * store 0 while displaying 1.
 *
 * For MCQ questions, the Marks <input type="number"> is the
 * only spinbutton in EditorSlide, so getAllByRole('spinbutton')[0]
 * reliably targets it.
 * ========================================================= */
describe('EditorSlide — marks input never stores 0 while displaying 1 (F23)', () => {
  it('clearing marks stores 1 (not 0)', () => {
    const { onUpdateStandalone } = renderEditor('mcq', { marks: 3 })
    const [marksInput] = screen.getAllByRole('spinbutton')
    fireEvent.change(marksInput, { target: { value: '' } })
    // clampInt('', 1, 100, 1) must return 1 — previously returned 0
    const marksCalls = onUpdateStandalone.mock.calls.filter(([, field]) => field === 'marks')
    expect(marksCalls).toHaveLength(1)
    expect(marksCalls[0][2]).toBe(1)
  })

  it('stored 0 is displayed as 0 (not silently shown as 1)', () => {
    // With ?? 1, question.marks=0 renders as 0 (truthful), not 1 (old || 1)
    renderEditor('mcq', { marks: 0 })
    const [marksInput] = screen.getAllByRole('spinbutton')
    expect(marksInput).toHaveValue(0)
  })

  it('display value matches the stored value after a normal change', () => {
    const { onUpdateStandalone } = renderEditor('mcq', { marks: 2 })
    const [marksInput] = screen.getAllByRole('spinbutton')
    fireEvent.change(marksInput, { target: { value: '7' } })
    const marksCalls = onUpdateStandalone.mock.calls.filter(([, field]) => field === 'marks')
    expect(marksCalls[0][2]).toBe(7)
  })
})

// ── PaperRenderView — the export gate (Phase 1.1) ─────────────────────────
// A paper with an unfinished question used to download and print as
// "1. (no question text) … TOTAL MARKS: ___ / 1". Save was already gated on
// the same blocking issues; the four export buttons were not. These pin the
// buttons to the gate so the wiring cannot quietly come loose again.
describe('PaperRenderView — export gate', () => {
  const EXPORT_BUTTONS = [/Download Word/, /Download PDF/, /Print \/ Save as PDF/, /Answer sheet/]

  function renderPreview(exportGate) {
    return render(
      <PaperRenderView
        mode="paper"
        blocks={[]}
        assessment={{ totalMarks: 10 }}
        changeView={() => {}}
        onExport={vi.fn()}
        onExportAnswerSheet={vi.fn()}
        onSave={vi.fn()}
        exportGate={exportGate}
      />,
    )
  }

  it('disables every download route while the paper is unfinished', () => {
    renderPreview({ blocked: true, reason: 'incomplete-questions', message: 'Question 3 is not finished yet.' })
    for (const name of EXPORT_BUTTONS) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('names what to fix instead of failing silently', () => {
    renderPreview({ blocked: true, reason: 'incomplete-questions', message: 'Question 3 is not finished yet.' })
    expect(screen.getByRole('status')).toHaveTextContent('Question 3 is not finished yet.')
  })

  it('leaves every download route open once the paper is complete', () => {
    renderPreview({ blocked: false, message: '' })
    for (const name of EXPORT_BUTTONS) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('stays usable when no gate is supplied at all', () => {
    // Defensive: an older caller that has not been updated must not lock a
    // teacher out of their own downloads.
    renderPreview(undefined)
    expect(screen.getByRole('button', { name: /Download Word/ })).toBeEnabled()
  })

  it('closes every download route when a required figure cannot be rendered', () => {
    // A missing required diagram is a correctness failure, not a quality
    // warning: the learner is asked to label something that is not on the page.
    // It must reach the teacher the same way an unfinished question does —
    // through the buttons, not through a toast after the file has downloaded.
    renderPreview({
      blocked: true,
      reason: 'unresolved-figure',
      numbers: [5],
      message: 'Question 5 requires a diagram, but the figure could not be rendered. '
        + 'Replace, regenerate or repair the diagram before exporting.',
    })
    for (const name of EXPORT_BUTTONS) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByRole('status')).toHaveTextContent(
      'Question 5 requires a diagram, but the figure could not be rendered.',
    )
  })
})
