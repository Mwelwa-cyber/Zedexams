/**
 * Behaviour tests for AssessmentList.jsx — the deletion flow (the fix for the
 * "deleted assessment comes back after refresh / re-entry" bug), the export
 * readiness gate, and the render-level display-title/search UI.
 *
 * The list performs a persisted, awaited hard delete and coordinates it through
 * the session deletion registry (src/utils/assessmentDeletion.js) so a deleted
 * paper can never be re-persisted by the editor's autosave or resurface from a
 * stale cache. These tests cover:
 *   • confirm dialog names the paper, then a successful delete calls the
 *     Firestore delete, removes the row, tombstones the id, and toasts success;
 *   • a failed (e.g. permission-denied) delete keeps the row, lifts the
 *     tombstone, and shows an error — never a silent optimistic drop;
 *   • a deletion coming from another tab removes the row here too.
 *
 * UI shape (2026-08 overhaul): actions live behind menus — Open (link),
 * Download ▾ (Word / PDF / marking scheme via ActionMenu) and a "More actions"
 * kebab holding Delete. Titles are derived at render time from the paper's own
 * fields, so the term shown always comes from the `term` FIELD, never from
 * term text embedded in a stored free-text title.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Firebase / pagination plumbing (usePaginatedQuery is mocked, so the real
//    fetcher/query-key never run) ──────────────────────────────────────────
vi.mock('../../../firebase/config', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({ where: vi.fn(() => ({})) }))
vi.mock('../services/firestorePage', () => ({ createFirestorePageFetcher: () => vi.fn() }))
vi.mock('../lib/queryKeys', () => ({ createPaginationKey: () => 'key' }))
vi.mock('../../../utils/pagination/cursors', () => ({ PAGE_SIZES: { DESKTOP_LIST: 20 } }))

const paginated = vi.hoisted(() => ({
  items: [],
  isInitialLoading: false,
  isLoadingNextPage: false,
  hasNextPage: false,
  error: null,
  loadNextPage: vi.fn(),
  removeItem: vi.fn(),
}))
vi.mock('../../../hooks/usePaginatedQuery', () => ({ usePaginatedQuery: () => paginated }))

const mockDeleteAssessment = vi.fn()
const mockGetQuestions = vi.hoisted(() => vi.fn().mockResolvedValue([]))
vi.mock('../../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getAssessmentQuestions: mockGetQuestions,
    deleteAssessment: mockDeleteAssessment,
  }),
}))

// The two routes to a file, both stubbed so a test can prove NOTHING was
// delivered while the paper is blocked. Both are dynamic imports inside
// handleExport, so they must be mocked at module scope.
const exportSpies = vi.hoisted(() => ({
  startBrandedDownload: vi.fn().mockResolvedValue(undefined),
  downloadAssessmentDocx: vi.fn().mockResolvedValue({}),
}))
vi.mock('../../../utils/assessmentExportClient', () => ({
  startBrandedDownload: exportSpies.startBrandedDownload,
}))
vi.mock('../../../utils/assessmentToDocx', () => ({
  downloadAssessmentDocx: exportSpies.downloadAssessmentDocx,
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'owner-1' }, userProfile: { id: 'owner-1' }, isAdmin: false }),
}))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => toast }))

// Lightweight ConfirmDialog stub — renders the title + message and wires the
// confirm/cancel buttons so we can drive the real confirmDelete handler.
vi.mock('../../../shared/components/ConfirmDialog', () => ({
  default: ({ open, title, message, confirmLabel, onConfirm, onCancel, loading }) =>
    open ? (
      <div role="alertdialog">
        <h2>{title}</h2>
        <div>{message}</div>
        <button type="button" onClick={onConfirm} disabled={loading}>{confirmLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}))

// Heavy / irrelevant leaves.
vi.mock('../../../utils/downloadFilename', () => ({ buildAssessmentName: () => 'file.docx' }))
vi.mock('../../../utils/teacherLibraryService', () => ({ isFreePlanTeacher: () => false }))
// openPrintWindow must return a window-like object: the row aborts with a
// "pop-ups blocked" toast on a falsy return, which would stop a print test
// before it ever reached the export gate.
//
// That mock outran the real function for a while. `openPrintWindow` passed
// `noopener` in its features string, and `window.open` with `noopener` opens
// the window but returns `null` — so in a real browser every print from this
// list died on "your browser blocked the print window" (which allowing pop-ups
// does not fix) and left the blank tab standing. jsdom ignores the features
// string, so nothing here could see it; a real-Chromium run of this same row
// found it. The features string is now enforced by
// scripts/test-pdf-export-window.test.js.
const printWindow = vi.hoisted(() => ({ close: vi.fn() }))
vi.mock('../../../utils/assessmentToPdf', () => ({
  printAssessmentAsPdf: vi.fn(),
  openPrintWindow: vi.fn(() => printWindow),
}))
vi.mock('../../../utils/importReviewSummary.js', () => ({ summarizeImportReview: () => ({ needsReview: false }) }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../shared/components/Skeleton', () => ({ default: () => null }))
vi.mock('../../../shared/components/PaginationFooter', () => ({ default: () => null }))

import AssessmentList from './AssessmentList'
import {
  isAssessmentDeleted,
  markAssessmentDeleted,
  _resetForTests,
} from '../../../utils/assessmentDeletion'

function renderList() {
  return render(<MemoryRouter><AssessmentList /></MemoryRouter>)
}

/** Open the first row's Download ▾ menu and pick an item by its exact label. */
function pickDownloadItem(itemLabel) {
  fireEvent.click(screen.getAllByRole('button', { name: 'Download' })[0])
  fireEvent.click(screen.getByRole('menuitem', { name: itemLabel }))
}

/** Open the first row's "More actions" kebab and pick Delete. */
function requestDeleteViaMenu(rowIndex = 0) {
  fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[rowIndex])
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetForTests()
  // Real assessments carry a subject and grade; without them the export gate
  // correctly blocks on paper details, which would mask the rule under test.
  // Titles + titleSource as the studio ACTUALLY saves them: a paper nobody
  // named carries the generator's own uppercase string and `titleSource:
  // 'auto'`. The earlier fixtures used readable hand-written prose, which is
  // the one thing a machine-titled paper never carries — and which the shared
  // rule now (correctly) reads as a name a teacher chose.
  paginated.items = [
    { id: 'a1', title: 'GRADE 5 MATHEMATICS - TOPIC TEST - 2026', titleSource: 'auto', year: 2026, assessmentType: 'topic_test', questionCount: 3, subject: 'Mathematics', grade: '5' },
    { id: 'a2', title: 'GRADE 8 INTEGRATED SCIENCE - EXAMINATION - 2026', titleSource: 'auto', year: 2026, assessmentType: 'examination', questionCount: 5, subject: 'Integrated Science', grade: '8' },
  ]
})

describe('AssessmentList — deletion flow', () => {
  it('confirm dialog names the paper (by its display title) before deleting', () => {
    renderList()
    requestDeleteViaMenu(0)
    const dialog = screen.getByRole('alertdialog')
    // a1 is machine-titled, so the dialog carries the render-derived name.
    expect(dialog).toHaveTextContent('Grade 5 Mathematics — Topic Test')
  })

  it('a confirmed delete persists, removes the row, tombstones the id, and toasts success', async () => {
    mockDeleteAssessment.mockResolvedValueOnce(undefined)
    renderList()
    requestDeleteViaMenu(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockDeleteAssessment).toHaveBeenCalledWith('a1'))
    expect(paginated.removeItem).toHaveBeenCalledWith('a1')
    expect(toast.success).toHaveBeenCalledWith('Assessment deleted.')
    // Persisted tombstone → survives a refresh and blocks any editor autosave.
    expect(isAssessmentDeleted('a1')).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a failed delete keeps the row, lifts the tombstone, and shows an error', async () => {
    mockDeleteAssessment.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }))
    renderList()
    requestDeleteViaMenu(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error.mock.calls[0][0]).toMatch(/Delete failed/)
    // Row NOT dropped, and the tombstone lifted since the paper still exists.
    expect(paginated.removeItem).not.toHaveBeenCalled()
    expect(isAssessmentDeleted('a1')).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('a deletion in another tab removes the row here too', async () => {
    renderList()
    // Simulate a peer tab's broadcast by driving the shared registry directly.
    act(() => { markAssessmentDeleted('a2') })
    await waitFor(() => expect(paginated.removeItem).toHaveBeenCalledWith('a2'))
  })
})

/* ── the export gate ─────────────────────────────────────────────────────── */

/**
 * Exporting from this list used to bypass every blocking rule the Assessment
 * Studio enforced: its only check was `questions.length === 0`. A rule with a
 * normal teacher workflow around it is not a rule.
 *
 * The stored-question shape matters here. Firestore documents carry no
 * `localId`, and `collectQuizIssues` keys every issue on one — so a gate wired
 * up without hydration blocks the paper and then names no question, which looks
 * like it works until a teacher tries to act on it.
 */
const storedQuestion = (id, over = {}) => ({
  id,
  order: over.order ?? 0,
  type: 'short_answer',
  text: '<p>Name the largest river in Zambia.</p>',
  marks: 2,
  ...over,
})

async function clickExport(itemLabel = 'Paper (Word)') {
  renderList()
  pickDownloadItem(itemLabel)
  await waitFor(() => expect(mockGetQuestions).toHaveBeenCalled())
}

/** Nothing reached the teacher: no server download, no client build, no print. */
async function expectNothingDelivered() {
  const { printAssessmentAsPdf } = await import('../../../utils/assessmentToPdf')
  expect(exportSpies.startBrandedDownload).not.toHaveBeenCalled()
  expect(exportSpies.downloadAssessmentDocx).not.toHaveBeenCalled()
  expect(printAssessmentAsPdf).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
}

describe('AssessmentList — export readiness', () => {
  it('an empty paper cannot export', async () => {
    mockGetQuestions.mockResolvedValueOnce([])
    await clickExport()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'This assessment has no questions to export yet.',
    ))
    await expectNothingDelivered()
  })

  it('an unfinished question cannot export, and the teacher is told which', async () => {
    mockGetQuestions.mockResolvedValueOnce([
      storedQuestion('q1', { order: 0 }),
      storedQuestion('q2', { order: 1, text: '' }),
    ])
    await clickExport()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    // Named, not merely blocked — this is what the localId hydration buys.
    expect(toast.error.mock.calls[0][0]).toMatch(/Question 2 is not finished/)
    await expectNothingDelivered()
  })

  it('a missing required figure cannot export, with the same sentence as the studio', async () => {
    mockGetQuestions.mockResolvedValueOnce([
      storedQuestion('q1', { imageDiagram: { libraryKey: 'not-in-the-catalog' } }),
    ])
    await clickExport()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error.mock.calls[0][0]).toBe(
      'Question 1 requires a diagram, but the figure could not be rendered. '
      + 'Replace, regenerate or repair the diagram before exporting.',
    )
    await expectNothingDelivered()
  })

  it('a blocked PRINT opens no window and prints nothing', async () => {
    // The print route opens its window before the handler runs, so that the
    // browser does not treat it as a popup. Blocked must not leave it standing.
    const { printAssessmentAsPdf } = await import('../../../utils/assessmentToPdf')
    mockGetQuestions.mockResolvedValueOnce([storedQuestion('q1', { text: '' })])
    await clickExport('Paper (PDF)')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(printAssessmentAsPdf).not.toHaveBeenCalled()
    // Opened before the gate ran, so blocked must also mean closed — otherwise
    // the refusal leaves a blank tab the teacher has to clear by hand.
    expect(printWindow.close).toHaveBeenCalled()
  })

  it('a valid paper exports exactly once, by the branded route', async () => {
    // The gate sits BEFORE the branded server download, which is the route a
    // teacher actually gets — a check after it would guard only the fallback.
    mockGetQuestions.mockResolvedValueOnce([storedQuestion('q1'), storedQuestion('q2', { order: 1 })])
    await clickExport()
    await waitFor(() => expect(exportSpies.startBrandedDownload).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('a render-time unresolved figure still prevents delivery', async () => {
    // The client fallback throws when a figure fails mid-render (a stage no
    // static check can predict). The list must report it rather than claim a
    // download started.
    exportSpies.startBrandedDownload.mockRejectedValueOnce(new Error('server unavailable'))
    exportSpies.downloadAssessmentDocx.mockRejectedValueOnce(Object.assign(
      new Error('Question 1 requires a diagram, but the figure could not be rendered. '
        + 'Replace, regenerate or repair the diagram before exporting.'),
      { code: 'unresolved-figure' },
    ))
    mockGetQuestions.mockResolvedValueOnce([storedQuestion('q1')])
    await clickExport()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error.mock.calls[0][0]).toMatch(/Question 1 requires a diagram/)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('fixing the paper makes it exportable again, with no reload', async () => {
    mockGetQuestions.mockResolvedValueOnce([storedQuestion('q1', { text: '' })])
    renderList()
    pickDownloadItem('Paper (Word)')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(exportSpies.startBrandedDownload).not.toHaveBeenCalled()

    // Same mounted list, same menu: the paper was repaired elsewhere and the
    // next click reads the repaired paper rather than a cached verdict.
    mockGetQuestions.mockResolvedValueOnce([storedQuestion('q1')])
    pickDownloadItem('Paper (Word)')
    await waitFor(() => expect(exportSpies.startBrandedDownload).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledTimes(1)
  })
})

/* ── display titles, search, and the no-emoji rule ───────────────────────── */

describe('AssessmentList — display titles', () => {
  it('derives the displayed term from the term FIELD, never from the stored title text', () => {
    // An earlier build stamped a DEFAULT term into generated titles, so a
    // Term 2 paper can be stored carrying "END OF TERM 1 TEST". The list must
    // rebuild the name from the paper's own fields.
    paginated.items = [{
      id: 'b1',
      title: 'GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026',
      assessmentType: 'end_of_term',
      term: 2,
      subject: 'Integrated Science',
      grade: '4',
      questionCount: 10,
    }]
    renderList()
    expect(screen.getByText('Grade 4 Integrated Science — End of Term 2 Test')).toBeInTheDocument()
    // The stored title's wrong term never reaches the screen.
    expect(screen.queryByText(/END OF TERM 1/i)).not.toBeInTheDocument()
  })

  it('keeps a name typed before the titleSource flag existed', () => {
    // The card used to ask ONLY for `titleSource === 'manual'`, so a paper
    // named before that field was added had its name rebuilt on screen — a
    // rename the title backfill would have refused to write. Both now ask the
    // same question (assessmentTitle.isTeacherAuthoredTitle).
    paginated.items = [{
      id: 'b3',
      title: 'Chalimbana Mock 2024',
      assessmentType: 'mock_exam',
      subject: 'Integrated Science',
      grade: '8',
      questionCount: 30,
    }]
    renderList()
    expect(screen.getByText('Chalimbana Mock 2024')).toBeInTheDocument()
    expect(screen.queryByText('Grade 8 Integrated Science — Mock Examination')).not.toBeInTheDocument()
  })

  it('reads a subject stored in capitals without shouting or mangling it', () => {
    paginated.items = [
      { id: 'c1', title: '', assessmentType: 'topic_test', subject: 'INTEGRATED SCIENCE', grade: '4', questionCount: 5 },
      { id: 'c2', title: '', assessmentType: 'topic_test', subject: 'ICT', grade: '4', questionCount: 5 },
    ]
    renderList()
    expect(screen.getByText('Grade 4 Integrated Science — Topic Test')).toBeInTheDocument()
    // Blanket title-casing turned this into "Ict".
    expect(screen.getByText('Grade 4 ICT — Topic Test')).toBeInTheDocument()
  })

  it('renders a manually-titled paper verbatim', () => {
    paginated.items = [{
      id: 'b2',
      title: 'Mrs Zulu Friday Revision Special',
      titleSource: 'manual',
      assessmentType: 'topic_test',
      subject: 'Mathematics',
      grade: '5',
      questionCount: 4,
    }]
    renderList()
    expect(screen.getByText('Mrs Zulu Friday Revision Special')).toBeInTheDocument()
    expect(screen.queryByText('Grade 5 Mathematics — Topic Test')).not.toBeInTheDocument()
  })
})

describe('AssessmentList — toolbar', () => {
  it('the search input filters the visible papers client-side', () => {
    renderList()
    // Both display titles render before any search.
    expect(screen.getByText('Grade 5 Mathematics — Topic Test')).toBeInTheDocument()
    expect(screen.getByText('Grade 8 Integrated Science — Examination')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search papers…'), { target: { value: 'science' } })
    expect(screen.queryByText('Grade 5 Mathematics — Topic Test')).not.toBeInTheDocument()
    expect(screen.getByText('Grade 8 Integrated Science — Examination')).toBeInTheDocument()

    // Clearing the search brings everything back — no refetch, no reload.
    fireEvent.change(screen.getByPlaceholderText('Search papers…'), { target: { value: '' } })
    expect(screen.getByText('Grade 5 Mathematics — Topic Test')).toBeInTheDocument()
  })

  it('renders no emoji glyphs anywhere (the eagle mascot is gone)', () => {
    renderList()
    expect(document.body.textContent).not.toContain('🦅')
    // The old emoji action buttons are gone too — actions are Open/Download/⋯.
    expect(document.body.textContent).not.toContain('📝')
    expect(document.body.textContent).not.toContain('🗑')
  })
})
