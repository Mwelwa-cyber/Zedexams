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
vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getAssessmentQuestions: vi.fn().mockResolvedValue([]),
    deleteAssessment: mockDeleteAssessment,
  }),
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
vi.mock('../../utils/assessmentToPdf', () => ({ printAssessmentAsPdf: vi.fn(), openPrintWindow: vi.fn() }))
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
  paginated.items = [
    { id: 'a1', title: 'Grade 5 Maths Test', assessmentType: 'topic_test', questionCount: 3 },
    { id: 'a2', title: 'Form 1 Science Exam', assessmentType: 'examination', questionCount: 5 },
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
