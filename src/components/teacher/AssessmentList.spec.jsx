/**
 * Behaviour tests for AssessmentList.jsx's deletion flow — the fix for the
 * "deleted assessment comes back after refresh / re-entry" bug.
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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Firebase / pagination plumbing (usePaginatedQuery is mocked, so the real
//    fetcher/query-key never run) ──────────────────────────────────────────
vi.mock('../../firebase/config', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({ where: vi.fn(() => ({})) }))
vi.mock('../../utils/pagination/firestorePage', () => ({ createFirestorePageFetcher: () => vi.fn() }))
vi.mock('../../utils/pagination/queryKeys', () => ({ createPaginationKey: () => 'key' }))
vi.mock('../../utils/pagination/cursors', () => ({ PAGE_SIZES: { DESKTOP_LIST: 20 } }))

const paginated = vi.hoisted(() => ({
  items: [],
  isInitialLoading: false,
  isLoadingNextPage: false,
  hasNextPage: false,
  error: null,
  loadNextPage: vi.fn(),
  removeItem: vi.fn(),
}))
vi.mock('../../hooks/usePaginatedQuery', () => ({ usePaginatedQuery: () => paginated }))

const mockDeleteAssessment = vi.fn()
const mockGetQuestions = vi.hoisted(() => vi.fn().mockResolvedValue([]))
vi.mock('../../hooks/useFirestore', () => ({
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
vi.mock('../../utils/assessmentExportClient', () => ({
  startBrandedDownload: exportSpies.startBrandedDownload,
}))
vi.mock('../../utils/assessmentToDocx', () => ({
  downloadAssessmentDocx: exportSpies.downloadAssessmentDocx,
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'owner-1' }, userProfile: { id: 'owner-1' }, isAdmin: false }),
}))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../ui/Toast', () => ({ useToast: () => toast }))

// Lightweight ConfirmDialog stub — renders the title + message and wires the
// confirm/cancel buttons so we can drive the real confirmDelete handler.
vi.mock('../ui/ConfirmDialog', () => ({
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
vi.mock('../../utils/downloadFilename', () => ({ buildAssessmentName: () => 'file.docx' }))
vi.mock('../../utils/teacherLibraryService', () => ({ isFreePlanTeacher: () => false }))
// openPrintWindow must return a window-like object: the row aborts with a
// "pop-ups blocked" toast on a falsy return, which would stop a print test
// before it ever reached the export gate.
vi.mock('../../utils/assessmentToPdf', () => ({
  printAssessmentAsPdf: vi.fn(),
  openPrintWindow: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock('../../utils/importReviewSummary.js', () => ({ summarizeImportReview: () => ({ needsReview: false }) }))
vi.mock('../quiz/ImportReviewBadge', () => ({ default: () => null }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../ui/Skeleton', () => ({ default: () => null }))
vi.mock('../ui/PaginationFooter', () => ({ default: () => null }))

import AssessmentList from './AssessmentList'
import {
  isAssessmentDeleted,
  markAssessmentDeleted,
  _resetForTests,
} from '../../utils/assessmentDeletion'

function renderList() {
  return render(<MemoryRouter><AssessmentList /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetForTests()
  // Real assessments carry a subject and grade; without them the export gate
  // correctly blocks on paper details, which would mask the rule under test.
  paginated.items = [
    { id: 'a1', title: 'Grade 5 Maths Test', assessmentType: 'topic_test', questionCount: 3, subject: 'Mathematics', grade: '5' },
    { id: 'a2', title: 'Form 1 Science Exam', assessmentType: 'examination', questionCount: 5, subject: 'Integrated Science', grade: '8' },
  ]
})

describe('AssessmentList — deletion flow', () => {
  it('confirm dialog names the paper before deleting', () => {
    renderList()
    fireEvent.click(screen.getAllByRole('button', { name: /Delete/ })[0])
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Grade 5 Maths Test')
  })

  it('a confirmed delete persists, removes the row, tombstones the id, and toasts success', async () => {
    mockDeleteAssessment.mockResolvedValueOnce(undefined)
    renderList()
    fireEvent.click(screen.getAllByRole('button', { name: /🗑 Delete/ })[0])
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
    fireEvent.click(screen.getAllByRole('button', { name: /🗑 Delete/ })[0])
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

async function clickExport(label = '📝 Paper (Word)') {
  renderList()
  fireEvent.click(screen.getAllByRole('button', { name: label })[0])
  await waitFor(() => expect(mockGetQuestions).toHaveBeenCalled())
}

/** Nothing reached the teacher: no server download, no client build, no print. */
async function expectNothingDelivered() {
  const { printAssessmentAsPdf } = await import('../../utils/assessmentToPdf')
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
    const { printAssessmentAsPdf } = await import('../../utils/assessmentToPdf')
    mockGetQuestions.mockResolvedValueOnce([storedQuestion('q1', { text: '' })])
    await clickExport('📄 Paper (PDF)')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(printAssessmentAsPdf).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getAllByRole('button', { name: '📝 Paper (Word)' })[0])
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(exportSpies.startBrandedDownload).not.toHaveBeenCalled()

    // Same mounted list, same button: the paper was repaired elsewhere and the
    // next click reads the repaired paper rather than a cached verdict.
    mockGetQuestions.mockResolvedValueOnce([storedQuestion('q1')])
    fireEvent.click(screen.getAllByRole('button', { name: '📝 Paper (Word)' })[0])
    await waitFor(() => expect(exportSpies.startBrandedDownload).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledTimes(1)
  })
})
