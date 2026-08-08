import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

const navigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' } }),
}))
vi.mock('../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))
vi.mock('../../hooks/draft/draftCloudSync', () => ({
  listDraftsRemote: vi.fn(),
  deleteDraftRemote: vi.fn(async () => {}),
}))
vi.mock('../../hooks/draft/draftIdbStore', () => ({
  idbListDrafts: vi.fn(async () => []),
  idbDeleteDraft: vi.fn(async () => {}),
}))
vi.mock('../../utils/teacherLibraryService', () => ({ TOOL_META: {} }))
vi.mock('../../utils/gamificationService', () => ({ timeAgo: () => 'just now' }))
vi.mock('../../components/teacher/StudioPageHeader', () => ({ default: () => null }))
vi.mock('../../components/seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => Object.assign(vi.fn(), { info: vi.fn(), error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  default: ({ open, onConfirm }) => (open ? <button onClick={onConfirm}>__confirm__</button> : null),
}))

import RecoveryCentre from './RecoveryCentre.jsx'
import { listDraftsRemote, deleteDraftRemote } from '../../hooks/draft/draftCloudSync'
import { idbListDrafts, idbDeleteDraft } from '../../hooks/draft/draftIdbStore'

beforeEach(() => {
  vi.clearAllMocks()
  idbListDrafts.mockResolvedValue([])
})

describe('RecoveryCentre', () => {
  it('shows the empty state when there are no drafts', async () => {
    listDraftsRemote.mockResolvedValue([])
    render(<RecoveryCentre />)
    await waitFor(() => expect(screen.getByText(/No drafts in progress/)).toBeInTheDocument())
  })

  it('lists a draft with its studio label and summary, and resumes it', async () => {
    listDraftsRemote.mockResolvedValue([
      { draftId: 'notes-current', studioId: 'notes', savedAt: 1000, payload: { curr: { grade: 'G5', subjectLabel: 'Mathematics', topic: 'Fractions' } } },
    ])
    render(<RecoveryCentre />)
    await waitFor(() => expect(screen.getByText('Teacher Notes')).toBeInTheDocument())
    expect(screen.getByText(/Grade 5 · Mathematics · Fractions/)).toBeInTheDocument()

    await userEvent.click(screen.getByText('Continue editing'))
    expect(navigate).toHaveBeenCalledWith('/teacher/generate/notes')
  })

  /* A draft for a studio that is no longer offered is still the teacher's:
     it is listed and it can still be discarded. Only "Continue editing" goes,
     because it would bounce straight off the studio's redirect. */
  it('lists a withdrawn studio\'s draft but does not offer to resume it', async () => {
    listDraftsRemote.mockResolvedValue([
      { draftId: 'worksheet-current', studioId: 'worksheet', savedAt: 1000, payload: { curr: { topic: 'Fractions' } } },
    ])
    render(<RecoveryCentre />)
    await waitFor(() => expect(screen.getByText('Worksheet')).toBeInTheDocument())
    expect(screen.getByText('Worksheet (tool returning soon)')).toBeInTheDocument()
    expect(screen.queryByText('Continue editing')).toBeNull()
    expect(screen.getByText('Discard')).toBeInTheDocument()
  })

  it('lists a retired studio\'s draft but does not offer to resume it', async () => {
    listDraftsRemote.mockResolvedValue([
      { draftId: 'rubric-current', studioId: 'rubric', savedAt: 1000, payload: { curr: { topic: 'Project' } } },
    ])
    render(<RecoveryCentre />)
    await waitFor(() => expect(screen.getByText('Rubric (retired tool)')).toBeInTheDocument())
    expect(screen.queryByText('Continue editing')).toBeNull()
    expect(screen.getByText('Discard')).toBeInTheDocument()
  })

  it('deep-links an SBA draft to its subject/grade combo', async () => {
    listDraftsRemote.mockResolvedValue([
      { draftId: 'sba_tracker-mathematics-G5', studioId: 'sba_tracker', savedAt: 1, payload: { pupils: [{ name: 'A' }] } },
    ])
    render(<RecoveryCentre />)
    await waitFor(() => expect(screen.getByText('SBA Mark Tracker')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Continue editing'))
    expect(navigate).toHaveBeenCalledWith('/teacher/generate/sba-tracker?subject=mathematics&grade=G5')
  })

  it('discards a draft (both stores) and removes the row', async () => {
    listDraftsRemote.mockResolvedValue([
      { draftId: 'notes-current', studioId: 'notes', savedAt: 1, payload: { curr: { topic: 'Cells' } } },
    ])
    render(<RecoveryCentre />)
    await waitFor(() => expect(screen.getByText('Teacher Notes')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Discard'))
    await userEvent.click(screen.getByText('__confirm__'))

    await waitFor(() => expect(deleteDraftRemote).toHaveBeenCalledWith({ uid: 'u1', draftId: 'notes-current' }))
    expect(idbDeleteDraft).toHaveBeenCalledWith({ studioId: 'notes', uid: 'u1', draftId: 'notes-current' })
    await waitFor(() => expect(screen.queryByText('Teacher Notes')).not.toBeInTheDocument())
  })
})
