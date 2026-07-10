import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockPickerSlide, EditorSlide } from './AssessmentSlideOvers.jsx'

// The block picker is a static tile grid — mount it directly with an onPick
// spy and assert every tile fires the key handleBlockPick expects. Guards the
// "Diagram-based" mis-wire (it used to fire 'structured', identical to the
// Structured tile, so picking it silently produced a figure-less block).

// Keep the live Firebase app (pulled transitively via the syllabus-topic
// hook → KB services) out of this jsdom run — same stubs as
// AssessmentStudio.spec.jsx.
vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {}, app: {} }))
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => vi.fn() }))
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
  addDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  serverTimestamp: vi.fn(), writeBatch: vi.fn(), onSnapshot: vi.fn(),
}))

// Heavy sub-imports that EditorSlide pulls in transitively.
vi.mock('../../editor/components/RichEditor.jsx', () => ({
  default: ({ label, placeholder, onChange }) => (
    <textarea
      aria-label={label || 'Rich editor'}
      placeholder={placeholder}
      onChange={e => onChange?.(e.target.value)}
    />
  ),
}))
vi.mock('../ui/AiGenerationProgress', () => ({ default: () => null }))
vi.mock('./syllabusTopicOptions', () => ({
  useSyllabusTopicOptions: () => ({ options: [], loading: false }),
}))
vi.mock('./views/PaperBlocks', () => ({ PaperBlock: () => null }))
vi.mock('../../utils/assessmentBloom', () => ({
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
vi.mock('./studio/sections/CurriculumPicker', () => ({ CurriculumPicker: () => null }))
vi.mock('../../utils/pasteQuestionParser.js', () => ({ parsePastedQuestions: vi.fn() }))
vi.mock('../diagrams/DiagramSvg', () => ({ default: () => null }))
vi.mock('./studio/studioIcons', () => ({ default: () => null }))

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
