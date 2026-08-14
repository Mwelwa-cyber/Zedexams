/**
 * SaveOfflineButton — the real pin-for-offline control on the notes reader.
 * Guards: it only shows for content-in-doc notes, reflects the pinned state,
 * and pins/unpins through the offline cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const mockDownloadForOffline = vi.fn()
const mockUnpin = vi.fn()
const mockGetContent = vi.fn()
vi.mock('../../../offline/contentCache.js', () => ({
  downloadForOffline: (...a) => mockDownloadForOffline(...a),
  unpin: (...a) => mockUnpin(...a),
}))
vi.mock('../../../offline/offlineStore.js', () => ({
  getContent: (...a) => mockGetContent(...a),
}))
vi.mock('../hooks/useOfflineNote', () => ({ fetchNoteForCache: vi.fn(async () => ({ id: 'n1' })) }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../shared/components/icons', () => ({
  Download: () => null, Check: () => null, Loader2: () => null, Trash2: () => null,
}))

import { SaveOfflineButton } from './SaveOfflineButton'

const studyNote = { id: 'n1', noteFormat: 'study' }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetContent.mockResolvedValue(null) // not pinned by default
  mockDownloadForOffline.mockResolvedValue({})
  mockUnpin.mockResolvedValue(undefined)
})

describe('SaveOfflineButton', () => {
  it('offers "Save for offline" for a content-in-doc note', async () => {
    render(<SaveOfflineButton note={studyNote} />)
    expect(await screen.findByRole('button', { name: /Save for offline/i })).toBeInTheDocument()
  })

  it('pins the note through the offline cache on click and flips to Saved', async () => {
    render(<SaveOfflineButton note={studyNote} />)
    fireEvent.click(await screen.findByRole('button', { name: /Save for offline/i }))
    await waitFor(() =>
      expect(mockDownloadForOffline).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'note', id: 'n1' }),
      ),
    )
    expect(await screen.findByRole('button', { name: /Saved offline/i })).toBeInTheDocument()
  })

  it('shows the Saved state when the note is already pinned, and can remove it', async () => {
    mockGetContent.mockResolvedValue({ entry: { pinned: true } })
    render(<SaveOfflineButton note={studyNote} />)
    const savedBtn = await screen.findByRole('button', { name: /Saved offline/i })
    fireEvent.click(savedBtn)
    await waitFor(() => expect(mockUnpin).toHaveBeenCalledWith('note', 'n1'))
    expect(await screen.findByRole('button', { name: /Save for offline/i })).toBeInTheDocument()
  })

  it('renders nothing for a FILE note (external PDF — not pinnable)', () => {
    const { container } = render(<SaveOfflineButton note={{ id: 'n2', noteFormat: 'file' }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing without a note', () => {
    const { container } = render(<SaveOfflineButton note={null} />)
    expect(container.firstChild).toBeNull()
  })
})
